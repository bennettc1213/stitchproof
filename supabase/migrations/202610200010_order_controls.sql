alter table public.orders add column assigned_to uuid references auth.users(id);
alter table public.orders add column assigned_label text not null default '';
alter table public.orders add column archived_at timestamptz;
alter table public.orders add column cancelled_at timestamptz;
alter table public.orders add column cancellation_reason text not null default '';
alter table public.orders add constraint archive_terminal_orders check(archived_at is null or lifecycle in ('completed','cancelled'));
create index orders_workspace_visibility on public.orders(workspace_id,(archived_at is not null),created_at desc);

-- This safe roster is available to shop members; invitations/team administration stay owner-only.
create function public.assignment_members() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; result jsonb; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,false);
 select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role) order by m.role,u.email),'[]')
 into result from memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w;
 return result;
end $$;

create function public.assign_order(p_order uuid,p_revision int,p_user uuid) returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; o orders; label text:=''; result int; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w);
 select * into o from orders where id=p_order and workspace_id=w for update;
 if not found then raise exception 'Order unavailable'; end if;
 if p_revision is distinct from o.revision then raise exception 'This order changed. Reload before saving; your input is still here.'; end if;
 if o.archived_at is not null or o.lifecycle in ('completed','cancelled') then raise exception 'Only active orders can be assigned'; end if;
 if p_user is not null then
  -- A membership key lock serializes assignment with removal. No workspace lock is taken after the order lock.
  perform 1 from memberships where workspace_id=w and user_id=p_user for key share;
  if not found then raise exception 'Choose an active member of this shop'; end if;
  select email into label from auth.users where id=p_user;
 end if;
 if o.assigned_to is not distinct from p_user then return o.revision; end if;
 update orders set assigned_to=p_user,assigned_label=coalesce(label,''),revision=revision+1,updated_at=now()
 where id=o.id returning revision into result;
 perform record_event(w,o.id,'Assignment changed',jsonb_build_object('previous_user',o.assigned_to,'previous_label',o.assigned_label,'assigned_user',p_user,'assigned_label',coalesce(label,'')));
 return result;
end $$;

create function public.cancel_order(p_order uuid,p_revision int,p_reason text,p_confirm boolean) returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; o orders; result int; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w);
 select * into o from orders where id=p_order and workspace_id=w for update;
 if not found then raise exception 'Order unavailable'; end if;
 if p_revision is distinct from o.revision then raise exception 'This order changed. Reload before saving; your input is still here.'; end if;
 if o.lifecycle not in ('draft','open') or o.archived_at is not null then raise exception 'Only draft or open orders can be cancelled; production has not been reversed.'; end if;
 p_reason:=trim(coalesce(p_reason,''));
 if not coalesce(p_confirm,false) or length(p_reason) not between 3 and 1000 then raise exception 'Confirm cancellation and record a reason between 3 and 1000 characters'; end if;
 update orders set lifecycle='cancelled',cancelled_at=now(),cancellation_reason=p_reason,revision=revision+1,updated_at=now()
 where id=o.id returning revision into result;
 update review_requests set revoked_at=now() where order_id=o.id and revoked_at is null and decided_at is null;
 -- The existing worker cancels/purges inactive queued review emails on its next run.
 -- Do not lock outbox rows here: finish_outbox records an event while holding its job lock.
 perform record_event(w,o.id,'Order cancelled',jsonb_build_object('reason',p_reason,'previous_lifecycle',o.lifecycle));
 return result;
end $$;

create function public.archive_order(p_order uuid,p_revision int,p_archived boolean) returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; o orders; result int; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w);
 select * into o from orders where id=p_order and workspace_id=w for update;
 if not found then raise exception 'Order unavailable'; end if;
 if p_revision is distinct from o.revision then raise exception 'This order changed. Reload before saving; your input is still here.'; end if;
 if p_archived is null then raise exception 'Choose archive or restore'; end if;
 if o.lifecycle not in ('completed','cancelled') then raise exception 'Only collected or cancelled orders can be archived'; end if;
 if (o.archived_at is not null)=p_archived then return o.revision; end if;
 update orders set archived_at=case when p_archived then now() else null end,revision=revision+1,updated_at=now()
 where id=o.id returning revision into result;
 perform record_event(w,o.id,case when p_archived then 'Order archived' else 'Order restored' end);
 return result;
end $$;

revoke all on function public.assignment_members(),public.assign_order(uuid,int,uuid),public.cancel_order(uuid,int,text,boolean),public.archive_order(uuid,int,boolean) from public,anon,authenticated;
grant execute on function public.assignment_members(),public.assign_order(uuid,int,uuid),public.cancel_order(uuid,int,text,boolean),public.archive_order(uuid,int,boolean) to authenticated,service_role;
