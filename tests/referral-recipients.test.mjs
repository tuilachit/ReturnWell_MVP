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
