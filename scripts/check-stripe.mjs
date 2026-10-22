// Explicit Stripe test-mode acceptance check. Creates fictional local shops and Stripe test-mode
// objects through hosted Checkout/Portal and Stripe CLI forwarding. Live mode is always refused.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import Stripe from 'stripe';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const app = process.env.APP_URL || 'http://127.0.0.1:3000';
const key = process.env.STRIPE_SECRET_KEY || '';
const loopback = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !loopback(url) ||
  !loopback(app) ||
  process.env.STRIPE_MODE === 'live' ||
  !key.startsWith('sk_test_') ||
  !process.env.STRIPE_WEBHOOK_SECRET ||
  !process.env.STRIPE_PRICE_ID
) {
  throw new Error(
    'Stripe checks require local Supabase/app, ALLOW_DEV_SEED=true, and complete Stripe test-mode configuration. No checks ran.',
  );
}
const stripe = new Stripe(key, { apiVersion: '2026-09-30.endive' });
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const client = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const run = randomBytes(6).toString('hex');
const password = randomBytes(24).toString('base64url');
const results = [];
const pass = (name) => {
  results.push(name);
  console.log('PASS', name);
};
const waitFor = async (probe, description, timeout = 90000) => {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for ' + description);
};
const DAY = 86400000;
// Wait until Stripe CLI forwarding has been quiet for a few seconds.
const settle = async () => {
  let seen = -1;
  while (seen !== deliveries.length) {
    seen = deliveries.length;
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
};

// Forward only the events the webhook route subscribes to.
const events = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];
const deliveries = [];
const listener = spawn(
  process.env.STRIPE_CLI || 'stripe',
  ['listen', '--forward-to', app + '/api/stripe/webhook', '--events', events.join(',')],
  { env: { ...process.env, STRIPE_API_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] },
);
const ready = new Promise((resolve, reject) => {
  const onData = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.includes('Ready!')) resolve();
      const delivered = line.match(/<--\s+\[(\d{3})\]\s+POST\s+\S+\s+\[(evt_[A-Za-z0-9]+)\]/);
      if (delivered) deliveries.push({ status: Number(delivered[1]), event: delivered[2] });
    }
  };
  listener.stdout.on('data', onData);
  listener.stderr.on('data', onData);
  listener.on('exit', (code) => reject(new Error('Stripe CLI exited early: ' + code)));
});
await Promise.race([
  ready,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Stripe CLI not ready')), 30000)),
]);

const account = async (name) => {
  const email = `stripe-${name}-${run}@example.test`;
  const user = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const db = client();
  await checked(db.auth.signInWithPassword({ email, password }));
  return { email, db, user: user.user.id };
};
const shop = async (name) => {
  const owner = await account(name);
  const workspace = await checked(
    owner.db.rpc('onboard_shop', {
      p_name: `Stripe check ${name} ${run}`,
      p_timezone: 'America/Los_Angeles',
      p_policy: 'Fictional test policy: review the proof and garment quantities.',
    }),
  );
  return { owner, workspace };
};
const state = async (workspace) => {
  const row = await checked(
    service.from('workspaces').select('paid_through,grace_until').eq('id', workspace).single(),
  );
  const billing = await checked(
    service
      .from('billing_accounts')
      .select('customer_id,subscription_id,status,cancel_at_period_end,failure_since')
      .eq('workspace_id', workspace)
      .maybeSingle(),
  );
  const { count } = await service
    .from('billing_events')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace);
  return { ...row, ...(billing || {}), events: count };
};
const deliver = async (payload, secret = process.env.STRIPE_WEBHOOK_SECRET) => {
  const body = JSON.stringify(payload);
  return fetch(app + '/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': Stripe.webhooks.generateTestHeaderString({ payload: body, secret }),
    },
    body,
  });
};

