import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const db = new PGlite();
const owner = randomUUID(),
  staff = randomUUID(),
  second = randomUUID(),
  outsider = randomUUID(),
  unverified = randomUUID();
let workspace: string;
async function user(id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
async function system() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
}
async function rpc<T = unknown>(name: string, args: unknown[] = []) {
  const result = await db.query<{ result: T }>(
    `select to_jsonb(public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})) result`,
    args,
  );
  return result.rows[0].result;
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  for (const name of [
    '202610190001_foundation.sql',
    '202610190003_review_status.sql',
    '202610190004_review_rate_limits.sql',
    '202610190005_team.sql',
    '202610190006_outbox.sql',
  ]) {
    await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
  }
  for (const [id, email] of [
    [owner, 'owner@example.test'],
    [staff, 'staff@example.test'],
    [second, 'second@example.test'],
    [outsider, 'outsider@example.test'],
  ]) {
    await db.query('insert into auth.users values($1,$2,now())', [id, email]);
  }
  await db.query('insert into auth.users values($1,$2,null)', [
    unverified,
    'unverified@example.test',
  ]);
  await user(owner);
  workspace = await rpc<string>('onboard_shop', ['Team shop', 'America/Los_Angeles', 'Policy']);
});
afterAll(async () => {
  await db.close();
});

test('owners create private email-bound links; staff and outsiders cannot manage the team', async () => {
  await user(owner);
  await rpc('invite_staff', [' STAFF@example.test ', 'a'.repeat(64)]);
  const details = await rpc<{ invitations: { email: string }[] }>('team_details');
  expect(details.invitations[0].email).toBe('staff@example.test');
  expect(JSON.stringify(details)).not.toContain('a'.repeat(64));
  await expect(db.query('select token_digest from invitations')).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    db.query("insert into memberships values($1,$2,'staff')", [workspace, outsider]),
  ).rejects.toThrow(/permission denied/);
  await user(outsider);
  await expect(rpc('accept_invitation', ['a'.repeat(64)])).rejects.toThrow('unavailable');
  await expect(rpc('team_details')).rejects.toThrow('Workspace access denied');
  await user(staff);
  expect(await rpc('accept_invitation', ['a'.repeat(64)])).toBe(workspace);
  expect(await rpc('accept_invitation', ['a'.repeat(64)])).toBe(workspace);
  await expect(rpc('invite_staff', ['outsider@example.test', 'b'.repeat(64)])).rejects.toThrow(
    'Owner access required',
  );
  await expect(rpc('team_details')).rejects.toThrow('Owner access required');
});

test('live invites reserve seats; replacement links revoke the old token', async () => {
  await user(owner);
  await rpc('invite_staff', ['second@example.test', 'b'.repeat(64)]);
  await expect(rpc('invite_staff', ['outsider@example.test', 'c'.repeat(64)])).rejects.toThrow(
    'two staff',
  );
  await rpc('invite_staff', ['second@example.test', 'd'.repeat(64)]);
  await user(second);
  await expect(rpc('accept_invitation', ['b'.repeat(64)])).rejects.toThrow('unavailable');
  await rpc('accept_invitation', ['d'.repeat(64)]);
  await user(owner);
  await expect(rpc('remove_staff', [owner])).rejects.toThrow('owner must remain');
  const details = await rpc<{ members: unknown[] }>('team_details');
  expect(details.members).toHaveLength(3);
});

test('removal immediately revokes reads, mutations, and previously accepted links', async () => {
  await user(owner);
  const order = await rpc<string>('create_order', [
    'Team order',
    'Customer',
    'customer@example.test',
    '',
    null,
    randomUUID(),
  ]);
  await user(staff);
  expect((await db.query('select id from orders where id=$1', [order])).rows).toHaveLength(1);
  await user(owner);
  await rpc('remove_staff', [staff]);
  await user(staff);
  expect((await db.query('select * from workspaces')).rows).toHaveLength(0);
  expect((await db.query('select * from orders where id=$1', [order])).rows).toHaveLength(0);
  await expect(rpc('save_internal_note', [order, 0, 'Must fail'])).rejects.toThrow(
    'Workspace access denied',
  );
  await expect(rpc('accept_invitation', ['a'.repeat(64)])).rejects.toThrow('unavailable');
});

test('expired, revoked, unverified, and already-onboarded accounts cannot accept', async () => {
  await user(owner);
  const invite = await rpc('invite_staff', ['outsider@example.test', 'e'.repeat(64)]);
  await system();
  await db.query("update invitations set expires_at=now()-interval '1 second' where id=$1", [
    invite,
  ]);
  await user(outsider);
  await expect(rpc('accept_invitation', ['e'.repeat(64)])).rejects.toThrow('unavailable');
  await user(owner);
  const revoked = await rpc('invite_staff', ['outsider@example.test', 'f'.repeat(64)]);
  await rpc('revoke_invitation', [revoked]);
  await user(outsider);
  await expect(rpc('accept_invitation', ['f'.repeat(64)])).rejects.toThrow('unavailable');
  await user(owner);
  const unverifiedInvite = await rpc('invite_staff', ['unverified@example.test', '1'.repeat(64)]);
  await user(unverified);
  await expect(rpc('accept_invitation', ['1'.repeat(64)])).rejects.toThrow('Verify your email');
  await user(owner);
  await rpc('revoke_invitation', [unverifiedInvite]);
  await rpc('invite_staff', ['outsider@example.test', '2'.repeat(64)]);
  await user(outsider);
  await rpc('onboard_shop', ['Other shop', 'America/Los_Angeles', '']);
  await expect(rpc('accept_invitation', ['2'.repeat(64)])).rejects.toThrow('already belongs');
});

test('verification is required for inviting; expiry preserves revocation and staff removal', async () => {
  await user(owner);
  await system();
  await db.query('update auth.users set email_confirmed_at=null where id=$1', [owner]);
  await user(owner);
  await expect(rpc('invite_staff', ['staff@example.test', '3'.repeat(64)])).rejects.toThrow(
    'Verify your email',
  );
  await system();
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [owner]);
  await db.query("update workspaces set trial_ends_at=now()-interval '1 day' where id=$1", [
    workspace,
  ]);
  await user(owner);
  await expect(rpc('invite_staff', ['staff@example.test', '3'.repeat(64)])).rejects.toThrow(
    'read-only',
  );
  await rpc('remove_staff', [second]);
  const details = await rpc<{ invitations: { id: string }[] }>('team_details');
  await rpc('revoke_invitation', [details.invitations[0].id]);
});
