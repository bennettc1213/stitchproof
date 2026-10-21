import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  customerSearch,
  customerPageHref,
  type CustomerDirectory,
  type CustomerHistory,
} from '../src/lib/customers';

const db = new PGlite();
const owner = randomUUID(),
  other = randomUUID(),
  staff = randomUUID();
let workspace: string, customer: string, order: string;
async function user(id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
async function service() {
  await db.exec('reset role');
}
async function rpc<T>(name: string, args: unknown[]) {
  return (
    await db.query<{ result: T }>(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`,
      args,
    )
  ).rows[0].result;
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`);
  await db.exec(readFileSync('supabase/migrations/202610190001_foundation.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610190009_customers.sql', 'utf8'));
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())', [
    owner,
    'owner@example.test',
    other,
    'other@example.test',
    staff,
    'staff@example.test',
  ]);
  await user(owner);
  workspace = await rpc<string>('onboard_shop', [
    'Directory shop',
    'America/Los_Angeles',
    'Policy',
  ]);
  order = randomUUID();
  await rpc('create_order', [
    'History oldest',
    'Zelda Needle',
    'zelda@example.test',
    '100% Stitch',
    null,
    order,
  ]);
  customer = (
    await db.query<{ customer_id: string }>('select customer_id from orders where id=$1', [order])
  ).rows[0].customer_id;
  await service();
  await db.query("insert into memberships values($1,$2,'staff')", [workspace, staff]);
  await db.query(
    `insert into customers(workspace_id,name,email,company,phone)
    select $1,'Customer '||lpad(n::text,3,'0'),'customer-'||n||'@example.test','Fictional company','555-01'||n from generate_series(1,210) n`,
    [workspace],
  );
  await db.query(
    `insert into orders(workspace_id,customer_id,number,title,created_at)
    select $1,$2,2000+n,'History '||n,now()+make_interval(secs=>n) from generate_series(1,204) n`,
    [workspace, customer],
  );
  await db.query(
    "insert into proof_versions(workspace_id,order_id,version,spec_revision,snapshot,files) values($1,$2,1,0,$3,'[]')",
    [workspace, order, JSON.stringify({ title: 'Immutable original', policy: 'Original policy' })],
  );
  await user(other);
  await rpc('onboard_shop', ['Other directory', 'America/New_York', '']);
  await rpc('create_order', [
    'Foreign',
    'Foreign customer',
    'foreign@example.test',
    '',
    null,
    randomUUID(),
  ]);
});
afterAll(async () => {
  await db.close();
});

