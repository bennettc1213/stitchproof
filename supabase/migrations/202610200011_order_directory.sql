create index review_requests_proof_latest on public.review_requests(proof_id,created_at desc,id desc);
create index orders_workspace_assignment on public.orders(workspace_id,assigned_to);
create index orders_workspace_due_directory on public.orders(workspace_id,(archived_at is not null),due_date,created_at desc,id desc);

create function public.order_directory(p_query text default '',p_status text default 'all',p_assignee text default 'all',p_archived boolean default false,p_sort text default 'newest',p_page int default 1) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; policy int; q text:=trim(coalesce(p_query,'')); assigned uuid; result jsonb; begin
 select m.workspace_id,s.policy_version into w,policy from memberships m join workspaces s on s.id=m.workspace_id where m.user_id=auth.uid();
 perform require_member(w,false);
 if length(q)>160 then raise exception 'Search must be 160 characters or fewer'; end if;
 if p_status is null or p_status not in ('all','attention','pending','draft','open','in_production','ready_for_pickup','completed','cancelled','approved','changes_requested','invalidated') then raise exception 'Invalid order status'; end if;
 if p_sort is null or p_sort not in ('newest','oldest','due_asc','due_desc') then raise exception 'Invalid order sort'; end if;
 if p_archived is null then raise exception 'Choose current or archived orders'; end if;
 if p_assignee is null or (p_assignee not in ('all','unassigned') and p_assignee!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Invalid assignment filter'; end if;
 if p_assignee not in ('all','unassigned') then assigned:=p_assignee::uuid; end if;

 with base as materialized (
  select o.id,o.number,o.title,o.due_date,o.lifecycle,o.created_at,o.assigned_to,o.assigned_label,o.archived_at,
   jsonb_build_object('name',c.name,'company',c.company,'email',c.email) as customers,
   quantities.expected,quantities.received,quantities.discrepancy,
   case when p.id is null then 'not_requested'
    when p.spec_revision<>o.spec_revision or (p.snapshot->>'policy_version')::int is distinct from policy then 'invalidated'
    when d.choice is not null then d.choice
    when r.id is null or r.revoked_at is not null or r.expires_at<=now() then 'invalidated'
    else 'pending' end as approval
  from orders o join customers c on c.workspace_id=o.workspace_id and c.id=o.customer_id
  left join lateral (select id,spec_revision,snapshot from proof_versions where order_id=o.id order by version desc limit 1) p on true
  left join approval_decisions d on d.proof_id=p.id
  left join lateral (select id,revoked_at,expires_at from review_requests where proof_id=p.id order by created_at desc,id desc limit 1) r on true
  cross join lateral (
   select coalesce(sum((s->>'expected')::bigint),0) as expected,coalesce(sum((s->>'received')::bigint),0) as received,
    coalesce(bool_or((s->>'expected')::bigint<>(s->>'received')::bigint),false) as discrepancy
   from jsonb_array_elements(o.garments) g cross join lateral jsonb_array_elements(g->'sizes') s
  ) quantities
  where o.workspace_id=w and (o.archived_at is not null)=p_archived
   and (p_assignee='all' or (p_assignee='unassigned' and o.assigned_to is null) or o.assigned_to=assigned)
   and (q='' or strpos(lower(o.title||' '||c.name||' '||c.company||' '||c.email||' #'||o.number::text),lower(q))>0)
 ), classified as materialized (
  select *, lifecycle not in ('completed','cancelled') and (approval in ('changes_requested','invalidated') or discrepancy) as attention from base
 ), filtered as materialized (
  select * from classified where p_status='all' or (p_status='attention' and attention)
   or (p_status in ('pending','approved','changes_requested','invalidated') and approval=p_status and lifecycle not in ('completed','cancelled'))
   or (p_status in ('draft','open','in_production','ready_for_pickup','completed','cancelled') and lifecycle=p_status)
 ), counted as (
  select count(*) as total,greatest(1,ceil(count(*)/24.0)::int) as pages from filtered
 ), paging as (
  select *,greatest(1,least(coalesce(p_page,1),pages)) as page from counted
 ), selected as (
  select * from filtered order by
   case when p_sort='due_asc' then due_date end asc nulls last,
   case when p_sort='due_desc' then due_date end desc nulls last,
   case when p_sort='oldest' then created_at end asc,
   case when p_sort<>'oldest' then created_at end desc,
   case when p_sort='oldest' then id end asc,id desc
  limit 24 offset (select (page::bigint-1)*24 from paging)
 )
 select jsonb_build_object(
  'orders',(select coalesce(jsonb_agg(to_jsonb(s)-'attention' order by
   case when p_sort='due_asc' then due_date end asc nulls last,
   case when p_sort='due_desc' then due_date end desc nulls last,
   case when p_sort='oldest' then created_at end asc,
   case when p_sort<>'oldest' then created_at end desc,
   case when p_sort='oldest' then id end asc,id desc),'[]') from selected s),
  'total',paging.total,'pages',paging.pages,'page',paging.page,'page_size',24,
  'summary',(select jsonb_build_object('all',count(*),'attention',count(*) filter(where attention),'pending',count(*) filter(where approval='pending' and lifecycle not in ('completed','cancelled')),'ready',count(*) filter(where lifecycle='ready_for_pickup')) from classified)
 ) into result from paging;
 return result;
end $$;

revoke all on function public.order_directory(text,text,text,boolean,text,int) from public,anon,authenticated;
grant execute on function public.order_directory(text,text,text,boolean,text,int) to authenticated,service_role;
