import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  app = process.env.APP_URL || 'http://127.0.0.1:3000';
const local = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !local(url) ||
  !local(app)
)
  throw new Error('Order-directory checks require explicitly enabled local fixtures.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const password = randomBytes(24).toString('base64url'),
  tag = randomBytes(6).toString('hex');
const account = async (role) => {
  const email = `order-directory-${role}-${tag}@example.test`;
  const { user } = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const db = client();
  await checked(db.auth.signInWithPassword({ email, password }));
  return { email, id: user.id, db };
};
const owner = await account('owner'),
  staff = await account('staff'),
  other = await account('other');
const workspace = await checked(
  owner.db.rpc('onboard_shop', {
    p_name: 'Order directory check',
    p_timezone: 'America/Los_Angeles',
    p_policy: 'Fictional policy.',
  }),
);
await checked(
  other.db.rpc('onboard_shop', {
    p_name: 'Other directory check',
    p_timezone: 'America/Los_Angeles',
    p_policy: '',
  }),
);
await checked(
  service.from('memberships').insert({ workspace_id: workspace, user_id: staff.id, role: 'staff' }),
);
const customer = randomUUID();
await checked(
  service.from('customers').insert({
    id: customer,
    workspace_id: workspace,
    name: 'Directory Customer',
    email: 'directory-customer@example.test',
    company: '100% Needle',
  }),
);
const fixtures = Array.from({ length: 805 }, (_, index) => {
  const archived = index >= 600,
    n = archived ? index - 600 : index;
  const assigned = archived ? n % 2 === 0 : n < 72 || n % 2 === 0;
  return {
    id: randomUUID(),
    workspace_id: workspace,
    customer_id: customer,
    number: 1001 + index,
    title:
      (archived ? 'Needle archive ' : n < 72 ? 'Needle group ' : 'Directory job ') +
      String(n).padStart(3, '0'),
    due_date: n % 3 === 0 ? null : '2026-11-' + String((n % 5) + 1).padStart(2, '0'),
    created_at: new Date(Date.UTC(2026, 0, 1) + Math.floor(index / 3) * 1000).toISOString(),
    assigned_to: assigned ? staff.id : null,
    assigned_label: assigned ? staff.email : '',
    lifecycle: archived ? 'cancelled' : n < 72 ? 'ready_for_pickup' : 'draft',
    archived_at: archived ? new Date().toISOString() : null,
  };
});
for (let offset = 0; offset < fixtures.length; offset += 400)
  await checked(service.from('orders').insert(fixtures.slice(offset, offset + 400)));
const directory = (changes = {}, db = owner.db) =>
  checked(
    db.rpc('order_directory', {
      p_query: '',
      p_status: 'all',
      p_assignee: 'all',
      p_archived: false,
      p_sort: 'newest',
      p_page: 1,
      ...changes,
    }),
  );
for (const [archived, total] of [
  [false, 600],
  [true, 205],
]) {
  const seen = new Set();
  for (let page = 1; page <= Math.ceil(total / 24); page++) {
    const result = await directory({ p_archived: archived, p_page: page });
    assert.equal(result.total, total);
    for (const order of result.orders) {
      assert.ok(!seen.has(order.id));
      seen.add(order.id);
    }
  }
  assert.equal(seen.size, total);
}
assert.equal(
  (await directory({ p_query: 'Needle group', p_status: 'ready_for_pickup', p_assignee: staff.id }))
    .total,
  72,
);
assert.equal((await directory({ p_query: '#1001' })).orders[0].id, fixtures[0].id);
assert.equal((await directory({ p_query: 'DIRECTORY-CUSTOMER@EXAMPLE.TEST' })).total, 600);
assert.equal((await directory({ p_query: '%' })).total, 600);
assert.equal((await directory({ p_query: '_,),workspace_id.neq.' })).total, 0);
assert.equal((await directory({ p_assignee: other.id })).total, 0);
assert.equal((await directory({}, other.db)).total, 0);
assert.ok((await client().rpc('order_directory')).error);
assert.equal((await directory()).summary.ready, 72);
for (const sort of ['due_asc', 'due_desc']) {
  const ordered = [];
  for (let page = 1; page <= 3; page++)
    ordered.push(
      ...(await directory({ p_query: 'Needle group', p_sort: sort, p_page: page })).orders,
    );
  assert.equal(new Set(ordered.map((order) => order.id)).size, 72);
  const dates = ordered.map((order) => order.due_date).filter(Boolean);
  assert.deepEqual(
    dates,
    [...dates].sort((a, b) => (sort === 'due_asc' ? a.localeCompare(b) : b.localeCompare(a))),
  );
  assert.equal(ordered.at(-1).due_date, null);
}
console.log(
  'Actual database search/sorting/counts and disjoint pagination passed for 600 current and 205 archived orders.',
);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && /hydrat/i.test(message.text()))
    runtimeErrors.push(message.text());
});
const pagination = (target) => target.getByRole('navigation', { name: 'Order pages', exact: true });
const ids = (target) =>
  target
    .locator('tbody .order-title')
    .evaluateAll((links) => links.map((link) => new URL(link.href).pathname.split('/').at(-1)));
