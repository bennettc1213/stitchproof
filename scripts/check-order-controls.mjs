import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
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
  throw new Error('Order-control checks require explicitly enabled local fixtures.');
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
  const email = `controls-${role}-${tag}@example.test`;
  const { user } = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const db = client();
  await checked(db.auth.signInWithPassword({ email, password }));
  return { db, email, id: user.id };
};
const owner = await account('owner'),
  staff = await account('staff'),
  other = await account('other');
const workspace = await checked(
  owner.db.rpc('onboard_shop', {
    p_name: 'Order controls check',
    p_timezone: 'America/Los_Angeles',
    p_policy: 'Fictional policy.',
  }),
);
await checked(
  other.db.rpc('onboard_shop', {
    p_name: 'Other controls shop',
    p_timezone: 'America/Los_Angeles',
    p_policy: '',
  }),
);
await checked(
  service.from('memberships').insert({ workspace_id: workspace, user_id: staff.id, role: 'staff' }),
);
const bytes = await readFile('supabase/fixtures/northline-v1.png');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const row = (id) => checked(owner.db.from('orders').select('*').eq('id', id).single());
const create = async (title, approved = false, queued = false) => {
  const id = randomUUID();
  await checked(
    owner.db.rpc('create_order', {
      p_title: title,
      p_customer_name: 'Synthetic Customer',
      p_email: 'controls-customer@example.test',
      p_company: 'Fictional',
      p_due: null,
      p_key: id,
    }),
  );
  await checked(
    owner.db.rpc('save_intake', {
      p_order: id,
      p_revision: 0,
      p_garments: [{ description: 'Polo', sizes: [{ size: 'M', expected: 1, received: 1 }] }],
      p_spec: { placement: 'Left chest' },
      p_reason: 'Synthetic reconciled intake.',
    }),
  );
  const file = await checked(
    owner.db.rpc('reserve_attachment', {
      p_order: id,
      p_name: 'fixture.png',
      p_mime: 'image/png',
      p_bytes: bytes.length,
      p_purpose: 'proof',
      p_caption: '',
    }),
  );
  await checked(
    service.storage.from('order-files').upload(file.path, bytes, { contentType: 'image/png' }),
  );
  await checked(
    service.rpc('finalize_attachment', { p_id: file.id, p_digest: hash(bytes), p_success: true }),
  );
  const token = randomBytes(32).toString('hex');
  await checked(
    owner.db.rpc(queued ? 'email_proof' : 'send_proof', {
      p_order: id,
      p_revision: 1,
      p_files: [file.id],
      ...(queued ? { p_token: token } : { p_digest: hash(token) }),
    }),
  );
  if (approved)
    await checked(
      service.rpc('decide_review', {
        p_digest: hash(token),
        p_choice: 'approved',
        p_name: 'Synthetic Customer',
        p_comments: '',
        p_design: true,
        p_policy: true,
      }),
    );
  return { id, title, file, token };
};
const pending = await create('Control check — pending job', false, true);
const approved = await create('Control check — approved job', true);
const collected = await create('Control check — collected job', true);
await checked(owner.db.rpc('start_production', { p_order: collected.id }));
await checked(
  owner.db.rpc('mark_ready', {
    p_order: collected.id,
    p_counts: [{ completed: 1, exceptions: 0, reason: '' }],
  }),
);
await checked(
  owner.db.rpc('collect_order', {
    p_order: collected.id,
    p_collector: 'Synthetic Customer',
    p_confirm: true,
  }),
);

for (const [name, args] of [
  ['assign_order', { p_order: pending.id, p_revision: 2, p_user: other.id }],
  ['cancel_order', { p_order: pending.id, p_revision: 2, p_reason: 'Attack', p_confirm: true }],
  ['archive_order', { p_order: pending.id, p_revision: 2, p_archived: true }],
])
  assert.ok((await other.db.rpc(name, args)).error);
assert.ok(
  (await owner.db.rpc('assign_order', { p_order: pending.id, p_revision: 2, p_user: other.id }))
    .error,
);
assert.ok((await client().rpc('assignment_members')).error);
assert.ok(
  (await owner.db.from('orders').update({ lifecycle: 'cancelled' }).eq('id', pending.id)).error,
);
const raceStates = [];
for (let index = 0; index < 3; index++) {
  const fixture = await create('Production cancellation race ' + index, true);
  const result = await Promise.all([
    owner.db.rpc('cancel_order', {
      p_order: fixture.id,
      p_revision: 2,
      p_reason: 'Cancel before production',
      p_confirm: true,
    }),
    owner.db.rpc('start_production', { p_order: fixture.id }),
  ]);
  assert.equal(result.filter((value) => !value.error).length, 1);
  const value = await row(fixture.id);
  assert.ok(['cancelled', 'in_production'].includes(value.lifecycle));
  const production = await checked(
    owner.db.from('production_runs').select('order_id').eq('order_id', fixture.id),
  );
  assert.equal(production.length, value.lifecycle === 'in_production' ? 1 : 0);
  raceStates.push(value.lifecycle);
}
console.log('Tenant/direct-write denial and independent cancellation/production races passed.');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const publicContext = await browser.newContext();
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && /hydrat/i.test(message.text()))
    runtimeErrors.push(message.text());
});
page.setDefaultTimeout(20000);
const controls = (target) =>
  target
    .locator('form')
    .filter({ has: target.locator('input[name="intent"][value="order-control"]') });