test('search URLs bound malformed input and preserve literal query text', () => {
  expect(customerSearch({ q: ['no'], page: 'NaN' })).toEqual({ query: '', page: 1 });
  expect(customerSearch({ q: '  100% stitch  ', page: '9999999999' })).toEqual({
    query: '100% stitch',
    page: 2147483647,
  });
  expect(customerSearch({ q: 'x'.repeat(200), page: '-1' }).query).toHaveLength(160);
  expect(customerPageHref('/app/customers', 2, 'a&,name.eq.attack')).toBe(
    '/app/customers?q=a%26%2Cname.eq.attack&page=2',
  );
});
test('directory reaches every customer beyond 200 with stable pages and accurate totals', async () => {
  await user(owner);
  const ids: string[] = [];
  for (let page = 1; page <= 9; page++) {
    const result = await rpc<CustomerDirectory>('customer_directory', ['', page]);
    expect(result.total).toBe(211);
    expect(result.pages).toBe(9);
    expect(result.page).toBe(page);
    expect(result.customers).toHaveLength(page < 9 ? 24 : 19);
    ids.push(...result.customers.map((c) => c.id));
  }
  expect(new Set(ids).size).toBe(211);
  expect(ids).toContain(customer);
  const last = await rpc<CustomerDirectory>('customer_directory', ['', 2147483647]);
  expect(last.page).toBe(9);
  expect(last.customers.find((c) => c.id === customer)?.order_count).toBe(205);
});
test('search covers contact fields and treats percent, underscore, and filter syntax literally', async () => {
  await user(owner);
  for (const query of ['zELDa', '100%', 'zelda@', '555-01210']) {
    expect((await rpc<CustomerDirectory>('customer_directory', [query, 1])).total).toBe(1);
  }
  for (const query of ['_', '),workspace_id.neq.', '%not-present']) {
    expect((await rpc<CustomerDirectory>('customer_directory', [query, 1])).total).toBe(0);
  }
  await expect(rpc('customer_directory', ['x'.repeat(161), 1])).rejects.toThrow('160');
  expect((await rpc<CustomerDirectory>('customer_directory', ['missing', 99])).page).toBe(1);
});
test('customer history pages independently of the shop order list and isolates other shops', async () => {
  await user(owner);
  const history = await rpc<CustomerHistory>('customer_order_history', [customer, 9]);
  expect(history.total).toBe(205);
  expect(history.orders.some((o) => o.id === order)).toBe(true);
  expect(history.orders).toHaveLength(13);
  await user(other);
  expect((await rpc<CustomerDirectory>('customer_directory', ['Zelda', 1])).total).toBe(0);
  await expect(rpc('customer_order_history', [customer, 1])).rejects.toThrow('unavailable');
  await expect(
    rpc('update_customer', [customer, 0, 'Attack', '', 'attack@example.test', '', '']),
  ).rejects.toThrow('unavailable');
  await expect(
    db.query('update customers set name=$1 where id=$2', ['Attack', customer]),
  ).rejects.toThrow('permission denied');
  await db.exec('reset role; set role anon');
  await expect(rpc('customer_directory', ['', 1])).rejects.toThrow('permission denied');
});
test('owner and staff edits normalize contacts, reject collisions and stale writes, and preserve sent proofs', async () => {
  await user(owner);
  const args = [
    customer,
    0,
    '  Zelda Needle  ',
    '  100% Stitch  ',
    '  ZELDA.NEW@EXAMPLE.TEST  ',
    '  555-0100  ',
    'Shop-only notes',
  ];
  expect(await rpc('update_customer', args)).toBe(1);
  await expect(rpc('update_customer', args)).rejects.toThrow('This customer changed');
  args[1] = 1;
  expect(await rpc('update_customer', args)).toBe(1);
  const row = (
    await db.query<{ email: string; phone: string }>(
      'select email,phone from customers where id=$1',
      [customer],
    )
  ).rows[0];
  expect(row).toEqual({ email: 'zelda.new@example.test', phone: '555-0100' });
  await expect(
    rpc('update_customer', [customer, 1, 'Zelda', '', 'customer-1@example.test', '', '']),
  ).rejects.toThrow('already uses this email');
  await expect(
    rpc('update_customer', [customer, 1, 'Zelda', '', 'bad-email', '', '']),
  ).rejects.toThrow('valid');
  await expect(
    rpc('update_customer', [customer, null, 'Zelda', '', 'z@example.test', '', '']),
  ).rejects.toThrow('changed');
  await expect(
    rpc('update_customer', [customer, 1, 'Zelda', '', 'z@example.test', '', 'x'.repeat(10001)]),
  ).rejects.toThrow('10000');
  await user(staff);
  expect(
    await rpc('update_customer', [
      customer,
      1,
      'Zelda Updated',
      '',
      'zelda.new@example.test',
      '',
      'Staff note',
    ]),
  ).toBe(2);
  expect(
    (
      await db.query<{ snapshot: unknown }>(
        'select snapshot from proof_versions where order_id=$1',
        [order],
      )
    ).rows[0].snapshot,
  ).toEqual({ title: 'Immutable original', policy: 'Original policy' });
  expect(
    (
      await db.query<{ spec_revision: number }>('select spec_revision from orders where id=$1', [
        order,
      ])
    ).rows[0].spec_revision,
  ).toBe(0);
});
test('read-only shops retain directory and history but cannot edit; removed staff lose RPC access', async () => {
  await service();
  await db.query("update workspaces set trial_ends_at=now()-interval '1 day' where id=$1", [
    workspace,
  ]);
  await user(owner);
  expect((await rpc<CustomerDirectory>('customer_directory', ['', 1])).total).toBe(211);
  expect((await rpc<CustomerHistory>('customer_order_history', [customer, 1])).total).toBe(205);
  await expect(
    rpc('update_customer', [customer, 2, 'No', '', 'n@example.test', '', '']),
  ).rejects.toThrow('read-only');
  await service();
  await db.query('delete from memberships where user_id=$1', [staff]);
  await user(staff);
  await expect(rpc('customer_directory', ['', 1])).rejects.toThrow('access denied');
});
