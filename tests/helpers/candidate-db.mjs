import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareCandidateBatch,canonicalJSON} from '../../scripts/candidates/normalise.mjs';
import {legacyCandidate} from '../fixtures/candidate-records.mjs';
const j=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
export async function candidateImportChecks(t,{sql,rpc,profile,review,id:sourceId,sqlAsync}){
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
  const workflow=(action,input={},actor=id(1))=>JSON.parse(sql(`set role service_role;select public.rw_workflow('${actor}','candidate.${action}',${j(input)})`));
  let target,disposed;
  await t.test('candidate operator queries are bounded, literal, role checked and exclude raw fields',()=>{
    apply(batch([legacyCandidate({candidate_id:'literal',display_name:'Fictional 100%_ literal'})]));
    const page=workflow('list',{search:'%_'});assert.equal(page.total,1);assert.equal(page.items.length,1);target=page.items[0];
    assert.equal('raw' in target,false);assert.equal(target.reviewRequired,true);
    assert.equal(workflow('list',{search:'SQL injection \''}).total,0);
    assert.throws(()=>workflow('list',{},id(2)),/denied/);
    for(const input of [{limit:0},{limit:-1},{limit:1.1},{search:'a'.repeat(161)},{postcode:'20'},{cursor:'bad'}])assert.throws(()=>workflow('list',input),/invalid_request|invalid_cursor/);
    const detail=workflow('detail',{candidateId:target.id});assert.equal(detail.displayName,target.displayName);assert.equal(detail.observations.length,1);assert.ok(detail.currentObservation.record.raw);
    const withdrawn=JSON.parse(sql("select jsonb_build_object('id',id) from private.practitioner_candidates where source_id='overlap'"));
    assert.equal(workflow('detail',{candidateId:withdrawn.id}).withdrawn,true);
    assert.equal(workflow('list',{search:'Fictional Legacy Person'}).items.some(x=>x.id===withdrawn.id),false);
  });
  await t.test('candidate disposition is versioned, idempotent and rechecks revoked operators before replay',()=>{
    const input={candidateId:target.id,expectedVersion:target.version,disposition:'reviewed_for_onboarding',reason:'Identity reviewed',evidenceReference:'Fictional review record',requestId:id(30)};
    assert.throws(()=>workflow('dispose',{...input,evidenceReference:null}),/evidence_required/);
    disposed=workflow('dispose',input);assert.equal(disposed.version,target.version+1);assert.deepEqual(workflow('dispose',input),disposed);
    assert.throws(()=>workflow('dispose',{...input,reason:'Changed'}),/conflict/);
    assert.throws(()=>workflow('dispose',{...input,requestId:id(31)}),/conflict/);
    assert.equal(workflow('detail',{candidateId:target.id}).reviewRequired,false);
    assert.equal(workflow('detail',{candidateId:target.id}).events.length,1);
    sql(`update private.platform_operators set active=false where user_id='${id(1)}'`);
    assert.throws(()=>workflow('list'),/denied/);assert.throws(()=>workflow('dispose',input),/denied/);
    sql(`update private.platform_operators set active=true where user_id='${id(1)}'`);
    assert.equal(counts(),initial);
  });
  await t.test('candidate history pagination obeys byte budget and binds cursors to their stream and candidate',()=>{
    let receipt;
    for(let n=0;n<5;n++)receipt=apply(batch([legacyCandidate({candidate_id:'history',display_name:`History ${n}`,notes:'x'.repeat(60000)})]));
    const item=workflow('list',{search:'History 4'}).items[0];
    let detail=workflow('detail',{candidateId:item.id}),seen=new Set(detail.observations.map(x=>x.id));
    assert.ok(Buffer.byteLength(JSON.stringify(detail))<=256*1024);assert.ok(detail.nextObservationCursor);
    assert.throws(()=>workflow('detail',{candidateId:target.id,observationCursor:detail.nextObservationCursor}),/invalid_cursor/);
    while(detail.nextObservationCursor){detail=workflow('detail',{candidateId:item.id,observationCursor:detail.nextObservationCursor});assert.ok(Buffer.byteLength(JSON.stringify(detail))<=256*1024);for(const x of detail.observations){assert.equal(seen.has(x.id),false);seen.add(x.id);}}
    assert.equal(seen.size,5);
    const batches=workflow('batches');assert.ok(batches.items.length<=25);
    const active=batches.items.find(x=>x.batchId===receipt.batchId);assert.ok(active);assert.equal(active.unsupportedOnWithdrawal,0);
    workflow('withdrawBatch',{batchId:active.batchId,expectedVersion:active.version,reason:'Fictional withdrawal',requestId:id(40)});
    assert.equal(workflow('list',{search:'History 4'}).total,0);
    assert.equal(workflow('list',{search:'History 3'}).total,1);
    assert.equal(counts(),initial);
  });
  await t.test('5000 synthetic candidates traverse stable pages without duplicates or private payloads',()=>{
    for(let offset=0;offset<5000;offset+=1000)apply(batch(Array.from({length:1000},(_,n)=>legacyCandidate({candidate_id:`volume-${offset+n}`,display_name:`Volume ${String(offset+n).padStart(5,'0')}`})),`volume-${offset}`));
    let cursor=null;const seen=new Set();let previous='';
    do{
      const page=workflow('list',{search:'Volume',limit:80,...(cursor?{cursor}:{})});assert.equal(page.total,5000);assert.ok(page.items.length<=50);
      for(const row of page.items){assert.equal(seen.has(row.id),false);assert.ok(row.displayName>=previous);previous=row.displayName;seen.add(row.id);assert.equal('raw' in row,false);assert.equal('sourceUrls' in row,false);}
      cursor=page.nextCursor;
      if(cursor)assert.throws(()=>workflow('list',{search:'different',cursor}),/invalid_cursor/);
    }while(cursor);
    assert.equal(seen.size,5000);assert.equal(counts(),initial);
  });
  await t.test('dense maximum-size evidence always advances history within the response budget',()=>{
    const raw=legacyCandidate({candidate_id:'dense',display_name:'Dense history',practice_names:Array.from({length:50},(_,n)=>`${n}`.padEnd(200,'p')),
      locations:Array.from({length:50},()=>({suburb:'s'.repeat(160),postcode:'2'.repeat(160),state:'N'.repeat(100)}))});
    let low=0,high=33000,prepared;
    while(low<=high){const n=Math.floor((low+high)/2);try{prepared=batch([{...raw,numbers:Array(n).fill(0)}]);low=n+1;}catch{high=n-1;}}
    assert.ok(prepared);apply(prepared);
    const item=workflow('list',{search:'Dense history'}).items[0];
    const detail=workflow('detail',{candidateId:item.id});
    assert.equal(detail.observations.length,1);assert.equal(detail.nextObservationCursor,null);
    assert.ok(Buffer.byteLength(JSON.stringify(detail))<=256*1024);
  });
  const applicationSnapshot=()=>sql(`select jsonb_agg(to_jsonb(a) order by id) from public.practitioner_applications a where id in ('${id(61)}','${id(62)}','${id(63)}')`);
  let source,linkBatch,linkInput,appSnapshot;
  await t.test('linking provenance never approves, copies profile data or assigns an account',()=>{
    sql(`insert into auth.users(id,email,email_confirmed_at) values ('${id(3)}','candidate-owner-3@example.test',now()),('${id(4)}','candidate-owner-4@example.test',now());`);
    for(const [n,owner] of [[1,3],[2,4],[3,1]]){
      sql(`insert into public.workspace_invitations(id,kind,invited_by,inviter_name,practice_name,recipient_name,recipient_email,recipient_email_normalized,consent_recorded_at,status,claimed_by)
        values('${id(50+n)}','practitioner','${id(1)}','Fictional Reviewer','Fictional Practice','Fictional Clinician','candidate-owner-${owner}@example.test','candidate-owner-${owner}@example.test',now(),'claimed','${id(owner)}');
        insert into public.practitioner_applications(id,invitation_id,user_id,terms_version,privacy_version) values('${id(60+n)}','${id(50+n)}','${id(owner)}','v1','v1');`);
      const saved=rpc(id(owner),'application.save',{applicationId:id(60+n),expectedVersion:0,profile:{...profile,registrationNumber:`PHY800000000${owner}`}});
      rpc(id(owner),'application.submit',{applicationId:id(60+n),expectedVersion:saved.version,profileConfirmed:true,referralConsent:true,termsVersion:'v1',privacyVersion:'v1'});
    }
    linkBatch=apply(batch([legacyCandidate({candidate_id:'link-source',display_name:'Fictional Clinician'})]));
    source=workflow('list',{search:'Fictional Clinician'}).items[0];
    assert.equal(workflow('detail',{candidateId:source.id}).linkedApplicationId,null);
    linkInput={candidateId:source.id,applicationId:id(61),expectedVersion:source.version,reason:'Fictional identity comparison',evidenceReference:'Fictional independent evidence',requestId:id(80)};
    assert.throws(()=>workflow('linkApplication',linkInput),/evidence_required/);
    workflow('dispose',{candidateId:source.id,expectedVersion:source.version,disposition:'reviewed_for_onboarding',reason:'Reviewed source',evidenceReference:'Fictional review',requestId:id(79)});
    linkInput.expectedVersion++;
    assert.throws(()=>workflow('linkApplication',{...linkInput,applicationId:id(63)}),/denied/);
    assert.throws(()=>workflow('linkApplication',{...linkInput,applicationId:id(999)}),/invalid_request/);
    assert.throws(()=>workflow('linkApplication',{...linkInput,evidenceReference:''}),/invalid_request|evidence_required/);
    appSnapshot=applicationSnapshot();
    const linked=workflow('linkApplication',linkInput);assert.equal(linked.version,linkInput.expectedVersion+1);
    assert.deepEqual(workflow('linkApplication',linkInput),linked);
    assert.equal(workflow('detail',{candidateId:source.id}).linkedApplicationId,id(61));
    apply(batch([legacyCandidate({candidate_id:'another-link-source',display_name:'Another link'})]));
    const other=workflow('list',{search:'Another link'}).items[0];
    const reviewed=workflow('dispose',{candidateId:other.id,expectedVersion:other.version,disposition:'reviewed_for_onboarding',reason:'Fictional review',evidenceReference:'Fictional evidence',requestId:id(86)});
    assert.throws(()=>workflow('linkApplication',{...linkInput,candidateId:other.id,expectedVersion:reviewed.version,requestId:id(87)}),/conflict/);
    assert.equal(sql(`select application_snapshot ?& array['applicationId','ownerId','applicationVersion','observationHash'] from private.candidate_review_events where candidate_id='${source.id}' and action='link_application'`),'t');
    assert.equal(applicationSnapshot(),appSnapshot);assert.equal(counts(),initial);
  });
  await t.test('link replay is actor scoped and correcting a link is explicit and audited',()=>{
    assert.throws(()=>workflow('linkApplication',{...linkInput,applicationId:id(62)}),/conflict/);
    assert.throws(()=>workflow('linkApplication',{...linkInput,requestId:id(81)}),/conflict/);
    sql(`insert into private.platform_operators(user_id) values('${id(2)}')`);
    assert.throws(()=>workflow('linkApplication',linkInput,id(2)),/conflict/);
    sql(`update private.platform_operators set active=false where user_id='${id(1)}'`);
    assert.throws(()=>workflow('linkApplication',linkInput),/denied/);
    sql(`update private.platform_operators set active=true where user_id='${id(1)}'`);
    let detail=workflow('detail',{candidateId:source.id});
    const unlink={...linkInput,expectedVersion:detail.version,requestId:id(82)};
    assert.throws(()=>workflow('unlinkApplication',{...unlink,applicationId:id(62)}),/conflict/);
    const unlinked=workflow('unlinkApplication',unlink);assert.deepEqual(workflow('unlinkApplication',unlink),unlinked);
    detail=workflow('detail',{candidateId:source.id});assert.equal(detail.linkedApplicationId,null);
    const changed=apply(batch([legacyCandidate({candidate_id:'link-source',display_name:'Changed candidate observation'})]));
    detail=workflow('detail',{candidateId:source.id});assert.equal(detail.reviewRequired,true);
    assert.throws(()=>workflow('linkApplication',{...linkInput,applicationId:id(62),expectedVersion:detail.version,requestId:id(88)}),/evidence_required/);
    workflow('dispose',{candidateId:source.id,expectedVersion:detail.version,disposition:'reviewed_for_onboarding',reason:'Rechecked changed source',evidenceReference:'Fictional recheck',requestId:id(89)});
    detail=workflow('detail',{candidateId:source.id});
    workflow('linkApplication',{...linkInput,applicationId:id(62),expectedVersion:detail.version,requestId:id(83)});
    detail=workflow('detail',{candidateId:source.id});assert.equal(detail.linkedApplicationId,id(62));
    assert.equal(detail.events.filter(e=>['link_application','unlink_application'].includes(e.action)).length,3);
    workflow('withdrawBatch',{batchId:linkBatch.batchId,expectedVersion:0,reason:'Fictional correction',requestId:id(84)});
    workflow('withdrawBatch',{batchId:changed.batchId,expectedVersion:0,reason:'Fictional correction',requestId:id(90)});
    detail=workflow('detail',{candidateId:source.id});assert.equal(detail.withdrawn,true);assert.equal(detail.linkedApplicationId,id(62));
    assert.equal(applicationSnapshot(),appSnapshot);assert.equal(counts(),initial);
  });
  await t.test('only independent application approval admits the linked provider; withdrawal never changes live eligibility',()=>{
    const before=Number(sql('select count(*) from public.practitioners'));
    const approved=rpc(id(1),'review.decide',{...review,applicationId:id(62),expectedVersion:2,requestId:id(85),registrationEvidence:{...review.registrationEvidence,registrationNumber:'PHY8000000004'}});
    const practitioner=approved.practitioner_id;
    assert.equal(Number(sql('select count(*) from public.practitioners')),before+1);
    assert.equal(sql(`select private.practitioner_is_eligible('${practitioner}','physiotherapist',now())`),'t');
    assert.equal(workflow('detail',{candidateId:source.id}).withdrawn,true);
    for(const change of [
      `update public.practitioners set accepting_new_referrals=false where id='${practitioner}'`,
      `update private.profession_policies set enabled=false where profession_id='physiotherapist'`,
      `update private.professional_credentials set expires_at=now() where practitioner_id='${practitioner}'`,
    ])assert.equal(sql(`begin;${change};select private.practitioner_is_eligible('${practitioner}','physiotherapist',now());rollback;`),'f');
    assert.equal(sql(`select count(*) from public.practitioner_users where practitioner_id='${practitioner}' and user_id='${id(4)}' and active`),'1');
    assert.equal(sql(`select count(*) from public.practitioner_users where practitioner_id='${practitioner}' and user_id='${id(1)}'`),'0');
  });
}