const login = async (target, account) => {
  await target.goto(app + '/login');
  await target.getByLabel('Email address', { exact: true }).fill(account.email);
  await target.getByLabel('Password', { exact: true }).fill(password);
  await target.getByRole('button', { name: 'Log in', exact: true }).click();
  await target.waitForURL('**/app/orders');
};
const openCancel = async (target) => {
  await target.locator('summary').filter({ hasText: 'Cancel this order' }).click();
};
try {
  await login(page, owner);
  await page.goto(app + '/app/orders/' + approved.id);
  await page
    .getByLabel('Visible only to your team', { exact: true })
    .fill('A private note before assigning.');
  await page.getByRole('button', { name: 'Save internal note', exact: true }).click();
  await expect(
    page
      .locator('form')
      .filter({ has: page.locator('input[name="intent"][value="note"]') })
      .getByRole('status'),
  ).toBeVisible();
  await page.getByLabel('Assign team member', { exact: true }).selectOption(staff.id);
  await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(controls(page).getByRole('status')).toContainText('Assignment saved');
  const first = await row(approved.id);
  assert.equal(first.assigned_to, staff.id);
  assert.equal(first.spec_revision, 1);
  await page.getByRole('tab', { name: 'Production & pickup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start production', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Proofs & approval', exact: true }).click();
  await expect(page.getByText('Approved by Synthetic Customer.', { exact: false })).toBeVisible();
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await login(staffPage, staff);
  await staffPage.goto(app + '/app/orders/' + approved.id);
  await staffPage.getByLabel('Assign team member', { exact: true }).selectOption(owner.id);
  await staffPage.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(controls(staffPage).getByRole('status')).toContainText('Assignment saved');
  assert.equal((await row(approved.id)).assigned_to, owner.id);
  await staffContext.close();

  const publicPage = await publicContext.newPage();
  await publicPage.goto(app + '/review/' + pending.token);
  await expect(
    publicPage.getByRole('button', { name: 'Approve this exact proof', exact: true }),
  ).toBeVisible();
  assert.equal(
    (
      await publicContext.request.get(
        app + '/api/files/' + pending.file.id + '?token=' + pending.token,
      )
    ).status(),
    200,
  );
  await page.goto(app + '/app/orders/' + pending.id);
  await openCancel(page);
  await page
    .getByLabel('Cancellation reason', { exact: true })
    .fill('Unsaved stale cancellation reason');
  await controls(page).locator('input[name="confirm_cancel"]').check();
  await checked(
    owner.db.rpc('assign_order', { p_order: pending.id, p_revision: 2, p_user: owner.id }),
  );
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(controls(page).getByRole('alert')).toContainText('This order changed');
  await expect(page.getByLabel('Cancellation reason', { exact: true })).toHaveValue(
    'Unsaved stale cancellation reason',
  );
  assert.equal((await row(pending.id)).lifecycle, 'open');
  await page.reload();
  await page.getByLabel('Assign team member', { exact: true }).selectOption(staff.id);
  await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(controls(page).getByRole('status')).toContainText('Assignment saved');
  await openCancel(page);
  await page
    .getByLabel('Cancellation reason', { exact: true })
    .fill('Customer no longer needs this order.');
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(controls(page).getByRole('alert')).toContainText('Confirm cancellation');
  await expect(page.getByLabel('Cancellation reason', { exact: true })).toHaveValue(
    'Customer no longer needs this order.',
  );
  await controls(page).locator('input[name="confirm_cancel"]').check();
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(controls(page).getByRole('status')).toContainText('Order cancelled');
  await expect(page.getByRole('button', { name: 'Archive order', exact: true })).toBeVisible();
  await publicPage.reload();
  await expect(
    publicPage.getByRole('heading', { name: 'This review link is inactive.', exact: true }),
  ).toBeVisible();
  assert.equal(
    (
      await publicContext.request.get(
        app + '/api/files/' + pending.file.id + '?token=' + pending.token,
      )
    ).status(),
    404,
  );
  assert.ok(
    (
      await service.rpc('decide_review', {
        p_digest: hash(pending.token),
        p_choice: 'approved',
        p_name: 'Late customer',
        p_comments: '',
        p_design: true,
        p_policy: true,
      })
    ).error,
  );
  await page.getByRole('button', { name: 'Archive order', exact: true }).click();
  await expect(controls(page).getByRole('status')).toContainText('Order archived');
  await page.goto(app + '/app/orders');
  await expect(page.getByRole('heading', { name: /^Orders/ })).toBeVisible();
  await expect(page.locator('.order-title').filter({ hasText: pending.title })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Order visibility', exact: true })
    .getByRole('link', { name: 'Archived orders', exact: true })
    .click();
  await expect(page.locator('.order-title').filter({ hasText: pending.title })).toHaveCount(1);
  await page.locator('.order-title').filter({ hasText: pending.title }).click();
  await page.getByRole('button', { name: 'Restore to current list', exact: true }).click();
  await expect(controls(page).getByRole('status')).toContainText('Order restored');
  assert.equal((await row(pending.id)).lifecycle, 'cancelled');
  assert.equal((await row(pending.id)).archived_at, null);
  await page.goto(app + '/app/orders');
  await page.getByRole('tab', { name: 'Cancelled', exact: true }).click();
  await expect(page.locator('.order-title').filter({ hasText: pending.title })).toHaveCount(1);

  await page.goto(app + '/app/orders/' + collected.id);
  await expect(page.getByRole('button', { name: 'Archive order', exact: true })).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: 'Cancel this order' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive order', exact: true }).click();
  await expect(controls(page).getByRole('status')).toContainText('Order archived');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Restore to current list', exact: true }),
  ).toBeVisible();
  const download = await context.request.get(app + '/api/files/' + collected.file.id);
  assert.equal(download.status(), 200);
  assert.equal(hash(await download.body()), hash(bytes));
  const pdf = await context.request.get(app + '/api/orders/' + collected.id + '/pdf');
  assert.equal(pdf.status(), 200);
  assert.equal((await pdf.body()).subarray(0, 5).toString(), '%PDF-');
  const exported = await (await context.request.get(app + '/api/export')).json();
  assert.ok(
    exported.orders.some((order) => order.id === pending.id && order.lifecycle === 'cancelled'),
  );
  assert.ok(
    exported.orders.some(
      (order) => order.id === collected.id && order.lifecycle === 'completed' && order.archived_at,
    ),
  );
  assert.ok(
    exported.order_events.some(
      (event) => event.order_id === pending.id && event.kind === 'Order cancelled',
    ),
  );
  await mkdir('.local/qa', { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: '.local/qa/order-controls-desktop.png',
    fullPage: true,
    caret: 'initial',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Restore to current list', exact: true }).click();
  await expect(controls(page).getByRole('status')).toContainText('Order restored');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Archive order', exact: true })).toBeVisible();
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await page.screenshot({
    path: '.local/qa/order-controls-mobile.png',
    fullPage: true,
    caret: 'initial',
  });

  // Removal racing assignment must terminate without deadlock and never leave a current staff choice.
  const revision = (await row(approved.id)).revision;
  const removal = await Promise.all([
    owner.db.rpc('assign_order', { p_order: approved.id, p_revision: revision, p_user: staff.id }),
    owner.db.rpc('remove_staff', { p_user: staff.id }),
  ]);
  assert.ok(!removal[1].error);
  assert.ok(
    !(await checked(owner.db.rpc('assignment_members'))).some(
      (member) => member.user_id === staff.id,
    ),
  );
  assert.ok(
    (
      await staff.db.rpc('assign_order', {
        p_order: approved.id,
        p_revision: revision,
        p_user: null,
      })
    ).error,
  );
  assert.ok((await staff.db.rpc('assignment_members')).error);
  await page.goto(app + '/app/orders/' + pending.id);
  await expect(page.getByText('Former team member', { exact: false }).first()).toBeVisible();
  await checked(
    service
      .from('workspaces')
      .update({ trial_ends_at: new Date(Date.now() - 86400000).toISOString() })
      .eq('id', workspace),
  );
  await page.reload();
  await expect(
    page.getByText('Your shop is read-only. Assignment and order controls are unavailable.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(controls(page)).toHaveCount(0);
  assert.ok(
    (
      await owner.db.rpc('archive_order', {
        p_order: pending.id,
        p_revision: (await row(pending.id)).revision,
        p_archived: true,
      })
    ).error,
  );
  assert.deepEqual(runtimeErrors, [], 'Shop controls must not produce runtime/hydration errors.');
  await writeFile(
    '.local/order-controls-check.json',
    JSON.stringify(
      {
        status: 'passed',
        checked_at: new Date().toISOString(),
        races: raceStates,
        scenarios:
          'Owner/staff assignments, approval preservation, cancellation confirmation/reason/stale input, public pending link/file revocation, cancellation versus production races, archive/restore current-list visibility, retained files/PDF/export/history, removal/assignment race, tenant/direct/anonymous/read-only denial, desktop/mobile restore persistence.',
      },
      null,
      2,
    ),
  );
  console.log(
    'Order controls passed connected API/browser checks, including archive restore and private-record preservation.',
  );
} catch (error) {
  await mkdir('.local/qa', { recursive: true });
  await page
    .screenshot({ path: '.local/qa/order-controls-failure.png', fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
