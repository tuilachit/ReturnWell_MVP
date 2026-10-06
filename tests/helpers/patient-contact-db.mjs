import assert from 'node:assert/strict';
export async function patientContactChecks(t,{sql,rpc,id,organisationId=id(1)}){
  const doctor=id(2),reviewer=id(800001),recipient=id(800002),referral=id(940001);
  const contact={initials:'JL',preferredMethod:'phone',phone:'+61 412 345 678',email:'unused@example.test'};
  const input={patientReference:'Fictional contact case',patientPostcode:'2000',profession:'physiotherapist',clinicalSummary:'Fictional reason',fundingPath:'self_funded',appointmentFormat:'in_person',patientContact:contact};
  sql(`insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values('${doctor}','${organisationId}','Fictional Doctor','Fictional Practice','${reviewer}') on conflict do nothing;`);
  let pending;
  await t.test('patient contacts survive partial drafts and finalise privately with the invitation',()=>{
    const draft=rpc(doctor,'draft.save',{id:referral,organisationId,expectedVersion:-1,requestId:id(940002),input});
    assert.equal(draft.input.patientContact.initials,'JL');
    assert.equal(rpc(doctor,'draft.load',{id:referral}).input.patientContact.phone,contact.phone);
    pending=rpc(doctor,'growth.invite',{id:referral,expectedVersion:0,requestId:id(940003),consentConfirmed:true,contactConsentConfirmed:true,
      contactBasis:'recipient_requested',recipientName:'Fictional Receiver',recipientEmail:'outsider@example.test',tokenHash:'a'.repeat(64),envelope:{test:'sealed'},keyId:'test'});
    assert.deepEqual(rpc(doctor,'referral.contact.read',{referralId:referral}),{...contact,phone:'+61412345678',email:''});
    for(const actor of [recipient,reviewer,null])assert.throws(()=>rpc(actor,'referral.contact.read',{referralId:referral}),/denied/);
    for(const role of ['anon','authenticated'])assert.throws(()=>sql(`set role ${role};select * from private.referral_patient_contacts`),/permission denied/);
    assert.equal(JSON.stringify(pending).includes('JL'),false);assert.equal(JSON.stringify(pending).includes('412345678'),false);
    assert.equal(sql("select count(*) from private.email_jobs where payload::text like '%412345678%'"),'0');
  });
  await t.test('contact changes invalidate the consent snapshot and bad chosen contacts cannot finalise',()=>{
    sql(`update private.referral_patient_contacts set contact=jsonb_set(contact,'{phone}','"+61412345679"') where referral_id='${referral}';`);
    assert.equal(rpc(doctor,'growth.status',{referralId:referral}).status,'needs_reconfirmation');
    assert.throws(()=>sql(`select private.validate_patient_contact('{"initials":"JL","preferredMethod":"phone","phone":"123","email":""}',true)`),/invalid_patient_contact/);
    assert.deepEqual(JSON.parse(sql(`select private.validate_patient_contact('{}',false)`)),{});
    assert.deepEqual(JSON.parse(sql(`select private.validate_patient_contact('{"initials":"JL","preferredMethod":"phone","phone":"0412"}',false)`)),{initials:'JL',preferredMethod:'phone',phone:'0412'});
  });
}
