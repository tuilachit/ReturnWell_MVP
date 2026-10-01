import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeoNamesNsw } from '../scripts/prepare-geonames.mjs';

const line = (postcode = '2000', suburb = 'Sydney', accuracy = '4', state = 'NSW', lat = '-33.8678', lon = '151.2073') =>
  ['AU', postcode, suburb, state === 'NSW' ? 'New South Wales' : 'Victoria', state, '', '', '', '', lat, lon, accuracy].join('\t');
test('NSW import preserves shared postcodes, excludes other states and retains only supported coordinate accuracy', () => {
  const result = parseGeoNamesNsw([line(), line('2000', 'Haymarket'), line('2000', 'Estimated', '1'), line('2000', 'Unspecified', '3'), line('3000', 'Melbourne', '4', 'VIC')].join('\n'));
  assert.equal(result.length, 4);
  assert.equal(result.find(x => x.suburb === 'Sydney').latitude, -33.8678);
  assert.equal(result.find(x => x.suburb === 'Estimated').latitude, null);
  assert.equal(result.find(x => x.suburb === 'Unspecified').longitude, null);
});
test('malformed, duplicate and invalid coordinates fail before any SQL can be produced', () => {
  for (const text of ['', 'broken', line() + '\n' + line('2000', ' sydney '), line('2000', 'Sydney', '4', 'NSW', '0', '0'), line('2000', 'Sydney', '4', 'NSW', '', '151'), line('200', 'Sydney')]) {
    assert.throws(() => parseGeoNamesNsw(text));
  }
});
