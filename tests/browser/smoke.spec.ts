import { test, expect } from '@playwright/test';

for (const width of [375, 1440]) {
  test(`signed-out entry and empty preview work at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to ReturnWell' })).toBeVisible();
    await expect(page.getByLabel('Work email')).toBeVisible();
    await page.getByRole('button', { name: 'Preview empty workspace' }).click();
    expect(errors).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Referrals', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    await expect(page.getByText('BROWSER-FICTIONAL-PATIENT')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
