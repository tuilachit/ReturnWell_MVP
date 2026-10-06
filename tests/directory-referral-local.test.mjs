import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {localRuntime} from './helpers/local-runtime.mjs';
import {enrollFixtureMfa} from './helpers/mfa.mjs';
import {prepareCandidateBatch} from '../scripts/candidates/normalise.mjs';
import {legacyCandidate} from './fixtures/candidate-records.mjs';

test('source-bound referral through real local Auth, HTTP and PostgREST isolates shared-inbox identities',
  {skip:process.env.RW_LOCAL_JOURNEY!=='1',timeout:120000},async()=>{
    const local=localRuntime(),suffix=randomUUID().slice(0,8),org=randomUUID();
    const reviewer=await local.verifiedFixtureUser(`directory-review-${suffix}@example.test`);
    const doctor=await local.verifiedFixtureUser(`directory-doctor-${suffix}@example.test`);
    const outsider=await local.verifiedFixtureUser(`directory-other-${suffix}@example.test`);
    await enrollFixtureMfa(reviewer.client);
    local.sql(`insert into private.platform_operators(user_id) values('${reviewer.userId}');
      insert into public.organisations(id,name) values('${org}','Fictional Directory Practice');
      insert into public.organisation_memberships(organisation_id,user_id,role) values('${org}','${doctor.userId}','referrer');
      insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values('${doctor.userId}','${org}','Dr Fictional','Fictional Directory Practice','${reviewer.userId}');
      update private.profession_policies set enabled=true,review_interval_days=7,identifier_pattern='^[A-Z0-9-]{3,80}$',approved_by='${reviewer.userId}',approved_at=now(),evidence_reference='Fictional directory policy' where profession_id='physiotherapist';`);
    const call=async(endpoint,input,client)=>{
      const result=await local.call(endpoint,input,client);
      assert.equal(result.status,200,`${endpoint}: HTTP ${result.status} ${result.body?.code}`);
      return result.body;
    };
    const email=`directory-receiver-${suffix}@example.test`;
    const prepared=prepareCandidateBatch([{label:`directory-${suffix}`,bytes:Buffer.from(JSON.stringify([1,2].map(n=>legacyCandidate({candidate_id:`directory-${suffix}-${n}`,display_name:`Fictional Intended ${suffix} ${n}`,practice_names:['Fictional Receiving Clinic'],business_emails:[email]}))))}]);
    const imported=await local.admin.rpc('rw_import_candidate_batch',{p_actor:reviewer.userId,p_manifest:prepared.manifest,p_records:prepared.records});
    assert.equal(imported.error,null);
    const page=await call('search-practitioners',{operation:'recipients',query:suffix,distanceGroup:'unknown',needs:{professionId:'physiotherapist',fundingId:'self_funded',appointmentFormat:'either',requiredServiceIds:[]}},doctor.client);
    const contacts=page.items.filter(x=>x.kind==='directory');assert.equal(contacts.length,2);
    assert.doesNotMatch(JSON.stringify(page),new RegExp(email));
    const sends=[];
    for(const selected of contacts){
      const draft=await call('manage-referral',{operation:'draft.save',id:randomUUID(),organisationId:org,expectedVersion:-1,requestId:randomUUID(),input:{patientReference:'Fictional private reference',patientPostcode:'2000',profession:'physiotherapist',clinicalSummary:'Fictional confidential summary',fundingPath:'self_funded',appointmentFormat:'either',patientContact:{initials:'FX',preferredMethod:'phone',phone:'0412345678',email:''}}},doctor.client);
      const input={operation:'draft.directoryInvite',id:draft.id,expectedVersion:draft.version,requestId:randomUUID(),selection:selected.selection,contactBasis:'documented_permission',contactConsentConfirmed:true,consentConfirmed:true};
      const sent=await call('manage-referral',input,doctor.client);
      assert.equal((await call('manage-referral',input,doctor.client)).invitationId,sent.invitationId);
      sends.push(sent);
    }
    assert.notEqual(sends[0].invitationId,sends[1].invitationId);
    let recipient,applicationId;
    for(const [index,sent] of sends.entries()){
      const token=await local.invitationToken(sent.invitationId);
      const inspection=await call('invitation-entry',{operation:'inspect',token});
      assert.equal(inspection.intendedIdentity.displayName,contacts[index].displayName);
      assert.doesNotMatch(JSON.stringify(inspection),/0412345678|confidential summary|private reference/);
      await call('invitation-entry',{operation:'beginSignup',token,termsVersion:local.env.TERMS_VERSION,privacyVersion:local.env.PRIVACY_VERSION,consentAccepted:true,requestId:randomUUID()});
      const message=await local.verificationMessage(sent.invitationId);
      assert.doesNotMatch(message.email.text,/0412345678|confidential summary|private reference/);
      recipient=await local.verify(message.values);
      const input={invitationId:sent.invitationId,attemptId:message.attemptId,displayName:contacts[0].displayName,requestId:randomUUID()};
      assert.equal((await local.call('claim-invitation',input,outsider.client)).status,403);
      const claim=await call('claim-invitation',input,recipient.client);
      applicationId??=claim.applicationId;
      assert.equal((await recipient.client.from('referrals').select('id').eq('id',sent.referralId)).data.length,0);
      assert.equal((await local.call('manage-referral',{operation:'contact.read',referralId:sent.referralId},recipient.client)).status,403);
    }
    const app=await call('practitioner-onboarding',{operation:'load',applicationId},recipient.client);
    const profile={displayName:contacts[0].displayName,profession:'physiotherapist',registrationNumber:`DIR${suffix.toUpperCase()}`,practiceName:'Fictional Receiving Clinic',services:['Physiotherapy'],funding:['self_funded'],languages:['english'],telehealth:false,acceptingNewReferrals:true,locations:[{suburb:'Sydney',postcode:'2000',state:'NSW',isPrimary:true}]};
    const saved=await call('practitioner-onboarding',{operation:'save',applicationId,expectedVersion:app.version,profile},recipient.client);
    const submitted=await call('practitioner-onboarding',{operation:'submit',applicationId,expectedVersion:saved.version,profileConfirmed:true,referralConsent:true,termsVersion:local.env.TERMS_VERSION,privacyVersion:local.env.PRIVACY_VERSION},recipient.client);
    const checkedAt=new Date().toISOString();
    await call('review-practitioner',{operation:'decide',applicationId,expectedVersion:submitted.version,requestId:randomUUID(),decision:'approved',identityEvidence:{method:'independent_practice_contact',matched:true,reference:'Fictional identity evidence',checkedAt},registrationEvidence:{method:'manual_register',matched:true,reference:'Fictional register evidence',registrationNumber:profile.registrationNumber,checkedAt},applicantFeedback:''},reviewer.client);
    for(const sent of sends)assert.equal((await call('manage-referral',{operation:'onboarding.status',referralId:sent.referralId},doctor.client)).status,'awaiting_review');
    const candidate=contacts[0].selection.candidateId;
    const version=Number(local.sql(`select version from private.practitioner_candidates where id='${candidate}'`));
    const disposed=await call('review-practitioner',{operation:'candidate_dispose',candidateId:candidate,expectedVersion:version,requestId:randomUUID(),disposition:'reviewed_for_onboarding',reason:'Fictional review',evidenceReference:'Fictional source review'},reviewer.client);
    await call('review-practitioner',{operation:'candidate_link_application',candidateId:candidate,applicationId,expectedVersion:disposed.version,requestId:randomUUID(),reason:'Fictional intended person confirmed',evidenceReference:'Fictional independent practice association'},reviewer.client);
    await local.runtime.rpc(null,'growth.sweep',{});
    assert.equal((await call('manage-referral',{operation:'onboarding.status',referralId:sends[0].referralId},doctor.client)).status,'released');
    assert.equal((await call('manage-referral',{operation:'contact.read',referralId:sends[0].referralId},recipient.client)).initials,'FX');
    assert.equal((await call('manage-referral',{operation:'onboarding.status',referralId:sends[1].referralId},doctor.client)).status,'awaiting_review');
    assert.equal((await local.call('manage-referral',{operation:'contact.read',referralId:sends[1].referralId},recipient.client)).status,403);
    assert.equal(local.sql(`select count(*) from public.referral_events where referral_id='${sends[0].referralId}' and event_type='sent'`),'1');
  });
