import assert from 'node:assert/strict';
import test from 'node:test';

test('recipient search uses the recipient operation, bounded pages and unchanged needs',async()=>{
  const {searchReferralRecipients}=await import('../app/lib/referral-recipients.ts');
  let sent;
  const expected={items:[],counts:{confirmed:0,needsConfirmation:0},nextCursor:null};
  const client={functions:{invoke:async(name,{body})=>{sent={name,body};return {data:expected,error:null};}}};
  const needs={professionId:'physiotherapist',fundingId:'medicare',appointmentFormat:'either',requiredServiceIds:[]};
  assert.deepEqual(await searchReferralRecipients(client,{needs,distanceGroup:'unknown',limit:100}),expected);
  assert.equal(sent.name,'search-practitioners');assert.equal(sent.body.operation,'recipients');
  assert.equal(sent.body.limit,50);assert.deepEqual(sent.body.needs,needs);
});
test('directory send uses source-bound selection and never a client mailbox',async()=>{
  const {sendDirectoryReferral}=await import('../app/lib/referral-growth.ts');
  assert.equal(typeof sendDirectoryReferral,'function');
  let sent;
  const client={functions:{invoke:async(name,{body})=>{sent={name,body};return {data:{referralId:'fixture'},error:null};}}};
  const selection={candidateId:'candidate',routeId:'route',observationHash:'a'.repeat(64)};
  const response=await sendDirectoryReferral(client,{id:'draft',expectedVersion:0,requestId:'request',selection,consentConfirmed:true,contactConsentConfirmed:true,contactBasis:'documented_permission'});
  assert.equal(response.referralId,'fixture');assert.equal(sent.body.operation,'draft.directoryInvite');
  assert.deepEqual(sent.body.selection,selection);assert.equal('recipientEmail' in sent.body,false);
});
