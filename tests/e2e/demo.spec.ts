import { expect, test } from '@playwright/test';
test('customer demo search preserves the query and remains read-only', async ({ page }) => {
  await page.goto('/demo/customers');
  await page.getByRole('textbox', { name: 'Search customers', exact: true }).fill('Northline');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.customer-card')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Search customers', exact: true })).toHaveValue(
    'Northline',
  );
  await page.locator('.customer-card .row-arrow').click();
  await expect(page.getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save customer', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'All customers', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search customers', exact: true })
    .fill('no such customer');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No matching customers', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('.customer-card')).toHaveCount(7);
});
test('invitation entry preserves the private destination and rejects malformed tokens', async ({
  page,
}) => {
  const path = '/invite/' + 'a'.repeat(64);
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  const configured =
    (await (await page.request.get('/api/health')).json()).database !== 'not-configured';
  if (configured) await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  else await expect(page.getByText('Workspace setup is needed.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start your shop' })).toHaveAttribute(
    'href',
    '/signup?next=' + encodeURIComponent(path),
  );
  await page.getByRole('link', { name: 'Start your shop' }).click();
  await expect(page.getByRole('link', { name: 'Log in', exact: true })).toHaveAttribute(
    'href',
    '/login?next=' + encodeURIComponent(path),
  );
  await page.goto('/invite/invalid');
  await expect(page.getByRole('heading', { name: /That page/ })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
});
test('orders search, filtering, detail, and walkthrough work in the read-only tour', async ({
  page,
}, info) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search orders' }).fill('Northline');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: '#1048 Northline team polos' }).click();
  await expect(page.getByRole('heading', { name: 'Northline team polos' })).toBeVisible();
  await expect(page.getByText('1 garment missing.')).toBeVisible();
  await page.goto('/demo');
  await page.getByRole('tab', { name: 'Ready for pickup', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Studio Eight');
  await page.goto('/demo/story');
  await expect(
    page.getByRole('heading', { name: 'Start with what actually arrived.' }),
  ).toBeVisible();
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByRole('heading', { name: 'Count it out. Close the loop.' })).toBeVisible();
  await page.getByRole('link', { name: 'Explore customer view' }).click();
  await expect(page.getByRole('heading', { name: 'Let’s get the details right.' })).toBeVisible();
  await expect(page.getByText('staff-only')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve this exact proof' })).toHaveCount(0);
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `.local/qa/orders-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        (window.visualViewport?.width || window.innerWidth) + 1,
    ),
  ).toBeTruthy();
});
test('marketing, setup message, and inactive reviews are honest and usable', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      name: 'Every garment. The right proof. One clear order.',
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `.local/qa/home-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Explore the demo' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.goto('/signup');
  const configuration = await (await page.request.get('/api/health')).json();
  if (configuration.database === 'not-configured')
    await expect(page.getByText('Workspace setup is needed.')).toBeVisible();
  else await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await page.goto('/review/invalid');
  await expect(page.getByRole('heading', { name: 'This review link is inactive.' })).toBeVisible();
  const response = await page.request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).database).toBe(configuration.database);
});
