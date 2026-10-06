import assert from 'node:assert/strict';
import {prepareCandidateBatch} from '../../scripts/candidates/normalise.mjs';
import {legacyCandidate} from '../fixtures/candidate-records.mjs';
import {geographyImportSql} from '../../scripts/import-geography.mjs';
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
}
