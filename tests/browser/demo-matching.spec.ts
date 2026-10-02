import { test, expect } from '@playwright/test';

for (const width of [375, 1440]) {
  test(`demo shortlist supports capability matching and referral review at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const backendRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/*', route =>
      ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Preview empty workspace' }).click();
    page.on('request', request => {
      if (/\/(auth|rest|functions)\/v1\//.test(new URL(request.url()).pathname)) {
        backendRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    await page.getByRole('button', { name: 'New referral', exact: true }).click();
    await page.getByPlaceholder('e.g. Practice record ID').fill('FICTIONAL-DEMO-ONLY');
    await page.getByPlaceholder('e.g. 2000').fill('2000');
    await page.getByPlaceholder('Describe the need, goals and relevant context…').fill('Fictional mobility assessment. No real patient.');
    await page.getByLabel('Age group requirement').selectOption('adult');
    await page.getByRole('checkbox', { name: 'Persistent pain' }).check();
    await page.getByRole('button', { name: 'Find practitioners' }).click();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review referral' })).toBeDisabled();
    await page.getByRole('button', { name: 'Load demo workspace' }).click();
    const physio = page.getByRole('radio', { name: /Taylor Example/ });
    await expect(physio).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(1);
    await expect(page.getByText('Fictional demo workspace', { exact: true })).toBeVisible();
    await expect(page.getByText(/Approx\. .* km/)).toHaveCount(0);
    await physio.check();
    await page.getByRole('button', { name: 'Review referral' }).click();
    await expect(page.getByText('FICTIONAL-DEMO-ONLY', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Referral details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record referral', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: /I confirm the patient has consented/ }).check();
    await page.getByRole('button', { name: 'Record referral', exact: true }).click();
    await expect(page.getByText('Preview only. This referral was not saved or transmitted.')).toBeVisible();
    expect(backendRequests).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Clear demo data' }).click();
    await expect(page.getByRole('heading', { name: 'No referrals yet' })).toBeVisible();
    await expect(page.getByText('FICTIONAL-DEMO-ONLY', { exact: true })).toHaveCount(0);
  });
}

test('loading samples keeps incompatible requirements and allows an explicit correction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview empty workspace' }).click();
  await page.getByRole('button', { name: 'New referral', exact: true }).click();
  await page.getByPlaceholder('e.g. Practice record ID').fill('FICTIONAL-PSYCH-DEMO');
  await page.getByPlaceholder('e.g. 2000').fill('2000');
  await page.getByRole('combobox', { name: 'Profession', exact: true }).selectOption('psychologist');
  await page.getByPlaceholder('Describe the need, goals and relevant context…').fill('Fictional psychology request. No real patient.');
  await page.getByLabel('Age group requirement').selectOption('adult');
  await page.getByRole('checkbox', { name: 'Persistent pain' }).check();
  await page.getByRole('button', { name: 'Find practitioners' }).click();
  await page.getByRole('button', { name: 'Load demo workspace' }).click();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review referral' })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit referral need' }).click();
  await expect(page.getByRole('checkbox', { name: 'Persistent pain' })).toBeChecked();
  await expect(page.getByLabel('Age group requirement')).toHaveValue('adult');
  await expect(page.getByPlaceholder('e.g. Practice record ID')).toHaveValue('FICTIONAL-PSYCH-DEMO');
  await page.getByRole('checkbox', { name: 'Persistent pain' }).uncheck();
  await page.getByRole('button', { name: 'Find practitioners' }).click();
  await expect(page.getByRole('radio', { name: /Jordan Example/ })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(1);
});
