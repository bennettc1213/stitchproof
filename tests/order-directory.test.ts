import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  orderFilters,
  orderListHref,
  orderReturnHref,
  type OrderDirectory,
} from '../src/lib/order-directory';

const db = new PGlite();
const owner = randomUUID(),
  staff = randomUUID(),
  other = randomUUID();
let workspace: string;
let ids: string[] = [];
async function user(id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
async function directory(
  query = '',
  status = 'all',
  assignee = 'all',
  archived = false,
  sort = 'newest',
  page = 1,
) {
  return (
    await db.query<{ result: OrderDirectory }>('select order_directory($1,$2,$3,$4,$5,$6) result', [
      query,
      status,
      assignee,
      archived,
      sort,
      page,
    ])
  ).rows[0].result;
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`);
  for (const file of [
    '202610190001_foundation.sql',
    '202610200010_order_controls.sql',
    '202610200011_order_directory.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())', [
    owner,
    'owner@example.test',
    staff,
    'staff@example.test',
    other,
    'other@example.test',
  ]);
  await user(owner);
  workspace = (
    await db.query<{ id: string }>(
      "select onboard_shop('Directory shop','America/Los_Angeles','Policy') id",
    )
  ).rows[0].id;
  await db.exec('reset role');
  await db.query("insert into memberships values($1,$2,'staff')", [workspace, staff]);
  const customer = randomUUID();
  await db.query(
    "insert into customers(id,workspace_id,name,company,email) values($1,$2,'Directory customer','100% Stitch','directory@example.test')",
    [customer, workspace],
  );
  await db.query(
    `insert into orders(workspace_id,customer_id,number,title,created_at,due_date,assigned_to,assigned_label,lifecycle,archived_at)
    select $1,$2,1000+n,'Directory '||lpad(n::text,3,'0'),'2026-01-01'::timestamptz+make_interval(secs=>n),
     case when n%3=0 then null else '2026-11-01'::date+(n%5) end,
     case when n%2=0 then $3::uuid else null end,case when n%2=0 then 'staff@example.test' else '' end,
     case when n>220 then 'cancelled' else 'draft' end,case when n>220 then now() else null end
    from generate_series(1,425) n`,
    [workspace, customer, staff],
  );
  ids = (await db.query<{ id: string }>('select id from orders order by number')).rows.map(
    (row) => row.id,
  );
  await db.query(
    "update orders set lifecycle='open',spec_revision=1 where number between 1001 and 1008 and workspace_id=$1",
    [workspace],
  );
  for (let index = 0; index < 7; index++) {
    const proof = randomUUID();
    await db.query(
      "insert into proof_versions(id,workspace_id,order_id,version,spec_revision,snapshot,files) values($1,$2,$3,1,$4,$5,'[]')",
      [
        proof,
        workspace,
        ids[index],
        index === 5 ? 0 : 1,
        JSON.stringify({ policy_version: index === 6 ? 0 : 1 }),
      ],
    );
    const request = randomUUID();
    await db.query(
      `insert into review_requests(id,workspace_id,order_id,proof_id,token_digest,expires_at,revoked_at,decided_at)
      values($1,$2,$3,$4,$5,now()+case when $6=1 then interval '-1 day' else interval '1 day' end,
       case when $6=2 then now() else null end,case when $6>=3 then now() else null end)`,
      [request, workspace, ids[index], proof, randomUUID().replaceAll('-', '').repeat(2), index],
    );
    if (index >= 3)
      await db.query(
        `insert into approval_decisions(request_id,proof_id,workspace_id,order_id,choice,name,comments,design_confirmation,policy_confirmation)
      values($1,$2,$3,$4,$5,'Customer','Requested revision','Design acknowledged','Policy acknowledged')`,
        [request, proof, workspace, ids[index], index === 3 ? 'changes_requested' : 'approved'],
      );
  }
  await db.query('update orders set garments=$1 where id=$2', [
    JSON.stringify([
      {
        description: 'Polo',
        sizes: [
          { size: 'S', expected: 1, received: 0 },
          { size: 'M', expected: 0, received: 1 },
        ],
      },
    ]),
    ids[7],
  ]);
  await db.query("update orders set lifecycle='ready_for_pickup' where id=$1", [ids[8]]);
  await db.query("update orders set lifecycle='completed' where id=$1", [ids[9]]);
  await db.query("update orders set lifecycle='cancelled' where id=$1", [ids[10]]);
  await user(other);
  await db.query("select onboard_shop('Other directory','America/New_York','')");
});
afterAll(async () => {
  await db.close();
});

test('URL filters are bounded/whitelisted and return links cannot navigate outside the order list', () => {
  const filters = orderFilters({
    q: '  100% Stitch  ',
    status: 'pending',
    assignee: staff.toUpperCase(),
    view: 'archived',
    sort: 'due_desc',
    page: '3',
  });
  expect(filters).toEqual({
    query: '100% Stitch',
    status: 'pending',
    assignee: staff,
    archived: true,
    sort: 'due_desc',
    page: 3,
  });
  expect(orderReturnHref(orderListHref(filters))).toBe(orderListHref(filters));
  expect(orderListHref(filters, { page: 1 })).not.toContain('page=');
  for (const value of [
    'https://evil.test/app/orders',
    '//evil.test',
    'javascript:alert(1)',
    '/app/orders/new',
    '/app/orders-else',
  ])
    expect(orderReturnHref(value)).toBe('/app/orders');
  expect(
    orderFilters({
      q: ['attack'],
      status: 'attack',
      sort: 'attack',
      assignee: 'attack',
      page: '-1',
    }),
  ).toEqual(orderFilters({}));
});
test('all current and archived records are reachable beyond 200 with stable disjoint pages', async () => {
  await user(owner);
  for (const [archived, total] of [
    [false, 220],
    [true, 205],
  ] as const) {
    const seen = new Set<string>();
    for (let page = 1; page <= Math.ceil(total / 24); page++) {
      const result = await directory('', 'all', 'all', archived, 'newest', page);
      expect(result.total).toBe(total);
      for (const row of result.orders) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
    }
    expect(seen.size).toBe(total);
  }
  expect((await directory('', 'all', 'all', false, 'newest', 2147483647)).page).toBe(10);
});
test('literal title/customer/email/number searches run before paging, with no filter-syntax wildcard interpretation', async () => {
  await user(owner);
  expect((await directory('Directory 001')).orders[0].id).toBe(ids[0]);
  expect((await directory('#1001')).total).toBe(1);
  expect((await directory('DIRECTORY@EXAMPLE.TEST')).total).toBe(220);
  expect((await directory('100%')).total).toBe(220);
  expect((await directory('),workspace_id.neq.')).total).toBe(0);
  expect((await directory('_')).total).toBe(0);
  expect((await directory('absent', 'all', 'all', false, 'newest', 99)).page).toBe(1);
  await expect(directory('x'.repeat(161))).rejects.toThrow('160');
  await expect(directory('', 'all', 'all', false, 'attack')).rejects.toThrow('sort');
  await expect(directory('', 'attack')).rejects.toThrow('status');
});
test('approval/attention filters and summary counts derive current proof, expiry, policy and per-size discrepancies', async () => {
  await user(owner);
  const all = await directory();
  expect(all.summary).toEqual({ all: 220, attention: 6, pending: 1, ready: 1 });
  expect((await directory('', 'pending')).orders.map((row) => row.id)).toEqual([ids[0]]);
  expect((await directory('', 'approved')).orders.map((row) => row.id)).toEqual([ids[4]]);
  expect((await directory('', 'invalidated')).total).toBe(4);
  const attention = await directory('', 'attention');
  expect(attention.total).toBe(6);
  expect(attention.summary.all).toBe(220);
  expect(attention.orders.find((row) => row.id === ids[7])).toMatchObject({
    expected: 1,
    received: 1,
    discrepancy: true,
  });
  expect((await directory('', 'ready_for_pickup')).total).toBe(1);
  expect((await directory('', 'cancelled', 'all', true)).total).toBe(205);
  expect(JSON.stringify(all)).not.toMatch(/token_digest|internal_notes|snapshot/);
  // A later pending version must supersede an older recorded approval.
  await db.exec('reset role');
  const replacement = randomUUID();
  await db.query(
    "insert into proof_versions(id,workspace_id,order_id,version,spec_revision,snapshot,files) values($1,$2,$3,2,1,'{\"policy_version\":1}','[]')",
    [replacement, workspace, ids[4]],
  );
  await db.query(
    'insert into review_requests(workspace_id,order_id,proof_id,token_digest) values($1,$2,$3,$4)',
    [workspace, ids[4], replacement, randomUUID().replaceAll('-', '').repeat(2)],
  );
  await user(owner);
  expect((await directory('', 'approved')).total).toBe(0);
  expect((await directory('', 'pending')).total).toBe(2);
});
test('due sorts keep undated orders last, stable ties span pages, and assignment applies before status totals', async () => {
  await user(owner);
  for (const sort of ['due_asc', 'due_desc']) {
    const values = [];
    for (let page = 1; page <= 10; page++)
      values.push(...(await directory('', 'all', 'all', false, sort, page)).orders);
    const dates = values.map((row) => row.due_date).filter(Boolean);
    expect(dates).toEqual(
      [...dates].sort((a, b) => (sort === 'due_asc' ? a.localeCompare(b) : b.localeCompare(a))),
    );
    expect(values.at(-1)?.due_date).toBeNull();
    expect(new Set(values.map((row) => row.id)).size).toBe(220);
  }
  expect((await directory('', 'all', 'all', false, 'oldest')).orders[0].id).toBe(ids[0]);
  expect((await directory('', 'all', staff)).total).toBe(110);
  expect((await directory('', 'all', 'unassigned')).total).toBe(110);
  expect((await directory('', 'pending', staff)).total).toBe(0);
  expect((await directory('', 'all', other)).total).toBe(0);
});
test('tenant/anonymous/removed-member isolation and expired-shop reads apply to the directory', async () => {
  await user(other);
  expect((await directory()).total).toBe(0);
  await db.exec('reset role; set role anon');
  await expect(directory()).rejects.toThrow('permission denied');
  await db.exec('reset role');
  await db.query("update workspaces set trial_ends_at=now()-interval '1 day' where id=$1", [
    workspace,
  ]);
  await user(owner);
  expect((await directory()).total).toBe(220);
  await db.exec('reset role');
  await db.query('delete from memberships where user_id=$1', [staff]);
  await user(owner);
  expect((await directory('', 'all', staff)).total).toBe(110);
  await user(staff);
  await expect(directory()).rejects.toThrow('access denied');
});
