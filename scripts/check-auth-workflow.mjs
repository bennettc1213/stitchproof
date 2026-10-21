import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const app = process.env.APP_URL || 'http://127.0.0.1:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const local = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  !url ||
  !local(url) ||
  !local(app)
)
  throw new Error('Auth checks require explicitly enabled local services.');
const mail = 'http://localhost:54324';
const nonce = randomBytes(6).toString('hex');
const ownerEmail = `signup-owner-${nonce}@example.test`,
  staffEmail = `signup-staff-${nonce}@example.test`;
const password = randomBytes(24).toString('base64url'),
  replacement = randomBytes(24).toString('base64url');
const browser = await chromium.launch();
const owner = await browser.newContext(),
  staff = await browser.newContext();
const page = await owner.newPage(),
  invitee = await staff.newPage();
const db = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const verification = async (email, subject) => {
  let id;
  await expect
    .poll(
      async () => {
        const list = await (await fetch(mail + '/api/v1/messages')).json();
        const message = list.messages.find(
          (m) =>
            m.To?.some((r) => r.Address === email) &&
            (!subject || m.Subject.toLowerCase().includes(subject)),
        );
        id = message?.ID;
        return Boolean(id);
      },
      { timeout: 20000, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  const message = await (await fetch(mail + '/api/v1/message/' + id)).json();
  const links = [...message.HTML.matchAll(/href=["']([^"']+)["']/g)].map((m) =>
    m[1].replaceAll('&amp;', '&'),
  );
  const link = links.find((value) => value.startsWith(url + '/auth/v1/verify'));
  if (!link) throw new Error('Auth verification link was not found in the local mail catcher.');
  return link;
};
const signup = async (target, email) => {
  await expect(
    target.getByRole('heading', { name: 'A little more clarity starts here.' }),
  ).toBeVisible();
  await target.getByLabel('Email address', { exact: true }).fill(email);
  await target.getByLabel('Password', { exact: true }).fill(password);
  await target.getByRole('button', { name: 'Create your account', exact: true }).click();
  try {
    await expect(target.locator('form .notice')).toBeVisible({ timeout: 15000 });
  } catch (error) {
    await writeFile(
      '.local/auth-signup-diagnostic.json',
      JSON.stringify(
        {
          stage: email.startsWith('signup-staff') ? 'staff' : 'owner',
          text: await target.locator('body').innerText(),
          fields: await target.locator('input').evaluateAll((inputs) =>
            inputs.map((input) => ({
              name: input.name,
              type: input.type,
              valid: input.validity.valid,
              message: input.validationMessage,
              length: input.value.length,
            })),
          ),
        },
        null,
        2,
      ),
    );
    throw error;
  }
  const failure = target.locator('form .notice.error');
  if (await failure.count()) throw new Error('Signup failed: ' + (await failure.innerText()));
  await expect(target.getByRole('status')).toContainText('Check your inbox');
  await target.goto(await verification(email, 'confirm'));
};
try {
  await page.goto(app + '/signup');
  await signup(page, ownerEmail);
  await page.waitForURL('**/onboarding');
  await page.getByLabel('Shop name', { exact: true }).fill('Verified local signup shop');
  await page
    .getByLabel('Your existing customer-supplied garment policy')
    .fill('Fictional local verification policy.');
  await page.getByRole('button', { name: 'Create my shop' }).click();
  await page.waitForURL('**/app/orders');
  await page.goto(app + '/onboarding');
  await page.waitForURL('**/app/orders');
  await checked(db.auth.signInWithPassword({ email: ownerEmail, password }));
  const memberships = await checked(db.from('memberships').select('workspace_id,role'));
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].role, 'owner');
  assert.deepEqual(await checked(db.from('orders').select('id')), []);
  console.log('Signup, local verification email, empty-shop onboarding, and retry passed.');

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/login');
  await page.goto(app + '/app/orders');
  await page.waitForURL('**/login');
  await page.getByLabel('Email address', { exact: true }).fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill('Incorrect-local-test-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('Invalid login credentials');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(ownerEmail);
  await page.goto(app + '/forgot-password');
  await page.getByLabel('Email address', { exact: true }).fill(ownerEmail);
  await page.getByRole('button', { name: 'Request reset link', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('recovery link');
  await page.goto(await verification(ownerEmail, 'reset'));
  await page.waitForURL('**/reset-password');
  await page.getByLabel('Password', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await page.waitForURL('**/app/orders');
  assert.ok((await db.auth.signInWithPassword({ email: ownerEmail, password })).error);
  await checked(db.auth.signInWithPassword({ email: ownerEmail, password: replacement }));
  console.log('Logout protection and real local password recovery passed.');

  await page.goto(app + '/app/orders/new');
  await page.getByLabel('Job title', { exact: true }).fill('Invitation visibility check');
  await page.getByLabel('Customer name', { exact: true }).fill('Synthetic customer');
  await page.getByLabel('Customer email', { exact: true }).fill('visibility@example.test');
  await page.getByRole('button', { name: 'Create order & add garments' }).click();
  await page.waitForURL(/\/app\/orders\/[a-f0-9-]{36}$/);
  const orderUrl = page.url();
  const condition = page
    .locator('form')
    .filter({ has: page.locator('input[name="purpose"][value="condition"]') });
  await condition
    .getByLabel('Photo', { exact: true })
    .setInputFiles('supabase/fixtures/northline-v1.png');
  await condition.getByRole('button', { name: 'Add condition photo' }).click();
  const file = page.locator('.condition-file a').first();
  await expect(file).toBeVisible();
  const filePath = await file.getAttribute('href');
  await page.goto(app + '/app/settings/team');
  const invitation = page
    .locator('form')
    .filter({ has: page.locator('input[name="intent"][value="invite-staff"]') });
  await invitation.getByLabel('Staff email address', { exact: true }).fill(staffEmail);
  await invitation.locator('input[name="queue_email"]').check();
  await invitation.getByRole('button', { name: 'Create invitation link' }).click();
  const link = invitation.getByRole('textbox', { name: 'Staff invitation link' });
  await expect(link).toBeVisible();
  await invitee.goto(await link.inputValue());
  await invitee.getByRole('link', { name: 'Start your shop', exact: true }).click();
  await signup(invitee, staffEmail);
  await expect(invitee.getByRole('heading', { name: 'Join your shop team.' })).toBeVisible();
  await invitee.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await invitee.waitForURL('**/app/orders');
  await invitee.goto(orderUrl);
  await expect(invitee.getByRole('heading', { name: 'Invitation visibility check' })).toBeVisible();
  assert.equal((await staff.request.get(app + filePath)).status(), 200);
  await invitee.goto(app + '/app/settings/team');
  await expect(invitee.getByText('Only the shop owner can invite or remove staff.')).toBeVisible();
  await page.reload();
  const remove = page
    .locator('form')
    .filter({ has: page.locator('input[name="intent"][value="remove-staff"]') });
  await remove.locator('input[name="confirm"]').check();
  await remove.getByRole('button', { name: 'Remove staff access' }).click();
  await expect(
    page
      .locator('form')
      .filter({ has: page.locator('input[name="intent"][value="remove-staff"]') }),
  ).toHaveCount(0);
  assert.equal((await staff.request.get(app + filePath)).status(), 404);
  await invitee.goto(orderUrl);
  await invitee.waitForURL('**/onboarding');
  console.log(
    'Invitation signup/verification preserves its destination; acceptance, owner-only controls, and removed-staff file denial passed.',
  );
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/auth-check-credentials.json',
    JSON.stringify(
      { email: ownerEmail, password: replacement, notice: 'Fictional local test account only.' },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    '.local/auth-check.json',
    JSON.stringify(
      {
        status: 'passed',
        checked_at: new Date().toISOString(),
        scenarios:
          'Signup/local-mail verification, idempotent empty onboarding, logout protection, password recovery, invite signup/verification/acceptance, staff role and immediate removal.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  // Auth URLs contain one-time secrets; retain diagnostic details locally, never print them.
  await mkdir('.local', { recursive: true });
  await writeFile('.local/auth-check-failure.txt', String(error));
  throw new Error(
    'Local auth browser check failed. Diagnostic details are in ignored .local/auth-check-failure.txt.',
  );
} finally {
  await browser.close();
}
