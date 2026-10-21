-- Shop logos live in their own private bucket. The server validates and re-encodes every
-- logo to a metadata-free PNG before upload; there are no authenticated storage grants.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('shop-logos','shop-logos',false,1048576,array['image/png']);

alter table public.workspaces add column logo_path text;
alter table public.workspaces add column logo_digest text;
alter table public.workspaces add column logo_bytes int;
alter table public.workspaces add column logo_width int;
alter table public.workspaces add column logo_height int;
alter table public.workspaces add column logo_updated_at timestamptz;
alter table public.workspaces add constraint logo_complete check(
 (logo_path is null and logo_digest is null and logo_bytes is null and logo_width is null and logo_height is null) or
 (logo_path is not null and logo_digest ~ '^[0-9a-f]{64}$' and logo_bytes between 1 and 1048576
  and logo_width between 1 and 1024 and logo_height between 1 and 1024));

-- Each swap returns the displaced object path so the caller deletes exactly that object.
-- Logos are capped at 1 MiB and do not count against the order-file storage allowance.
create function public.set_shop_logo(p_path text,p_digest text,p_bytes int,p_width int,p_height int) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; old text; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,true,true);
 if coalesce(p_path,'')!~('^'||w::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$')
  or coalesce(p_digest,'')!~'^[0-9a-f]{64}$' or p_bytes not between 1 and 1048576
  or p_width not between 1 and 1024 or p_height not between 1 and 1024 then raise exception 'Invalid logo upload'; end if;
 select logo_path into old from workspaces where id=w for update;
 if old=p_path then raise exception 'This logo is already saved'; end if;
 update workspaces set logo_path=p_path,logo_digest=p_digest,logo_bytes=p_bytes,logo_width=p_width,logo_height=p_height,logo_updated_at=now() where id=w;
 return old;
end $$;
create function public.remove_shop_logo() returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; old text; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,true,true);
 select logo_path into old from workspaces where id=w for update;
 update workspaces set logo_path=null,logo_digest=null,logo_bytes=null,logo_width=null,logo_height=null,logo_updated_at=now() where id=w;
 return old;
end $$;
-- Public review pages may show the current logo of the shop that owns an active request.
create function public.review_logo(p_digest text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('path',w.logo_path,'digest',w.logo_digest,'width',w.logo_width,'height',w.logo_height)
 from review_requests r join workspaces w on w.id=r.workspace_id
 where r.token_digest=p_digest and r.revoked_at is null and r.expires_at>now() and w.logo_path is not null
$$;
revoke all on function public.set_shop_logo(text,text,int,int,int),public.remove_shop_logo(),public.review_logo(text) from public,anon,authenticated;
grant execute on function public.set_shop_logo(text,text,int,int,int),public.remove_shop_logo() to authenticated;
grant execute on function public.review_logo(text) to service_role;
