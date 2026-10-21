import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

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
  throw new Error('Logo checks require explicitly enabled local fixtures.');
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const objects = async (workspace) =>
  (await checked(service.storage.from('shop-logos').list(workspace))).map(
    (o) => workspace + '/' + o.name,
  );
const shopRow = async (workspace) =>
  checked(service.from('workspaces').select('*').eq('id', workspace).single());
async function account(label) {
  const email = `logo-${label}-${randomBytes(5).toString('hex')}@example.test`,
    password = randomBytes(24).toString('base64url');
  const user = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const db = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  await checked(db.auth.signInWithPassword({ email, password }));
  return { email, password, db, id: user.user.id };
}
const owner = await account('owner'),
  staff = await account('staff'),
  outsider = await account('outsider');
const workspace = await checked(
  owner.db.rpc('onboard_shop', {
    p_name: 'Logo Check Embroidery',
    p_timezone: 'America/Chicago',
    p_policy: 'Synthetic policy.',
  }),
);
await checked(
  outsider.db.rpc('onboard_shop', { p_name: 'Other Shop', p_timezone: 'UTC', p_policy: '' }),
);
await checked(
  service.from('memberships').insert({ workspace_id: workspace, user_id: staff.id, role: 'staff' }),
);

// A reconciled order with a sent proof gives us a real customer review link.
const order = await checked(
  owner.db.rpc('create_order', {
    p_title: 'Logo check polos',
    p_customer_name: 'Synthetic customer',
    p_email: 'logo-customer@example.test',
    p_company: '',
    p_due: null,
    p_key: randomUUID(),
  }),
);
await checked(
  owner.db.rpc('save_intake', {
    p_order: order,
    p_revision: 0,
    p_garments: [{ description: 'Polo', sizes: [{ size: 'M', expected: 1, received: 1 }] }],
    p_spec: { placement: 'Left chest' },
    p_reason: 'Synthetic reconciled intake.',
  }),
);
const proofBytes = await readFile('supabase/fixtures/northline-v1.png');
const reservation = await checked(
  owner.db.rpc('reserve_attachment', {
    p_order: order,
    p_name: 'proof.png',
    p_mime: 'image/png',
    p_bytes: proofBytes.length,
    p_purpose: 'proof',
    p_caption: '',
  }),
);
await checked(
  service.storage
    .from('order-files')
    .upload(reservation.path, proofBytes, { contentType: 'image/png' }),
);
await checked(
  service.rpc('finalize_attachment', {
    p_id: reservation.id,
    p_digest: createHash('sha256').update(proofBytes).digest('hex'),
    p_success: true,
  }),
);
const token = randomBytes(32).toString('hex');
const { revision } = await checked(
  owner.db.from('orders').select('revision').eq('id', order).single(),
);
await checked(
  owner.db.rpc('send_proof', {
    p_order: order,
    p_revision: revision,
    p_files: [reservation.id],
    p_digest: createHash('sha256').update(token).digest('hex'),
  }),
);

const report = { workspace, checks: [] };
const pass = (name) => {
  report.checks.push(name);
  console.log('✓ ' + name);
};
const browser = await chromium.launch();
const login = async (who, viewport = { width: 1440, height: 1000 }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(app + '/login');
  await page.getByLabel('Email address').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/app/orders');
  return { context, page };
};
const logoForm = (page) =>
  page
    .locator('form')
    .filter({ has: page.locator('input[name="intent"][value="shop-logo"]') })
    .filter({ has: page.locator('input[type="file"]') });
