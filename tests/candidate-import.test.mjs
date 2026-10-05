import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normaliseCandidate,prepareCandidateBatch} from '../scripts/candidates/normalise.mjs';
import {runCandidateImport} from '../scripts/import-candidates.mjs';
import {legacyCandidate,pilotCandidate,expandedCandidate} from './fixtures/candidate-records.mjs';
const input=(rows,label='test')=>({label,bytes:Buffer.from(JSON.stringify(rows))});
test('three source shapes retain unknowns, multi-profession and stable provenance hashes',()=>{
  const a=legacyCandidate(),b=pilotCandidate(),c=expandedCandidate();
  const batch=prepareCandidateBatch([input([a,b,c])]);
  assert.equal(batch.manifest.recordCount,3);
  assert.deepEqual(batch.records.find(x=>x.sourceId==='fictional-multi').professionIds,['occupational_therapist','physiotherapist']);
  assert.equal(batch.records[0].observedAt,null);
  assert.equal(batch.records[0].raw.telehealth,null);
  assert.equal(batch.records[1].observedAt,'2026-09-30T01:00:00.000Z');
  const pair=[input([a],'alpha'),input([b,c],'beta')];
  assert.equal(prepareCandidateBatch(pair.toReversed()).manifest.digest,prepareCandidateBatch(pair).manifest.digest);
  assert.notEqual(prepareCandidateBatch([input([a,b,{...c,display_name:'Changed fictional name'}])]).manifest.digest,batch.manifest.digest);
  assert.equal('active' in batch.records[2],false);
  assert.equal('providerConfirmed' in batch.records[2],false);
});
test('dedupe uses source identity not names and rejects conflicting observations',()=>{
  const a=legacyCandidate();
  assert.equal(prepareCandidateBatch([input([a,a])]).manifest.recordCount,1);
  assert.equal(prepareCandidateBatch([input([a,{...a,candidate_id:'another'}])]).manifest.recordCount,2);
  assert.throws(()=>prepareCandidateBatch([input([a,{...a,telehealth:true}])]),/conflicting_source/);
  assert.throws(()=>prepareCandidateBatch([input([a]),input([a])]),/duplicate_label/);
});
test('malformed structure and bounded fields fail without private values in errors',()=>{
  for(const overrides of [{display_name:''},{candidate_id:''},{display_name:'n'.repeat(161)},{candidate_id:'s'.repeat(161)},
    {practice_names:['p'.repeat(201)]},{profession:42},{locations:[null]},{source_urls:['javascript:alert(1)']},
    {source_urls:['https://user:password@example.com']},{source_urls:['https://example.com/'+'x'.repeat(2048)]},
    {practice_names:Array(51).fill('p')},{professions:Array(21).fill('physiotherapist')},
    {private_notes:'x'.repeat(65536)}]) {
    assert.throws(()=>normaliseCandidate(legacyCandidate(overrides)),/^Error: candidate_[a-z_]+$/);
  }
  assert.throws(()=>prepareCandidateBatch([{label:'safe',bytes:Buffer.from('{PRIVATE BAD JSON')}]),/candidate_invalid_json/);
  assert.throws(()=>prepareCandidateBatch([input({})]),/candidate_invalid_array/);
  assert.throws(()=>prepareCandidateBatch([input([legacyCandidate()],'bad label')]),/candidate_invalid_label/);
  assert.throws(()=>prepareCandidateBatch([{label:'large',bytes:Buffer.alloc(20*1024*1024+1)}]),/candidate_input_too_large/);
  assert.throws(()=>prepareCandidateBatch([input(Array.from({length:1001},(_,i)=>legacyCandidate({candidate_id:`s${i}`})))]),/candidate_batch_too_large/);
  let nested={};for(let i=0;i<14;i++)nested={nested};
  assert.throws(()=>normaliseCandidate(legacyCandidate({nested})),/candidate_depth/);
});
test('unknown observations and hostile text stay text and never become trust claims',()=>{
  const r=normaliseCandidate(legacyCandidate({display_name:'<script>alert(1)</script>',profession:'unknown_role',locations:[{suburb:'Unknown',postcode:'BAD',state:'VIC'}],scraped_at:'not-a-date',active:true}));
  assert.equal(r.displayName,'<script>alert(1)</script>');
  assert.ok(r.reviewFlags.includes('unknown_profession'));
  assert.ok(r.reviewFlags.includes('invalid_postcode'));
  assert.ok(r.reviewFlags.includes('outside_nsw'));
  assert.ok(r.reviewFlags.includes('invalid_observed_at'));
  assert.equal(r.observedAt,null);
  assert.equal(r.raw.active,true);
  assert.equal('active' in r,false);
});
test('dry run performs no network and emits count-only output even on errors',async()=>{
  const lines=[];let networkCalls=0;
  const deps={readFile:async()=>input([legacyCandidate()]).bytes,apply:async()=>{networkCalls++;},stdout:s=>lines.push(s)};
  assert.equal(await runCandidateImport(['--input','fixture=/fictional/private.json'],deps),0);
  assert.equal(networkCalls,0);
  assert.equal(JSON.parse(lines[0]).recordCount,1);
  assert.doesNotMatch(lines.join(''),/Fictional Legacy Person|example.com|\/fictional/);
  lines.length=0;
  assert.equal(await runCandidateImport(['--input','fixture=/private/person.json'],{...deps,readFile:async()=>{throw Error('secret path and name');}}),1);
  assert.doesNotMatch(lines.join(''),/secret path|person.json/);
});
test('retired public generator fails closed without creating exports',async t=>{
  const root=await mkdtemp(join(tmpdir(),'rw-retired-generator-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const result=spawnSync(process.execPath,[new URL('../scripts/generate-prototype-data.mjs',import.meta.url).pathname],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/retired/);
  assert.deepEqual(await readdir(root),[]);
});
