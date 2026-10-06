import assert from 'node:assert/strict';
import {prepareCandidateBatch} from '../../scripts/candidates/normalise.mjs';
import {legacyCandidate} from '../fixtures/candidate-records.mjs';
import {credentialFixtureSql} from './credential-fixture.mjs';
const j=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
export async function directoryReferralChecks(t,{sql,rpc,id,organisationId=id(1)}){
  const doctor=id(2),reviewer=id(800001),owner=id(950003),wrong=id(950004),practitioner=id(950030);
  const records=[1,2].map(n=>legacyCandidate({candidate_id:`directory-flow-${n}`,display_name:`Directory test ${n}`,practice_names:['Fictional Practice'],business_emails:['shared@example.test'],funding_types_raw:['self_funded'],languages_raw:['English'],telehealth:false}));
  const prepared=prepareCandidateBatch([{label:'directory-flow',bytes:Buffer.from(JSON.stringify(records))}]);
  sql(`set role service_role;select public.rw_import_candidate_batch('${reviewer}',${j(prepared.manifest)},${j(prepared.records)});`);
  sql(`insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values('${doctor}','${organisationId}','Fictional Doctor','Fictional Practice','${reviewer}') on conflict do nothing;
    insert into auth.users(id,email,email_confirmed_at) values('${owner}','shared@example.test',now()),('${wrong}','wrong@example.test',now());
    insert into public.practitioners(id,display_name,profession,practice_name,contact_email,lifecycle_status,ahpra_registration_number,ahpra_verification_status,ahpra_verified_at,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages)
      values('${practitioner}','Directory test 1','physiotherapist','Fictional Practice','shared@example.test','active','PHY9500000001','verified',now(),'confirmed',now(),true,true,array['Physiotherapy'],array['self_funded'],array['english']);
    insert into public.practitioner_locations(practitioner_id,suburb,postcode,state,is_primary) values('${practitioner}','Sydney','2000','NSW',true);`);
  sql(credentialFixtureSql({practitionerId:practitioner,ownerId:owner,reviewerId:reviewer,organisationId}));
  const needs={professionId:'physiotherapist',appointmentFormat:'either',fundingId:'self_funded',requiredServiceIds:[]};
  const options=rpc(doctor,'directory.recipients',{query:'Directory test',distanceGroup:'unknown',needs,limit:50}).items.filter(x=>x.kind==='directory');
  assert.equal(options.length,2);
  let n=951000;const next=()=>id(++n);
  const make=selection=>{
    const draft=rpc(doctor,'draft.save',{id:next(),organisationId,expectedVersion:-1,requestId:next(),input:{patientReference:'Fictional directory case',patientPostcode:'2000',profession:'physiotherapist',clinicalSummary:'Fictional private summary',fundingPath:'self_funded',appointmentFormat:'either',patientContact:{initials:'FX',preferredMethod:'phone',phone:'0412345678',email:''}}});
    return {id:draft.id,expectedVersion:0,requestId:next(),selection,consentConfirmed:true,contactConsentConfirmed:true,contactBasis:'documented_permission',tokenHash:String(n).padStart(64,'0'),envelope:{test:'encrypted'},keyId:'test'};
  };
  const one=make(options[0].selection),two=make(options[1].selection);
  let first,second;
  await t.test('source sends reject absent consent, revoked authority and suppressed destinations before commit',()=>{
    assert.throws(()=>rpc(doctor,'growth.directoryInvite',{...one,consentConfirmed:false}),/consent_required/);
    assert.throws(()=>rpc(doctor,'growth.directoryInvite',{...one,contactConsentConfirmed:false}),/consent_required/);
    sql(`update public.organisation_memberships set active=false where user_id='${doctor}' and organisation_id='${organisationId}'`);
    assert.throws(()=>rpc(doctor,'growth.directoryInvite',one),/denied/);
    sql(`update public.organisation_memberships set active=true where user_id='${doctor}' and organisation_id='${organisationId}';update private.inviter_identities set active=false where user_id='${doctor}' and organisation_id='${organisationId}'`);
    assert.throws(()=>rpc(doctor,'growth.directoryInvite',one),/reviewed_identity_required/);
    sql(`update private.inviter_identities set active=true where user_id='${doctor}' and organisation_id='${organisationId}';insert into private.email_suppressions(email,reason) values('shared@example.test','complaint')`);
    assert.throws(()=>rpc(doctor,'growth.directoryInvite',one),/recipient_changed/);
    sql("delete from private.email_suppressions where email='shared@example.test'");
    assert.equal(sql(`select count(*) from public.referrals where id='${one.id}'`),'0');
  });
  await t.test('source-bound sends resolve the public mailbox, replay once and separate shared-inbox identities',()=>{
    const before=Number(sql('select count(*) from private.email_jobs'));
    first=rpc(doctor,'growth.directoryInvite',{...one,recipientEmail:'attacker@example.test',recipientName:'Forged'});
    assert.equal(first.recipientName,'Directory test 1');assert.equal(first.recipientEmail,'shared@example.test');
    assert.equal(rpc(doctor,'growth.directoryInvite',{...one,recipientEmail:'attacker@example.test',recipientName:'Forged',tokenHash:'f'.repeat(64)}).invitationId,first.invitationId);
    assert.equal(Number(sql('select count(*) from private.email_jobs')),before+1);
    second=rpc(doctor,'growth.directoryInvite',two);assert.notEqual(second.invitationId,first.invitationId);
    assert.equal(Number(sql('select count(*) from private.email_jobs')),before+2);
    assert.throws(()=>rpc(doctor,'growth.invite',{...make(options[1].selection),recipientEmail:'shared@example.test',recipientName:'Unbound legacy person'}),/directory_selection_required/);
    assert.throws(()=>rpc(doctor,'growth.directoryInvite',{...one,selection:two.selection}),/conflict/);
    assert.throws(()=>rpc(wrong,'growth.directoryInvite',make(one.selection)),/denied/);
  });
  await t.test('forwarded links and shared mailboxes do not bypass intended identity review',()=>{
    for(const result of [first,second]){
      const tokenHash=sql(`select token_hash from private.invitation_secrets where invitation_id='${result.invitationId}'`);
      const attempt=rpc(null,'invitation.begin',{tokenHash,termsVersion:'v1',privacyVersion:'v1',consentAccepted:true,requestId:next()});
      rpc(null,'invitation.attach_auth',{attemptId:attempt.attemptId,authLeaseId:attempt.authLeaseId,authUserId:owner,tokenType:'magiclink',envelope:{test:'encrypted'}});
      assert.throws(()=>rpc(wrong,'invitation.claim',{invitationId:result.invitationId,attemptId:attempt.attemptId,displayName:'Wrong',requestId:next()}),/denied/);
      rpc(owner,'invitation.claim',{invitationId:result.invitationId,attemptId:attempt.attemptId,displayName:'Directory test 1',requestId:next()});
    }
    rpc(null,'growth.sweep',{});
    for(const result of [first,second]){
      assert.equal(rpc(doctor,'growth.status',{referralId:result.referralId}).status,'awaiting_review');
      assert.throws(()=>rpc(owner,'referral.contact.read',{referralId:result.referralId}),/denied/);
    }
    const application=sql(`select application_id from private.professional_credentials where practitioner_id='${practitioner}'`);
    const candidate=options[0].selection.candidateId;
    let version=Number(sql(`select version from private.practitioner_candidates where id='${candidate}'`));
    const disposed=rpc(reviewer,'candidate.dispose',{candidateId:candidate,expectedVersion:version,requestId:next(),disposition:'reviewed_for_onboarding',reason:'Fictional review',evidenceReference:'Fictional independent identity evidence'});
    rpc(reviewer,'candidate.linkApplication',{candidateId:candidate,applicationId:application,expectedVersion:disposed.version,requestId:next(),reason:'Fictional intended person confirmed',evidenceReference:'Fictional identity and practice evidence'});
    rpc(null,'growth.sweep',{});rpc(null,'growth.sweep',{});
    assert.equal(rpc(doctor,'growth.status',{referralId:first.referralId}).status,'released');
    assert.equal(rpc(doctor,'growth.status',{referralId:second.referralId}).status,'awaiting_review');
    assert.equal(rpc(owner,'referral.contact.read',{referralId:first.referralId}).initials,'FX');
    assert.throws(()=>rpc(owner,'referral.contact.read',{referralId:second.referralId}),/denied/);
    assert.equal(sql(`select count(*) from public.referral_events where referral_id='${first.referralId}' and event_type='sent'`),'1');
  });
  await t.test('finalisation rechecks known capability contradictions and legacy invitation scope',()=>{
    for(const change of [{fundingPath:'medicare'},{preferredLanguage:'vietnamese'},{appointmentFormat:'telehealth'}]){
      const input=make(options[1].selection);
      const draft=JSON.parse(sql(`select input from public.referral_drafts where id='${input.id}'`));
      rpc(doctor,'draft.save',{id:input.id,organisationId,expectedVersion:0,requestId:next(),input:{...draft,...change}});
      assert.throws(()=>rpc(doctor,'growth.directoryInvite',{...input,expectedVersion:1}),/recipient_changed/);
    }
  });
  await t.test('directory referrals keep cancellation, expiry, decline and reconfirmation gates',()=>{
    for(const action of ['cancel','decline','expiry','consent']){
      const sent=rpc(doctor,'growth.directoryInvite',make(options[1].selection));
      if(action==='cancel')rpc(doctor,'referral.transition',{referralId:sent.referralId,expectedVersion:0,action:'cancel',reasonCode:'no_longer_required',requestId:next()});
      if(action==='decline')rpc(null,'invitation.decline',{tokenHash:sql(`select token_hash from private.invitation_secrets where invitation_id='${sent.invitationId}'`),requestId:next()});
      if(action==='expiry')sql(`update public.workspace_invitations set expires_at=now()-interval '1 minute' where id='${sent.invitationId}'`);
      if(action==='consent')sql(`update private.referral_invitations set consent_confirmed_at=now()-interval '8 days',consent_valid_until=now()-interval '1 minute' where referral_id='${sent.referralId}'`);
      rpc(null,'growth.sweep',{});
      const state=rpc(doctor,'growth.status',{referralId:sent.referralId});
      assert.equal(state.status,action==='cancel'?'cancelled':'needs_reconfirmation');
      assert.equal(sql(`select selected_practitioner_id is null from public.referrals where id='${sent.referralId}'`),'t');
      if(action==='consent'){
        rpc(doctor,'growth.reconfirm',{referralId:sent.referralId,expectedVersion:state.version,requestId:next(),consentConfirmed:true});
        assert.equal(rpc(doctor,'growth.status',{referralId:sent.referralId}).status,'awaiting_signup');
      }
      sql(`delete from private.email_suppressions where email='shared@example.test' and reason='declined_invitation'`);
    }
  });
  await t.test('stale directory observations cannot finalise a new referral',()=>{
    const changed=prepareCandidateBatch([{label:'directory-flow-changed',bytes:Buffer.from(JSON.stringify([{...records[1],display_name:'Directory changed identity'}]))}]);
    sql(`set role service_role;select public.rw_import_candidate_batch('${reviewer}',${j(changed.manifest)},${j(changed.records)});`);
    assert.throws(()=>rpc(doctor,'growth.directoryInvite',make(options[1].selection)),/recipient_changed/);
    const missing=make({...options[0].selection,routeId:id(999999)});
    assert.throws(()=>rpc(doctor,'growth.directoryInvite',missing),/recipient_changed/);
  });
}