const pdfImages = async (bytes) => {
  const pdf = await PDFDocument.load(bytes);
  const objects = pdf.context.enumerateIndirectObjects().map(([ref, o]) => [ref, String(o)]);
  // A transparent PNG adds a soft-mask image; count only the drawn images.
  const masks = new Set(
    objects.flatMap(([, o]) => [...o.matchAll(/\/SMask (\d+) 0 R/g)].map((m) => +m[1])),
  );
  return objects.filter(([ref, o]) => o.includes('/Subtype /Image') && !masks.has(ref.objectNumber))
    .length;
};
try {
  const { context, page } = await login(owner);
  // Order sheets always carry the QR code image; approval records carry no image.
  const before = await (await context.request.get(app + `/api/orders/${order}/pdf`)).body();
  assert.equal(await pdfImages(before), 1, 'order sheet without a logo has only its QR code');
  await page.goto(app + '/app/settings/shop');
  await expect(page.getByText('No logo yet')).toBeVisible();
  await expect(page.locator('.shop-monogram')).toHaveText('LC');

  // Rejected content never reaches storage.
  await logoForm(page)
    .getByLabel('Logo image')
    .setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<svg onload="alert(1)"/>'),
    });
  await logoForm(page).getByRole('button', { name: 'Upload logo' }).click();
  await expect(logoForm(page).getByRole('alert')).toContainText('must match');
  assert.deepEqual(await objects(workspace), []);
  pass('disguised SVG rejected before storage');

  await logoForm(page).getByLabel('Logo image').setInputFiles('supabase/fixtures/northline-v1.png');
  await logoForm(page).getByRole('button', { name: 'Upload logo' }).click();
  await expect(logoForm(page).getByRole('status')).toContainText('Logo saved');
  await page.reload();
  const first = await shopRow(workspace);
  assert.match(first.logo_path, new RegExp(`^${workspace}/[0-9a-f-]{36}\\.png$`));
  assert.deepEqual(await objects(workspace), [first.logo_path]);
  await expect(page.locator('.logo-preview img')).toHaveJSProperty('complete', true);
  assert.ok(await page.locator('.logo-preview img').evaluate((img) => img.naturalWidth > 0));
  assert.ok(await page.locator('.shop-logo-mark img').evaluate((img) => img.naturalWidth > 0));
  pass('owner upload stored privately and shown in settings and sidebar');

  const served = await context.request.get(app + '/api/logo');
  assert.equal(served.status(), 200);
  assert.equal(served.headers()['content-type'], 'image/png');
  assert.match(served.headers()['cache-control'], /private/);
  const servedBytes = await served.body();
  assert.equal(createHash('sha256').update(servedBytes).digest('hex'), first.logo_digest);
  const notModified = await context.request.get(app + '/api/logo', {
    headers: { 'If-None-Match': served.headers().etag },
  });
  assert.equal(notModified.status(), 304);
  const publicUrl = service.storage.from('shop-logos').getPublicUrl(first.logo_path).data.publicUrl;
  assert.notEqual((await fetch(publicUrl)).status, 200);
  pass('logo route serves the stored digest with revalidation; bucket is not public');

  const sheet = await context.request.get(app + `/api/orders/${order}/pdf`);
  assert.equal(sheet.status(), 200);
  assert.equal(await pdfImages(await sheet.body()), 2);
  const proofId = (
    await checked(owner.db.from('proof_versions').select('id').eq('order_id', order).single())
  ).id;
  const record = await context.request.get(app + `/api/orders/${order}/pdf?proof=${proofId}`);
  assert.equal(await pdfImages(await record.body()), 1);
  pass('order sheet and approval record PDFs include the logo');

  const customer = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const review = await customer.newPage();
  const reviewErrors = [];
  // Development React reports the review page's strict CSP blocking eval; production never uses it.
  review.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !m.text().startsWith('eval() is not supported') &&
      reviewErrors.push(m.text()),
  );
  review.on('pageerror', (e) => reviewErrors.push(e.message));
  await review.goto(app + '/review/' + token);
  const reviewLogo = review.locator('.review-shop-logo');
  await expect(reviewLogo).toBeVisible();
  assert.ok(await reviewLogo.evaluate((img) => img.naturalWidth > 0));
  assert.equal((await customer.request.get(app + '/api/logo')).status(), 401);
  assert.equal(
    (await customer.request.get(app + '/api/logo?token=' + 'f'.repeat(64))).status(),
    404,
  );
  await mkdir('.local/qa', { recursive: true });
  await review.screenshot({ path: '.local/qa/logo-review-mobile.png', fullPage: false });
  assert.deepEqual(reviewErrors, [], 'customer review page logs no browser errors');
  pass('customer review page shows the logo through its token; anonymous access is denied');

  const other = await login(outsider);
  assert.equal((await other.context.request.get(app + '/api/logo')).status(), 404);
  pass('another shop cannot read this logo');

  const team = await login(staff);
  await team.page.goto(app + '/app/settings/shop');
  await expect(team.page.locator('.logo-preview img')).toBeVisible();
  await expect(team.page.getByText('Only the shop owner can change the logo.')).toBeVisible();
  assert.equal(await logoForm(team.page).count(), 0);
  assert.equal((await team.context.request.get(app + '/api/logo')).status(), 200);
  const staffAttempt = await staff.db.rpc('set_shop_logo', {
    p_path: `${workspace}/${randomUUID()}.png`,
    p_digest: 'a'.repeat(64),
    p_bytes: 10,
    p_width: 10,
    p_height: 10,
  });
  assert.match(staffAttempt.error?.message || '', /Owner access required/);
  assert.match((await staff.db.rpc('remove_shop_logo')).error?.message || '', /Owner access/);
  pass('staff see the logo but cannot change it');

  await logoForm(page)
    .getByLabel('New logo image')
    .setInputFiles('supabase/fixtures/northline-v2.png');
  await logoForm(page).getByRole('button', { name: 'Replace logo' }).click();
  await expect(logoForm(page).getByRole('status')).toContainText('Logo saved');
  const second = await shopRow(workspace);
  assert.notEqual(second.logo_path, first.logo_path);
  assert.deepEqual(await objects(workspace), [second.logo_path]);
  await review.reload();
  const refreshed = await review.locator('.review-shop-logo').getAttribute('src');
  assert.ok(refreshed.includes('v=' + second.logo_digest.slice(0, 16)));
  pass('replacement deletes the displaced object and refreshes customer pages');

  await page.reload();
  await page.locator('summary').filter({ hasText: 'Remove logo' }).click();
  await logoForm(page).getByRole('button', { name: 'Remove logo' }).click();
  // Removal needs the explicit confirmation; nothing changes without it.
  await expect(logoForm(page).getByRole('alert')).toContainText('Confirm logo removal');
  assert.equal((await shopRow(workspace)).logo_path, second.logo_path);
  await logoForm(page).getByRole('checkbox').check();
  await logoForm(page).getByRole('button', { name: 'Remove logo' }).click();
  await expect(logoForm(page).getByRole('status')).toContainText('Logo removed');
  await expect(page.getByText('No logo yet')).toBeVisible();
  assert.equal((await shopRow(workspace)).logo_path, null);
  assert.deepEqual(await objects(workspace), []);
  assert.equal((await context.request.get(app + '/api/logo')).status(), 404);
  await review.reload();
  await expect(review.locator('.review-shop-logo')).toHaveCount(0);
  assert.equal(
    await pdfImages(await (await context.request.get(app + `/api/orders/${order}/pdf`)).body()),
    1,
  );
  pass('removal clears storage, workspace, customer page, and PDFs');

  // Read-only shops keep their logo but cannot change it.
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
  await page.reload();
  await logoForm(page).getByLabel('Logo image').setInputFiles('supabase/fixtures/northline-v1.png');
  await logoForm(page).getByRole('button', { name: 'Upload logo' }).click();
  await expect(logoForm(page).getByRole('alert')).toContainText('read-only');
  assert.deepEqual(await objects(workspace), []);
  pass('expired shop upload is rejected and its staged object is deleted');

  const mobile = await login(owner, { width: 390, height: 844 });
  await checked(
    service
      .from('workspaces')
      .update({ trial_ends_at: new Date(Date.now() + 7 * 86400000).toISOString() })
      .eq('id', workspace),
  );
  await mobile.page.goto(app + '/app/settings/shop');
  await logoForm(mobile.page)
    .getByLabel('Logo image')
    .setInputFiles('supabase/fixtures/northline-v1.png');
  await logoForm(mobile.page).getByRole('button', { name: 'Upload logo' }).click();
  await expect(logoForm(mobile.page).getByRole('status')).toContainText('Logo saved');
  assert.ok(
    await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );
  await mobile.page.screenshot({ path: '.local/qa/logo-settings-mobile.png', fullPage: true });
  pass('mobile upload works without horizontal scrolling');

  // A new owner can add the optional logo while creating the shop.
  const fresh = await account('onboarding');
  const start = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const onboarding = await start.newPage();
  onboarding.setDefaultTimeout(20000);
  await onboarding.goto(app + '/login');
  await onboarding.getByLabel('Email address').fill(fresh.email);
  await onboarding.getByLabel('Password', { exact: true }).fill(fresh.password);
  await onboarding.getByRole('button', { name: 'Log in', exact: true }).click();
  await onboarding.waitForURL('**/onboarding');
  await onboarding.getByLabel('Shop name').fill('Onboarding Logo Shop');
  await onboarding
    .getByLabel('Shop logo (optional)')
    .setInputFiles('supabase/fixtures/northline-v2.png');
  await onboarding.getByRole('button', { name: 'Create my shop' }).click();
  await onboarding.waitForURL('**/app/orders');
  const created = await checked(
    fresh.db.from('memberships').select('workspace_id').eq('user_id', fresh.id).single(),
  );
  const freshShop = await shopRow(created.workspace_id);
  assert.ok(freshShop.logo_path);
  assert.deepEqual(await objects(created.workspace_id), [freshShop.logo_path]);
  assert.ok(
    await onboarding.locator('.shop-logo-mark img').evaluate((img) => img.naturalWidth > 0),
  );
  pass('optional logo saved during onboarding');
} finally {
  await browser.close();
}
await writeFile('.local/shop-logo-check.json', JSON.stringify(report, null, 2));
console.log(`All ${report.checks.length} shop logo checks passed.`);
