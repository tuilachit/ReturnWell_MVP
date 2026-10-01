import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// A hosted URL or inherited live credentials must never reach the test server.
const load = async () => import(pathToFileURL(`${process.cwd()}/tests/helpers/browser-test-config.mjs`).href);
test('browser harness rejects hosted targets and credential-bearing URLs', async () => {
  const { browserSettings } = await load();
  for (const url of ['https://return-well-mvp.vercel.app', 'http://127.0.0.1:3000', 'http://user:pass@127.0.0.1:3101', 'http://127.0.0.1:3101/?token=bad']) {
    assert.throws(() => browserSettings({ RW_BROWSER_URL: url }), /isolated browser/);
  }
});
test('browser harness forces disabled delivery and discards inherited live keys', async () => {
  const { browserSettings } = await load();
  const settings = browserSettings({ PATH: '/bin', RESEND_API_KEY: 'fictional', SUPABASE_SERVICE_ROLE_KEY: 'fictional', NEXT_PUBLIC_SUPABASE_URL: 'https://hosted.example.test', EMAIL_DELIVERY_ENABLED: 'true' });
  assert.equal(settings.baseURL, 'http://127.0.0.1:3101');
  assert.equal(settings.env.EMAIL_DELIVERY_ENABLED, 'false');
  assert.equal(settings.env.NEXT_PUBLIC_EMAIL_DELIVERY_ENABLED, 'false');
  assert.equal(settings.env.RESEND_API_KEY, undefined);
  assert.equal(settings.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(settings.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:55321');
});
