-- Provider IDs and reconciliation controls are server-owned; no direct client writes.
create table public.billing_accounts (
 workspace_id uuid primary key references workspaces(id), customer_id text unique, subscription_id text unique,
 status text not null default 'not_subscribed', cancel_at_period_end boolean not null default false,
 failure_since timestamptz, checked_at timestamptz,
 checkout_id text, checkout_generation int not null default 0, checkout_valid_until timestamptz,
 operation_id uuid, operation_until timestamptz, sync_id uuid, sync_until timestamptz
);
create table public.billing_events (
 id text primary key, workspace_id uuid not null references workspaces(id), processed_at timestamptz not null default now()
);
alter table public.billing_accounts enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.billing_accounts,public.billing_events from public,anon,authenticated;
grant all on public.billing_accounts,public.billing_events to service_role;

create function public.billing_summary() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,false,true);
 return (select jsonb_build_object('status',coalesce(b.status,'not_subscribed'),'has_customer',b.customer_id is not null,
  'cancel_at_period_end',coalesce(b.cancel_at_period_end,false),'checked_at',b.checked_at,
  'trial_ends_at',s.trial_ends_at,'paid_through',s.paid_through,'grace_until',s.grace_until)
  from workspaces s left join billing_accounts b on b.workspace_id=s.id where s.id=w);
end $$;

create function public.begin_checkout() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; b billing_accounts; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,false,true);
 insert into billing_accounts(workspace_id) values(w) on conflict do nothing;
 select * into b from billing_accounts where workspace_id=w for update;
 if b.operation_until>now() then raise exception 'Billing is already being updated. Please retry shortly.'; end if;
 if b.checkout_valid_until is null or b.checkout_valid_until<=now() then
  b.checkout_generation:=b.checkout_generation+1; b.checkout_valid_until:=now()+interval '1 hour'; b.checkout_id:=null;
 end if;
 update billing_accounts set operation_id=gen_random_uuid(),operation_until=now()+interval '2 minutes',
  checkout_generation=b.checkout_generation,checkout_valid_until=b.checkout_valid_until,checkout_id=b.checkout_id where workspace_id=w returning * into b;
 return jsonb_build_object('workspace',w,'lease',b.operation_id,'customer',b.customer_id,'checkout',b.checkout_id,
  'generation',b.checkout_generation,'expires_at',b.checkout_valid_until);
end $$;

create function public.bind_billing_customer(p_workspace uuid,p_lease uuid,p_customer text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_customer !~ '^cus_[a-zA-Z0-9]+$' then raise exception 'Invalid billing customer'; end if;
 update billing_accounts set customer_id=p_customer where workspace_id=p_workspace and operation_id=p_lease and operation_until>now()
  and (customer_id is null or customer_id=p_customer);
 if not found then raise exception 'Billing operation expired'; end if;
end $$;

create function public.finish_checkout(p_workspace uuid,p_lease uuid,p_checkout text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update billing_accounts set checkout_id=coalesce(p_checkout,checkout_id),operation_id=null,operation_until=null
  where workspace_id=p_workspace and operation_id=p_lease and operation_until>now();
 if not found then raise exception 'Billing operation expired'; end if;
end $$;

create function public.billing_customer() returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; c text; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,false,true);
 select customer_id into c from billing_accounts where workspace_id=w; return c;
end $$;

create function public.claim_billing_sync(p_customer text,p_event text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b billing_accounts; begin
 select * into b from billing_accounts where customer_id=p_customer for update;
 if not found then return jsonb_build_object('untracked',true); end if;
 if exists(select 1 from billing_events where id=p_event) then return jsonb_build_object('duplicate',true); end if;
 if b.sync_until>now() then raise exception 'Billing reconciliation is already running'; end if;
 update billing_accounts set sync_id=gen_random_uuid(),sync_until=now()+interval '2 minutes' where workspace_id=b.workspace_id returning * into b;
 return jsonb_build_object('workspace',b.workspace_id,'lease',b.sync_id,'subscription',b.subscription_id);
end $$;

create function public.apply_billing_snapshot(p_customer text,p_event text,p_lease uuid,p_subscription text,p_status text,p_paid timestamptz,p_failure timestamptz,p_cancel boolean,p_ended timestamptz) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare b billing_accounts; failed timestamptz; begin
 select * into b from billing_accounts where customer_id=p_customer for update;
 if not found or b.sync_id is distinct from p_lease or b.sync_until<=now() then raise exception 'Billing reconciliation expired'; end if;
 if p_status not in ('not_subscribed','active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused','trialing') then raise exception 'Invalid billing state'; end if;
 if exists(select 1 from billing_events where id=p_event) then return false; end if;
 if p_status in ('past_due','unpaid') then failed:=coalesce(b.failure_since,p_failure,now());
 elsif p_status='active' and p_paid is null then failed:=b.failure_since; end if;
 update billing_accounts set subscription_id=p_subscription,status=p_status,cancel_at_period_end=p_cancel,
  failure_since=failed,checked_at=now(),sync_id=null,sync_until=null where workspace_id=b.workspace_id;
 update workspaces set paid_through=case
   when p_status='active' and p_paid is not null then p_paid
   when p_status in ('not_subscribed','unpaid','canceled','incomplete_expired','paused','trialing') then case when paid_through is null then null else least(paid_through,coalesce(p_ended,now())) end
   else paid_through end,
  grace_until=case when failed is not null and p_status in ('past_due','active') then failed+interval '3 days' else null end where id=b.workspace_id;
 insert into billing_events(id,workspace_id) values(p_event,b.workspace_id);
 return true;
end $$;

create function public.release_billing_sync(p_customer text,p_lease uuid) returns void language sql security definer set search_path=public,pg_temp as $$
 update billing_accounts set sync_id=null,sync_until=null where customer_id=p_customer and sync_id=p_lease
$$;

revoke all on function public.billing_summary(),public.begin_checkout(),public.billing_customer(),public.bind_billing_customer(uuid,uuid,text),public.finish_checkout(uuid,uuid,text),public.claim_billing_sync(text,text),public.apply_billing_snapshot(text,text,uuid,text,text,timestamptz,timestamptz,boolean,timestamptz),public.release_billing_sync(text,uuid) from public,anon,authenticated;
grant execute on function public.billing_summary(),public.begin_checkout(),public.billing_customer() to authenticated,service_role;
grant execute on function public.bind_billing_customer(uuid,uuid,text),public.finish_checkout(uuid,uuid,text),public.claim_billing_sync(text,text),public.apply_billing_snapshot(text,text,uuid,text,text,timestamptz,timestamptz,boolean,timestamptz),public.release_billing_sync(text,uuid) to service_role;
