import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const db = new PGlite();
const owner = randomUUID(),
  other = randomUUID();
let workspace: string, orderId: string, fileId: string;
const garments = [
  {
    description: 'Company polos',
    color: 'Sandstone',
    sizes: [
      { size: 'S', expected: 6, received: 6 },
      { size: 'M', expected: 8, received: 7 },
      { size: 'L', expected: 6, received: 6 },
      { size: 'XL', expected: 4, received: 4 },
    ],
  },
];
const spec = {
  placement: 'Left chest',
  design: 'Northline',
  dimensions: '3 inches',
  thread: 'Green',
  text: 'NORTHLINE',
  instructions: 'Match left chest placement.',
};
async function asUser(user: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
}
async function service() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
}
async function rpc<T = unknown>(name: string, args: unknown[] = []) {
  return db.query<Record<string, T>>(
    `select to_jsonb(public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})) result`,
    args,
  );
}
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`,
  );
  await db.exec(readFileSync('supabase/migrations/202610190001_foundation.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610190003_review_status.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610190004_review_rate_limits.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610190005_team.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610190006_outbox.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610190007_billing.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610190008_upload_cleanup.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610190009_customers.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610200010_order_controls.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610200011_order_directory.sql', 'utf8'));
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [
    owner,
    'owner@example.test',
    other,
    'other@example.test',
  ]);
  await asUser(owner);
  workspace = String(
    (await rpc('onboard_shop', ['Cedar Stitch Demo', 'America/Los_Angeles', 'Policy one'])).rows[0]
      .result,
  );
  orderId = randomUUID();
  await rpc('create_order', [
    'Northline team polos',
    'Alex Morgan',
    'alex@example.test',
    'Northline',
    '2026-10-23',
    orderId,
  ]);
});
afterAll(async () => {
  await db.close();
});
test('onboarding is idempotent and creates one seven-day workspace', async () => {
  await asUser(owner);
  expect(
    (await rpc('onboard_shop', ['Different name', 'America/Los_Angeles', ''])).rows[0].result,
  ).toBe(workspace);
  expect((await db.query('select * from workspaces')).rows).toHaveLength(1);
});
test('a second tenant cannot read or mutate the first tenant through direct SQL or RPC', async () => {
  await asUser(other);
  await rpc('onboard_shop', ['Other shop', 'America/New_York', '']);
  expect((await db.query('select * from orders where id=$1', [orderId])).rows).toHaveLength(0);
  await expect(rpc('save_internal_note', [orderId, 0, 'Attack'])).rejects.toThrow(
    'Workspace access denied',
  );
  await expect(
    db.query('update orders set title=$1 where id=$2', ['Attack', orderId]),
  ).rejects.toThrow(/permission denied/);
  await expect(db.query('select token_digest from review_requests')).rejects.toThrow(
    /permission denied/,
  );
});
test('intake persists quantities, rejects invalid counts and stale writes, and preserves history', async () => {
  await asUser(owner);
  const invalid = structuredClone(garments);
  invalid[0].sizes[0].received = -1;
  await expect(
    rpc('save_intake', [
      orderId,
      0,
      JSON.stringify(invalid),
      JSON.stringify(spec),
      'Initial intake',
    ]),
  ).rejects.toThrow(/nonnegative/);
  await rpc('save_intake', [
    orderId,
    0,
    JSON.stringify(garments),
    JSON.stringify(spec),
    'One medium missing at intake',
  ]);
  const result = await db.query<{ garments: unknown; revision: number }>(
    'select garments,revision from orders where id=$1',
    [orderId],
  );
  expect(result.rows[0].garments).toEqual(garments);
  expect(result.rows[0].revision).toBe(1);
  await expect(
    rpc('save_intake', [orderId, 0, JSON.stringify(garments), JSON.stringify(spec), 'Stale edit']),
  ).rejects.toThrow('This order changed');
  const history = await db.query<{
    details: { before: unknown; after: unknown };
  }>("select details from order_events where order_id=$1 and kind='Intake updated'", [orderId]);
  expect(history.rows[0].details.before).toEqual([]);
  expect(history.rows[0].details.after).toEqual(garments);
});
test('discrepancies block proof requests and storage reservations enforce the workspace limit', async () => {
  await asUser(owner);
  await expect(rpc('send_proof', [orderId, 1, [], 'a'.repeat(64)])).rejects.toThrow('Reconcile');
  await service();
  await db.query('update workspaces set storage_limit=100 where id=$1', [workspace]);
  await asUser(owner);
  await expect(
    rpc('reserve_attachment', [orderId, 'test.png', 'image/png', 101, 'proof', '']),
  ).rejects.toThrow('storage allowance');
  const file = (
    await rpc<{ id: string }>('reserve_attachment', [
      orderId,
      'test.png',
      'image/png',
      90,
      'proof',
      '',
    ])
  ).rows[0].result;
  fileId = file.id;
  await expect(
    rpc('reserve_attachment', [orderId, 'second.png', 'image/png', 90, 'proof', '']),
  ).rejects.toThrow('storage allowance');
  await service();
  await rpc('finalize_attachment', [fileId, 'b'.repeat(64), true]);
  await asUser(owner);
});
test('the fictional change-request and replacement approval journey keeps each decision with its version', async () => {
  await asUser(owner);
  garments[0].sizes[1].received = 8;
  await rpc('save_intake', [
    orderId,
    1,
    JSON.stringify(garments),
    JSON.stringify(spec),
    'Missing medium delivered',
  ]);
  await rpc('send_proof', [orderId, 2, [fileId], '1'.repeat(64)]);
  await service();
  const review = (
    await rpc<{ snapshot: Record<string, unknown> }>('review_bundle', ['1'.repeat(64)])
  ).rows[0].result;
  expect(review.snapshot).not.toHaveProperty('internal_notes');
  expect(review.snapshot).not.toHaveProperty('customers');
  await rpc('decide_review', [
    '1'.repeat(64),
    'changes_requested',
    '',
    'Please make the logo smaller',
    false,
    false,
  ]);
  await asUser(owner);
  await rpc('send_proof', [orderId, 3, [fileId], '2'.repeat(64)]);
  await expect(rpc('start_production', [orderId])).rejects.toThrow('Current customer approval');
  await service();
  await expect(
    rpc('decide_review', ['1'.repeat(64), 'approved', 'Alex Morgan', '', true, true]),
  ).rejects.toThrow('already been recorded');
  await expect(
    rpc('decide_review', ['2'.repeat(64), 'approved', 'Alex Morgan', '', true, false]),
  ).rejects.toThrow('Both confirmations');
  await rpc('decide_review', ['2'.repeat(64), 'approved', 'Alex Morgan', '', true, true]);
  await rpc('decide_review', ['2'.repeat(64), 'approved', 'Alex Morgan', '', true, true]);
  expect(
    (await db.query('select * from approval_decisions where order_id=$1', [orderId])).rows,
  ).toHaveLength(2);
  expect(
    (await db.query('select * from email_outbox where order_id=$1', [orderId])).rows,
  ).toHaveLength(2);
});
test('internal notes preserve approval; specifications invalidate it; production requires a fresh approval', async () => {
  await asUser(owner);
  await rpc('save_internal_note', [orderId, 4, 'Keep this staff-only']);
  await service();
  expect(
    (
      await db.query<{ spec_revision: number }>('select spec_revision from orders where id=$1', [
        orderId,
      ])
    ).rows[0].spec_revision,
  ).toBe(2);
  await asUser(owner);
  await rpc('save_intake', [
    orderId,
    5,
    JSON.stringify(garments),
    JSON.stringify({ ...spec, dimensions: '2.5 inches' }),
    'Smaller final dimensions',
  ]);
  await expect(rpc('start_production', [orderId])).rejects.toThrow('Current customer approval');
  await rpc('send_proof', [orderId, 6, [fileId], '3'.repeat(64)]);
  await service();
  await rpc('decide_review', ['3'.repeat(64), 'approved', 'Alex Morgan', '', true, true]);
  await asUser(owner);
  await rpc('start_production', [orderId]);
  await expect(
    rpc('save_intake', [
      orderId,
      8,
      JSON.stringify(garments),
      JSON.stringify(spec),
      'Unapproved edit',
    ]),
  ).rejects.toThrow('locked');
});
test('ready and pickup enforce reconciled production counts and a named collector', async () => {
  await asUser(owner);
  await expect(
    rpc('mark_ready', [orderId, JSON.stringify([{ completed: 23, exceptions: 0, reason: '' }])]),
  ).rejects.toThrow('must equal');
  await expect(
    rpc('mark_ready', [orderId, JSON.stringify([{ completed: 23, exceptions: 1, reason: '' }])]),
  ).rejects.toThrow('Explain');
  await rpc('mark_ready', [
    orderId,
    JSON.stringify([{ completed: 24, exceptions: 0, reason: '' }]),
  ]);
  await expect(rpc('collect_order', [orderId, '', true])).rejects.toThrow();
  await expect(rpc('collect_order', [orderId, 'Alex Morgan', false])).rejects.toThrow('Confirm');
  await rpc('collect_order', [orderId, 'Alex Morgan', true]);
  expect(
    (await db.query<{ lifecycle: string }>('select lifecycle from orders where id=$1', [orderId]))
      .rows[0].lifecycle,
  ).toBe('completed');
});
test('expired/revoked links expose no bundle and expired trial blocks new work but allows sent decisions', async () => {
  await asUser(owner);
  const id = randomUUID();
  await rpc('create_order', [
    'Later job',
    'Alex Morgan',
    'alex@example.test',
    '',
    '2026-10-24',
    id,
  ]);
  await rpc('save_intake', [
    id,
    0,
    JSON.stringify(garments),
    JSON.stringify(spec),
    'Initial intake',
  ]);
  await service();
  await db.query('update workspaces set storage_limit=10000 where id=$1', [workspace]);
  await asUser(owner);
  const file = (
    await rpc<{ id: string }>('reserve_attachment', [id, 'p.png', 'image/png', 10, 'proof', ''])
  ).rows[0].result;
  await service();
  await rpc('finalize_attachment', [file.id, 'f'.repeat(64), true]);
  await asUser(owner);
  await rpc('send_proof', [id, 1, [file.id], '4'.repeat(64)]);
  await rpc('send_proof', [id, 2, [file.id], '5'.repeat(64)]);
  await service();
  expect((await rpc('review_bundle', ['4'.repeat(64)])).rows[0].result).toBeNull();
  await db.query("update workspaces set trial_ends_at=now()-interval '1 day' where id=$1", [
    workspace,
  ]);
  await asUser(owner);
  await expect(
    rpc('create_order', ['Blocked', 'Alex', 'a@example.test', '', null, randomUUID()]),
  ).rejects.toThrow('read-only');
  expect((await db.query('select * from orders')).rows.length).toBeGreaterThan(0);
  await service();
  await rpc('decide_review', ['5'.repeat(64), 'approved', 'Alex Morgan', '', true, true]);
  await db.query(
    "update review_requests set expires_at=now()-interval '1 day' where token_digest=$1",
    ['5'.repeat(64)],
  );
  expect((await rpc('review_bundle', ['5'.repeat(64)])).rows[0].result).toBeNull();
});
