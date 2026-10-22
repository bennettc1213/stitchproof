// Explicit local form-quality check on the real signed-in app, at desktop and phone sizes:
// accessibility, overflow, touch targets, keyboard order, empty states, server errors,
// failed saves (network loss), and maximum-length names. Creates isolated fictional fixtures.
import { createClient } from '@supabase/supabase-js';
import { chromium, devices, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const app = process.env.APP_URL || 'http://127.0.0.1:3000';
const loopback = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !loopback(url) ||
  !loopback(app)
)
  throw new Error('Form checks require local Supabase, a local app, and ALLOW_DEV_SEED=true.');
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
const findings = [];
const passed = [];
const finding = (where, problem) => {
  findings.push({ where, problem });
  console.log('FINDING', where, '-', problem);
};
// Run one step; a thrown error becomes a finding instead of ending the whole sweep.
const step = async (where, fn) => {
  try {
    await fn();
    passed.push(where);
  } catch (error) {
    finding(where, String(error.message || error).split('\n')[0]);
  }
};

// Maximum-length values from the form limits, with long unbroken words.
const long = {
  title: ('Embroidered-left-chest-logo-' + 'X'.repeat(200)).slice(0, 160),
  name: ('Maximiliana-' + 'W'.repeat(200)).slice(0, 160),
  company: ('Northwestern-Regional-Custom-Apparel-' + 'M'.repeat(200)).slice(0, 160),
  email: 'a'.repeat(60) + '-' + run + '@' + 'subdomain-'.repeat(5) + 'example.test',
};

const owner = await (async () => {
  const email = `forms-${run}@example.test`;
  await checked(service.auth.admin.createUser({ email, password, email_confirm: true }));
  const db = client();
  await checked(db.auth.signInWithPassword({ email, password }));
  const workspace = await checked(
    db.rpc('onboard_shop', {
      p_name: ('Forms check shop ' + run + ' ' + 'Q'.repeat(100)).slice(0, 100),
      p_timezone: 'America/Los_Angeles',
      p_policy: 'Fictional test policy: review the proof and garment quantities.',
    }),
  );
  return { email, workspace, db };
})();
const hash = (value) => createHash('sha256').update(value).digest('hex');
// A sent proof on a maximum-length order, for the customer's review page.
const reviewFixture = async () => {
  const id = randomUUID();
  await checked(
    owner.db.rpc('create_order', {
      p_title: long.title,
      p_customer_name: long.name,
      p_email: long.email.replace('@', '-review@'),
      p_company: long.company,
      p_due: null,
      p_key: id,
    }),
  );
  await checked(
    owner.db.rpc('save_intake', {
      p_order: id,
      p_revision: 0,
      p_garments: [
        {
          description: ('Heavyweight-pique-performance-polo-' + 'P'.repeat(200)).slice(0, 160),
          color: 'Navy',
          sizes: [{ size: 'M', expected: 24, received: 24 }],
        },
      ],
      p_spec: {
        placement: 'Left chest',
        design: long.company,
        dimensions: '3 inches',
        thread: 'White',
        text: long.name,
        instructions: 'Center-the-wordmark-' + 'Z'.repeat(300),
      },
      p_reason: 'Fictional forms-check intake.',
    }),
  );
  const bytes = await readFile('supabase/fixtures/northline-v1.png');
  const file = await checked(
    owner.db.rpc('reserve_attachment', {
      p_order: id,
      p_name: 'Proof-' + 'N'.repeat(120) + '.png',
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
  const secret = randomBytes(32).toString('hex');
  await checked(
    owner.db.rpc('send_proof', {
      p_order: id,
      p_revision: 1,
      p_files: [file.id],
      p_digest: hash(secret),
    }),
  );
  return secret;
};

const audit = async (page, where, mobile) => {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  for (const v of axe.violations.filter((v) => ['critical', 'serious'].includes(v.impact)))
    finding(
      where,
      `axe ${v.id}: ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(', ')}`,
    );
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const page = document.scrollingElement.scrollWidth - width;
    const offenders = [...document.querySelectorAll('main *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > width + 1 && getComputedStyle(el).position !== 'fixed';
      })
      .filter((el, _, all) => !all.some((other) => other !== el && other.contains(el)))
      .slice(0, 3)
      .map(
        (el) =>
          el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
      );
    return { page, offenders };
  });
  if (overflow.page > 1)
    finding(where, `horizontal overflow ${overflow.page}px: ${overflow.offenders.join(', ')}`);
  if (mobile) {
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          'main button, main input:not([type=hidden]), main select, main textarea, main [role=tab], main a.button, nav a, header a, header button',
        ),
      ]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return false;
          // Inputs inside a wrapping label are targeted through the whole label.
          const target =
            el.tagName !== 'BUTTON' && el.closest('label')
              ? el.closest('label').getBoundingClientRect()
              : r;
          return target.width < 24 || target.height < 24;
        })
        .slice(0, 4)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const name = (el.getAttribute('aria-label') || el.textContent || el.name || '').trim();
          return `${el.tagName.toLowerCase()}[${name.slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`;
        }),
    );
    if (small.length) finding(where, `touch targets under 24px: ${small.join(', ')}`);
    // iOS zooms the page when focusing a field whose text is smaller than 16px.
    const zoom = await page.evaluate(() =>
      [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
        .filter(
          (el) =>
            el.getBoundingClientRect().width && !['checkbox', 'radio', 'file'].includes(el.type),
        )
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
        .slice(0, 4)
        .map(
          (el) => `${el.name || el.getAttribute('aria-label')} ${getComputedStyle(el).fontSize}`,
        ),
    );
    if (zoom.length)
      finding(where, `fields under 16px text (iOS zooms on focus): ${zoom.join(', ')}`);
  }
};
const values = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('main form input:not([type=hidden]), main form textarea')]
        .filter((el) => el.name && el.type !== 'checkbox')
        .map((el) => [el.name, el.value]),
    ),
  );
