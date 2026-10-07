import { test, expect } from '@playwright/test';
import { doctorBrowser, selectFixturePractitioner } from '../helpers/browser-context.mjs';

async function fillNeed(page) {
  await page.getByRole('button', { name: 'New referral', exact: true }).click();
  await page.getByPlaceholder('e.g. Practice record ID').fill('FICTIONAL-ACCOUNT-ONLY');
  await page.getByPlaceholder('e.g. 2000').fill('2000');
  await page.getByPlaceholder('Describe the need, goals and relevant context…').fill('Fictional matching test. No real patient.');
  await page.getByLabel('Patient initials', { exact: true }).fill('FX');
  await page.getByLabel('Patient phone', { exact: true }).fill('0412345678');
}

for (const width of [375, 1440]) {
  test(`authenticated matching preserves requirements and reaches consent review at ${width}px`, async ({ page }) => {
    test.skip(!process.env.RW_LOCAL_STACK_DIR, 'Requires isolated local Auth.');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    const f = await doctorBrowser(page);
    await page.goto('/');
    await fillNeed(page);
    await page.getByLabel('Age group requirement').selectOption('adult');
    await page.getByRole('checkbox', { name: 'Persistent pain' }).check();
    await page.getByRole('button', { name: 'Find practitioners' }).click();
    await expect(page.getByRole('radio', { name: new RegExp(f.clinic) })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /load demo|preview|explore/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit referral need' }).click();
    await expect(page.getByRole('checkbox', { name: 'Persistent pain' })).toBeChecked();
    await expect(page.getByLabel('Age group requirement')).toHaveValue('adult');
    await page.getByRole('checkbox', { name: 'Persistent pain' }).uncheck();
    await page.getByLabel('Age group requirement').selectOption('');
    await page.getByRole('button', { name: 'Find practitioners' }).click();
    await selectFixturePractitioner(page, f.clinic);
    await page.getByRole('button', { name: 'Review referral' }).click();
    await expect(page.getByText('FICTIONAL-ACCOUNT-ONLY', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Referral details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send referral', exact: true })).toBeDisabled();
    expect(f.local.sql(`select count(*) from public.referrals where created_by='${f.doctor.userId}'`)).toBe('0');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('a signed-in doctor can correct an incompatible profession without losing patient input', async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, 'Requires isolated local Auth.');
  const f = await doctorBrowser(page);
  await page.goto('/');
  await fillNeed(page);
  await page.getByRole('combobox', { name: 'Profession', exact: true }).selectOption('psychologist');
  await page.getByRole('button', { name: 'Find practitioners' }).click();
  await expect(page.getByRole('radio', { name: new RegExp(f.clinic) })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review referral' })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit referral need' }).click();
  await expect(page.getByPlaceholder('e.g. Practice record ID')).toHaveValue('FICTIONAL-ACCOUNT-ONLY');
  await expect(page.getByLabel('Patient initials', { exact: true })).toHaveValue('FX');
  await expect(page.getByLabel('Patient phone', { exact: true })).toHaveValue('0412345678');
  await page.getByRole('combobox', { name: 'Profession', exact: true }).selectOption('physiotherapist');
  await page.getByRole('button', { name: 'Find practitioners' }).click();
  await selectFixturePractitioner(page, f.clinic);
  await expect(page.getByRole('button', { name: 'Review referral' })).toBeEnabled();
});
