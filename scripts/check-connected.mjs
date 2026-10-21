// Explicit local integration check. Creates isolated fictional fixtures and preserves them for inspection.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const app = process.env.APP_URL || 'http://127.0.0.1:3000';
const loopback = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !loopback(url) ||
  !loopback(app)
) {
  throw new Error(
    'Connected checks require local Supabase, a local app, and ALLOW_DEV_SEED=true. No checks ran.',
  );
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Configure local Supabase keys in .env.local. No checks ran.');
}
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const client = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
const hash = (token) => createHash('sha256').update(token).digest('hex');
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const denied = async (request, message) => assert.ok((await request).error, message);
const run = randomBytes(6).toString('hex');
const password = randomBytes(24).toString('base64url');
const accounts = [];
for (const name of ['owner', 'other', 'staff']) {
  const email = `connected-${name}-${run}@example.test`;
  await checked(service.auth.admin.createUser({ email, password, email_confirm: true }));
  const db = client();
  const login = await checked(db.auth.signInWithPassword({ email, password }));
  accounts.push({ email, password, db, user: login.user.id });
}
const [owner, other, staff] = accounts;
const workspace = await checked(
  owner.db.rpc('onboard_shop', {
    p_name: `Connected check ${run}`,
    p_timezone: 'America/Los_Angeles',
    p_policy: 'Fictional test policy: review the proof and garment quantities.',
  }),
);
assert.equal(
  await checked(
    owner.db.rpc('onboard_shop', {
      p_name: 'Retry',
      p_timezone: 'America/Los_Angeles',
      p_policy: '',
    }),
  ),
  workspace,
);
await checked(
  other.db.rpc('onboard_shop', {
    p_name: `Isolated check ${run}`,
    p_timezone: 'America/Los_Angeles',
    p_policy: '',
  }),
);
await mkdir('.local', { recursive: true });
await writeFile(
  '.local/connected-credentials.json',
  JSON.stringify(
    {
      notice: 'Fictional local integration accounts only.',
      accounts: accounts.map(({ email, user }) => ({ email, user, password })),
      workspace,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

const orderId = randomUUID();
const create = {
  p_title: 'Connected 24-polo journey',
  p_customer_name: 'Alex Morgan',
  p_email: 'alex@example.test',
  p_company: 'Northline (fictional)',
  p_due: '2026-10-23',
  p_key: orderId,
};
assert.equal(await checked(owner.db.rpc('create_order', create)), orderId);
assert.equal(await checked(owner.db.rpc('create_order', create)), orderId);
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
  design: 'Northline wordmark',
  dimensions: '3 inches',
  thread: 'Forest green',
  text: 'NORTHLINE',
  instructions: 'Center above seam.',
};
let revision = 0;
const intake = async (reason) => {
  await checked(
    owner.db.rpc('save_intake', {
      p_order: orderId,
      p_revision: revision,
      p_garments: garments,
      p_spec: spec,
      p_reason: reason,
    }),
  );
  revision++;
};
const send = async (file, token) => {
  await checked(
    owner.db.rpc('send_proof', {
      p_order: orderId,
      p_revision: revision,
      p_files: [file.id],
      p_digest: hash(token),
    }),
  );
  revision++;
};
const upload = async (name) => {
  const bytes = await readFile('supabase/fixtures/' + name);
  const file = await checked(
    owner.db.rpc('reserve_attachment', {
      p_order: orderId,
      p_name: name,
      p_mime: 'image/png',
      p_bytes: bytes.length,
      p_purpose: 'proof',
      p_caption: '',
    }),
  );
  await checked(
    service.storage
      .from('order-files')
      .upload(file.path, bytes, { contentType: 'image/png', upsert: false }),
  );
  await checked(
    service.rpc('finalize_attachment', { p_id: file.id, p_digest: hash(bytes), p_success: true }),
  );
  return { ...file, bytes };
};
await intake('Initial receipt: one medium missing.');
await denied(
  owner.db.rpc('send_proof', {
    p_order: orderId,
    p_revision: revision,
    p_files: [],
    p_digest: hash('blocked'),
  }),
  'Mismatch must block a proof.',
);
garments[0].sizes[1].received = 8;
await intake('Customer delivered the missing medium.');
const file1 = await upload('northline-v1.png');
const token1 = randomBytes(32).toString('hex');
await send(file1, token1);
await checked(
  service.rpc('decide_review', {
    p_digest: hash(token1),
    p_choice: 'changes_requested',
    p_name: '',
    p_comments: 'Please make the logo smaller.',
    p_design: false,
    p_policy: false,
  }),
);
spec.dimensions = '2.5 inches';
await intake('Smaller logo requested by customer.');
const file2 = await upload('northline-v2.png');
const token2 = randomBytes(32).toString('hex');
await send(file2, token2);
await denied(owner.db.rpc('start_production', { p_order: orderId }), 'Production needs approval.');
await denied(
  service.rpc('decide_review', {
    p_digest: hash(token1),
    p_choice: 'approved',
    p_name: 'Alex Morgan',
    p_comments: '',
    p_design: true,
    p_policy: true,
  }),
  'Old decision must not be replaced.',
);

// Competing requests use independently created API clients/connections.
const services = [0, 1].map(() =>
  createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
);
const outcomes = await Promise.all(
  services.map((db, i) =>
    db.rpc('decide_review', {
      p_digest: hash(token2),
      p_choice: i === 0 ? 'approved' : 'changes_requested',
      p_name: 'Alex Morgan',
      p_comments: i === 0 ? '' : 'A competing decision',
      p_design: true,
      p_policy: true,
    }),
  ),
);
assert.equal(
  outcomes.filter((r) => !r.error).length,
  1,
  'Exactly one competing decision may succeed.',
);
const winner = await checked(
  service
    .from('approval_decisions')
    .select('choice')
    .eq('order_id', orderId)
    .order('decided_at', { ascending: false })
    .limit(1)
    .single(),
);
let approvedToken = token2;
if (winner.choice !== 'approved') {
  approvedToken = randomBytes(32).toString('hex');
  await send(file2, approvedToken);
  await checked(
    service.rpc('decide_review', {
      p_digest: hash(approvedToken),
      p_choice: 'approved',
      p_name: 'Alex Morgan',
      p_comments: '',
      p_design: true,
      p_policy: true,
    }),
  );
}
await checked(
  service.rpc('decide_review', {
    p_digest: hash(approvedToken),
    p_choice: 'approved',
    p_name: 'Alex Morgan',
    p_comments: '',
    p_design: true,
    p_policy: true,
  }),
);
const decisions = await checked(
  service.from('approval_decisions').select('request_id').eq('order_id', orderId),
);
const outbox = await checked(service.from('email_outbox').select('id').eq('order_id', orderId));
assert.equal(outbox.length, decisions.length, 'Retry must not duplicate notifications.');
await checked(
  owner.db.rpc('save_internal_note', {
    p_order: orderId,
    p_revision: revision,
    p_note: 'PRIVATE CONNECTED CHECK NOTE',
  }),
);
revision++;
await checked(owner.db.rpc('start_production', { p_order: orderId }));
await denied(
  owner.db.rpc('mark_ready', {
    p_order: orderId,
    p_counts: [{ completed: 23, exceptions: 0, reason: '' }],
  }),
  'Counts must reconcile.',
);
await checked(
  owner.db.rpc('mark_ready', {
    p_order: orderId,
    p_counts: [{ completed: 24, exceptions: 0, reason: '' }],
  }),
);
await denied(
  owner.db.rpc('collect_order', { p_order: orderId, p_collector: '', p_confirm: true }),
  'Collection requires a name.',
);
await checked(
  owner.db.rpc('collect_order', { p_order: orderId, p_collector: 'Alex Morgan', p_confirm: true }),
);
assert.equal(
  (await checked(owner.db.from('orders').select('lifecycle').eq('id', orderId).single())).lifecycle,
  'completed',
);
assert.deepEqual(await checked(other.db.from('orders').select('*').eq('id', orderId)), []);
await denied(
  other.db.rpc('save_internal_note', { p_order: orderId, p_revision: 0, p_note: 'Attack' }),
  'Cross-tenant mutation must fail.',
);
await denied(
  other.db.storage.from('order-files').createSignedUrl(file2.path, 60),
  'Cross-tenant storage signing must fail.',
);

const invitation = randomBytes(32).toString('hex');
await checked(owner.db.rpc('invite_staff', { p_email: staff.email, p_digest: hash(invitation) }));
await denied(
  other.db.rpc('accept_invitation', { p_digest: hash(invitation) }),
  'Invitation requires intended email.',
);
await checked(staff.db.rpc('accept_invitation', { p_digest: hash(invitation) }));
assert.equal((await checked(staff.db.from('orders').select('id').eq('id', orderId))).length, 1);
await checked(owner.db.rpc('remove_staff', { p_user: staff.user }));
assert.deepEqual(await checked(staff.db.from('orders').select('id').eq('id', orderId)), []);
await denied(
  staff.db.rpc('accept_invitation', { p_digest: hash(invitation) }),
  'Removed staff cannot reuse an invitation.',
);

// An expired shop retains reads/exports and already-sent decisions, but cannot create new work.
const pendingOrder = randomUUID();
await checked(
  owner.db.rpc('create_order', {
    ...create,
    p_title: 'Expiry decision check',
    p_key: pendingOrder,
  }),
);
await checked(
  owner.db.rpc('save_intake', {
    p_order: pendingOrder,
    p_revision: 0,
    p_garments: garments,
    p_spec: spec,
    p_reason: 'Reconciled expiry-check intake.',
  }),
);
const pendingFile = await checked(
  owner.db.rpc('reserve_attachment', {
    p_order: pendingOrder,
    p_name: 'expiry-proof.png',
    p_mime: 'image/png',
    p_bytes: file2.bytes.length,
    p_purpose: 'proof',
    p_caption: '',
  }),
);
await checked(
  service.storage
    .from('order-files')
    .upload(pendingFile.path, file2.bytes, { contentType: 'image/png', upsert: false }),
);
await checked(
  service.rpc('finalize_attachment', {
    p_id: pendingFile.id,
    p_digest: hash(file2.bytes),
    p_success: true,
  }),
);
const expiryToken = randomBytes(32).toString('hex');
await checked(
  owner.db.rpc('send_proof', {
    p_order: pendingOrder,
    p_revision: 1,
    p_files: [pendingFile.id],
    p_digest: hash(expiryToken),
  }),
);
await checked(
  service
    .from('workspaces')
    .update({
      trial_ends_at: new Date(Date.now() - 86400000).toISOString(),
      paid_through: null,
      grace_until: null,
    })
    .eq('id', workspace),
);
await denied(
  owner.db.rpc('create_order', { ...create, p_key: randomUUID() }),
  'Expired trial must block new orders.',
);
await denied(
  owner.db.rpc('reserve_attachment', {
    p_order: pendingOrder,
    p_name: 'blocked.png',
    p_mime: 'image/png',
    p_bytes: 10,
    p_purpose: 'proof',
    p_caption: '',
  }),
  'Expired trial must block uploads.',
);
await checked(
  service.rpc('decide_review', {
    p_digest: hash(expiryToken),
    p_choice: 'approved',
    p_name: 'Alex Morgan',
    p_comments: '',
    p_design: true,
    p_policy: true,
  }),
);
console.log('Connected API decisions, isolation, staff removal, and expired-trial rules passed.');

const browser = await chromium.launch();
try {
  const signIn = async (account) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(app + '/login');
    await page.getByLabel('Email address').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL('**/app/orders');
    return { ctx, page };
  };
  const { ctx, page } = await signIn(owner);
  await page.goto(app + '/app/settings/billing?checkout=returned');
  await expect(page.getByRole('heading', { name: 'Shop settings', exact: true })).toBeVisible();
  assert.equal(
    (await checked(owner.db.from('workspaces').select('paid_through').eq('id', workspace).single()))
      .paid_through,
    null,
    'A checkout return URL must not grant paid access.',
  );
  await page.goto(app + '/app/orders/new');
  await page.getByLabel('Job title', { exact: true }).fill('This unsaved title must remain');
  await page.getByLabel('Customer name', { exact: true }).fill('Alex Morgan');
  await page.getByLabel('Customer email', { exact: true }).fill('alex@example.test');
  await page.getByRole('button', { name: 'Create order & add garments' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('read-only');
  await expect(page.getByLabel('Job title', { exact: true })).toHaveValue(
    'This unsaved title must remain',
  );
  await page.goto(app + '/app/orders/' + orderId);
  await expect(page.getByRole('heading', { name: create.p_title })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: create.p_title })).toBeVisible();
  const response = await ctx.request.get(app + '/api/export');
  assert.equal(response.status(), 200);
  const exported = await response.json();
  assert.ok(exported.orders.some((o) => o.id === orderId));
  assert.ok(!JSON.stringify(exported).includes(approvedToken));
  const download = await ctx.request.get(app + '/api/files/' + file2.id);
  assert.equal(download.status(), 200);
  assert.equal(hash(await download.body()), hash(file2.bytes));
  const pdf = await ctx.request.get(app + '/api/orders/' + orderId + '/pdf');
  assert.equal(pdf.status(), 200);
  assert.equal((await pdf.body()).subarray(0, 5).toString(), '%PDF-');
  const isolated = await signIn(other);
  assert.equal((await isolated.ctx.request.get(app + '/api/files/' + file2.id)).status(), 404);
  assert.equal(
    (await isolated.ctx.request.get(app + '/api/orders/' + orderId + '/pdf')).status(),
    404,
  );
  const otherExport = await (await isolated.ctx.request.get(app + '/api/export')).json();
  assert.ok(!otherExport.orders.some((o) => o.id === orderId));
  await ctx.close();
  await isolated.ctx.close();
} finally {
  await browser.close();
}
await writeFile(
  '.local/connected-check.json',
  JSON.stringify(
    {
      checked_at: new Date().toISOString(),
      workspace,
      order: orderId,
      status: 'passed',
      limits:
        'Verified local Auth login, Storage, SQL, browser routes, expiry/read access, failed-input preservation, and forged checkout redirects. Signup mail and full UI mutations have separate checks. Actual Stripe, provider email delivery, and quota races require separate checks.',
    },
    null,
    2,
  ),
);
console.log(
  'Connected local workflow, concurrent decision, tenant isolation, private downloads, PDF, export, and staff-removal checks passed. Fixtures preserved; local credentials and report are in .local/.',
);
