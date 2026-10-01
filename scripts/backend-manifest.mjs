import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const manifestPath = 'supabase/functions/_shared/backend-manifest.json';
export async function backendManifest(root = process.cwd()) {
  const hash = createHash('sha256');
  const entries = await readdir(resolve(root, 'supabase/functions'), { withFileTypes: true });
  const endpoints = entries.filter(x => x.isDirectory() && !x.name.startsWith('_') && !x.name.startsWith('.')).map(x => x.name).sort();
  async function addTree(dir) {
    for (const file of (await readdir(resolve(root, dir), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = `${dir}/${file.name}`;
      if (file.name.startsWith('.') || path === manifestPath) continue;
      if (file.isDirectory()) await addTree(path);
      else { hash.update(path + '\0'); hash.update(await readFile(resolve(root, path))); hash.update('\0'); }
    }
  }
  await addTree('supabase/functions');
  await addTree('supabase/migrations');
  hash.update(await readFile(resolve(root, 'supabase/config.toml')));
  const migrations = (await readdir(resolve(root, 'supabase/migrations'))).filter(x => /^\d+_.+\.sql$/.test(x)).map(x => x.split('_')[0]).sort();
  if (!endpoints.includes('workspace-access') || !migrations.length) throw Error('Backend release inputs missing');
  return { protocol: 1, sourceHash: hash.digest('hex'), endpoints, migrations };
}
export async function verifyManifest(root = process.cwd()) {
  const expected = await backendManifest(root);
  const stored = JSON.parse(await readFile(resolve(root, manifestPath), 'utf8'));
  if (JSON.stringify(stored) !== JSON.stringify(expected)) throw Error('Stale backend manifest: run npm run backend:prepare, then deploy the backend before the frontend');
  return expected;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--write')) {
    const manifest = await backendManifest();
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Prepared ${manifest.endpoints.length} functions / ${manifest.migrations.length} migrations: ${manifest.sourceHash}`);
  } else { await verifyManifest(); console.log('Backend manifest matches source'); }
}
