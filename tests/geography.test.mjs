import assert from 'node:assert/strict';
import test from 'node:test';
import { straightLineKm, nearestPracticeLocation } from '../app/lib/geography.ts';
import { geographyImportSql } from '../scripts/import-geography.mjs';

test('distance retains genuine zero, rejects malformed points and measures a known equatorial degree', () => {
  assert.equal(straightLineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
  assert.ok(Math.abs(straightLineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111.19508) < 0.00001);
  for (const point of [null, { latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: Infinity }]) {
    assert.equal(straightLineKm(point, { latitude: 0, longitude: 0 }), null);
  }
});
test('nearest location checks secondary practices, skips unknown points and breaks ties by ID', () => {
  const loc = (id, longitude) => ({ id, point: longitude === null ? null : { latitude: 0, longitude }, precision: 'suburb_reference' });
  assert.deepEqual(nearestPracticeLocation({ latitude: 0, longitude: 0 }, [loc('primary', 10), loc('z', 0), loc('a', 0), loc('unknown', null)]), { locationId: 'a', distanceKm: 0, precision: 'suburb_reference' });
  assert.equal(nearestPracticeLocation(null, [loc('a', 0)]), null);
  assert.equal(nearestPracticeLocation({ latitude: 0, longitude: 0 }, [loc('a', null)]), null);
});
const fixture = () => ({
  source: { version: 'fictional-v1', url: 'https://example.org/fictional', license: 'Test fixture only', attribution: 'Fictional test data', sha256: 'a'.repeat(64), publishedAt: '2026-10-01' },
  localities: [{ postcode: '2000', state: 'NSW', suburb: 'Test Central', latitude: -33.86, longitude: 151.2 }, { postcode: '2000', state: 'NSW', suburb: 'Unknown Test', latitude: null, longitude: null }],
});
test('offline importer validates the entire edition before producing an atomic activation transaction', () => {
  const sql = geographyImportSql(fixture());
  assert.ok(sql.startsWith('begin;'));
  assert.ok(sql.trimEnd().endsWith('commit;'));
  assert.ok(sql.includes('fictional-v1'));
  for (const mutate of [
    d => d.localities.push({ ...d.localities[0], suburb: ' test central ' }),
    d => d.localities[0].latitude = 999,
    d => d.localities[0].longitude = null,
    d => d.localities[0].postcode = '200',
    d => d.source.sha256 = '',
    d => d.source.url = 'javascript:alert(1)',
    d => d.localities = [],
  ]) { const d = fixture(); mutate(d); assert.throws(() => geographyImportSql(d)); }
});
