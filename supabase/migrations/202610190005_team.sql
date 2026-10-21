-- Invitation tokens are bearer secrets; only their digests are stored.
create table public.invitations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 email text not null check(email=lower(trim(email)) and length(email)<=254),
 token_digest text not null unique check(token_digest ~ '^[0-9a-f]{64}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 revoked_at timestamptz, accepted_at timestamptz, accepted_by uuid references auth.users(id)
);
create index invitations_workspace on public.invitations(workspace_id,expires_at);
alter table public.invitations enable row level security;
revoke all on public.invitations from public,anon,authenticated;
grant all on public.invitations to service_role;

create function public.team_details() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; begin
 select workspace_id into w from memberships where user_id=auth.uid();
 perform require_member(w,false,true);
 return jsonb_build_object(
  'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'email',u.email) order by m.role,u.email)
    from memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w),'[]'::jsonb),
  'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'expires_at',expires_at) order by created_at)
    from invitations where workspace_id=w and revoked_at is null and accepted_at is null and expires_at>now()),'[]'::jsonb));
end $$;

create function public.invite_staff(p_email text,p_digest text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; invitation_id uuid; normalized text:=lower(trim(p_email)); begin
 select workspace_id into w from memberships where user_id=auth.uid();
 perform require_member(w,true,true);
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
  raise exception 'Verify your email before inviting staff'; end if;
 if normalized is null or length(normalized)>254 or normalized !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation'; end if;
 -- One workspace lock serializes invitations, acceptance, revocation, and removal.
 perform 1 from workspaces where id=w for update;
 if exists(select 1 from memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and lower(u.email)=normalized) then
  raise exception 'This person is already on your team'; end if;
 update invitations set revoked_at=now() where workspace_id=w and email=normalized and revoked_at is null and accepted_at is null;
 if (select count(*) from memberships where workspace_id=w and role='staff')+
    (select count(*) from invitations where workspace_id=w and revoked_at is null and accepted_at is null and expires_at>now())>=2 then
  raise exception 'Your plan allows two staff. Remove a staff member or revoke an invitation first.'; end if;
 -- Rate limit persists across application instances, including repeated replacement links.
 if (select count(*) from invitations where workspace_id=w and created_at>now()-interval '1 hour')>=10 then
  raise exception 'Too many invitations. Please try again later.'; end if;
 insert into invitations(workspace_id,email,token_digest,created_by) values(w,normalized,p_digest,auth.uid()) returning id into invitation_id;
 return invitation_id;
end $$;

create function public.accept_invitation(p_digest text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation invitations; current_email text; current_workspace uuid; begin
 if auth.uid() is null then raise exception 'Sign in to accept this invitation'; end if;
 -- Same user lock as onboarding prevents acceptance/onboarding from creating two memberships.
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select lower(email) into current_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if current_email is null then raise exception 'Verify your email before accepting an invitation'; end if;
 select * into invitation from invitations where token_digest=p_digest;
 if not found or invitation.email<>current_email then raise exception 'Invitation unavailable for this account'; end if;
 perform 1 from workspaces where id=invitation.workspace_id for update;
 select * into invitation from invitations where id=invitation.id for update;
 -- Same-account retries succeed only while the membership is still active.
 if invitation.accepted_by=auth.uid() and invitation.revoked_at is null and exists(
    select 1 from memberships where workspace_id=invitation.workspace_id and user_id=auth.uid()) then return invitation.workspace_id; end if;
 if invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() then
  raise exception 'Invitation unavailable for this account'; end if;
 select workspace_id into current_workspace from memberships where user_id=auth.uid();
 if found then raise exception 'This account already belongs to a shop. Use an account without a workspace.'; end if;
 if not exists(select 1 from workspaces where id=invitation.workspace_id and greatest(trial_ends_at,paid_through,grace_until)>now()) then
  raise exception 'This shop is read-only. Ask its owner to manage billing.'; end if;
 if (select count(*) from memberships where workspace_id=invitation.workspace_id and role='staff')>=2 then
  raise exception 'This shop already has two staff members'; end if;
 insert into memberships values(invitation.workspace_id,auth.uid(),'staff');
 update invitations set accepted_at=now(),accepted_by=auth.uid() where id=invitation.id;
 return invitation.workspace_id;
end $$;

create function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; begin
 select workspace_id into w from memberships where user_id=auth.uid();
 perform require_member(w,false,true);
 perform 1 from workspaces where id=w for update;
 update invitations set revoked_at=now() where id=p_id and workspace_id=w and accepted_at is null and revoked_at is null;
 if not found then raise exception 'Invitation unavailable'; end if;
end $$;

create function public.remove_staff(p_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; begin
 select workspace_id into w from memberships where user_id=auth.uid();
 perform require_member(w,false,true);
 perform 1 from workspaces where id=w for update;
 delete from memberships where workspace_id=w and user_id=p_user and role='staff';
 if not found then raise exception 'Only a staff member can be removed. The owner must remain.'; end if;
 update invitations set revoked_at=now() where workspace_id=w and accepted_by=p_user and revoked_at is null;
end $$;

revoke all on function public.team_details(),public.invite_staff(text,text),public.accept_invitation(text),public.revoke_invitation(uuid),public.remove_staff(uuid) from public,anon,authenticated;
grant execute on function public.team_details(),public.invite_staff(text,text),public.accept_invitation(text),public.revoke_invitation(uuid),public.remove_staff(uuid) to authenticated,service_role;