const login = async (target, account) => {
  await target.goto(app + '/login');
  await target.getByLabel('Email address', { exact: true }).fill(account.email);
  await target.getByLabel('Password', { exact: true }).fill(password);
  await target.getByRole('button', { name: 'Log in', exact: true }).click();
  await target.waitForURL('**/app/orders');
};
try {
  await login(page, owner);
  await expect(pagination(page)).toContainText('Page 1 of 25');
  await expect(page.locator('tbody tr')).toHaveCount(24);
  await expect(page.locator('.order-summary')).toContainText('72');
  await page.getByRole('tab', { name: 'Ready for pickup', exact: true }).click();
  await expect(pagination(page)).toContainText('Page 1 of 3');
  await page.getByRole('textbox', { name: 'Search orders', exact: true }).fill('Needle group');
  await page
    .getByRole('combobox', { name: 'Filter by assigned member', exact: true })
    .selectOption(staff.id);
  await page.getByRole('combobox', { name: 'Sort orders', exact: true }).selectOption('due_asc');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const expected = await directory({
    p_query: 'Needle group',
    p_status: 'ready_for_pickup',
    p_assignee: staff.id,
    p_sort: 'due_asc',
    p_page: 1,
  });
  await expect.poll(() => ids(page)).toEqual(expected.orders.map((order) => order.id));
  await pagination(page).getByRole('link', { name: 'Next', exact: true }).click();
  await expect(pagination(page)).toContainText('Page 2 of 3');
  const savedUrl = page.url(),
    savedQuery = new URL(savedUrl).searchParams;
  assert.equal(savedQuery.get('q'), 'Needle group');
  assert.equal(savedQuery.get('sort'), 'due_asc');
  assert.equal(savedQuery.get('assignee'), staff.id);
  assert.equal(savedQuery.get('status'), 'ready_for_pickup');
  assert.equal(savedQuery.get('page'), '2');
  const second = await directory({
    p_query: 'Needle group',
    p_status: 'ready_for_pickup',
    p_assignee: staff.id,
    p_sort: 'due_asc',
    p_page: 2,
  });
  await expect.poll(() => ids(page)).toEqual(second.orders.map((order) => order.id));
  await page.reload();
  await expect(pagination(page)).toContainText('Page 2 of 3');
  await expect(page.getByRole('textbox', { name: 'Search orders', exact: true })).toHaveValue(
    'Needle group',
  );
  await expect(page.getByRole('combobox', { name: 'Sort orders', exact: true })).toHaveValue(
    'due_asc',
  );
  await expect.poll(() => ids(page)).toEqual(second.orders.map((order) => order.id));
  await page.locator('tbody .order-title').first().click();
  await expect(page.getByRole('link', { name: 'All orders', exact: true })).toHaveAttribute(
    'href',
    new URL(savedUrl).pathname + new URL(savedUrl).search,
  );
  await page.getByRole('link', { name: 'All orders', exact: true }).click();
  await expect(pagination(page)).toContainText('Page 2 of 3');
  await expect.poll(() => ids(page)).toEqual(second.orders.map((order) => order.id));
  await pagination(page).getByRole('link', { name: 'Previous', exact: true }).click();
  await expect(pagination(page)).toContainText('Page 1 of 3');
  await page.goBack();
  await expect(pagination(page)).toContainText('Page 2 of 3');
  await page.goForward();
  await expect(pagination(page)).toContainText('Page 1 of 3');
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await login(staffPage, staff);
  await staffPage.goto(savedUrl);
  await expect(pagination(staffPage)).toContainText('Page 2 of 3');
  await expect.poll(() => ids(staffPage)).toEqual(second.orders.map((order) => order.id));
  await staffContext.close();
  await page.goto(savedUrl);
  await expect(pagination(page)).toContainText('Page 2 of 3');
  await mkdir('.local/qa', { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.local/qa/order-directory-desktop.png', caret: 'initial' });
  await page
    .getByRole('navigation', { name: 'Order visibility', exact: true })
    .getByRole('link', { name: 'Archived orders', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'No matching orders', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await expect(pagination(page)).toContainText('Page 1 of 9');
  await page.goto(app + '/app/orders?view=archived&page=999999');
  await expect(pagination(page)).toContainText('Page 9 of 9');
  assert.equal(new URL(page.url()).searchParams.get('page'), '9');
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('textbox', { name: 'Search orders', exact: true })
    .fill('Needle archive 000');
  await page.getByRole('combobox', { name: 'Sort orders', exact: true }).selectOption('due_desc');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(pagination(page)).toContainText('Page 1 of 1');
  assert.ok(!new URL(page.url()).searchParams.has('page'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Apply filters', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'Sort orders', exact: true })).toHaveValue(
    'due_desc',
  );
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: '.local/qa/order-directory-mobile.png',
    fullPage: true,
    caret: 'initial',
  });
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await expect(pagination(page)).toContainText('Page 1 of 9');
  await pagination(page).getByRole('link', { name: 'Next', exact: true }).click();
  await expect(pagination(page)).toContainText('Page 2 of 9');
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await page.goto(app + '/app/orders?q=' + encodeURIComponent('_,),workspace_id.neq.'));
  await expect(
    page.getByRole('heading', { name: 'No matching orders', exact: true }),
  ).toBeVisible();
  await checked(owner.db.rpc('remove_staff', { p_user: staff.id }));
  await page.goto(savedUrl);
  await expect(pagination(page)).toContainText('Page 2 of 3');
  await expect(
    page.getByRole('combobox', { name: 'Filter by assigned member', exact: true }),
  ).toHaveValue(staff.id);
  await expect(page.locator('tbody')).toContainText('Former team member');
  assert.ok((await staff.db.rpc('order_directory')).error);
  await checked(
    service
      .from('workspaces')
      .update({ trial_ends_at: new Date(Date.now() - 86400000).toISOString() })
      .eq('id', workspace),
  );
  await page.reload();
  await expect(pagination(page)).toContainText('Page 2 of 3');
  assert.equal((await directory()).total, 600);
  assert.deepEqual(runtimeErrors, []);
  await writeFile(
    '.local/order-directory-check.json',
    JSON.stringify(
      {
        status: 'passed',
        checked_at: new Date().toISOString(),
        current_orders: 600,
        archived_orders: 205,
        scenarios:
          'All records across disjoint database pages; literal customer/title/email/number search; null-last due sorting and stable ties; whole-view summary counts; combined status/staff/archive filters; saved/reloaded/shared/back/forward URLs and detail return links; mobile search/paging; former-member filters; tenant/anonymous/removed-member isolation and expired-shop reads.',
      },
      null,
      2,
    ),
  );
  console.log(
    'Order directory passed real API/browser checks, including saved views, detail return, shared URLs and mobile paging.',
  );
} catch (error) {
  await mkdir('.local/qa', { recursive: true });
  await page
    .screenshot({ path: '.local/qa/order-directory-failure.png', fullPage: true, caret: 'initial' })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
