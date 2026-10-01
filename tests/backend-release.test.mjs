import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBackend, requiresHostedCheck } from '../scripts/check-backend-release.mjs';
import { withReleaseHealth } from '../supabase/functions/_shared/release-health.ts';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backendManifest, verifyManifest, manifestPath } from '../scripts/backend-manifest.mjs';

test('stale generated receipts fail when an endpoint, shared dependency or migration changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rw-release-test-'));
  try {
    for (const dir of ['supabase/functions/workspace-access', 'supabase/functions/_shared', 'supabase/migrations']) await mkdir(join(root, dir), {recursive:true});
    const inputs = ['supabase/config.toml', 'supabase/functions/workspace-access/index.ts', 'supabase/functions/_shared/runtime.ts', 'supabase/migrations/20261001234319_test.sql'];
    for (const path of inputs) await writeFile(join(root,path), 'original');
    const manifest = await backendManifest(root);
    await writeFile(join(root,manifestPath),JSON.stringify(manifest));
    await verifyManifest(root);
    for (const path of inputs) {
      await writeFile(join(root,path), 'changed');
      await assert.rejects(verifyManifest(root), /Stale backend manifest/);
      await writeFile(join(root,path), 'original');
    }
  } finally { await rm(root, {recursive:true,force:true}); }
});

const expected = { protocol: 1, sourceHash: 'a'.repeat(64), migrations: ['20261001222515', '20261001234319'], endpoints: ['workspace-access', 'manage-referral'] };
const env = { SUPABASE_URL: 'https://example.supabase.co', BACKEND_RELEASE_CHECK_SECRET: 'fictional-read-only-secret-at-least-32-characters' };
const response = endpoint => ({ protocol: 1, endpoint, sourceHash: expected.sourceHash, migrations: endpoint === 'workspace-access' ? expected.migrations : null });
test('production cannot skip hosted compatibility checks but ordinary local builds remain offline', () => {
  assert.equal(requiresHostedCheck({ VERCEL_ENV: 'production' }), true);
  assert.equal(requiresHostedCheck({ VERCEL_TARGET_ENV: 'production', VERCEL_ENV: 'preview' }), true);
  assert.equal(requiresHostedCheck({}), false);
});
test('a production release cannot validate one backend while the browser is configured for a different or absent project', async () => {
  let contacted = false;
  const fetcher = async () => { contacted = true; return Response.json(response('workspace-access')); };
  await assert.rejects(checkBackend(expected, {...env, VERCEL_ENV:'production', NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'}, fetcher), /URLs must match/);
  await assert.rejects(checkBackend(expected, {...env, VERCEL_ENV:'production'}, fetcher), /browser Supabase URL/);
  assert.equal(contacted,false);
});
test('guard checks every endpoint and rejects stale code, missing migrations, errors, malformed responses and redirects', async () => {
  const seen = [];
  const good = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.authorization, `Bearer ${env.BACKEND_RELEASE_CHECK_SECRET}`);
    const endpoint = new URL(url).pathname.split('/').at(-1); seen.push(endpoint);
    return Response.json(response(endpoint));
  };
  await checkBackend(expected, env, good);
  assert.deepEqual(seen, ['workspace-access', 'manage-referral']);
  for (const fail of [
    async () => new Response('unavailable', { status: 404 }),
    async () => Response.json({ ...response('workspace-access'), sourceHash: 'b'.repeat(64) }),
    async () => Response.json({ ...response('workspace-access'), migrations: ['20261001234319'] }),
    async () => Response.json({ ...response('workspace-access'), endpoint: 'other' }),
    async () => new Response('<html>sign in</html>'),
    async () => { throw Error('network timeout'); },
  ]) await assert.rejects(checkBackend(expected, env, fail));
  await assert.rejects(checkBackend(expected, { ...env, BACKEND_RELEASE_CHECK_SECRET: '' }, good));
});
test('health requires a read-only deployment credential, cannot dispatch workflows, and fails closed on missing database history', async () => {
  let reads = 0, dispatched = 0;
  const runtime = { env, backendMigrations: async () => { reads++; return expected.migrations; } };
  const next = async () => { dispatched++; return new Response('normal'); };
  const handler = withReleaseHealth('workspace-access', expected, runtime, next);
  const request = (method = 'GET', key = env.BACKEND_RELEASE_CHECK_SECRET) => new Request('https://example.supabase.co/functions/v1/workspace-access?release-health=1', { method, headers: { authorization: `Bearer ${key}` } });
  assert.equal((await handler(request('GET', 'wrong'))).status, 401);
  assert.equal((await handler(request('POST'))).status, 405);
  assert.equal(reads, 0); assert.equal(dispatched, 0);
  assert.deepEqual(await (await handler(request())).json(), response('workspace-access'));
  assert.equal(reads, 1);
  const broken = withReleaseHealth('workspace-access', expected, { ...runtime, backendMigrations: async () => { throw Error('private details'); } }, next);
  const result = await broken(request());
  assert.equal(result.status, 503); assert.ok(!(await result.text()).includes('private details'));
  assert.equal((await handler(new Request('https://example.supabase.co/functions/v1/workspace-access', {method:'POST'}))).status, 200);
  assert.equal(dispatched, 1);
});
