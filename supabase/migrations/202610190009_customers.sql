alter table public.customers add column revision int not null default 0;
create index customers_workspace_sorted on public.customers(workspace_id,lower(name),id);
create index orders_customer_history on public.orders(workspace_id,customer_id,created_at desc,id desc);

-- Literal, case-insensitive matching; query text is never PostgREST filter syntax.
create function public.customer_directory(p_query text default '',p_page int default 1) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; q text:=trim(coalesce(p_query,'')); total bigint; pages int; page_no int; result jsonb; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,false);
 if length(q)>160 then raise exception 'Search must be 160 characters or fewer'; end if;
 select count(*) into total from customers c where c.workspace_id=w and
  (q='' or strpos(lower(c.name||' '||c.company||' '||c.email||' '||c.phone),lower(q))>0);
 pages:=greatest(1,ceil(total/24.0)::int); page_no:=greatest(1,least(coalesce(p_page,1),pages));
 select coalesce(jsonb_agg(to_jsonb(row) order by lower(row.name),row.id),'[]') into result from (
  select c.id,c.name,c.company,c.email,c.phone,
   (select count(*) from orders o where o.workspace_id=w and o.customer_id=c.id) as order_count
  from customers c where c.workspace_id=w and
   (q='' or strpos(lower(c.name||' '||c.company||' '||c.email||' '||c.phone),lower(q))>0)
  order by lower(c.name),c.id limit 24 offset (page_no::bigint-1)*24
 ) row;
 return jsonb_build_object('customers',result,'total',total,'page',page_no,'pages',pages,'page_size',24,'query',q);
end $$;

create function public.customer_order_history(p_customer uuid,p_page int default 1) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; total bigint; pages int; page_no int; result jsonb; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,false);
 if not exists(select 1 from customers where id=p_customer and workspace_id=w) then raise exception 'Customer unavailable'; end if;
 select count(*) into total from orders where workspace_id=w and customer_id=p_customer;
 pages:=greatest(1,ceil(total/24.0)::int); page_no:=greatest(1,least(coalesce(p_page,1),pages));
 select coalesce(jsonb_agg(to_jsonb(row) order by row.created_at desc,row.id desc),'[]') into result from (
  select id,number,title,lifecycle,created_at from orders where workspace_id=w and customer_id=p_customer
  order by created_at desc,id desc limit 24 offset (page_no::bigint-1)*24
 ) row;
 return jsonb_build_object('orders',result,'total',total,'page',page_no,'pages',pages,'page_size',24);
end $$;

create function public.update_customer(p_customer uuid,p_revision int,p_name text,p_company text,p_email text,p_phone text,p_notes text) returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare c customers; w uuid; next_revision int; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w);
 select * into c from customers where id=p_customer and workspace_id=w for update;
 if not found then raise exception 'Customer unavailable'; end if;
 if p_revision is distinct from c.revision then raise exception 'This customer changed. Reload before saving; your input is still here.'; end if;
 p_name:=trim(coalesce(p_name,'')); p_company:=trim(coalesce(p_company,'')); p_email:=lower(trim(coalesce(p_email,'')));
 p_phone:=trim(coalesce(p_phone,'')); p_notes:=coalesce(p_notes,'');
 if length(p_name) not between 1 and 160 or length(p_company)>160 or length(p_email)>254 or p_email!~'^[^\s@]+@[^\s@]+\.[^\s@]+$'
  or length(p_phone)>80 or length(p_notes)>10000 then raise exception 'Enter a valid name and email; keep company within 160, phone within 80, and notes within 10000 characters.'; end if;
 if (c.name,c.company,c.email,c.phone,c.internal_notes) is not distinct from (p_name,p_company,p_email,p_phone,p_notes) then return c.revision; end if;
 -- Customer edits change future contact details, never sent proofs, decisions, or queued recipients.
 update customers set name=p_name,company=p_company,email=p_email,phone=p_phone,internal_notes=p_notes,revision=revision+1
 where id=c.id returning revision into next_revision;
 return next_revision;
exception when unique_violation then raise exception 'Another customer already uses this email. Open that customer record instead.';
end $$;

revoke all on function public.customer_directory(text,int),public.customer_order_history(uuid,int),public.update_customer(uuid,int,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.customer_directory(text,int),public.customer_order_history(uuid,int),public.update_customer(uuid,int,text,text,text,text,text) to authenticated,service_role;
