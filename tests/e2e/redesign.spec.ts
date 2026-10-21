import { expect, test } from '@playwright/test';

test('portal preview supports screen selection and playback', async ({ page }, info) => {
  await page.goto('/');
  const preview = page.getByRole('region', { name: 'Interactive StitchProof portal preview' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Preview Approval', exact: true }).click();
  await expect(preview.getByRole('heading', { name: 'Artwork approval' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Play portal preview' })).toBeVisible();
  await preview.getByRole('button', { name: 'Preview Pickup', exact: true }).click();
  await expect(preview.getByRole('heading', { name: '24 polos. All set.' })).toBeVisible();
  await preview.getByRole('button', { name: 'Preview Orders', exact: true }).click();
  await expect(preview.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Play portal preview' }).click();
  await expect(preview.locator('.portal-screen')).toHaveAttribute('data-screen', '1', {
    timeout: 8000,
  });
  await preview.getByRole('button', { name: 'Pause portal preview' }).click();
  await preview.getByRole('button', { name: 'Preview Orders', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `.local/qa/makeover-home-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= (visualViewport?.width || innerWidth) + 1,
    ),
  ).toBeTruthy();
  await preview.getByRole('link', { name: 'Open the full demo' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('order sections are separated into accessible keyboard-operated tabs', async ({
  page,
}, info) => {
  await page.goto('/demo/orders/northline');
  await expect(page.getByRole('heading', { name: 'Garment intake', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decoration instructions' })).toBeHidden();
  await page.getByRole('tab', { name: 'Instructions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decoration instructions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Garment intake', exact: true })).toBeHidden();
  await page.getByRole('tab', { name: 'Instructions', exact: true }).press('ArrowRight');
  await expect(page.getByRole('heading', { name: 'Proofs & approval', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Garment intake', exact: true }).click();
  await page.screenshot({
    path: `.local/qa/makeover-order-${info.project.name}.png`,
    fullPage: true,
  });
});

test('reduced motion stops automatic portal playback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play portal preview' })).toBeDisabled();
  await page.getByRole('button', { name: 'Preview Intake', exact: true }).click();
  await expect(page.locator('.preview-page-title h3')).toHaveText('Northline team polos');
});
