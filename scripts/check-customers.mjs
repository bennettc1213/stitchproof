import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const app = process.env.APP_URL || 'http://127.0.0.1:3000';
const local = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !local(url) ||
  !local(app)
)
  throw new Error('Customer checks require explicitly enabled local fixtures.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const password = randomBytes(24).toString('base64url');
const tag = randomBytes(6).toString('hex');
const account = async (role) => {
  const email = `customers-${role}-${tag}@example.test`;
  const created = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const db = client();
  await checked(db.auth.signInWithPassword({ email, password }));
  return { db, email, id: created.user.id };
};
const owner = await account('owner'),
  other = await account('other'),
  staff = await account('staff');
const workspace = await checked(
  owner.db.rpc('onboard_shop', {
    p_name: 'Customer check shop',
    p_timezone: 'America/Los_Angeles',
    p_policy: 'Fictional policy.',
  }),
);
await checked(
  other.db.rpc('onboard_shop', {
    p_name: 'Other customer check shop',
    p_timezone: 'America/Los_Angeles',
    p_policy: '',
  }),
);
await checked(
  service.from('memberships').insert({ workspace_id: workspace, user_id: staff.id, role: 'staff' }),
);
const customerId = randomUUID();
await checked(
  service.from('customers').insert([
    {
      id: customerId,
      workspace_id: workspace,
      name: 'Zelda Needle',
      company: '100% Stitch',
      email: 'zelda@example.test',
      phone: '555-0100',
    },
    ...Array.from({ length: 205 }, (_, index) => ({
      id: randomUUID(),
      workspace_id: workspace,
      name: 'Directory ' + String(index + 1).padStart(3, '0'),
      email: `directory-${index + 1}@example.test`,
      company: 'Fictional company',
      phone: '',
    })),
  ]),
);
// Local-only bulk fixtures deliberately exceed the former 200-record UI limit.
const orderId = randomUUID();
await checked(
  service.from('orders').insert(
    Array.from({ length: 205 }, (_, index) => ({
      id: index === 0 ? orderId : randomUUID(),
      workspace_id: workspace,
      customer_id: customerId,
      number: 2000 + index,
      title: index === 0 ? 'Oldest customer order' : 'Customer history ' + index,
      created_at: new Date(Date.now() - (205 - index) * 1000).toISOString(),
    })),
  ),
);
const snapshot = {
  title: 'Original sent proof',
  policy: 'Original policy',
  spec: { placement: 'Left chest' },
};
await checked(
  service.from('proof_versions').insert({
    workspace_id: workspace,
    order_id: orderId,
    version: 1,
    spec_revision: 0,
    snapshot,
    files: [],
  }),
);
await checked(
  service.from('email_outbox').insert({
    workspace_id: workspace,
    order_id: orderId,
    template: 'pickup',
    recipient: 'zelda@example.test',
    dedupe_key: 'customer-check:' + tag,
    payload: {},
  }),
);
const update = (db, revision, name) =>
  db.rpc('update_customer', {
    p_customer: customerId,
    p_revision: revision,
    p_name: name,
    p_company: '100% Stitch',
    p_email: 'ZELDA.UPDATED@EXAMPLE.TEST',
    p_phone: '555-0199',
    p_notes: 'Private shop note.',
  });

const directory = async (query, page = 1) =>
  checked(owner.db.rpc('customer_directory', { p_query: query, p_page: page }));
const ids = new Set();
for (let page = 1; page <= 9; page++) {
  const result = await directory('', page);
  assert.equal(result.total, 206);
  for (const c of result.customers) {
    assert.ok(!ids.has(c.id));
    ids.add(c.id);
  }
}
assert.equal(ids.size, 206);
assert.equal((await directory('%')).total, 1);
assert.equal((await directory('),workspace_id.neq.')).total, 0);
assert.equal(
  (await checked(other.db.rpc('customer_directory', { p_query: 'Zelda', p_page: 1 }))).total,
  0,
);
assert.ok((await update(other.db, 0, 'Attack')).error);
assert.ok(
  (await other.db.rpc('customer_order_history', { p_customer: customerId, p_page: 1 })).error,
);
assert.ok((await client().rpc('customer_directory')).error);
assert.ok(
  (await owner.db.from('customers').update({ name: 'Direct write' }).eq('id', customerId)).error,
);
const races = await Promise.all([
  update(owner.db, 0, 'Zelda One'),
  update(staff.db, 0, 'Zelda Two'),
]);
assert.equal(races.filter((result) => !result.error).length, 1);
assert.match(races.find((result) => result.error).error.message, /changed/);
console.log(
  'Actual database pagination, literal search, tenant permissions, and competing customer edits passed.',
);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
try {
  await page.goto(app + '/login');
  await page.getByLabel('Email address', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/app/orders');
  await page.goto(app + '/app/customers');
  await expect(page.locator('.customer-grid .customer-card')).toHaveCount(24);
  const pages = page.getByRole('navigation', { name: 'Customer pages', exact: true });
  await expect(pages).toContainText('of 206');
  await pages.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(pages).toContainText('Page 2 of 9');
  await page.getByLabel('Search customers', { exact: true }).fill('Zelda');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.customer-grid .customer-card')).toHaveCount(1);
  await expect(pages).toContainText('of 1');
  assert.ok(!new URL(page.url()).searchParams.has('page'), 'A fresh search resets pagination.');
  await page.locator('.customer-card .row-arrow').click();
  await expect(page.getByRole('heading', { name: 'Contact details', exact: true })).toBeVisible();
  const edit = page
    .locator('form')
    .filter({ has: page.locator('input[name="intent"][value="update-customer"]') });
  const stale = await context.newPage();
  await stale.goto(page.url());
  await page.getByLabel('Customer name', { exact: true }).fill('Zelda Browser');
  await page.getByLabel('Company (optional)', { exact: true }).fill('100% Browser Stitch');
  await page.getByLabel('Customer email', { exact: true }).fill('zelda.browser@example.test');
  await page.getByLabel('Phone (optional)', { exact: true }).fill('555-0188');
  await page
    .getByLabel('Internal customer notes', { exact: true })
    .fill('Browser-only private note.');
  await edit.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(edit.getByRole('status')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zelda Browser', exact: true })).toBeVisible();
  await stale.getByLabel('Customer name', { exact: true }).fill('Unsaved stale name');
  await stale
    .getByRole('navigation', { name: 'Customer order pages', exact: true })
    .getByRole('link', { name: 'Next', exact: true })
    .click();
  await expect(
    stale.getByRole('navigation', { name: 'Customer order pages', exact: true }),
  ).toContainText('Page 2 of 9');
  await expect(stale.getByLabel('Customer name', { exact: true })).toHaveValue(
    'Unsaved stale name',
  );
  await stale.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(stale.locator('form').getByRole('alert')).toContainText('This customer changed');
  await expect(stale.getByLabel('Customer name', { exact: true })).toHaveValue(
    'Unsaved stale name',
  );
  await stale.close();
  await page.reload();
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Zelda Browser');
  await expect(page.getByLabel('Internal customer notes', { exact: true })).toHaveValue(
    'Browser-only private note.',
  );
  await page.getByLabel('Customer email', { exact: true }).fill('directory-1@example.test');
  await edit.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('already uses this email');
  await expect(page.getByLabel('Customer email', { exact: true })).toHaveValue(
    'directory-1@example.test',
  );
  await page.getByLabel('Customer email', { exact: true }).fill('zelda.browser@example.test');
  await page.getByLabel('Phone (optional)', { exact: true }).fill('555-0177');
  await edit.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(edit.getByRole('status')).toBeVisible();
  await page.goto(app + '/app/customers/' + customerId + '?page=9');
  await expect(page.getByRole('link', { name: /Oldest customer order/ })).toBeVisible();
  await page.getByRole('link', { name: /Oldest customer order/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Oldest customer order', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Zelda Browser', { exact: true }).first()).toBeVisible();
  await page.goto(app + '/app/customers/' + randomUUID());
  await expect(page.getByRole('heading', { name: /That page/ })).toBeVisible();
  await page.goto(app + '/app/customers?q=' + encodeURIComponent('not found %_,()'));
  await expect(
    page.getByRole('heading', { name: 'No matching customers', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('.customer-grid .customer-card')).toHaveCount(24);
  await page.goto(app + '/app/customers/' + customerId + '?page=9');
  await expect(page.getByRole('heading', { name: 'Zelda Browser', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Oldest customer order/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/customers-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Phone (optional)', { exact: true }).fill('555-0166');
  await edit.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(edit.getByRole('status')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Zelda Browser', exact: true })).toBeVisible();
  await expect(page.getByLabel('Phone (optional)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Phone (optional)', { exact: true })).toHaveValue('555-0166');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.local/qa/customers-mobile.png', fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  const record = await checked(
    owner.db.from('customers').select('*').eq('id', customerId).single(),
  );
  assert.equal(record.name, 'Zelda Browser');
  assert.equal(record.email, 'zelda.browser@example.test');
  assert.equal(record.revision, 4);
  assert.deepEqual(
    (
      await checked(
        service.from('proof_versions').select('snapshot').eq('order_id', orderId).single(),
      )
    ).snapshot,
    snapshot,
  );
  assert.equal(
    (
      await checked(
        service
          .from('email_outbox')
          .select('recipient')
          .eq('dedupe_key', 'customer-check:' + tag)
          .single(),
      )
    ).recipient,
    'zelda@example.test',
  );
  await checked(
    service
      .from('workspaces')
      .update({ trial_ends_at: new Date(Date.now() - 86400000).toISOString() })
      .eq('id', workspace),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save customer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Oldest customer order/ })).toBeVisible();
  assert.ok((await update(owner.db, record.revision, 'Blocked')).error);
  await checked(service.from('memberships').delete().eq('user_id', staff.id));
  assert.ok((await staff.db.rpc('customer_directory')).error);
  await writeFile(
    '.local/customers-check.json',
    JSON.stringify(
      {
        status: 'passed',
        checked_at: new Date().toISOString(),
        scenarios:
          '206 customers and 205 orders, stable/literal search and pagination, oldest direct detail, concurrent owner/staff edits, browser save/reload/conflicts/duplicates/input preservation, missing records, tenant/anonymous/direct-write/removed-staff denial, read-only history, immutable proof and queued recipient, desktop/mobile.',
      },
      null,
      2,
    ),
  );
  console.log(
    'Customer browser editing, search, pagination, persistence, conflict handling, and mobile checks passed.',
  );
} catch (error) {
  await mkdir('.local/qa', { recursive: true });
  await page
    .screenshot({ path: '.local/qa/customers-failure.png', fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
