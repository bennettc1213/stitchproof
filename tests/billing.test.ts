import { PGlite } from '@electric-sql/pglite';
import Stripe from 'stripe';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  assertShopPrice,
  billingConfiguration,
  billingSnapshot,
  verifyBillingEvent,
} from '../src/lib/billing-domain';

const db = new PGlite();
const owner = randomUUID(),
  staff = randomUUID(),
  other = randomUUID();
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
  return (
    await db.query<{ result: T }>(
      `select to_jsonb(public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})) result`,
      args,
    )
  ).rows[0].result;
}
const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
type Lease = {
  workspace: string;
  lease: string;
  generation: number;
  customer: string | null;
  checkout: string | null;
  expires_at: string;
};
async function sync(
  event: string,
  status: string,
  paid: string | null = null,
  failure: string | null = null,
  cancel = false,
  ended: string | null = null,
) {
  await system();
  const claim = await rpc<{ lease: string }>('claim_billing_sync', ['cus_threadproof', event]);
  return rpc('apply_billing_snapshot', [
    'cus_threadproof',
    event,
    claim.lease,
    'sub_threadproof',
    status,
    paid,
    failure,
    cancel,
    ended,
  ]);
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
    '202610190007_billing.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
  for (const [id, email] of [
    [owner, 'owner@example.test'],
    [staff, 'staff@example.test'],
    [other, 'other@example.test'],
  ])
    await db.query('insert into auth.users values($1,$2,now())', [id, email]);
  await user(owner);
  workspace = await rpc<string>('onboard_shop', ['Billing shop', 'America/Los_Angeles', 'Policy']);
  await system();
  await db.query("insert into memberships values($1,$2,'staff')", [workspace, staff]);
  await db.query("update workspaces set trial_ends_at=now()-interval '1 day' where id=$1", [
    workspace,
  ]);
});
afterAll(async () => {
  await db.close();
});

test('billing remains owner-only and readable after entitlement expiry; callers cannot forge paid access', async () => {
  await user(staff);
  await expect(rpc('begin_checkout')).rejects.toThrow('Owner access required');
  await expect(rpc('billing_summary')).rejects.toThrow('Owner access required');
  await expect(db.query('select * from billing_accounts')).rejects.toThrow('permission denied');
  await expect(
    db.query('update workspaces set paid_through=$1 where id=$2', [date(30), workspace]),
  ).rejects.toThrow('permission denied');
  await expect(
    rpc('apply_billing_snapshot', [
      'cus_threadproof',
      'forged',
      randomUUID(),
      'sub_threadproof',
      'active',
      date(30),
      null,
      false,
      null,
    ]),
  ).rejects.toThrow('permission denied');
  await user(owner);
  expect(await rpc('billing_summary')).toMatchObject({
    status: 'not_subscribed',
    has_customer: false,
    paid_through: null,
  });
});

test('checkout leases serialize requests and reuse the same generation/session until expiry', async () => {
  await user(owner);
  const first = await rpc<Lease>('begin_checkout');
  await expect(rpc('begin_checkout')).rejects.toThrow('already being updated');
  await system();
  await expect(
    rpc('bind_billing_customer', [workspace, randomUUID(), 'cus_threadproof']),
  ).rejects.toThrow('expired');
  await rpc('bind_billing_customer', [workspace, first.lease, 'cus_threadproof']);
  await rpc('finish_checkout', [workspace, first.lease, 'cs_test_one']);
  await user(owner);
  const next = await rpc<Lease>('begin_checkout');
  expect(next.generation).toBe(first.generation);
  expect(next.checkout).toBe('cs_test_one');
  await system();
  await rpc('finish_checkout', [workspace, next.lease, null]);
  await db.query(
    "update billing_accounts set checkout_valid_until=now()-interval '1 second' where workspace_id=$1",
    [workspace],
  );
  await user(owner);
  const expired = await rpc<Lease>('begin_checkout');
  expect(expired.generation).toBe(first.generation + 1);
  expect(expired.checkout).toBeNull();
  await system();
  await rpc('finish_checkout', [workspace, expired.lease, null]);
});

test('provider reconciliation deduplicates events, serializes snapshots, and grants only paid access', async () => {
  await system();
  const claim = await rpc<{ lease: string }>('claim_billing_sync', ['cus_threadproof', 'evt_paid']);
  await expect(rpc('claim_billing_sync', ['cus_threadproof', 'evt_other'])).rejects.toThrow(
    'already running',
  );
  await expect(
    rpc('apply_billing_snapshot', [
      'cus_threadproof',
      'evt_paid',
      randomUUID(),
      'sub_threadproof',
      'active',
      date(30),
      null,
      false,
      null,
    ]),
  ).rejects.toThrow('expired');
  await rpc('apply_billing_snapshot', [
    'cus_threadproof',
    'evt_paid',
    claim.lease,
    'sub_threadproof',
    'active',
    date(30),
    null,
    false,
    null,
  ]);
  expect(await rpc('claim_billing_sync', ['cus_threadproof', 'evt_paid'])).toEqual({
    duplicate: true,
  });
  await user(owner);
  await rpc('create_order', ['Paid order', 'Alex', 'alex@example.test', '', null, randomUUID()]);
  const summary = await rpc<{ paid_through: string }>('billing_summary');
  expect(new Date(summary.paid_through).getTime()).toBeGreaterThan(Date.now());
});

