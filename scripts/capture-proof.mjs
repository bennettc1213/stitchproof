import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('supabase/fixtures', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  for (const [version, url] of [
    [1, '/demo/orders/fieldwork'],
    [2, '/demo/review'],
  ]) {
    await page.goto('http://127.0.0.1:3000' + url);
    await page.locator('.proof-art').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page
      .locator('.proof-art')
      .screenshot({ path: `supabase/fixtures/northline-v${version}.png` });
  }
} finally {
  await browser.close();
}
console.log('Captured fictional, code-rendered proof fixtures.');
