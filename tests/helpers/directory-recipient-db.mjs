import assert from 'node:assert/strict';
import {prepareCandidateBatch} from '../../scripts/candidates/normalise.mjs';
import {legacyCandidate} from '../fixtures/candidate-records.mjs';
import {geographyImportSql} from '../../scripts/import-geography.mjs';
import {credentialFixtureSql} from './credential-fixture.mjs';
import {directoryScaleFixtureSql} from './directory-scale-fixture.mjs';
const j=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
export async function directoryRecipientChecks(t,{sql,rpc,id}){
  const actor=id(800001),doctor=id(2),outsider=id(800002);
  const records=[
    ['recipient-good',{business_emails:['clinic@example.test']}],
    ['recipient-other',{business_emails:['other@example.test']}],
    ['recipient-none',{}],['recipient-empty',{business_emails:['  ']}],
    ['recipient-bad',{business_emails:['not-an-email']}],
    ['recipient-ambiguous',{business_emails:['ambiguous@example.test'],practice_names:['One','Two']}],
    ['recipient-suppressed',{business_emails:['suppressed@example.test']}],
    ['recipient-unsuitable',{business_emails:['unsuitable@example.test']}],
    ['recipient-duplicate',{business_emails:['duplicate@example.test']}],
    ['recipient-no-intake',{business_emails:['closed@example.test'],accepting_new_referrals:false}],
    ['recipient-funding',{business_emails:['funding@example.test'],funding_types_raw:['self_funded']}],
    ['recipient-multiple-email',{business_emails:['one@example.test','two@example.test']}],
  ].map(([candidate_id,fields])=>legacyCandidate({candidate_id,display_name:candidate_id,...fields}));
  const batch=prepareCandidateBatch([{label:'recipient-fixture',bytes:Buffer.from(JSON.stringify(records))}]);
  const before=sql('select count(*) from private.email_jobs');
  const receipt=JSON.parse(sql(`set role service_role;select public.rw_import_candidate_batch('${actor}',${j(batch.manifest)},${j(batch.records)});`));
  sql("insert into private.email_suppressions(email,reason) values('suppressed@example.test','bounce');update private.practitioner_candidates set disposition='unsuitable' where source_id='recipient-unsuitable';update private.practitioner_candidates set disposition='duplicate' where source_id='recipient-duplicate';");
  const needs={professionId:'physiotherapist',appointmentFormat:'either',fundingId:'medicare',requiredServiceIds:[]};
  const query={needs,distanceGroup:'unknown',query:'recipient-',limit:1};
  let first;
  await t.test('email-backed directory includes only supported, unambiguous contact routes',()=>{
    first=rpc(doctor,'directory.recipients',query);
    assert.equal(first.counts.needsConfirmation,2);
    assert.equal(first.items.length,1);assert.equal(first.items[0].requirementStatus,'needs_confirmation');
    assert.equal(first.items[0].kind,'directory');assert.ok(first.items[0].selection.routeId);
    assert.equal(first.items[0].distanceKm,null);assert.ok(first.nextCursor);
    const second=rpc(doctor,'directory.recipients',{...query,cursor:first.nextCursor});
    assert.equal(second.items.length,1);assert.notEqual(first.items[0].selection.candidateId,second.items[0].selection.candidateId);
    assert.equal(second.nextCursor,null);
    const projection=JSON.stringify(first);for(const field of ['business_emails','clinic@example','raw','observations'])assert.equal(projection.includes(field),false);
    assert.equal(sql('select count(*) from private.email_jobs'),before);
  });
  await t.test('outsiders and browser roles cannot read directory route evidence',()=>{
    assert.throws(()=>rpc(outsider,'directory.recipients',query),/denied/);
    assert.throws(()=>rpc(null,'directory.recipients',query),/denied/);
    for(const role of ['anon','authenticated'])assert.throws(()=>sql(`set role ${role};select * from private.directory_contact_routes`),/permission denied/);
    assert.throws(()=>rpc(doctor,'directory.recipients',{...query,query:'changed',cursor:first.nextCursor}),/invalid_cursor/);
  });
  await t.test('exact suburb geography applies radius without postcode-centroid or unknown-distance substitution',()=>{
    sql(geographyImportSql({source:{version:'recipient-geo',url:'https://example.org/fixture',license:'Fixture only',attribution:'Fictional',sha256:'d'.repeat(64),publishedAt:'2026-10-06'},
      localities:[{state:'NSW',postcode:'2000',suburb:'Sydney',latitude:-33.8688,longitude:151.2093},
        {state:'NSW',postcode:'2000',suburb:'Another suburb',latitude:-33,longitude:151}]}));
    const nearby={...query,postcode:'2000',localityId:'NSW:2000:sydney',radiusKm:1,distanceGroup:'local',limit:50};
    assert.equal(rpc(doctor,'directory.recipients',nearby).items.length,2);
    assert.equal(rpc(doctor,'directory.recipients',nearby).items[0].distanceKm,0);
    assert.equal(rpc(doctor,'directory.recipients',{...nearby,localityId:'NSW:2000:another suburb'}).items.length,0);
    assert.equal(rpc(doctor,'directory.recipients',{...nearby,distanceGroup:'unknown'}).items.length,0);
    assert.throws(()=>rpc(doctor,'directory.recipients',{...nearby,localityId:'NSW:2000:missing'}),/invalid_location/);
    sql('delete from private.geography_active;delete from private.postcode_localities;delete from private.geography_sources;');
  });
  await t.test('source withdrawal invalidates routes transactionally and clears results',()=>{
    const selected=first.items[0].selection;
    rpc(actor,'candidate.withdrawBatch',{batchId:receipt.batchId,expectedVersion:0,expectedUnsupported:records.length,reason:'Fictional withdrawal',requestId:id(900010)});
    assert.equal(rpc(doctor,'directory.recipients',query).counts.needsConfirmation,0);
    assert.equal(sql(`select active from private.directory_contact_routes where id='${selected.routeId}'`),'f');
    assert.equal(sql('select count(*) from private.email_jobs'),before);
  });
  await t.test('combined results retain approved members and their authoritative eligibility',()=>{
    const practitioner=id(880001),organisation=sql(`select organisation_id from public.organisation_memberships where user_id='${doctor}' and active order by organisation_id limit 1`);
    sql(`insert into public.practitioners(id,display_name,profession,practice_name,contact_email,lifecycle_status,ahpra_registration_number,ahpra_verification_status,ahpra_verified_at,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages)
      values('${practitioner}','Fictional Member Regression','physiotherapist','Fictional Member Regression Clinic','member-regression@example.test','active','MEMBERREGRESSION','verified',now(),'confirmed',now(),true,true,array['Physiotherapy'],array['Medicare'],array['English']);`);
    sql(credentialFixtureSql({practitionerId:practitioner,ownerId:outsider,reviewerId:actor,organisationId:organisation}));
    const search={needs,distanceGroup:'remote',query:'Member Regression',limit:1};
    assert.equal(rpc(doctor,'directory.search',search).items.length,1);
    const combined=rpc(doctor,'directory.recipients',search);
    assert.equal(combined.counts.confirmed,1);
    assert.equal(combined.items[0].kind,'member');
    assert.equal(combined.items[0].practitionerId,practitioner);
    sql(`update public.practitioners set accepting_new_referrals=false where id='${practitioner}'`);
    assert.equal(rpc(doctor,'directory.recipients',search).counts.confirmed,0);
  });
  await t.test('a missing physical location is unknown, never telehealth-only when telehealth is false',()=>{
    const batch=prepareCandidateBatch([{label:'modality-fixture',bytes:Buffer.from(JSON.stringify([legacyCandidate({candidate_id:'modality-no-telehealth',display_name:'Fictional modality receiver',locations:[],telehealth:false,business_emails:['modality@example.test']})]))}]);
    sql(`set role service_role;select public.rw_import_candidate_batch('${actor}',${j(batch.manifest)},${j(batch.records)});`);
    const search={query:'Fictional modality receiver',limit:50,needs};
    assert.equal(rpc(doctor,'directory.recipients',{...search,distanceGroup:'remote'}).items.length,0);
    assert.equal(rpc(doctor,'directory.recipients',{...search,distanceGroup:'unknown'}).items.length,1);
    for(const appointmentFormat of ['in_person','telehealth'])for(const distanceGroup of ['local','remote','unknown'])
      assert.equal(rpc(doctor,'directory.recipients',{...search,distanceGroup,needs:{...needs,appointmentFormat}}).items.length,0);
  });
  await t.test('combined pages stay bounded with 5000 members and cross the directory tier once',()=>{
    sql(directoryScaleFixtureSql({ownerId:outsider,reviewerId:actor,tag:'RECIPIENT-SCALE'}));
    const batch=prepareCandidateBatch([{label:'combined-scale',bytes:Buffer.from(JSON.stringify([legacyCandidate({candidate_id:'combined-scale',display_name:'Fictional RECIPIENT-SCALE directory',locations:[],telehealth:true,business_emails:['combined-scale@example.test']})]))}]);
    sql(`set role service_role;select public.rw_import_candidate_batch('${actor}',${j(batch.manifest)},${j(batch.records)});`);
    const search={query:'RECIPIENT-SCALE',limit:50,distanceGroup:'remote',needs:{...needs,appointmentFormat:'telehealth'}};
    // RED is bounded too: the old exhaustive pagination must fail this timeout.
    sql(`set statement_timeout='750ms';select private.directory_recipients('${doctor}',${j(search)});`);
    const seen=new Set();let cursor=null,page;
    do {
      page=rpc(doctor,'directory.recipients',{...search,...(cursor?{cursor}:{})});
      assert.deepEqual(page.counts,{confirmed:5000,needsConfirmation:1});
      assert.ok(page.items.length<=50);
      for(const item of page.items){const key=item.kind==='member'?item.practitionerId:item.selection.routeId;assert.equal(seen.has(key),false);seen.add(key);}
      cursor=page.nextCursor;
    }while(cursor);
    assert.equal(seen.size,5001);assert.equal(page.items.length,1);assert.equal(page.items[0].kind,'directory');
    const timings=JSON.parse(sql(`do $test$ declare started timestamptz; elapsed jsonb:='[]'; begin for n in 1..30 loop started:=clock_timestamp();perform private.directory_recipients('${doctor}',${j(search)});elapsed:=elapsed||to_jsonb(extract(epoch from clock_timestamp()-started)*1000);end loop;perform set_config('returnwell.combined_timings',elapsed::text,false);end $test$;select current_setting('returnwell.combined_timings');`)).sort((a,b)=>a-b);
    console.log(JSON.stringify({combinedMemberProfiles:5000,queryRuns:30,p50Ms:timings[14],p95Ms:timings[28]}));
    assert.ok(timings[28]<500,`Combined p95 exceeded 500ms budget: ${timings[28]}`);
  });
}
