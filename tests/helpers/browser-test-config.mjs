export function browserSettings(source = process.env) {
  const baseURL = source.RW_BROWSER_URL ?? 'http://127.0.0.1:3101';
  if (baseURL !== 'http://127.0.0.1:3101') throw new Error('Only the isolated browser origin on port 3101 is allowed.');
  const env = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'CI', 'PLAYWRIGHT_BROWSERS_PATH', 'RW_LOCAL_STACK_DIR']) {
    if (source[name]) env[name] = source[name];
  }
  return { baseURL, env: {
    ...env,
    EMAIL_DELIVERY_ENABLED: 'false',
    NEXT_PUBLIC_EMAIL_DELIVERY_ENABLED: 'false',
    NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-browser-test-not-a-secret',
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_LOG_PATH: '.wrangler/browser-test.log',
    MINIFLARE_REGISTRY_PATH: '.wrangler/registry',
  } };
}