// Simulate losing the connection for the next server-action save.
const offlineSave = async (page) => {
  await page.route('**/*', (route) =>
    route.request().method() === 'POST' && route.request().headers()['next-action']
      ? route.abort('internetdisconnected')
      : route.continue(),
  );
};

const browser = await chromium.launch();
const report = { run, viewports: {} };
try {
  for (const [label, options] of [
    ['desktop', { viewport: { width: 1280, height: 800 } }],
    ['mobile', { ...devices['iPhone 13'] }],
  ]) {
    const mobile = label === 'mobile';
    const ctx = await browser.newContext(options);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(app + '/login');
    await audit(page, `${label} login`, mobile);
    await page.getByLabel('Email address').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill('wrong-password-123');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await step(`${label} login error`, async () => {
      await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();
      if ((await page.getByLabel('Email address').inputValue()) !== owner.email)
        throw new Error('Email was cleared after a failed login.');
    });
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL('**/app/orders');

    // Empty states before any data exists (the first viewport sees an empty shop).
    if (!mobile) {
      await step(`${label} empty orders`, () =>
        expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible(),
      );
      await page.goto(app + '/app/customers');
      await step(`${label} empty customers`, () =>
        expect(page.getByRole('heading', { name: 'No customers yet' })).toBeVisible(),
      );
    }
    for (const route of [
      '/app/orders',
      '/app/customers',
      '/app/settings/shop',
      '/app/settings/team',
      '/app/settings/billing',
      '/app/settings/data',
    ]) {
      await page.goto(app + route);
      await audit(page, `${label} ${route}`, mobile);
    }

    // New order: keyboard order, server error, failed save, then long names.
    await page.goto(app + '/app/orders/new');
    await audit(page, `${label} new order`, mobile);
    await step(`${label} new order keyboard order`, async () => {
      await page.getByLabel('Job title').focus();
      const order = [];
      for (let i = 0; i < 12; i++) {
        order.push(
          await page.evaluate(() => {
            const el = document.activeElement;
            return el.labels?.[0]?.textContent?.trim() || el.textContent?.trim() || el.tagName;
          }),
        );
        await page.keyboard.press('Tab');
      }
      // Date inputs take one Tab stop per segment; collapse repeats.
      const stops = order.filter((name, i) => name !== order[i - 1]);
      const expected = [
        'Job title',
        'Customer name',
        'Company (optional)',
        'Customer email',
        'Due date',
        'Create order',
      ];
      for (const [i, name] of expected.entries())
        if (!stops[i]?.startsWith(name)) throw new Error('Tab order was ' + stops.join(' → '));
    });
    const fill = async (email) => {
      await page.getByLabel('Job title').fill(long.title);
      await page.getByLabel('Customer name').fill(long.name);
      await page.getByLabel('Company (optional)').fill(long.company);
      await page.getByLabel('Customer email').fill(email);
    };
    await fill('owner@localhost');
    await page.getByRole('button', { name: /Create order/ }).click();
    await step(`${label} new order server error`, async () => {
      await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible({
        timeout: 10000,
      });
      const kept = await values(page);
      if (kept.title !== long.title || kept.customer_name !== long.name)
        throw new Error('Inputs were not kept after a rejected save.');
    });
    await page.getByLabel('Customer email').fill(long.email);
    await offlineSave(page);
    await page.getByRole('button', { name: /Create order/ }).click();
    await step(`${label} new order failed save (offline)`, async () => {
      await expect(
        page.getByRole('alert').filter({ hasText: 'Could not reach StitchProof' }),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByLabel('Job title')).toHaveValue(long.title);
      await expect(page.getByLabel('Customer email')).toHaveValue(long.email);
    });
    await page.unrouteAll();
    if (!(await page.getByLabel('Job title').count())) {
      await page.goto(app + '/app/orders/new');
      await fill(long.email);
    }
    await page.getByLabel('Customer email').press('Enter');
    await page.waitForURL(/\/app\/orders\/[0-9a-f-]{36}/, { timeout: 20000 });
    const orderUrl = page.url().split('?')[0];
    await audit(page, `${label} order detail (long names)`, mobile);
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      await audit(page, `${label} order tab ${(await tab.textContent()).trim()}`, mobile);
    }
    await page.goto(app + '/app/orders');
    await audit(page, `${label} orders list (long names)`, mobile);
    await page.goto(app + '/app/customers');
    await audit(page, `${label} customers list (long names)`, mobile);
    await page
      .getByRole('link', { name: new RegExp(long.name.slice(0, 20)) })
      .first()
      .click();
    await page.waitForURL(/\/app\/customers\/[0-9a-f-]{36}/);
    await audit(page, `${label} customer detail (long names)`, mobile);

    // Customer edit: failed save keeps the edit; retry saves it.
    await step(`${label} customer edit failed save (offline)`, async () => {
      const phone = page.getByLabel(/Phone/);
      await phone.fill('555-0100');
      await offlineSave(page);
      await page.getByRole('button', { name: /Save/ }).first().click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Could not reach StitchProof' }),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByLabel(/Phone/)).toHaveValue('555-0100');
    });
    await page.unrouteAll();

    // Team invite with an invalid address shows an error and keeps the input.
    await page.goto(app + '/app/settings/team');
    await step(`${label} invite error`, async () => {
      const email = page.getByLabel(/email/i).first();
      await email.fill('teammate@localhost');
      await page.getByRole('button', { name: /Invite|Create invitation/i }).click();
      await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible({
        timeout: 10000,
      });
      await expect(email).toHaveValue('teammate@localhost');
    });
    // The customer's review page, opened from the emailed link on the customer's own device.
    const customer = await browser.newContext(options);
    const review = await customer.newPage();
    review.on('pageerror', (error) => errors.push(error.message));
    await review.goto(app + '/review/' + (await reviewFixture()));
    await audit(review, `${label} customer review (long names)`, mobile);
    await step(`${label} customer review failed save (offline)`, async () => {
      await review.getByLabel('Your full name').fill('Synthetic Reviewer');
      await review.locator('input[name="design"]').check();
      await review.locator('input[name="policy"]').check();
      await offlineSave(review);
      await review.getByRole('button', { name: 'Approve this exact proof' }).click();
      await expect(
        review.getByRole('alert').filter({ hasText: 'Could not reach StitchProof' }),
      ).toBeVisible({ timeout: 10000 });
      await expect(review.getByLabel('Your full name')).toHaveValue('Synthetic Reviewer');
      await expect(review.locator('input[name="design"]')).toBeChecked();
      await expect(review.locator('input[name="policy"]')).toBeChecked();
    });
    await review.unrouteAll();
    await step(`${label} customer review approve after reconnect`, async () => {
      await review.getByRole('button', { name: 'Approve this exact proof' }).click();
      await expect(
        review.getByText('This recorded decision cannot be changed through this link.'),
      ).toBeVisible({ timeout: 20000 });
    });
    await audit(review, `${label} customer review receipt`, mobile);
    await customer.close();
    if (errors.length) finding(`${label} page errors`, errors.slice(0, 3).join(' | '));
    report.viewports[label] = { order: orderUrl };
    await ctx.close();
  }
} finally {
  await browser.close();
}
report.passed = passed;
report.findings = findings;
await mkdir('.local', { recursive: true });
await writeFile('.local/forms-check.json', JSON.stringify(report, null, 2));
console.log(
  `${passed.length} steps passed, ${findings.length} findings. Report: .local/forms-check.json`,
);
if (findings.length) process.exitCode = 1;
