alter table public.email_outbox drop constraint email_outbox_state_check;
alter table public.email_outbox add constraint email_outbox_state_check check(state in ('queued','accepted_by_provider','delivered','failed','development_outbox'));
alter table public.email_outbox add column lease_id uuid;
alter table public.email_outbox add column leased_until timestamptz;
alter table public.email_outbox add column first_attempt_at timestamptz;
alter table public.email_outbox add column error_code text;
alter table public.email_outbox add column source_id uuid;
create index outbox_due on public.email_outbox(next_attempt_at) where state='queued';

create function public.email_proof(p_order uuid,p_revision int,p_files uuid[],p_token text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare proof uuid; o orders; r review_requests; begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid review token'; end if;
 proof:=send_proof(p_order,p_revision,p_files,encode(sha256(convert_to(p_token,'UTF8')),'hex'));
 select * into o from orders where id=p_order;
 select * into r from review_requests where proof_id=proof;
 insert into email_outbox(workspace_id,order_id,template,recipient,dedupe_key,source_id,payload)
 select o.workspace_id,o.id,'review',c.email,'review:'||r.id,r.id,
  jsonb_build_object('token',p_token,'order_number',o.number,'version',p.version,'shop',w.name)
 from customers c,workspaces w,proof_versions p where c.id=o.customer_id and w.id=o.workspace_id and p.id=proof;
 perform record_event(o.workspace_id,o.id,'Email queued',jsonb_build_object('template','review'));
 return proof;
end $$;

create function public.email_invitation(p_email text,p_token text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation_id uuid; i invitations; begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation token'; end if;
 invitation_id:=invite_staff(p_email,encode(sha256(convert_to(p_token,'UTF8')),'hex'));
 select * into i from invitations where id=invitation_id;
 insert into email_outbox(workspace_id,template,recipient,dedupe_key,source_id,payload)
 select i.workspace_id,'invitation',i.email,'invitation:'||i.id,i.id,jsonb_build_object('token',p_token,'shop',name)
 from workspaces where id=i.workspace_id;
 return invitation_id;
end $$;

create function public.queue_pickup_notice(p_order uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; job uuid; begin
 select * into o from orders where id=p_order for update;
 perform require_member(o.workspace_id);
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
  raise exception 'Verify your email before notifying customers'; end if;
 if o.lifecycle<>'ready_for_pickup' then raise exception 'Only ready orders can receive a pickup notice'; end if;
 insert into email_outbox(workspace_id,order_id,template,recipient,dedupe_key,payload)
 select o.workspace_id,o.id,'pickup',c.email,'pickup:'||o.id,jsonb_build_object('order_number',o.number,'shop',w.name,'contact_email',w.contact_email)
 from customers c,workspaces w where c.id=o.customer_id and w.id=o.workspace_id
 on conflict(dedupe_key) do nothing returning id into job;
 if job is not null then perform record_event(o.workspace_id,o.id,'Email queued',jsonb_build_object('template','pickup'));
 else select id into job from email_outbox where dedupe_key='pickup:'||o.id; end if;
 return job;
end $$;

-- Worker-only claim/finish functions. SKIP LOCKED permits overlapping scheduled jobs.
create function public.claim_outbox(p_limit int default 5) returns setof email_outbox
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Never re-send after the provider's 24-hour idempotency window. Purge stale bearer payloads.
 update email_outbox set state='failed',error_code='retry_window_expired',payload='{}',lease_id=null,leased_until=null
 where state in ('queued','failed') and first_attempt_at<now()-interval '23 hours' and (leased_until is null or leased_until<=now());
 update email_outbox e set state='failed',error_code=case when template='pickup' then 'order_not_ready' else 'link_inactive' end,payload='{}',lease_id=null,leased_until=null
 where e.state in ('queued','failed') and (e.leased_until is null or e.leased_until<=now()) and (
  (template='review' and not exists(select 1 from review_requests r where r.id=e.source_id and r.revoked_at is null and r.decided_at is null and r.expires_at>now())) or
  (template='invitation' and not exists(select 1 from invitations i where i.id=e.source_id and i.revoked_at is null and i.accepted_at is null and i.expires_at>now())) or
  (template='pickup' and not exists(select 1 from orders o where o.id=e.order_id and o.lifecycle='ready_for_pickup')));
 update email_outbox set state='failed',error_code='attempt_limit',lease_id=null,leased_until=null
 where state='queued' and attempts>=6 and (leased_until is null or leased_until<=now());
 return query with candidates as (
  select id from email_outbox where state='queued' and next_attempt_at<=now() and attempts<6
   and (leased_until is null or leased_until<=now()) order by created_at limit greatest(1,least(coalesce(p_limit,5),5)) for update skip locked
 ) update email_outbox e set lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes',
    attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now())
  from candidates c where e.id=c.id returning e.*;
end $$;

create function public.finish_outbox(p_id uuid,p_lease uuid,p_state text,p_provider text default null,p_error text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare e email_outbox; next_state text; begin
 select * into e from email_outbox where id=p_id for update;
 if not found or e.lease_id is distinct from p_lease or e.leased_until<=now() or e.state<>'queued' then return false; end if;
 if p_state not in ('accepted_by_provider','development_outbox','failed') then raise exception 'Invalid delivery result'; end if;
 if p_state='accepted_by_provider' and coalesce(length(p_provider),0)=0 then raise exception 'Provider reference required'; end if;
 next_state:=case when p_state='failed' and e.attempts<6 then 'queued' else p_state end;
 update email_outbox set state=next_state,provider_id=left(p_provider,200),error_code=left(p_error,80),lease_id=null,leased_until=null,
  next_attempt_at=now()+make_interval(secs=>least(3600,(60*power(2,e.attempts-1))::int)),
  payload=case when p_state in ('accepted_by_provider','development_outbox') then '{}'::jsonb else payload end where id=p_id;
 if e.order_id is not null then
  perform record_event(e.workspace_id,e.order_id,case when p_state='failed' then 'Email attempt failed' when p_state='development_outbox' then 'Email written to development outbox' else 'Email accepted by provider' end,
   jsonb_build_object('email_id',e.id,'template',e.template,'attempt',e.attempts,'state',next_state,'error_code',left(p_error,80)));
 end if;
 return true;
end $$;

create function public.outbox_status() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,false,true);
 return coalesce((select jsonb_agg(to_jsonb(s)) from (select id,order_id,template,recipient,state,attempts,next_attempt_at,error_code,created_at from email_outbox where workspace_id=w order by created_at desc limit 30) s),'[]'::jsonb);
end $$;

create function public.retry_email(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare e email_outbox; begin
 select * into e from email_outbox where id=p_id for update; perform require_member(e.workspace_id,false,true);
 if e.state not in ('queued','failed') or e.attempts>=6 or e.first_attempt_at<now()-interval '23 hours'
  or e.leased_until>now() or e.error_code in ('link_inactive','retry_window_expired','order_not_ready') then raise exception 'This message cannot be retried. Create a fresh request if appropriate.'; end if;
 if e.next_attempt_at>now() then raise exception 'Wait for the scheduled retry time'; end if;
 update email_outbox set state='queued',next_attempt_at=now(),error_code=null where id=p_id;
end $$;

revoke all on function public.email_proof(uuid,int,uuid[],text),public.email_invitation(text,text),public.queue_pickup_notice(uuid),public.outbox_status(),public.retry_email(uuid),public.claim_outbox(int),public.finish_outbox(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.email_proof(uuid,int,uuid[],text),public.email_invitation(text,text),public.queue_pickup_notice(uuid),public.outbox_status(),public.retry_email(uuid) to authenticated,service_role;
grant execute on function public.claim_outbox(int),public.finish_outbox(uuid,uuid,text,text,text) to service_role;
