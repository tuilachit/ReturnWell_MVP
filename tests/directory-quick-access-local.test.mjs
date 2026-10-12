import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {localRuntime} from './helpers/local-runtime.mjs';
import {enrollFixtureMfa} from './helpers/mfa.mjs';
import {prepareCandidateBatch} from '../scripts/candidates/normalise.mjs';
import {legacyCandidate} from './fixtures/candidate-records.mjs';

// Reviewed directory record + exact mailbox code => one referral, no review.
// Shared mailboxes, other accounts and withdrawn sources stay denied.
test('reviewed directory referral opens to the verified mailbox by emailed code, for that referral only',
  {skip:process.env.RW_LOCAL_JOURNEY!=='1',timeout:120000},async()=>{
    const local=localRuntime(),suffix=randomUUID().slice(0,8),org=randomUUID();
    const reviewer=await local.verifiedFixtureUser(`quick-review-${suffix}@example.test`);
    const doctor=await local.verifiedFixtureUser(`quick-doctor-${suffix}@example.test`);
    const outsider=await local.verifiedFixtureUser(`quick-other-${suffix}@example.test`);
    await enrollFixtureMfa(reviewer.client);
    local.sql(`insert into private.platform_operators(user_id) values('${reviewer.userId}');
      insert into public.organisations(id,name,notification_email) values('${org}','Fictional Quick Practice','quick-practice-${suffix}@example.test');
      insert into public.organisation_memberships(organisation_id,user_id,role) values('${org}','${doctor.userId}','referrer');
      insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values('${doctor.userId}','${org}','Dr Fictional Quick','Fictional Quick Practice','${reviewer.userId}');
      update private.profession_policies set enabled=true,review_interval_days=7,identifier_pattern='^[A-Z0-9-]{3,80}$',approved_by='${reviewer.userId}',approved_at=now(),evidence_reference='Fictional directory policy' where profession_id='physiotherapist';`);
    const call=async(endpoint,input,client)=>{
      const result=await local.call(endpoint,input,client);
      assert.equal(result.status,200,`${endpoint}: HTTP ${result.status} ${result.body?.code}`);
      return result.body;
    };
    const unique=`quick-unique-${suffix}@example.test`,shared=`quick-shared-${suffix}@example.test`;
    const records=[[1,unique],[2,shared],[3,shared]].map(([n,mail])=>legacyCandidate({candidate_id:`quick-${suffix}-${n}`,display_name:`Fictional Quick ${suffix} ${n}`,practice_names:[`Fictional Quick Clinic ${n}`],business_emails:[mail]}));
    const prepared=prepareCandidateBatch([{label:`quick-${suffix}`,bytes:Buffer.from(JSON.stringify(records))}]);
    assert.equal((await local.admin.rpc('rw_import_candidate_batch',{p_actor:reviewer.userId,p_manifest:prepared.manifest,p_records:prepared.records})).error,null);
    const page=await call('search-practitioners',{operation:'recipients',query:suffix,distanceGroup:'unknown',needs:{professionId:'physiotherapist',fundingId:'self_funded',appointmentFormat:'either',requiredServiceIds:[]}},doctor.client);
    const contacts=page.items.filter(x=>x.kind==='directory').sort((a,b)=>a.displayName.localeCompare(b.displayName));
    assert.equal(contacts.length,3);
    for(const contact of contacts){
      const candidate=contact.selection.candidateId;
      const version=Number(local.sql(`select version from private.practitioner_candidates where id='${candidate}'`));
      await call('review-practitioner',{operation:'candidate_dispose',candidateId:candidate,expectedVersion:version,requestId:randomUUID(),disposition:'reviewed_for_onboarding',reason:'Fictional review',evidenceReference:'Fictional reviewed directory record'},reviewer.client);
    }
    const send=async selected=>{
      const draft=await call('manage-referral',{operation:'draft.save',id:randomUUID(),organisationId:org,expectedVersion:-1,requestId:randomUUID(),input:{patientReference:'Fictional private reference',patientPostcode:'2000',profession:'physiotherapist',clinicalSummary:'Fictional confidential summary',fundingPath:'self_funded',appointmentFormat:'either',patientContact:{initials:'FX',preferredMethod:'phone',phone:'0412345678',email:''}}},doctor.client);
      return call('manage-referral',{operation:'draft.directoryInvite',id:draft.id,expectedVersion:draft.version,requestId:randomUUID(),selection:selected.selection,contactBasis:'documented_permission',contactConsentConfirmed:true,consentConfirmed:true},doctor.client);
    };

    // Unique, reviewed mailbox: the page offers the code flow.
    const sent=await send(contacts[0]);
    const token=await local.invitationToken(sent.invitationId);
    const inspection=await call('invitation-entry',{operation:'inspect',token});
    assert.equal(inspection.intendedIdentity.quickAccess,true);
    assert.equal(inspection.intendedIdentity.referralId,sent.referralId);
    assert.doesNotMatch(JSON.stringify(inspection),new RegExp(unique));
    const begun=await call('invitation-entry',{operation:'beginSignup',token,termsVersion:local.env.TERMS_VERSION,privacyVersion:local.env.PRIVACY_VERSION,consentAccepted:true,requestId:randomUUID()});
    assert.equal(begun.verification.email,unique);
    assert.equal(begun.verification.invitationId,sent.invitationId);
    const message=await local.verificationMessage(sent.invitationId);
    assert.equal(message.attemptId,begun.verification.attemptId);
    const code=message.email.text.match(/^Your code: ([0-9]{6,10})$/m)?.[1];
    assert.ok(code,'verification email shows a typed code');
    assert.match(message.email.subject,new RegExp(`^${code} is your ReturnWell code$`));
    assert.doesNotMatch(message.email.text,/0412345678|confidential summary|private reference/);
    // A wrong code never creates a session.
    await assert.rejects(local.verifyCode(unique,code==='000000'?'111111':'000000',begun.verification.type));
    const recipient=await local.verifyCode(unique,code,begun.verification.type);
    const claim={invitationId:sent.invitationId,attemptId:begun.verification.attemptId,displayName:contacts[0].displayName,requestId:randomUUID()};
    assert.equal((await local.call('claim-invitation',claim,outsider.client)).status,403);
    await call('claim-invitation',claim,recipient.client);

    // Released to that account only, without a member profile or review.
    const status=await call('manage-referral',{operation:'onboarding.status',referralId:sent.referralId},doctor.client);
    assert.equal(status.status,'released');
    assert.equal(status.reason,'directory_mailbox');
    assert.equal(local.sql(`select count(*) from public.practitioner_users where user_id='${recipient.userId}'`),'0');
    assert.equal(local.sql(`select selected_practitioner_id is null and directory_recipient_user_id='${recipient.userId}' from public.referrals where id='${sent.referralId}'`),'t');
    const access=await call('workspace-access',{},recipient.client);
    assert.deepEqual(access.directoryReferrals.map(x=>[x.referralId,x.invitationId]),[[sent.referralId,sent.invitationId]]);
    const detail=await call('manage-referral',{operation:'recipient.detail',referralId:sent.referralId},recipient.client);
    assert.equal(detail.clinicalSummary,'Fictional confidential summary');
    assert.equal(detail.referringPractice,'Fictional Quick Practice');
    assert.equal((await call('manage-referral',{operation:'contact.read',referralId:sent.referralId},recipient.client)).initials,'FX');
    for(const operation of ['recipient.detail','contact.read'])
      assert.equal((await local.call('manage-referral',{operation,referralId:sent.referralId},outsider.client)).status,403);
    assert.equal((await recipient.client.from('referrals').select('id').eq('id',sent.referralId)).data.length,0);
    assert.equal(local.sql(`select count(*) from private.email_jobs where related_id='${sent.referralId}' and family='referral' and recipient_email='${unique}'`),'1');

    // Accept: one decision, replay-safe, other accounts denied, doctor notified.
    const respond={referralId:sent.referralId,expectedVersion:detail.version,decision:'accepted',requestId:randomUUID()};
    assert.equal((await local.call('respond-to-referral',{...respond,requestId:randomUUID()},outsider.client)).status,403);
    const accepted=await call('respond-to-referral',respond,recipient.client);
    assert.equal(accepted.status,'accepted');
    assert.deepEqual(await call('respond-to-referral',respond,recipient.client),accepted);
    assert.equal((await doctor.client.from('referrals').select('status').eq('id',sent.referralId).single()).data.status,'accepted');
    assert.equal(local.sql(`select count(*) from public.referral_events where referral_id='${sent.referralId}' and event_type='accepted' and actor_user_id='${recipient.userId}'`),'1');
    assert.equal(local.sql(`select count(*) from public.notification_outbox where referral_id='${sent.referralId}' and kind='referral_accepted'`),'1');
    const listed=(await call('manage-referral',{operation:'list',organisationId:org,status:'all',limit:25},doctor.client)).items.find(x=>x.id===sent.referralId);
    assert.equal(listed.directory_recipient,true);
    assert.equal('directory_recipient_user_id' in listed,false);

    // Doctor cancels: the recipient is told by email and loses patient details.
    await call('manage-referral',{operation:'transition',referralId:sent.referralId,expectedVersion:accepted.version,action:'cancel',reasonCode:'no_longer_required',requestId:randomUUID()},doctor.client);
    assert.equal(local.sql(`select count(*) from public.notification_outbox where referral_id='${sent.referralId}' and kind='referral_cancelled' and recipient_email='${unique}'`),'1');
    const cancelled=await call('manage-referral',{operation:'recipient.detail',referralId:sent.referralId},recipient.client);
    assert.equal(cancelled.status,'cancelled');
    assert.equal(cancelled.clinicalSummary,undefined);
    assert.equal((await local.call('manage-referral',{operation:'contact.read',referralId:sent.referralId},recipient.client)).status,403);

    // Withdrawing the reviewed record removes access to its referrals.
    const second=await send(contacts[0]);
    const secondToken=await local.invitationToken(second.invitationId);
    const again=await call('invitation-entry',{operation:'beginSignup',token:secondToken,termsVersion:local.env.TERMS_VERSION,privacyVersion:local.env.PRIVACY_VERSION,consentAccepted:true,requestId:randomUUID()});
    const secondMessage=await local.verificationMessage(second.invitationId);
    const secondCode=secondMessage.email.text.match(/^Your code: ([0-9]{6,10})$/m)[1];
    const returning=await local.verifyCode(unique,secondCode,again.verification.type);
    assert.equal(returning.userId,recipient.userId);
    await call('claim-invitation',{invitationId:second.invitationId,attemptId:again.verification.attemptId,displayName:contacts[0].displayName,requestId:randomUUID()},returning.client);
    assert.equal((await call('manage-referral',{operation:'recipient.detail',referralId:second.referralId},returning.client)).status,'sent');
    const candidate=contacts[0].selection.candidateId;
    const version=Number(local.sql(`select version from private.practitioner_candidates where id='${candidate}'`));
    await call('review-practitioner',{operation:'candidate_dispose',candidateId:candidate,expectedVersion:version,requestId:randomUUID(),disposition:'needs_clarification',reason:'Fictional source question'},reviewer.client);
    for(const operation of ['recipient.detail','contact.read'])
      assert.equal((await local.call('manage-referral',{operation,referralId:second.referralId},returning.client)).status,403);
    assert.equal((await local.call('respond-to-referral',{referralId:second.referralId,expectedVersion:1,decision:'accepted',requestId:randomUUID()},returning.client)).status,403);

    // Shared mailbox: no quick access; independent review still required.
    const sharedSent=await send(contacts[1]);
    const sharedToken=await local.invitationToken(sharedSent.invitationId);
    const sharedInspection=await call('invitation-entry',{operation:'inspect',token:sharedToken});
    assert.equal(sharedInspection.intendedIdentity.quickAccess,undefined);
    const sharedBegun=await call('invitation-entry',{operation:'beginSignup',token:sharedToken,termsVersion:local.env.TERMS_VERSION,privacyVersion:local.env.PRIVACY_VERSION,consentAccepted:true,requestId:randomUUID()});
    const sharedMessage=await local.verificationMessage(sharedSent.invitationId);
    const sharedCode=sharedMessage.email.text.match(/^Your code: ([0-9]{6,10})$/m)[1];
    const sharedRecipient=await local.verifyCode(shared,sharedCode,sharedBegun.verification.type);
    await call('claim-invitation',{invitationId:sharedSent.invitationId,attemptId:sharedBegun.verification.attemptId,displayName:contacts[1].displayName,requestId:randomUUID()},sharedRecipient.client);
    const held=await call('manage-referral',{operation:'onboarding.status',referralId:sharedSent.referralId},doctor.client);
    assert.equal(held.status,'awaiting_review');
    assert.equal(held.reason,'directory_identity_review');
    for(const operation of ['recipient.detail','contact.read'])
      assert.equal((await local.call('manage-referral',{operation,referralId:sharedSent.referralId},sharedRecipient.client)).status,403);
  });
