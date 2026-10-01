import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Offline compiler only. Import/activation requires a separate operator action.
// The original source file's SHA256 and its licence must be recorded by the operator.
export function geographyImportSql(document) {
  const { source, localities } = document ?? {};
  for (const field of ['version', 'url', 'license', 'attribution', 'sha256', 'publishedAt']) {
    if (typeof source?.[field] !== 'string' || !source[field].trim() || source[field].length > 1000 || source[field].includes('\0')) throw new Error(`Invalid source ${field}`);
  }
  if (!/^https:\/\//.test(source.url) || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !/^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt) || !Number.isFinite(Date.parse(source.publishedAt))) throw new Error('Invalid source metadata');
  if (!Array.isArray(localities) || localities.length === 0 || localities.length > 50000) throw new Error('Expected 1–50000 localities');
  const keys = new Set();
  const rows = localities.map(row => {
    if (typeof row.suburb !== 'string' || !row.suburb.trim() || row.suburb.length > 160 || /[\x00-\x1f]/.test(row.suburb)
      || !/^\d{4}$/.test(row.postcode) || row.state !== 'NSW') throw new Error('Invalid NSW locality');
    const suburb = row.suburb.trim().replace(/\s+/g, ' ');
    const id = `NSW:${row.postcode}:${suburb.toLowerCase()}`;
    if (keys.has(id)) throw new Error(`Duplicate locality: ${id}`);
    keys.add(id);
    const unknown = row.latitude === null && row.longitude === null;
    // Australia bounds: reject swapped lat/lon and 0,0 source placeholders.
    if (!unknown && !(typeof row.latitude === 'number' && Number.isFinite(row.latitude) && row.latitude >= -45 && row.latitude <= -9
      && typeof row.longitude === 'number' && Number.isFinite(row.longitude) && row.longitude >= 110 && row.longitude <= 155)) throw new Error(`Invalid coordinates: ${id}`);
    return { id, postcode: row.postcode, state: row.state, suburb, latitude: row.latitude, longitude: row.longitude };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const metadata = Object.fromEntries(['version', 'url', 'license', 'attribution', 'sha256', 'publishedAt'].map(key => [key, source[key]]));
  metadata.contentSha256 = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `begin;\nselect private.install_geography(${literal(metadata)}, ${literal(rows)});\ncommit;\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/import-geography.mjs approved-reference.json > import.sql (does not execute SQL)');
    const sql = geographyImportSql(JSON.parse(await readFile(process.argv[2], 'utf8')));
    process.stdout.write(sql);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