test('retries and stale payment events cannot restart the three-day grace; recovery clears it', async () => {
  const failed = date(-2);
  await sync('evt_failure', 'past_due', null, failed);
  await user(owner);
  const first = await rpc<{ grace_until: string }>('billing_summary');
  await sync('evt_retry', 'past_due', null, date(0));
  await user(owner);
  expect((await rpc<{ grace_until: string }>('billing_summary')).grace_until).toBe(
    first.grace_until,
  );
  // An old invoice-paid notification still reconciles the current provider past-due state.
  await sync('evt_old_paid', 'past_due', null, date(0));
  await user(owner);
  expect((await rpc<{ grace_until: string }>('billing_summary')).grace_until).toBe(
    first.grace_until,
  );
  await sync('evt_recovered', 'active', date(30));
  await user(owner);
  expect((await rpc<{ grace_until: unknown }>('billing_summary')).grace_until).toBeNull();
});

test('expired grace blocks new work even when another failure notification arrives', async () => {
  await system();
  await db.query("update workspaces set paid_through=now()-interval '1 day' where id=$1", [
    workspace,
  ]);
  await sync('evt_old_failure', 'past_due', null, date(-4));
  await user(owner);
  await expect(
    rpc('create_order', ['Grace expired', 'Alex', 'alex@example.test', '', null, randomUUID()]),
  ).rejects.toThrow('read-only');
  await sync('evt_old_failure_retry', 'past_due', null, date(0));
  await user(owner);
  await expect(
    rpc('create_order', ['Still expired', 'Alex', 'alex@example.test', '', null, randomUUID()]),
  ).rejects.toThrow('read-only');
});

test('period-end cancellation retains paid time; final termination blocks writes while retaining records and billing', async () => {
  const end = date(20);
  await sync('evt_scheduled', 'active', end, null, true);
  await user(owner);
  expect(await rpc('billing_summary')).toMatchObject({ cancel_at_period_end: true });
  await rpc('create_order', ['Still paid', 'Alex', 'alex@example.test', '', null, randomUUID()]);
  await sync('evt_canceled', 'canceled', null, null, false, date(-1));
  await user(owner);
  await expect(
    rpc('create_order', ['Expired', 'Alex', 'alex@example.test', '', null, randomUUID()]),
  ).rejects.toThrow('read-only');
  expect((await db.query('select * from orders')).rows.length).toBeGreaterThan(0);
  expect((await rpc<{ status: string }>('billing_summary')).status).toBe('canceled');
  const lease = await rpc<Lease>('begin_checkout');
  await system();
  await rpc('finish_checkout', [workspace, lease.lease, null]);
  await user(other);
  await rpc('onboard_shop', ['Other shop', 'America/Los_Angeles', '']);
  expect(await rpc('billing_summary')).toMatchObject({
    status: 'not_subscribed',
    has_customer: false,
  });
});

const price = {
  id: 'price_shop',
  active: true,
  livemode: false,
  type: 'recurring',
  currency: 'usd',
  unit_amount: 3900,
  recurring: {
    interval: 'month',
    interval_count: 1,
    usage_type: 'licensed',
    trial_period_days: null,
  },
  transform_quantity: null,
} as Stripe.Price;
test('only the fixed monthly plan is accepted and local configuration cannot enable live charging', () => {
  expect(() => assertShopPrice(price, false)).not.toThrow();
  expect(() => assertShopPrice({ ...price, unit_amount: 4900 }, false)).toThrow('$39');
  expect(() => assertShopPrice({ ...price, livemode: true }, false)).toThrow('$39');
  expect(() => billingConfiguration({ STRIPE_SECRET_KEY: 'sk_live_example' })).toThrow(
    'Live Stripe is disabled',
  );
  expect(billingConfiguration({ STRIPE_SECRET_KEY: 'sk_test_example' })).toBeNull();
});

test('webhooks require the unchanged signed body and reject stale signatures', () => {
  const body = JSON.stringify({
    id: 'evt_test',
    object: 'event',
    livemode: false,
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_test' } },
  });
  const secret = 'whsec_local_test';
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  expect(verifyBillingEvent(body, signature, secret).id).toBe('evt_test');
  expect(() => verifyBillingEvent(body + ' ', signature, secret)).toThrow();
  const old = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    timestamp: Math.floor(Date.now() / 1000) - 600,
  });
  expect(() => verifyBillingEvent(body, old, secret)).toThrow();
});

test('subscription snapshots require the workspace, plan, and paid invoice; browser redirects cannot grant access', () => {
  const sub = {
    id: 'sub_shop',
    status: 'active',
    livemode: false,
    metadata: { workspace_id: 'workspace' },
    cancel_at_period_end: false,
    ended_at: null,
    items: {
      data: [{ price, quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 86400 }],
    },
    latest_invoice: {
      id: 'in_shop',
      status: 'paid',
      created: Math.floor(Date.now() / 1000),
      status_transitions: { finalized_at: Math.floor(Date.now() / 1000) },
    },
  } as unknown as Stripe.Subscription;
  expect(billingSnapshot(sub, 'workspace', 'price_shop', false).paid).not.toBeNull();
  expect(
    billingSnapshot(
      { ...sub, latest_invoice: { ...(sub.latest_invoice as Stripe.Invoice), status: 'open' } },
      'workspace',
      'price_shop',
      false,
    ).paid,
  ).toBeNull();
  expect(() => billingSnapshot(sub, 'different', 'price_shop', false)).toThrow('workspace');
  expect(() => billingSnapshot(sub, 'workspace', 'price_other', false)).toThrow('plan');
  expect(billingSnapshot(null, 'workspace', 'price_shop', false).paid).toBeNull();
});
