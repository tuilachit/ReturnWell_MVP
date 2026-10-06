import assert from 'node:assert/strict';
import test from 'node:test';
import {validateDraft} from '../app/lib/referral-drafts.ts';

test('partial contacts survive draft validation without a required final contact',async()=>{
  const {validatePatientContact}=await import('../app/lib/patient-contact.ts');
  assert.deepEqual(validatePatientContact({},false),[]);
  assert.deepEqual(validatePatientContact({initials:'JL',preferredMethod:'phone',phone:'0412'},false),[]);
  assert.deepEqual(validatePatientContact({initials:'JL',preferredMethod:'email',email:'person@'},false),[]);
  assert.deepEqual(validateDraft({patientContact:{initials:'JL',preferredMethod:'phone',phone:'',email:''}}),[]);
});
test('final contacts require bounded initials and only the selected usable method',async()=>{
  const {validatePatientContact}=await import('../app/lib/patient-contact.ts');
  const phone={initials:'JL',preferredMethod:'phone',phone:'+61 412 345 678',email:''};
  assert.deepEqual(validatePatientContact(phone,true),[]);
  assert.deepEqual(validatePatientContact({initials:'ĐN',preferredMethod:'email',email:'patient@example.test',phone:''},true),[]);
  for(const change of [{initials:''},{initials:'1JL'},{initials:'J\nL'},{initials:'J'.repeat(17)},{phone:'123'},{phone:'call 0412345678'},{preferredMethod:'fax'},{phone:'1'.repeat(16)}])
    assert.ok(validatePatientContact({...phone,...change},true).length>0,JSON.stringify(change));
  assert.ok(validatePatientContact({initials:'JL',preferredMethod:'email',email:'bad',phone:''},true).length>0);
});
