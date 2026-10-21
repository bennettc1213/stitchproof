-- Pre-auth counters are server-only. Store keyed identity digests, never addresses/passwords/IPs.
create table public.auth_attempt_limits (
 action text not null check(action in ('login','signup','forgot')),
 scope text not null check(scope in ('identity','global')),
 digest text not null check(digest~'^[0-9a-f]{64}$'),
 window_start timestamptz not null,
 hits int not null check(hits>0),
 primary key(action,scope,digest,window_start)
);
create index auth_attempt_limits_expiry on public.auth_attempt_limits(window_start);
alter table public.auth_attempt_limits enable row level security;
revoke all on public.auth_attempt_limits from public,anon,authenticated;
grant all on public.auth_attempt_limits to service_role;

create function public.consume_auth_attempt(p_action text,p_digest text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare stamp timestamptz:=now(); global_start timestamptz; identity_start timestamptz;
 global_limit int; identity_limit int; span interval; attempts int;
begin
 if p_action is null or p_action not in ('login','signup','forgot') or p_digest is null or p_digest!~'^[0-9a-f]{64}$' then raise exception 'Invalid authentication limit request'; end if;
 global_limit:=case when p_action='login' then 300 else 60 end;
 identity_limit:=case when p_action='login' then 10 else 3 end;
 span:=case p_action when 'login' then interval '10 minutes' when 'signup' then interval '1 hour' else interval '15 minutes' end;
 -- Bounded cleanup; no active window is older than an hour.
 with expired as (
  select ctid from auth_attempt_limits where window_start<stamp-interval '2 hours' order by window_start limit 100 for update skip locked
 ) delete from auth_attempt_limits a using expired e where a.ctid=e.ctid;
 global_start:=date_bin(interval '1 minute',stamp,'2000-01-01'::timestamptz);
 insert into auth_attempt_limits(action,scope,digest,window_start,hits) values(p_action,'global',repeat('0',64),global_start,1)
 on conflict(action,scope,digest,window_start) do update set hits=least(auth_attempt_limits.hits+1,global_limit+1) returning hits into attempts;
 if attempts>global_limit then
  return jsonb_build_object('allowed',false,'retry_after',greatest(1,ceil(extract(epoch from global_start+interval '1 minute'-stamp))::int));
 end if;
 identity_start:=date_bin(span,stamp,'2000-01-01'::timestamptz);
 insert into auth_attempt_limits(action,scope,digest,window_start,hits) values(p_action,'identity',p_digest,identity_start,1)
 on conflict(action,scope,digest,window_start) do update set hits=least(auth_attempt_limits.hits+1,identity_limit+1) returning hits into attempts;
 return jsonb_build_object('allowed',attempts<=identity_limit,'retry_after',case when attempts<=identity_limit then 0 else greatest(1,ceil(extract(epoch from identity_start+span-stamp))::int) end);
end $$;
revoke all on function public.consume_auth_attempt(text,text) from public,anon,authenticated;
grant execute on function public.consume_auth_attempt(text,text) to service_role;
