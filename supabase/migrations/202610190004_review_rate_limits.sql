-- Shared, bounded rate counters; no IP address/device fingerprint collection.
create table public.review_rate_buckets(key text primary key,window_started timestamptz not null,hits int not null);
alter table public.review_rate_buckets enable row level security;
revoke all on public.review_rate_buckets from anon,authenticated;
create function public.consume_review_limit(p_digest text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n int; k text; cutoff timestamptz:=date_trunc('minute',clock_timestamp()); begin
 -- Fixed global bucket first also bounds guessing attempts using changing random tokens.
 foreach k in array array['global',p_digest] loop
 insert into review_rate_buckets values(k,cutoff,1) on conflict(key) do update
 set hits=case when review_rate_buckets.window_started<cutoff then 1 else review_rate_buckets.hits+1 end,window_started=cutoff returning hits into n;
 if (k='global' and n>1000) or (k<>'global' and n>60) then return false; end if;
 end loop;
 delete from review_rate_buckets where window_started<clock_timestamp()-interval '10 minutes';
 return true;
end $$;
-- The rate limit is evaluated at the HTTP/server-action boundary so a rejected
-- mutation cannot roll back the counter alongside the domain transaction.
revoke all on function public.consume_review_limit(text) from public,anon,authenticated;
grant execute on function public.consume_review_limit(text) to service_role;
