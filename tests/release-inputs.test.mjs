import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/verify-release-inputs.mjs', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'returnwell-release-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', root]);
  await writeFile(join(root, 'package.json'), '{"private":true}');
  spawnSync('git', ['add', 'package.json'], { cwd: root });
  return root;
}
const run = root => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
test('release manifest hashes the current contents of tracked source', async t => {
  const root = await fixture(t);
  const first = run(root);
  assert.equal(first.status, 0, first.stderr);
  const manifest = JSON.parse(first.stdout);
  assert.match(manifest.files['package.json'], /^[a-f0-9]{64}$/);
  await writeFile(join(root, 'package.json'), '{"private":false}');
  assert.notEqual(JSON.parse(run(root).stdout).files['package.json'], manifest.files['package.json']);
});
test('untracked source cannot silently escape the release manifest', async t => {
  const root=await fixture(t);
  await mkdir(join(root,'app'));
  await writeFile(join(root,'app','unreviewed.ts'),'export const localChange = true;');
  assert.equal(run(root).status,1);
  spawnSync('git',['add','app/unreviewed.ts'],{cwd:root});
  assert.equal(run(root).status,0);
  assert.ok(JSON.parse(run(root).stdout).files['app/unreviewed.ts']);
});
for (const filename of ['.env.local', 'supabase/functions/.env', 'private-data/records.json', 'local-credentials.json']) {
  test(`release input rejects ${filename} without printing contents`, async t => {
    const root = await fixture(t);
    await mkdir(join(root, filename, '..'), { recursive: true });
    await writeFile(join(root, filename), 'PRIVATE_TEST_VALUE_NEVER_PRINT');
    spawnSync('git', ['add', filename], { cwd: root });
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsafe release input/);
    assert.doesNotMatch(result.stderr + result.stdout, /PRIVATE_TEST_VALUE_NEVER_PRINT/);
  });
}
