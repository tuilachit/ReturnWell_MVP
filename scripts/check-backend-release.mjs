import { pathToFileURL } from 'node:url';
import { verifyManifest } from './backend-manifest.mjs';

export const requiresHostedCheck = env => env.VERCEL_ENV === 'production' || env.VERCEL_TARGET_ENV === 'production';
export async function checkBackend(expected, env, fetcher = fetch) {
  if (requiresHostedCheck(env) && !env.NEXT_PUBLIC_SUPABASE_URL) throw Error('Production requires the browser Supabase URL');
  const base = new URL(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '');
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !base.hostname.endsWith('.supabase.co')) throw Error('Hosted Supabase URL required');
  if (env.NEXT_PUBLIC_SUPABASE_URL && new URL(env.NEXT_PUBLIC_SUPABASE_URL).href !== base.href) throw Error('Server and browser Supabase URLs must match');
  if (!env.BACKEND_RELEASE_CHECK_SECRET || env.BACKEND_RELEASE_CHECK_SECRET.length < 32) throw Error('BACKEND_RELEASE_CHECK_SECRET is required for the backend release check');
  for (const endpoint of expected.endpoints) {
    try {
      const result = await fetcher(new URL(`/functions/v1/${endpoint}?release-health=1`, base), {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { authorization: `Bearer ${env.BACKEND_RELEASE_CHECK_SECRET}` },
      });
      if (!result.ok) throw Error('health unavailable');
      const actual = await result.json();
      if (actual.protocol !== expected.protocol || actual.endpoint !== endpoint || actual.sourceHash !== expected.sourceHash) throw Error('function mismatch');
      if (endpoint === 'workspace-access' && (!Array.isArray(actual.migrations) || expected.migrations.some(version => !actual.migrations.includes(version)))) throw Error('migration missing');
    } catch {
      // Do not log raw responses, authorization headers or provider error details.
      throw Error(`Backend release blocked at ${endpoint}: unavailable, outdated, or missing required migrations. Deploy and verify the backend first.`);
    }
  }
  return { functions: expected.endpoints.length, migrations: expected.migrations.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const expected = await verifyManifest();
    if (process.argv.includes('--build') && !requiresHostedCheck(process.env)) console.log('Backend source verified; hosted check required on production builds (offline build only).');
    else console.log('Hosted backend compatible:', await checkBackend(expected, process.env));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