const report = { run, stripe_mode: 'test' };
const browser = await chromium.launch();
let clock;
const signIn = async (owner) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(app + '/login');
  await page.getByLabel('Email address').fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/app/orders');
  return page;
};
const startCheckout = async (page) => {
  await page.goto(app + '/app/settings/billing');
  await page.getByLabel(/I understand the paid subscription starts immediately/).check();
  await page.getByRole('button', { name: 'Subscribe for $39 USD/month' }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
  return page.url().match(/cs_test_[A-Za-z0-9]+/)[0];
};
const pay = async (page, card) => {
  const number = page.locator('#cardNumber');
  await number.waitFor({ timeout: 30000 });
  await number.fill(card);
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  await page.locator('#billingName').fill('Fictional Shop Owner');
  const zip = page.locator('#billingPostalCode');
  if (await zip.isVisible()) await zip.fill('94110');
  const link = page.locator('#enableStripePass');
  if ((await link.count()) && (await link.isChecked())) await link.uncheck();
  await page.getByTestId('hosted-payment-submit-button').click();
};
const subscribe = async (page, workspace) => {
  await pay(page, '4242424242424242');
  await page.waitForURL(app + '/app/settings/billing?checkout=returned', { timeout: 60000 });
  return waitFor(async () => {
    const s = await state(workspace);
    return s.status === 'active' && s.paid_through ? s : null;
  }, 'active subscription');
};

try {
  // ---- Shop A: the app creates its own Stripe customer. ----
  const a = await shop('a');
  const staff = await account('staff');
  await checked(
    service
      .from('memberships')
      .insert({ workspace_id: a.workspace, user_id: staff.user, role: 'staff' }),
  );
  const page = await signIn(a.owner);
  assert.ok((await staff.db.rpc('begin_checkout')).error, 'Staff must not begin checkout.');
  await page.goto(app + '/app/settings/billing?checkout=returned');
  assert.equal((await state(a.workspace)).paid_through, null);
  pass('staff cannot begin checkout; forged return URL grants no access');

  const first = await startCheckout(page);
  const second = await startCheckout(page);
  assert.equal(second, first, 'A repeated attempt must reuse the open checkout session.');
  const session = await stripe.checkout.sessions.retrieve(first);
  assert.equal(session.livemode, false);
  assert.equal(session.metadata.workspace_id, a.workspace);
  pass('repeated subscribe attempts reuse one open Stripe Checkout session');

  await pay(page, '4000000000000002');
  await expect(page.getByText(/declined/i).first()).toBeVisible({ timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  assert.equal(
    (await state(a.workspace)).paid_through,
    null,
    'A declined card must not grant access.',
  );
  pass('declined test card shows an error and grants no access');

  const active = await subscribe(page, a.workspace);
  const paidThrough = new Date(active.paid_through).getTime();
  assert.ok(paidThrough > Date.now() + 27 * DAY && paidThrough < Date.now() + 32 * DAY);
  assert.equal(active.grace_until, null);
  await page.reload();
  await expect(page.getByText('active', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subscribe for $39 USD/month' })).toHaveCount(0);
  report.shop_a = { workspace: a.workspace, customer: active.customer_id };
  pass('successful checkout activates via signed webhooks with about one month paid');

  // Every forwarded event must be processed; redelivery and stale payloads then change nothing.
  await settle();
  const customerEvents = (
    await stripe.events.list({ limit: 100, created: { gte: Math.floor(Date.now() / 1000) - 3600 } })
  ).data.filter((e) => events.includes(e.type) && e.data.object.customer === active.customer_id);
  const recorded = new Set(
    (
      await checked(service.from('billing_events').select('id').eq('workspace_id', a.workspace))
    ).map((row) => row.id),
  );
  for (const e of customerEvents)
    assert.ok(recorded.has(e.id), `Forwarded ${e.type} must be processed, not deferred.`);
  const paidEvent = customerEvents.find((e) => e.type === 'invoice.paid');
  const createdEvent = customerEvents.find((e) => e.type === 'customer.subscription.created');
  assert.ok(paidEvent && createdEvent, 'Expected invoice.paid and subscription.created events.');
  const before = await state(a.workspace);
  assert.equal((await deliver(paidEvent)).status, 200);
  assert.deepEqual(
    await state(a.workspace),
    before,
    'A redelivered event must not change anything.',
  );
  pass('all concurrent checkout events processed; redelivered invoice.paid is deduplicated');
  // A late delivery whose payload describes an older, unpaid state.
  const late = structuredClone(createdEvent);
  late.id = 'evt_late_' + run;
  late.data.object.status = 'incomplete_expired';
  assert.equal((await deliver(late)).status, 200);
  const afterLate = await state(a.workspace);
  assert.equal(afterLate.status, 'active');
  assert.equal(afterLate.paid_through, before.paid_through);
  pass('late out-of-order event carrying a stale unpaid status leaves the shop active');
  assert.equal((await deliver(paidEvent, 'whsec_' + randomBytes(16).toString('hex'))).status, 400);
  assert.equal(
    (await deliver({ ...paidEvent, id: 'evt_live_' + run, livemode: true })).status,
    400,
  );
  assert.equal(
    (await fetch(app + '/api/stripe/webhook', { method: 'POST', body: JSON.stringify(paidEvent) }))
      .status,
    400,
  );
  pass('unsigned, wrongly signed, and live-mode webhook payloads are rejected');

  // Portal cancellation at period end keeps paid time.
  await page.goto(app + '/app/settings/billing');
  await page.getByRole('button', { name: 'Manage billing & invoices' }).click();
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 30000 });
  // Owner flow: Cancel subscription, the optional reason dialog, then confirm.
  await page
    .getByRole('link', { name: /Cancel subscription/i })
    .first()
    .click({ timeout: 20000 });
  await page.waitForURL(/\/cancel/);
  await page.getByText('Continue to cancellation').click({ timeout: 15000 });
  await page.getByTestId('confirm').click({ timeout: 15000 });
  await expect(page.getByText(/Cancels /).first()).toBeVisible({ timeout: 20000 });
  const scheduled = await stripe.subscriptions.retrieve(active.subscription_id);
  assert.equal(scheduled.cancel_at, scheduled.items.data[0].current_period_end);
  const cancelling = await waitFor(async () => {
    const s = await state(a.workspace);
    return s.cancel_at_period_end ? s : null;
  }, 'scheduled cancellation');
  assert.equal(cancelling.status, 'active');
  assert.equal(cancelling.paid_through, before.paid_through);
  await page.goto(app + '/app/settings/billing');
  await expect(
    page.getByText('Cancellation is scheduled at the end of the paid period.'),
  ).toBeVisible();
  pass('owner cancels in the hosted Portal; app shows period-end cancellation and keeps paid time');

  // Final termination caps access at the real end.
  await stripe.subscriptions.cancel(active.subscription_id);
  const ended = await waitFor(async () => {
    const s = await state(a.workspace);
    return s.status === 'canceled' ? s : null;
  }, 'canceled subscription');
  assert.ok(new Date(ended.paid_through).getTime() <= Date.now() + 60000);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Subscribe for $39 USD/month' })).toBeVisible();
  pass('ending the subscription caps paid access at the end time and offers subscribe again');

  // ---- Shop B: a test-clock customer, so a real renewal can fail and recover. ----
  const b = await shop('b');
  clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: 'StitchProof renewal ' + run,
  });
  const customer = await stripe.customers.create({
    email: b.owner.email,
    test_clock: clock.id,
    metadata: { workspace_id: b.workspace },
  });
  await checked(
    service
      .from('billing_accounts')
      .insert({ workspace_id: b.workspace, customer_id: customer.id }),
  );
  const pageB = await signIn(b.owner);
  await startCheckout(pageB);
  const paidB = await subscribe(pageB, b.workspace);
  report.shop_b = { workspace: b.workspace, customer: customer.id, clock: clock.id };
  await settle();

  const failing = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', {
    customer: customer.id,
  });
  await stripe.subscriptions.update(paidB.subscription_id, {
    default_payment_method: failing.id,
  });
  const advance = async (to) => {
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: to });
    await waitFor(
      async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status === 'ready',
      'test clock advance',
      180000,
    );
  };
  const renewal = Math.floor(new Date(paidB.paid_through).getTime() / 1000);
  await advance(renewal + 2 * 3600);
  const pastDue = await waitFor(
    async () => {
      const s = await state(b.workspace);
      return s.status === 'past_due' && s.grace_until ? s : null;
    },
    'past_due after failed renewal',
    120000,
  );
  const sub = await stripe.subscriptions.retrieve(paidB.subscription_id, {
    expand: ['latest_invoice'],
  });
  // Under a test clock the invoice is dated in simulated time; event timestamps stay real.
  const failedEvent = (
    await stripe.events.list({ type: 'invoice.payment_failed', limit: 20 })
  ).data.find((e) => e.data.object.id === sub.latest_invoice.id);
  // Whichever of the failure event or invoice transition reconciles first anchors the grace;
  // in real time they coincide.
  const failedAt = new Date(pastDue.failure_since).getTime();
  assert.ok(
    [
      failedEvent.created * 1000,
      sub.latest_invoice.status_transitions.finalized_at * 1000,
    ].includes(failedAt),
  );
  assert.equal(new Date(pastDue.grace_until).getTime() - failedAt, 3 * DAY);
  assert.equal(pastDue.paid_through, paidB.paid_through, 'Failure must not extend paid time.');
  await pageB.goto(app + '/app/settings/billing');
  await expect(pageB.getByText('past due', { exact: true })).toBeVisible();
  pass('failed renewal sets past_due with a three-day grace from the failure, no extra paid time');

  await settle();
  const eventsBefore = (await state(b.workspace)).events;
  await stripe.invoices.pay(sub.latest_invoice.id).catch(() => null);
  await waitFor(
    async () => (await state(b.workspace)).events > eventsBefore,
    'retry failure webhook',
  );
  await settle();
  const retried = await state(b.workspace);
  assert.equal(retried.status, 'past_due');
  assert.equal(retried.grace_until, pastDue.grace_until, 'Retries must not extend grace.');
  pass('a second failed attempt keeps the original grace deadline');

  const good = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.subscriptions.update(paidB.subscription_id, { default_payment_method: good.id });
  await stripe.invoices.pay(sub.latest_invoice.id, { payment_method: good.id });
  const recovered = await waitFor(async () => {
    const s = await state(b.workspace);
    return s.status === 'active' && !s.grace_until ? s : null;
  }, 'recovery after payment');
  assert.equal(recovered.failure_since, null);
  assert.ok(
    new Date(recovered.paid_through).getTime() > new Date(paidB.paid_through).getTime() + 27 * DAY,
  );
  await pageB.reload();
  await expect(pageB.getByText('active', { exact: true })).toBeVisible();
  pass('paying the open invoice recovers: active, grace cleared, next month paid');

  await settle();
  const failures = deliveries.filter((d) => d.status >= 300);
  report.cli_deliveries = deliveries.length;
  report.cli_non_2xx = failures.length;
  assert.ok(deliveries.length > 0, 'Expected Stripe CLI deliveries.');
  assert.equal(failures.length, 0, 'Concurrent webhook deliveries must not be rejected.');
  pass(`${deliveries.length} Stripe CLI webhook deliveries, ${failures.length} non-2xx`);
  report.passed = results;
  await mkdir('.local', { recursive: true });
  await writeFile('.local/stripe-check.json', JSON.stringify(report, null, 2));
  console.log('Stripe test-mode checks passed. Report: .local/stripe-check.json');
} catch (error) {
  await mkdir('.local/qa', { recursive: true });
  for (const [i, ctx] of browser.contexts().entries())
    for (const [j, p] of ctx.pages().entries())
      await p
        .screenshot({ path: `.local/qa/stripe-failure-${i}-${j}.png`, fullPage: true })
        .catch(() => {});
  console.log('Deliveries:', JSON.stringify(deliveries));
  throw error;
} finally {
  await browser.close();
  listener.kill();
  // Deleting the clock removes its test customer and subscription.
  if (clock) await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
}
