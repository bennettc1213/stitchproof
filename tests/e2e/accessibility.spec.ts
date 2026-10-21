import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('core demo screens have no serious accessibility violations', async ({ page }) => {
  for (const route of ['/', '/demo', '/demo/orders/northline', '/demo/review', '/signup']) {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    const report = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      report.violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
      route,
    ).toEqual([]);
  }
});
