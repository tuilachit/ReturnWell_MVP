import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { geographyImportSql } from './import-geography.mjs';

export function parseGeoNamesNsw(text) {
  const rows = [];
  const seen = new Set();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line) continue;
    const columns = line.split('\t');
    if (columns.length !== 12 || columns[0] !== 'AU') throw Error(`Invalid AU row ${index + 1}`);
    if (columns[4] !== 'NSW') continue;
    const [, postcode, place] = columns;
    const suburb = place.trim().replace(/\s+/g, ' ');
    const key = `${postcode}:${suburb.toLowerCase()}`;
    if (!/^\d{4}$/.test(postcode) || !suburb || suburb.length > 160 || [...place].some(char => char.charCodeAt(0) < 32) || seen.has(key)) throw Error(`Invalid or duplicate NSW locality at row ${index + 1}`);
    seen.add(key);
    // Only documented geoname-linked points (4) or centroids (6). Estimated,
    // unspecified and undocumented accuracy levels remain explicitly unknown.
    const supported = ['4', '6'].includes(columns[11]);
    let latitude = null, longitude = null;
    if (supported) {
      latitude = Number(columns[9]); longitude = Number(columns[10]);
      if (!columns[9].trim() || !columns[10].trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -45 || latitude > -9 || longitude < 110 || longitude > 155) throw Error(`Invalid NSW coordinates at row ${index + 1}`);
    }
    rows.push({ postcode, suburb, state: 'NSW', latitude, longitude });
  }
  if (!rows.length || rows.length > 50000) throw Error('Expected 1–50000 NSW localities');
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [archive, publishedAt, output] = process.argv.slice(2);
    if (!archive || !output || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) || new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt) throw Error('Usage: node scripts/prepare-geonames.mjs AU.zip YYYY-MM-DD output.json');
    const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
    const text = execFileSync('unzip', ['-p', archive, 'AU.txt'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    const document = {
      source: {
        version: `geonames-nsw-${publishedAt}-${sha256.slice(0, 12)}-accuracy46`,
        url: 'https://download.geonames.org/export/zip/AU.zip',
        license: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
        attribution: 'GeoNames (https://www.geonames.org). NSW postal localities; accuracy 4/6 coordinates only. Approximate reference points, not driving distances or exact addresses.',
        sha256, publishedAt,
      },
      localities: parseGeoNamesNsw(text),
    };
    geographyImportSql(document); // Validate full document before creating output.
    await writeFile(output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ source: document.source, localities: document.localities.length, withCoordinates: document.localities.filter(x => x.latitude !== null).length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
