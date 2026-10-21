import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const app = process.env.APP_URL || 'http://127.0.0.1:3000';
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !['localhost', '127.0.0.1'].includes(new URL(app).hostname) ||
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !['localhost', '127.0.0.1'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname)
) {
  throw new Error('The browser workflow check requires explicitly enabled local test data.');
}
const { accounts } = JSON.parse(await readFile('.local/seed-credentials.json', 'utf8'));
const account = accounts.find((a) => a.email === 'owner@cedar-stitch.example.test');
if (!account) throw new Error('Run the guarded local seed first.');
const browser = await chromium.launch();
const staff = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const customer = await browser.newContext();
const page = await staff.newPage();
page.setDefaultTimeout(20000);
const form = (intent) =>
  page.locator('form').filter({ has: page.locator(`input[name="intent"][value="${intent}"]`) });
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const disclosure = async (text) => {
  const summary = page.locator('summary').filter({ hasText: text });
  if (!(await summary.evaluate((element) => element.parentElement.open))) await summary.click();
};
const saved = async (intent) => expect(form(intent).getByRole('status')).toBeVisible();
try {
  await page.goto(app + '/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/app/orders');
  await page.goto(app + '/app/orders/new');
  const title = 'Browser check — 24 company polos';
  await page.getByLabel('Job title', { exact: true }).fill(title);
  await page.getByLabel('Customer name', { exact: true }).fill('Alex Morgan');
  await page.getByLabel('Company (optional)').fill('Northline (fictional)');
  await page.getByLabel('Customer email', { exact: true }).fill('alex-browser@example.test');
  await page.getByLabel('Due date').fill('2026-10-23');
  await page.getByRole('button', { name: 'Create order & add garments' }).click();
  await page.waitForURL(/\/app\/orders\/[a-f0-9-]{36}$/);
  const orderUrl = page.url();
  console.log('Created a fictional order through the browser.');
  await disclosure('Add garments & instructions');
  await page.getByLabel('Garment description').fill('Company polos');
  await page.getByLabel('Color / brand / style').fill('Sandstone');
  for (const [size, expected, received] of [
    ['S', 6, 6],
    ['M', 8, 7],
    ['L', 6, 6],
    ['XL', 4, 4],
  ]) {
    await page.getByLabel(size + ' expected', { exact: true }).fill(String(expected));
    await page.getByLabel(size + ' received', { exact: true }).fill(String(received));
  }
  await form('intake').getByLabel('Placement', { exact: true }).fill('Left chest');
  await form('intake').getByLabel('Design name').fill('Northline wordmark');
  await form('intake').getByLabel('Dimensions (include units)').fill('3.0 x 1.2 in');
  await form('intake').getByLabel('Thread / colors').fill('Forest green');
  await form('intake').getByLabel('Exact embroidered text').fill('NORTHLINE');
  await form('intake').getByLabel('Customer-visible instructions').fill('Center above the seam.');
  await form('intake')
    .getByLabel('Reason for this intake update')
    .fill('One medium missing at receipt.');
  await form('intake').getByRole('button', { name: 'Save intake & instructions' }).click();
  // Intake is remounted on revision changes, so verify persisted UI rather than its old form state.
  await expect(
    page.getByText('1 garment missing. Reconcile the size counts before sending a proof.'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('1 garment missing. Reconcile the size counts before sending a proof.'),
  ).toBeVisible();
  const condition = page
    .locator('form')
    .filter({ has: page.locator('input[name="purpose"][value="condition"]') });
  await condition
    .getByLabel('Photo', { exact: true })
    .setInputFiles('supabase/fixtures/northline-v1.png');
  await condition
    .getByLabel('Condition note')
    .fill('Synthetic condition-photo fixture for workflow verification.');
  await condition.getByRole('button', { name: 'Add condition photo' }).click();
  await expect(
    page.getByText('Synthetic condition-photo fixture for workflow verification.', { exact: true }),
  ).toBeVisible();

  const upload = async (name) => {
    await disclosure('Upload a proof file');
    const uploadForm = page
      .locator('form')
      .filter({ has: page.locator('input[name="purpose"][value="proof"]') });
    await uploadForm.getByLabel('Artwork file').setInputFiles('supabase/fixtures/' + name);
    await uploadForm.getByRole('button', { name: 'Upload proof', exact: true }).click();
    await expect(uploadForm.getByRole('status')).toBeVisible();
    await expect(form('send-proof').getByLabel(name, { exact: true })).toBeAttached();
  };
  await tab('Proofs & approval');
  await upload('northline-v1.png');
  await disclosure('Create a new review request');
  await form('send-proof').getByLabel('northline-v1.png', { exact: true }).check();
  await form('send-proof').getByRole('button', { name: 'Create customer review link' }).click();
  await expect(form('send-proof').getByRole('alert')).toContainText('Reconcile');
  await tab('Garment intake');
  await disclosure('Edit intake & instructions');
  await page.getByLabel('M received', { exact: true }).fill('8');
  await form('intake')
    .getByLabel('Reason for this intake update')
    .fill('Customer delivered the missing medium.');
  await form('intake').getByRole('button', { name: 'Save intake & instructions' }).click();
  await expect(
    page.getByText('1 garment missing. Reconcile the size counts before sending a proof.'),
  ).toHaveCount(0);
  await tab('Proofs & approval');
  const send = async (name) => {
    await disclosure('Create a new review request');
    for (const checkbox of await form('send-proof').locator('input[name="files"]').all())
      await checkbox.uncheck();
    await form('send-proof').getByLabel(name, { exact: true }).check();
    await form('send-proof').locator('input[name="queue_email"]').check();
    const textbox = form('send-proof').getByRole('textbox', { name: 'Customer review link' });
    const previous = (await textbox.count()) ? await textbox.inputValue() : '';
    await form('send-proof').getByRole('button', { name: 'Create customer review link' }).click();
    await expect(textbox).toBeVisible();
    await expect(textbox).not.toHaveValue(previous);
    return textbox.inputValue();
  };
  const first = await send('northline-v1.png');
  const review = await customer.newPage();
  await review.goto(first);
  await expect(review.getByText('Garments · 24 received', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Request changes', exact: true }).click();
  await review.getByLabel('What would you like changed?').fill('Please make the logo smaller.');
  await review.getByRole('button', { name: 'Send change request', exact: true }).click();
  await expect(
    review.getByText('This recorded decision cannot be changed through this link.'),
  ).toBeVisible();
  console.log('Customer requested a change to version 1.');
  await page.reload();
  await tab('Garment intake');
  await disclosure('Edit intake & instructions');
  await form('intake').getByLabel('Dimensions (include units)').fill('2.5 x 1.0 in');
  await form('intake')
    .getByLabel('Reason for this intake update')
    .fill('Smaller logo requested by the customer.');
  await form('intake').getByRole('button', { name: 'Save intake & instructions' }).click();
  await expect(page.getByText('2.5 x 1.0 in', { exact: true }).first()).toBeAttached();
  await tab('Proofs & approval');
  await upload('northline-v2.png');
  const second = await send('northline-v2.png');
  const old = await customer.newPage();
  await old.goto(first);
  await expect(
    old.getByText('This recorded decision cannot be changed through this link.'),
  ).toBeVisible();
  await expect(old.getByRole('button', { name: 'Approve this exact proof' })).toHaveCount(0);
  await review.goto(second);
  await review.getByLabel('Your full name').fill('Alex Morgan');
  await review.locator('input[name="design"]').check();
  await review.locator('input[name="policy"]').check();
  await review.getByRole('button', { name: 'Approve this exact proof' }).click();
  await expect(
    review.getByText('This recorded decision cannot be changed through this link.'),
  ).toBeVisible();
  await page.reload();
  await tab('Production & pickup');
  await form('start-production')
    .getByRole('button', { name: 'Start production', exact: true })
    .click();
  await expect(form('ready')).toBeVisible();
  await form('ready').getByLabel('Completed', { exact: true }).fill('24');
  await form('ready').getByLabel('Exceptions', { exact: true }).fill('0');
  await form('ready').getByRole('button', { name: 'Mark ready for pickup' }).click();
  await expect(form('collect')).toBeVisible();
  await form('pickup-email').getByRole('button', { name: 'Queue pickup notice' }).click();
  await saved('pickup-email');
  await form('collect').getByLabel('Collector’s full name').fill('Alex Morgan');
  await form('collect').locator('input[name="confirm"]').check();
  await form('collect').getByRole('button', { name: 'Record collection' }).click();
  await expect(
    page.getByText(
      'This order has been collected. Its history and approval record remain available.',
    ),
  ).toBeVisible();
  await page.reload();
  await tab('Production & pickup');
  await expect(
    page.getByText(
      'This order has been collected. Its history and approval record remain available.',
    ),
  ).toBeVisible();
  const pdf = await staff.request.get(orderUrl.replace('/app/orders/', '/api/orders/') + '/pdf');
  assert.equal(pdf.status(), 200);
  assert.equal((await pdf.body()).subarray(0, 5).toString(), '%PDF-');
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/connected-completed-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/qa/connected-completed-mobile.png', fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await writeFile(
    '.local/ui-workflow-check.json',
    JSON.stringify(
      {
        status: 'passed',
        checked_at: new Date().toISOString(),
        order_url: orderUrl,
        scenarios:
          'Browser login, create, discrepant intake, upload, failed request, reconciliation, v1 changes, v2 approval, production, pickup, persistence, PDF, desktop/mobile.',
      },
      null,
      2,
    ),
  );
  console.log(
    'The full persisted 24-polo journey passed through browser forms. Report and QA screenshots are saved under .local/.',
  );
} catch (error) {
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/workflow-failure.png', fullPage: true }).catch(() => {});
  await writeFile('.local/ui-workflow-failure.txt', await page.locator('body').innerText()).catch(
    () => {},
  );
  throw error;
} finally {
  await browser.close();
}
