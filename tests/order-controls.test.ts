import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const db = new PGlite();
const owner = randomUUID(),
  staff = randomUUID(),
  foreign = randomUUID();
let workspace: string;
async function user(id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
async function service() {
  await db.exec('reset role');
}
async function rpc<T = unknown>(name: string, args: unknown[] = []) {
  return (
    await db.query<{ result: T }>(
      `select to_jsonb(public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})) result`,
      args,
    )
  ).rows[0].result;
}
async function create(title = 'Control fixture') {
  const id = randomUUID();
  await rpc('create_order', [title, 'Synthetic customer', 'customer@example.test', '', null, id]);
  return id;
}
async function proof(approved = false, queued = false) {
  const id = await create();
  await rpc('save_intake', [
    id,
    0,
    JSON.stringify([{ description: 'Polo', sizes: [{ size: 'M', expected: 1, received: 1 }] }]),
    JSON.stringify({ placement: 'Left chest' }),
    'Synthetic intake',
  ]);
  const attachment = await rpc<{ id: string }>('reserve_attachment', [
    id,
    'fixture.png',
    'image/png',
    100,
    'proof',
    '',
  ]);
  await service();
  await rpc('finalize_attachment', [attachment.id, 'a'.repeat(64), true]);
  await user(owner);
  const token = randomUUID().replaceAll('-', '').repeat(2);
  const digest = await db.query<{ digest: string }>(
    "select encode(sha256(convert_to($1,'UTF8')),'hex') digest",
    [token],
  );
  const hash = digest.rows[0].digest;
  if (queued) await rpc('email_proof', [id, 1, [attachment.id], token]);
  else await rpc('send_proof', [id, 1, [attachment.id], hash]);
  if (approved) {
    await service();
    await rpc('decide_review', [hash, 'approved', 'Synthetic Customer', '', true, true]);
    await user(owner);
  }
  return { id, hash, attachment: attachment.id };
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`);
  for (const name of [
    '202610190001_foundation.sql',
    '202610190003_review_status.sql',
    '202610190004_review_rate_limits.sql',
    '202610190005_team.sql',
    '202610190006_outbox.sql',
    '202610190008_upload_cleanup.sql',
    '202610200010_order_controls.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())', [
    owner,
    'owner@example.test',
    staff,
    'staff@example.test',
    foreign,
    'foreign@example.test',
  ]);
  await user(owner);
  workspace = await rpc<string>('onboard_shop', ['Controls shop', 'America/Los_Angeles', 'Policy']);
  await service();
  await db.query("insert into memberships values($1,$2,'staff')", [workspace, staff]);
  await user(foreign);
  await rpc('onboard_shop', ['Foreign shop', 'America/New_York', '']);
});
afterAll(async () => {
  await db.close();
});

test('members can assign/unassign active team members; approvals/specifications remain unchanged', async () => {
  await user(owner);
  const { id } = await proof(true);
  const before = (await db.query('select snapshot from proof_versions where order_id=$1', [id]))
    .rows;
  const choices = await rpc<{ user_id: string }[]>('assignment_members');
  expect(choices.map((m) => m.user_id).sort()).toEqual([owner, staff].sort());
  expect(await rpc('assign_order', [id, 2, staff])).toBe(3);
  expect(await rpc('assign_order', [id, 3, staff])).toBe(3);
  await expect(rpc('assign_order', [id, 2, owner])).rejects.toThrow('changed');
  await expect(rpc('assign_order', [id, 3, foreign])).rejects.toThrow('active member');
  await user(staff);
  expect(await rpc('assign_order', [id, 3, null])).toBe(4);
  expect(await rpc('assign_order', [id, 4, owner])).toBe(5);
  expect(
    (await db.query('select snapshot from proof_versions where order_id=$1', [id])).rows,
  ).toEqual(before);
  expect(
    (
      await db.query<{ spec_revision: number }>('select spec_revision from orders where id=$1', [
        id,
      ])
    ).rows[0].spec_revision,
  ).toBe(1);
  expect(
    (await db.query('select * from approval_decisions where order_id=$1', [id])).rows,
  ).toHaveLength(1);
  await rpc('start_production', [id]);
});

test('cancellation requires a reason, confirmation and current revision and disables pending review access', async () => {
  await user(owner);
  const { id, hash, attachment } = await proof(false, true);
  await expect(rpc('cancel_order', [id, 2, '', true])).rejects.toThrow('reason');
  await expect(
    rpc('cancel_order', [id, 2, 'Customer requested cancellation', false]),
  ).rejects.toThrow('Confirm');
  await expect(rpc('cancel_order', [id, 1, 'Stale cancellation', true])).rejects.toThrow('changed');
  expect(await rpc('cancel_order', [id, 2, '  Customer requested cancellation  ', true])).toBe(3);
  const order = (
    await db.query<{ lifecycle: string; cancellation_reason: string; cancelled_at: string }>(
      'select lifecycle,cancellation_reason,cancelled_at from orders where id=$1',
      [id],
    )
  ).rows[0];
  expect(order.lifecycle).toBe('cancelled');
  expect(order.cancellation_reason).toBe('Customer requested cancellation');
  expect(order.cancelled_at).toBeTruthy();
  expect(
    (await db.query('select * from attachments where id=$1 and state=$2', [attachment, 'ready']))
      .rows,
  ).toHaveLength(1);
  await expect(rpc('start_production', [id])).rejects.toThrow('open');
  await service();
  expect(await rpc('review_bundle', [hash])).toBeNull();
  await expect(
    rpc('decide_review', [hash, 'approved', 'Customer', '', true, true]),
  ).rejects.toThrow('inactive');
  await rpc('claim_outbox', [5]);
  const job = (
    await db.query<{ state: string; payload: unknown }>(
      'select state,payload from email_outbox where order_id=$1',
      [id],
    )
  ).rows[0];
  expect(job).toEqual({ state: 'failed', payload: {} });
});

test('cancelling an approved open order preserves the decision and its read-only receipt', async () => {
  await user(owner);
  const { id, hash } = await proof(true);
  const before = (await db.query('select * from approval_decisions where order_id=$1', [id])).rows;
  await rpc('cancel_order', [id, 2, 'Cancelled before production', true]);
  expect((await db.query('select * from approval_decisions where order_id=$1', [id])).rows).toEqual(
    before,
  );
  await service();
  expect((await rpc<{ choice: string }>('review_bundle', [hash])).choice).toBe('approved');
});

test('production, ready and collected orders cannot be cancelled; only terminal orders can be archived', async () => {
  await user(owner);
  const { id } = await proof(true);
  await expect(rpc('archive_order', [id, 2, true])).rejects.toThrow('collected or cancelled');
  await rpc('start_production', [id]);
  await expect(rpc('cancel_order', [id, 3, 'Wrong stage', true])).rejects.toThrow(
    'Only draft or open',
  );
  await expect(rpc('archive_order', [id, 3, true])).rejects.toThrow('collected or cancelled');
  await rpc('mark_ready', [id, JSON.stringify([{ completed: 1, exceptions: 0, reason: '' }])]);
  await expect(rpc('cancel_order', [id, 4, 'Wrong stage', true])).rejects.toThrow(
    'Only draft or open',
  );
  await rpc('collect_order', [id, 'Synthetic Customer', true]);
  await expect(rpc('cancel_order', [id, 5, 'Wrong stage', true])).rejects.toThrow(
    'Only draft or open',
  );
  await expect(rpc('assign_order', [id, 5, staff])).rejects.toThrow('Only active');
  expect(await rpc('archive_order', [id, 5, true])).toBe(6);
  expect(await rpc('archive_order', [id, 6, true])).toBe(6);
  expect(await rpc('archive_order', [id, 6, false])).toBe(7);
  const row = (
    await db.query<{ lifecycle: string; archived_at: unknown }>(
      'select lifecycle,archived_at from orders where id=$1',
      [id],
    )
  ).rows[0];
  expect(row).toEqual({ lifecycle: 'completed', archived_at: null });
  expect((await db.query('select * from collections where order_id=$1', [id])).rows).toHaveLength(
    1,
  );
});

test('cancelled orders archive/restore without reopening, with stale and direct-write protection', async () => {
  await user(owner);
  const id = await create();
  await rpc('cancel_order', [id, 0, 'No longer needed', true]);
  await rpc('archive_order', [id, 1, true]);
  await expect(rpc('archive_order', [id, 1, false])).rejects.toThrow('changed');
  await rpc('archive_order', [id, 2, false]);
  expect(
    (await db.query<{ lifecycle: string }>('select lifecycle from orders where id=$1', [id]))
      .rows[0].lifecycle,
  ).toBe('cancelled');
  expect((await db.query('select * from order_events where order_id=$1', [id])).rows).toHaveLength(
    4,
  );
  await expect(db.query('update orders set archived_at=now() where id=$1', [id])).rejects.toThrow(
    'permission denied',
  );
});

test('tenant/anonymous/expired/removed-member checks apply to every control while history remains readable', async () => {
  await user(owner);
  const id = await create();
  await rpc('assign_order', [id, 0, staff]);
  await user(foreign);
  for (const [name, args] of [
    ['assign_order', [id, 1, foreign]],
    ['cancel_order', [id, 1, 'Attack', true]],
    ['archive_order', [id, 1, true]],
  ] as const)
    await expect(rpc(name, [...args])).rejects.toThrow('unavailable');
  await db.exec('reset role; set role anon');
  await expect(rpc('assignment_members')).rejects.toThrow('permission denied');
  await user(owner);
  await service();
  await db.query("update workspaces set trial_ends_at=now()-interval '1 day' where id=$1", [
    workspace,
  ]);
  await user(owner);
  for (const [name, args] of [
    ['assign_order', [id, 1, null]],
    ['cancel_order', [id, 1, 'Blocked', true]],
    ['archive_order', [id, 1, true]],
  ] as const)
    await expect(rpc(name, [...args])).rejects.toThrow('read-only');
  expect((await db.query('select * from orders where id=$1', [id])).rows).toHaveLength(1);
  await rpc('remove_staff', [staff]);
  const removed = (
    await db.query<{ assigned_to: string; assigned_label: string }>(
      'select assigned_to,assigned_label from orders where id=$1',
      [id],
    )
  ).rows[0];
  expect(removed).toEqual({ assigned_to: staff, assigned_label: 'staff@example.test' });
  expect(
    (await rpc<{ user_id: string }[]>('assignment_members')).some((m) => m.user_id === staff),
  ).toBe(false);
  await user(staff);
  await expect(rpc('assignment_members')).rejects.toThrow('access denied');
  await expect(rpc('assign_order', [id, 1, null])).rejects.toThrow('access denied');
});
