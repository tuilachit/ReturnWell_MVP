import { test, expect } from '@playwright/test';
import { doctorBrowser } from '../helpers/browser-context.mjs';

test('signed-out users cannot enter a dashboard through previews or direct customer routes', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/(auth|rest|functions)\/v1\//.test(new URL(request.url()).pathname)) writes.push(request.url());
  });
  for (const path of ['/', '/account/setup', '/practitioner', '/onboarding', '/invitations', '/referrals/3bbc9fd4-2da2-4a72-80e4-b920ad033692', '/?preview=1', '/?demo=1']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Welcome to ReturnWell' })).toBeVisible();
    await expect(page.getByLabel('Work email', { exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: /preview|explore|demo/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New referral', exact: true })).toHaveCount(0);
  }
  expect(writes).toEqual([]);
});

test('a signed-in doctor opens their own empty dashboard and sign-out removes access after refresh', async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, 'Requires isolated local Auth.');
  const f = await doctorBrowser(page, { seedSession: false });
  const { data: { session } } = await f.doctor.client.auth.getSession();
  await page.context().addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('login-only-fixture-seeded')) {
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem('login-only-fixture-seeded', 'true');
    }
  }, { key: f.doctor.client.auth.storageKey, value: session });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Referrals', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No referrals yet' })).toBeVisible();
  await expect(page.getByText('Fictional Draft Practice', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /demo|preview|explore/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ReturnWell administration', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to ReturnWell' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome to ReturnWell' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New referral', exact: true })).toHaveCount(0);
});
