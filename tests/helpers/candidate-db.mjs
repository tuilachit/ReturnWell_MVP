import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareCandidateBatch,canonicalJSON} from '../../scripts/candidates/normalise.mjs';
import {legacyCandidate} from '../fixtures/candidate-records.mjs';
const j=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
export async function candidateImportChecks(t,{sql,id:sourceId,sqlAsync}){
  const id=n=>sourceId(800000+n);
  sql(`insert into auth.users(id,email,email_confirmed_at) values ('${id(1)}','candidate-operator@example.test',now()),('${id(2)}','candidate-other@example.test',now());
    insert into private.platform_operators(user_id) values ('${id(1)}');`);
  const batch=(records,label='fixture')=>prepareCandidateBatch([{label,bytes:Buffer.from(JSON.stringify(records))}]);
  const query=(b,actor=id(1))=>`set role service_role; select public.rw_import_candidate_batch('${actor}',${j(b.manifest)},${j(b.records)});`;
  const apply=b=>JSON.parse(sql(query(b)));
  const counts=()=>sql("select jsonb_build_array((select count(*) from public.practitioners),(select count(*) from public.practitioner_locations),(select count(*) from private.professional_credentials),(select count(*) from private.email_jobs))");
  const initial=counts();
  let a,b,first,second;
  await t.test('candidate import is idempotent, private, count-only and cannot activate or send',()=>{
    a=batch([legacyCandidate()]);first=apply(a);
    assert.equal(first.inserted,1);assert.equal(first.newObservations,1);assert.equal(first.replayed,false);
    const replay=apply(a);assert.equal(replay.batchId,first.batchId);assert.equal(replay.replayed,true);
    assert.equal(sql('select count(*) from private.candidate_observations'),'1');
    assert.equal(counts(),initial);
    for(const role of ['anon','authenticated']){
      assert.throws(()=>sql(`set role ${role};select * from private.practitioner_candidates`),/permission denied/);
      assert.throws(()=>sql(query(a).replace('service_role',role)),/permission denied/);
    }
    assert.throws(()=>sql(query(a,id(2))),/denied/);
    assert.throws(()=>sql('set role service_role;delete from private.candidate_observations'),/permission denied/);
  });
  await t.test('changed candidate evidence preserves disposition and invalidates the reviewed hash',()=>{
    sql("update private.practitioner_candidates set disposition='reviewed_for_onboarding',reviewed_observation_hash=(select observation_hash from private.candidate_observations limit 1) where source_id='fictional-a'");
    b=batch([legacyCandidate({display_name:'Fictional changed name'})]);second=apply(b);
    assert.equal(second.inserted,0);assert.equal(second.newObservations,1);
    assert.equal(sql("select disposition from private.practitioner_candidates where source_id='fictional-a'"),'reviewed_for_onboarding');
    assert.equal(sql("select c.reviewed_observation_hash<>o.observation_hash from private.practitioner_candidates c join private.candidate_observations o on o.id=c.current_observation_id"),'t');
    assert.equal(counts(),initial);
  });
  await t.test('forged digest, malformed second row and revoked operator cannot write or replay',()=>{
    const c=batch([legacyCandidate({candidate_id:'another'}),legacyCandidate({candidate_id:'invalid-second'})]);
    c.records[1].displayName='';
    const before=sql('select count(*) from private.candidate_import_batches');
    assert.throws(()=>apply(c),/candidate_invalid/);
    assert.equal(sql('select count(*) from private.candidate_import_batches'),before);
    assert.equal(sql("select count(*) from private.practitioner_candidates where source_id='another'"),'0');
    const forged=structuredClone(a);forged.manifest.digest='0'.repeat(64);
    assert.throws(()=>apply(forged),/candidate_invalid/);
    sql(`update private.platform_operators set active=false where user_id='${id(1)}'`);
    assert.throws(()=>apply(a),/denied/);
    sql(`update private.platform_operators set active=true where user_id='${id(1)}'`);
  });
  await t.test('SQL validates bounded fields even when malformed payload hashes are authentic',()=>{
    const hash=value=>createHash('sha256').update(canonicalJSON(value)).digest('hex');
    for(const change of [
      r=>{r.displayName='x'.repeat(161);},r=>{r.practiceNames=Array(51).fill('practice');},
      r=>{r.professionIds=Array(21).fill('physiotherapist');},r=>{r.locations=[null];},
      r=>{r.sourceUrls=['https://person:password@example.test'];},r=>{r.raw={private:'x'.repeat(65537)};},
      r=>{r.observedAt='not a date';},r=>{r.raw=null;},r=>{r.active=true;},
    ]){
      const invalid=batch([legacyCandidate({candidate_id:'malformed'})]);change(invalid.records[0]);
      const {observationHash:ignored,...record}=invalid.records[0];void ignored;
      invalid.records[0].observationHash=hash(record);
      const {digest:ignoredDigest,...manifest}=invalid.manifest;void ignoredDigest;
      invalid.manifest.digest=hash({manifest,records:invalid.records});
      assert.throws(()=>apply(invalid),/candidate_invalid/);
    }
    assert.equal(sql("select count(*) from private.practitioner_candidates where source_id='malformed'"),'0');
    assert.equal(counts(),initial);
  });
  await t.test('withdrawal restores supported evidence, replays once, and never revives a withdrawn batch',()=>{
    const withdraw=(batchId,version,requestId,reason='Fictional correction')=>JSON.parse(sql(`set role service_role;select private.withdraw_candidate_batch('${id(1)}','${batchId}',${version},'${reason}','${requestId}')`));
    const undone=withdraw(second.batchId,0,id(10));
    assert.equal(undone.hiddenCandidates,0);
    assert.equal(sql("select o.record->>'displayName' from private.practitioner_candidates c join private.candidate_observations o on o.id=c.current_observation_id where c.source_id='fictional-a'"),'Fictional Legacy Person');
    assert.deepEqual(withdraw(second.batchId,0,id(10)),undone);
    assert.throws(()=>withdraw(second.batchId,0,id(10),'Different reason'),/request_conflict/);
    assert.equal(apply(b).status,'withdrawn');
    assert.equal(apply(b).replayed,true);
    assert.equal(sql('select count(*) from private.candidate_review_events'),'1');
    assert.equal(withdraw(first.batchId,0,id(11)).hiddenCandidates,1);
    assert.equal(sql('select count(*) from private.practitioner_candidates where current_observation_id is not null'),'0');
    assert.equal(counts(),initial);
  });
  await t.test('concurrent identical candidate imports commit one batch',async()=>{
    const c=batch([legacyCandidate({candidate_id:'concurrent'})]);
    const result=await Promise.all([sqlAsync(query(c)),sqlAsync(query(c))]);
    const receipts=result.map(x=>JSON.parse(x));
    assert.equal(receipts[0].batchId,receipts[1].batchId);
    assert.deepEqual(receipts.map(x=>x.replayed).sort(),[false,true]);
    assert.equal(sql("select count(*) from private.practitioner_candidates where source_id='concurrent'"),'1');
    assert.equal(counts(),initial);
  });
  await t.test('overlapping batches retain support, immutable evidence and review versions',()=>{
    const record=legacyCandidate({candidate_id:'overlap',numeric_notes:{small:1e-7,big:1e21,'😀':1,'\ue000':2,'2':3,'10':4}});
    const one=apply(batch([record],'overlap-one')),two=apply(batch([record],'overlap-two'));
    assert.equal(one.newObservations,1);assert.equal(two.newObservations,0);
    const version=sql("select version from private.practitioner_candidates where source_id='overlap'");
    const withdraw=(receipt,request)=>JSON.parse(sql(`set role service_role;select private.withdraw_candidate_batch('${id(1)}','${receipt.batchId}',0,'Fixture overlap','${id(request)}')`));
    assert.equal(withdraw(two,20).hiddenCandidates,0);
    assert.equal(sql("select version from private.practitioner_candidates where source_id='overlap'"),version);
    assert.equal(withdraw(one,21).hiddenCandidates,1);
    assert.equal(Number(sql("select version from private.practitioner_candidates where source_id='overlap'")),Number(version)+1);
    for(const table of ['candidate_observations','candidate_review_events','candidate_batch_items']){
      assert.throws(()=>sql(`set role service_role;delete from private.${table}`),/permission denied/);
    }
    assert.equal(counts(),initial);
  });
}
