alter table public.attachments add column cleanup_id uuid;
alter table public.attachments add column cleanup_until timestamptz;
alter table public.attachments add column cleaned_at timestamptz;
create index attachment_cleanup_due on public.attachments(state,created_at) where state<>'ready';

create or replace function public.finalize_attachment(p_id uuid,p_digest text,p_success boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a attachments; begin
 select * into a from attachments where id=p_id for update;
 if not found then raise exception 'Upload reservation unavailable'; end if;
 if a.state='ready' then
  if p_success and a.digest=p_digest then return; end if;
  raise exception 'This upload is already finalized';
 end if;
 if a.state<>'reserved' or a.created_at<now()-interval '1 hour' then raise exception 'Upload reservation expired. Please retry.'; end if;
 if p_success and (p_digest is null or p_digest!~'^[0-9a-f]{64}$') then raise exception 'Invalid digest'; end if;
 update attachments set state=case when p_success then 'ready' else 'abandoned' end,digest=case when p_success then p_digest else null end where id=p_id;
 if not p_success then update workspaces set storage_used=storage_used-a.bytes where id=a.workspace_id;
 else perform record_event(a.workspace_id,a.order_id,'File uploaded',jsonb_build_object('name',a.name,'purpose',a.purpose,'attachment',a.id)); end if;
end $$;

create function public.claim_attachment_cleanup(p_limit int default 20) returns setof attachments
language plpgsql security definer set search_path=public,pg_temp as $$
declare a attachments; begin
 -- Retire expired reservations before deleting bytes. A late finalization cannot revive them.
 for a in select f.* from attachments f where f.state='reserved' and f.created_at<now()-interval '1 hour'
  and not exists(select 1 from proof_versions p where p.workspace_id=f.workspace_id and p.order_id=f.order_id and p.files @> jsonb_build_array(jsonb_build_object('id',f.id)))
  order by f.created_at limit greatest(1,least(coalesce(p_limit,20),20)) for update skip locked
 loop
  update attachments set state='abandoned',digest=null where id=a.id;
  update workspaces set storage_used=storage_used-a.bytes where id=a.workspace_id;
 end loop;
 -- Recheck cleaned tombstones daily: this also catches a late-arriving orphan object.
 return query with candidates as (
  select f.id from attachments f where f.state='abandoned' and (f.cleanup_until is null or f.cleanup_until<=now())
   and (f.cleaned_at is null or f.cleaned_at<now()-interval '1 day')
   and not exists(select 1 from proof_versions p where p.workspace_id=f.workspace_id and p.order_id=f.order_id and p.files @> jsonb_build_array(jsonb_build_object('id',f.id)))
   order by f.cleaned_at nulls first,f.created_at limit greatest(1,least(coalesce(p_limit,20),20)) for update skip locked
 ) update attachments f set cleanup_id=gen_random_uuid(),cleanup_until=now()+interval '2 minutes'
 from candidates c where f.id=c.id returning f.*;
end $$;

create function public.finish_attachment_cleanup(p_id uuid,p_lease uuid,p_success boolean) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update attachments set cleaned_at=case when p_success then now() else cleaned_at end,cleanup_id=null,cleanup_until=null
 where id=p_id and state='abandoned' and cleanup_id=p_lease and cleanup_until>now();
 return found;
end $$;
revoke all on function public.claim_attachment_cleanup(int),public.finish_attachment_cleanup(uuid,uuid,boolean),public.finalize_attachment(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_attachment_cleanup(int),public.finish_attachment_cleanup(uuid,uuid,boolean),public.finalize_attachment(uuid,text,boolean) to service_role;
