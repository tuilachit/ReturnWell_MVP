import assert from 'node:assert/strict';
import { professions } from '../app/lib/professions.ts';
import terms from '../shared/terminology.json' with {type:'json'};
assert.equal(new Set(professions.map(p => p.id)).size, professions.length);
for (const p of professions) {
  assert.match(p.id, /^[a-z_]+$/);
  assert.ok(p.scope !== 'supported' || p.authorityId !== 'protocol_pending');
  assert.ok(p.route !== 'professional_body' || !p.credentialLabel.includes('AHPRA'));
  assert.ok(p.sourceUrls.every(url => new URL(url).protocol === 'https:'));
}
for (const [kind, list] of Object.entries(terms).filter(([kind]) => kind !== 'version')) {
  const aliases = new Map();
  for (const term of list) for (const alias of [term.id,term.label,...term.aliases]) {
    const key = alias.trim().toLocaleLowerCase('en-AU');
    assert.ok(!aliases.has(key) || aliases.get(key) === term.id, `Ambiguous ${kind} alias`);
    aliases.set(key, term.id);
  }
}
console.log(`Validated ${professions.length} profession decisions; no private records imported.`);
