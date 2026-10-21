-- The application can SELECT through RLS. All domain writes use narrow transactional RPCs.
revoke create on schema public from public;
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 100),
 timezone text not null default 'America/Los_Angeles', policy text not null default '', policy_version int not null default 1,
 contact_email text not null default '', created_at timestamptz not null default now(),
 trial_ends_at timestamptz not null default now()+interval '7 days', paid_through timestamptz, grace_until timestamptz,
 next_order_number int not null default 1001, storage_used bigint not null default 0 check(storage_used>=0),
 storage_limit bigint not null default 2147483648
);
create table public.memberships (
 workspace_id uuid not null references public.workspaces(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','staff')), primary key(workspace_id,user_id), unique(user_id)
);
create unique index one_owner on public.memberships(workspace_id) where role='owner';
create table public.customers (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(name) between 1 and 160), company text not null default '', email text not null,
 phone text not null default '', internal_notes text not null default '', created_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,email)
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 customer_id uuid not null, number int not null, title text not null check(length(title) between 1 and 160), due_date date,
 lifecycle text not null default 'draft' check(lifecycle in ('draft','open','in_production','ready_for_pickup','completed','cancelled')),
 garments jsonb not null default '[]', spec jsonb not null default '{}', internal_notes text not null default '',
 revision int not null default 0, spec_revision int not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,number), foreign key(workspace_id,customer_id) references public.customers(workspace_id,id)
);
create index orders_workspace_due on public.orders(workspace_id,due_date);
create index orders_workspace_created on public.orders(workspace_id,created_at desc);
create index customers_workspace_name on public.customers(workspace_id,lower(name));
create table public.attachments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, order_id uuid not null,
 path text not null unique, name text not null, mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 bytes bigint not null check(bytes between 1 and 10485760), digest text, purpose text not null check(purpose in ('proof','condition')),
 caption text not null default '', state text not null default 'reserved' check(state in ('reserved','ready','abandoned')),
 created_at timestamptz not null default now(), unique(workspace_id,order_id,id),
 foreign key(workspace_id,order_id) references public.orders(workspace_id,id),
 check(purpose='proof' or mime<>'application/pdf')
);
create table public.proof_versions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, order_id uuid not null,
 version int not null, spec_revision int not null, snapshot jsonb not null, files jsonb not null,
 sent_at timestamptz not null default now(), unique(order_id,version), unique(workspace_id,order_id,id),
 foreign key(workspace_id,order_id) references public.orders(workspace_id,id)
);
create table public.review_requests (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, order_id uuid not null, proof_id uuid not null,
 token_digest text not null unique check(length(token_digest)=64), expires_at timestamptz not null default now()+interval '7 days',
 revoked_at timestamptz, decided_at timestamptz, created_at timestamptz not null default now(),
 unique(workspace_id,order_id,id), foreign key(workspace_id,order_id,proof_id) references public.proof_versions(workspace_id,order_id,id)
);
create unique index one_pending_review on public.review_requests(order_id) where revoked_at is null and decided_at is null;
create table public.approval_decisions (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique references public.review_requests(id),
 proof_id uuid not null unique references public.proof_versions(id), workspace_id uuid not null, order_id uuid not null,
 choice text not null check(choice in ('approved','changes_requested')), name text not null default '', comments text not null default '',
 design_confirmation text not null default '', policy_confirmation text not null default '', decided_at timestamptz not null default now(),
 foreign key(workspace_id,order_id,proof_id) references public.proof_versions(workspace_id,order_id,id),
 check((choice='approved' and length(trim(name)) between 2 and 160 and length(design_confirmation)>0 and length(policy_confirmation)>0) or
 (choice='changes_requested' and length(trim(comments)) between 3 and 2000))
);
create table public.production_runs (
 order_id uuid primary key, workspace_id uuid not null, proof_id uuid not null, snapshot jsonb not null,
 counts jsonb not null default '[]', started_at timestamptz not null default now(), started_by uuid not null references auth.users(id),
 foreign key(workspace_id,order_id,proof_id) references public.proof_versions(workspace_id,order_id,id)
);
create table public.collections (
 order_id uuid primary key, workspace_id uuid not null, collector text not null check(length(trim(collector)) between 2 and 160),
 staff_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(workspace_id,order_id) references public.orders(workspace_id,id)
);
create table public.order_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, order_id uuid not null,
 actor uuid references auth.users(id), kind text not null, details jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(workspace_id,order_id) references public.orders(workspace_id,id)
);
create index order_events_order on public.order_events(order_id,created_at);
create table public.email_outbox (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id), order_id uuid,
 template text not null, recipient text not null, state text not null default 'queued' check(state in ('queued','accepted_by_provider','delivered','failed')),
 attempts int not null default 0, next_attempt_at timestamptz not null default now(), provider_id text,
 dedupe_key text not null unique, payload jsonb not null default '{}', created_at timestamptz not null default now()
);
-- Server-only tokens and email payloads never receive authenticated SELECT grants.
create function public.is_member(w uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from memberships where workspace_id=w and user_id=auth.uid())
$$;
create function public.is_owner(w uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from memberships where workspace_id=w and user_id=auth.uid() and role='owner')
$$;
create function public.require_member(w uuid, writing boolean default true, owner_only boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not is_member(w) then raise exception 'Workspace access denied'; end if;
 if owner_only and not is_owner(w) then raise exception 'Owner access required'; end if;
 if writing and not exists(select 1 from workspaces where id=w and greatest(trial_ends_at,paid_through,grace_until)>now()) then
 raise exception 'Your shop is read-only. Manage billing to resume new work.'; end if;
end $$;
do $$ declare t text; begin
 foreach t in array array['workspaces','memberships','customers','orders','attachments','proof_versions','approval_decisions','production_runs','collections','order_events','review_requests','email_outbox'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 if t not in ('review_requests','email_outbox') then
 execute format('grant select on public.%I to authenticated',t);
 if t='workspaces' then execute 'create policy read_members on public.workspaces for select to authenticated using(public.is_member(id))';
 else execute format('create policy read_members on public.%I for select to authenticated using(public.is_member(workspace_id))',t); end if;
 end if;
 end loop;
end $$;
create function public.onboard_shop(p_name text,p_timezone text,p_policy text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select workspace_id into w from memberships where user_id=auth.uid(); if found then return w; end if;
 if length(trim(p_name)) not between 2 and 100 or length(p_policy)>10000 then raise exception 'Invalid shop details'; end if;
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
 insert into workspaces(name,timezone,policy) values(trim(p_name),p_timezone,p_policy) returning id into w;
 insert into memberships values(w,auth.uid(),'owner'); return w;
end $$;
create function public.validate_garments(g jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
declare item jsonb; s jsonb; begin
 if jsonb_typeof(g)<>'array' or jsonb_array_length(g) not between 1 and 20 then raise exception 'Add at least one garment group'; end if;
 for item in select value from jsonb_array_elements(g) loop
 if length(trim(coalesce(item->>'description',''))) not between 1 and 160 or jsonb_typeof(item->'sizes')<>'array' or jsonb_array_length(item->'sizes') not between 1 and 30 then raise exception 'Invalid garment group'; end if;
 if (select count(*)<>count(distinct lower(value->>'size')) from jsonb_array_elements(item->'sizes')) then raise exception 'Duplicate sizes'; end if;
 for s in select value from jsonb_array_elements(item->'sizes') loop
 if length(trim(coalesce(s->>'size',''))) not between 1 and 24 or coalesce(s->>'expected','')!~'^\d+$' or coalesce(s->>'received','')!~'^\d+$' then raise exception 'Counts must be nonnegative whole numbers'; end if;
 if (s->>'expected')::bigint>100000 or (s->>'received')::bigint>100000 then raise exception 'Count too large'; end if;
 end loop; end loop;
end $$;
create function public.counts_reconcile(g jsonb) returns boolean language sql immutable as $$
 select not exists(select 1 from jsonb_array_elements(g) x, jsonb_array_elements(x->'sizes') s where s->>'expected'<>s->>'received')
$$;
create function public.record_event(w uuid,o uuid,k text,d jsonb default '{}') returns void language sql security definer set search_path=public,pg_temp as $$
 insert into order_events(workspace_id,order_id,actor,kind,details) values(w,o,auth.uid(),k,d)
$$;
create function public.create_order(p_title text,p_customer_name text,p_email text,p_company text,p_due date,p_key uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; c uuid; n int; existing orders; begin
 select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w);
 select * into existing from orders where id=p_key; if found then if existing.workspace_id<>w then raise exception 'Invalid request'; end if; return p_key; end if;
 if length(trim(p_title)) not between 1 and 160 or length(trim(p_customer_name)) not between 1 and 160 or length(p_email)>254 or p_email!~'^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Valid title, customer name, and email required'; end if;
 insert into customers(workspace_id,name,email,company) values(w,trim(p_customer_name),lower(trim(p_email)),left(p_company,160))
 on conflict(workspace_id,email) do update set email=excluded.email returning id into c;
 update workspaces set next_order_number=next_order_number+1 where id=w returning next_order_number-1 into n;
 insert into orders(id,workspace_id,customer_id,number,title,due_date) values(p_key,w,c,n,trim(p_title),p_due);
 perform record_event(w,p_key,'Order created'); return p_key;
end $$;
create function public.save_intake(p_order uuid,p_revision int,p_garments jsonb,p_spec jsonb,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; changed boolean; begin
 select * into o from orders where id=p_order for update; perform require_member(o.workspace_id);
 if o.revision<>p_revision then raise exception 'This order changed. Reload before saving.'; end if;
 if o.lifecycle not in ('draft','open') then raise exception 'The production specification is locked.'; end if;
 perform validate_garments(p_garments);
 if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Record a reason for this update'; end if;
 if jsonb_typeof(p_spec)<>'object' or length(trim(coalesce(p_spec->>'placement',''))) not between 1 and 160 or length(p_spec::text)>10000 then raise exception 'Decoration placement is required'; end if;
 changed := o.garments<>p_garments or o.spec<>p_spec;
 if not changed then return; end if;
 update orders set garments=p_garments,spec=p_spec,revision=revision+1,spec_revision=spec_revision+1,lifecycle='open',updated_at=now() where id=o.id;
 update review_requests set revoked_at=now() where order_id=o.id and revoked_at is null and decided_at is null;
 perform record_event(o.workspace_id,o.id,'Intake updated',jsonb_build_object('reason',p_reason,'before',o.garments,'after',p_garments,'spec_before',o.spec,'spec_after',p_spec));
end $$;
create function public.save_internal_note(p_order uuid,p_revision int,p_note text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; begin select * into o from orders where id=p_order for update; perform require_member(o.workspace_id);
 if o.revision<>p_revision then raise exception 'This order changed. Reload before saving.'; end if;
 if length(p_note)>5000 then raise exception 'Note is too long'; end if;
 update orders set internal_notes=p_note,revision=revision+1,updated_at=now() where id=o.id;
 perform record_event(o.workspace_id,o.id,'Internal note updated'); end $$;
create function public.reserve_attachment(p_order uuid,p_name text,p_mime text,p_bytes bigint,p_purpose text,p_caption text) returns attachments
language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; a attachments; aid uuid:=gen_random_uuid(); begin
 select * into o from orders where id=p_order for update; perform require_member(o.workspace_id);
 if o.lifecycle not in ('draft','open') then raise exception 'Uploads are locked after production starts'; end if;
 update workspaces set storage_used=storage_used+p_bytes where id=o.workspace_id and p_bytes between 1 and 10485760 and storage_used+p_bytes<=storage_limit;
 if not found then raise exception 'File exceeds the size limit or workspace storage allowance'; end if;
 insert into attachments(id,workspace_id,order_id,path,name,mime,bytes,purpose,caption) values(aid,o.workspace_id,o.id,o.workspace_id||'/'||o.id||'/'||aid,left(p_name,200),p_mime,p_bytes,p_purpose,left(p_caption,1000)) returning * into a;
 return a;
end $$;
create function public.finalize_attachment(p_id uuid,p_digest text,p_success boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a attachments; begin
 select * into a from attachments where id=p_id for update; if a.state<>'reserved' then return; end if;
 if p_success and p_digest!~'^[0-9a-f]{64}$' then raise exception 'Invalid digest'; end if;
 update attachments set state=case when p_success then 'ready' else 'abandoned' end,digest=p_digest where id=p_id;
 if not p_success then update workspaces set storage_used=storage_used-a.bytes where id=a.workspace_id;
 else perform record_event(a.workspace_id,a.order_id,'File uploaded',jsonb_build_object('name',a.name,'purpose',a.purpose,'attachment',a.id)); end if;
end $$;
create function public.send_proof(p_order uuid,p_revision int,p_files uuid[],p_digest text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; w workspaces; p uuid; v int; f jsonb; begin
 select * into o from orders where id=p_order for update; perform require_member(o.workspace_id);
 if o.revision<>p_revision then raise exception 'This order changed. Reload before sending.'; end if;
 if o.lifecycle<>'open' or not counts_reconcile(o.garments) or jsonb_array_length(o.garments)=0 then raise exception 'Reconcile garment counts before sending a proof'; end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Verify your email before sending a review'; end if;
 if cardinality(p_files) not between 1 and 10 or p_digest!~'^[0-9a-f]{64}$' then raise exception 'Choose 1 to 10 proof files'; end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'mime',mime,'digest',digest) order by array_position(p_files,id)) into f from attachments where id=any(p_files) and order_id=o.id and workspace_id=o.workspace_id and state='ready' and purpose='proof';
 if jsonb_array_length(f) is distinct from cardinality(p_files) then raise exception 'Invalid proof file selection'; end if;
 select * into w from workspaces where id=o.workspace_id for share;
 select coalesce(max(version),0)+1 into v from proof_versions where order_id=o.id;
 insert into proof_versions(workspace_id,order_id,version,spec_revision,snapshot,files) values(o.workspace_id,o.id,v,o.spec_revision,
 jsonb_build_object('garments',o.garments,'spec',o.spec,'policy',w.policy,'policy_version',w.policy_version,'shop',w.name,'order_number',o.number,'title',o.title,'due_date',o.due_date),f) returning id into p;
 update review_requests set revoked_at=now() where order_id=o.id and revoked_at is null and decided_at is null;
 insert into review_requests(workspace_id,order_id,proof_id,token_digest) values(o.workspace_id,o.id,p,p_digest);
 update orders set revision=revision+1,updated_at=now() where id=o.id;
 perform record_event(o.workspace_id,o.id,'Review link created',jsonb_build_object('version',v)); return p;
end $$;
create function public.review_bundle(p_digest text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r review_requests; p proof_versions; d approval_decisions; begin
 select * into r from review_requests where token_digest=p_digest and revoked_at is null and expires_at>now();
 if not found then return null; end if;
 select * into p from proof_versions where id=r.proof_id;
 select * into d from approval_decisions where request_id=r.id;
 return jsonb_build_object('id',p.id,'version',p.version,'snapshot',p.snapshot,'files',p.files,'choice',d.choice,'name',d.name,'comments',d.comments,'decided_at',d.decided_at,'expires_at',r.expires_at);
end $$;
create function public.decide_review(p_digest text,p_choice text,p_name text,p_comments text,p_design boolean,p_policy boolean) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare r review_requests; p proof_versions; o orders; existing text; begin
 -- Lock order first for the same lock order as send/start/intake, then revalidate the request.
 select * into r from review_requests where token_digest=p_digest;
 if not found then raise exception 'This review link is inactive'; end if;
 select * into o from orders where id=r.order_id for update;
 select * into r from review_requests where id=r.id for update;
 if r.revoked_at is not null or r.expires_at<=now() then raise exception 'This review link is inactive'; end if;
 select choice into existing from approval_decisions where request_id=r.id;
 if found then if existing=p_choice then return existing; else raise exception 'A decision has already been recorded'; end if; end if;
 select * into p from proof_versions where id=r.proof_id;
 if o.lifecycle<>'open' or p.spec_revision<>o.spec_revision or p.version<>(select max(version) from proof_versions where order_id=o.id) then raise exception 'This proof is no longer current'; end if;
 if p_choice='approved' and (not coalesce(p_design,false) or not coalesce(p_policy,false)) then raise exception 'Both confirmations are required'; end if;
 insert into approval_decisions(request_id,proof_id,workspace_id,order_id,choice,name,comments,design_confirmation,policy_confirmation)
 values(r.id,p.id,o.workspace_id,o.id,p_choice,left(trim(p_name),160),left(trim(p_comments),2000),
 case when p_choice='approved' then 'I approve the displayed design, instructions, and garment quantities.' else '' end,
 case when p_choice='approved' then 'I acknowledge the shop policy displayed with this proof.' else '' end);
 update review_requests set decided_at=now() where id=r.id;
 perform record_event(o.workspace_id,o.id,case when p_choice='approved' then 'Proof approved' else 'Changes requested' end,jsonb_build_object('version',p.version,'comments',left(p_comments,2000),'name',left(p_name,160)));
 insert into email_outbox(workspace_id,order_id,template,recipient,dedupe_key,payload)
 select o.workspace_id,o.id,'decision',u.email,'decision:'||r.id,jsonb_build_object('order_number',o.number,'choice',p_choice) from memberships m join auth.users u on u.id=m.user_id where m.workspace_id=o.workspace_id and m.role='owner';
 return p_choice;
end $$;
create function public.start_production(p_order uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; p proof_versions; begin
 select * into o from orders where id=p_order for update; perform require_member(o.workspace_id);
 if o.lifecycle<>'open' or not counts_reconcile(o.garments) then raise exception 'Production requires an open reconciled order'; end if;
 select * into p from proof_versions where order_id=o.id order by version desc limit 1;
 if p.id is null or p.spec_revision<>o.spec_revision or not exists(select 1 from approval_decisions where proof_id=p.id and choice='approved') or
 (p.snapshot->>'policy_version')::int<>(select policy_version from workspaces where id=o.workspace_id) then raise exception 'Current customer approval is required'; end if;
 insert into production_runs(order_id,workspace_id,proof_id,snapshot,started_by) values(o.id,o.workspace_id,p.id,p.snapshot,auth.uid());
 update orders set lifecycle='in_production',revision=revision+1,updated_at=now() where id=o.id;
 perform record_event(o.workspace_id,o.id,'Production started',jsonb_build_object('version',p.version));
end $$;
create function public.mark_ready(p_order uuid,p_counts jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; c jsonb; g jsonb; received int; idx int:=0; begin
 select * into o from orders where id=p_order for update; perform require_member(o.workspace_id);
 if o.lifecycle<>'in_production' then raise exception 'Order is not in production'; end if;
 if jsonb_typeof(p_counts)<>'array' or jsonb_array_length(p_counts)<>jsonb_array_length(o.garments) then raise exception 'Count every garment group'; end if;
 for g in select value from jsonb_array_elements(o.garments) loop
 c:=p_counts->idx; idx:=idx+1;
 if coalesce(c->>'completed','')!~'^\d+$' or coalesce(c->>'exceptions','')!~'^\d+$' then raise exception 'Use whole nonnegative counts'; end if;
 select sum((s->>'received')::int) into received from jsonb_array_elements(g->'sizes') s;
 if (c->>'completed')::bigint+(c->>'exceptions')::bigint<>received then raise exception 'Completed plus exception counts must equal received counts'; end if;
 if (c->>'exceptions')::int>0 and length(trim(coalesce(c->>'reason','')))<3 then raise exception 'Explain the production exceptions'; end if;
 end loop;
 update production_runs set counts=p_counts where order_id=o.id;
 update orders set lifecycle='ready_for_pickup',revision=revision+1,updated_at=now() where id=o.id;
 perform record_event(o.workspace_id,o.id,'Ready for pickup',jsonb_build_object('counts',p_counts));
end $$;
create function public.collect_order(p_order uuid,p_collector text,p_confirm boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; begin select * into o from orders where id=p_order for update; perform require_member(o.workspace_id);
 if o.lifecycle<>'ready_for_pickup' or not coalesce(p_confirm,false) then raise exception 'Confirm collection of the ready order'; end if;
 insert into collections(order_id,workspace_id,collector,staff_id) values(o.id,o.workspace_id,trim(p_collector),auth.uid());
 update orders set lifecycle='completed',revision=revision+1,updated_at=now() where id=o.id;
 perform record_event(o.workspace_id,o.id,'Order collected',jsonb_build_object('collector',trim(p_collector))); end $$;
create function public.update_shop(p_name text,p_timezone text,p_policy text,p_email text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; begin select workspace_id into w from memberships where user_id=auth.uid(); perform require_member(w,true,true);
 if length(p_name) not between 2 and 100 or length(p_policy)>10000 or length(p_email)>254 or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid shop settings'; end if;
 update workspaces set name=p_name,timezone=p_timezone,contact_email=p_email,policy_version=policy_version+case when policy<>p_policy then 1 else 0 end,policy=p_policy where id=w;
 -- Pending snapshots remain accurate to the shown policy; new policy requires a new approval for production.
end $$;
create function public.revoke_review(p_order uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; begin select * into o from orders where id=p_order for update; perform require_member(o.workspace_id);
 update review_requests set revoked_at=now() where order_id=o.id and revoked_at is null and decided_at is null;
 perform record_event(o.workspace_id,o.id,'Review link revoked'); end $$;
-- Explicit execute grants: PostgreSQL otherwise grants EXECUTE to PUBLIC by default.
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_member(uuid),public.is_owner(uuid) to authenticated;
grant execute on function public.onboard_shop(text,text,text), public.create_order(text,text,text,text,date,uuid),
 public.save_intake(uuid,int,jsonb,jsonb,text),public.save_internal_note(uuid,int,text),
 public.reserve_attachment(uuid,text,text,bigint,text,text), public.send_proof(uuid,int,uuid[],text),
 public.start_production(uuid),public.mark_ready(uuid,jsonb),public.collect_order(uuid,text,boolean),
 public.update_shop(text,text,text,text),public.revoke_review(uuid) to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
