import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {randomUUID} from 'node:crypto';
import {doctorBrowser,selectFixturePractitioner} from '../helpers/browser-context.mjs';
import {prepareCandidateBatch} from '../../scripts/candidates/normalise.mjs';
import {legacyCandidate} from '../fixtures/candidate-records.mjs';

async function directoryFixture(page,options={}) {
  const f=await doctorBrowser(page,options),suffix=randomUUID().slice(0,8);
  f.local.sql(`insert into private.platform_operators(user_id) values('${f.owner.userId}');
    insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values('${f.doctor.userId}','${f.organisationId}','Dr Fictional Reviewed','Fictional Draft Practice','${f.owner.userId}');`);
  const clinic=`Fictional Directory Clinic ${suffix}`;
  const batch=prepareCandidateBatch([{label:`browser-directory-${suffix}`,bytes:Buffer.from(JSON.stringify([legacyCandidate({candidate_id:suffix,display_name:`Fictional Directory Receiver ${suffix}`,practice_names:[clinic],business_emails:[`directory-${suffix}@example.test`]})]))}]);
  const imported=await f.local.admin.rpc('rw_import_candidate_batch',{p_actor:f.owner.userId,p_manifest:batch.manifest,p_records:batch.records});
  expect(imported.error).toBeNull();
  return {...f,directoryClinic:clinic};
}
async function fillReferral(page) {
  await page.goto('/');
  await page.getByRole('button',{name:'New referral',exact:true}).click();
  await page.getByPlaceholder('e.g. Practice record ID').fill('FICTIONAL-DIRECTORY');
  await page.getByPlaceholder('e.g. 2000').fill('2000');
  await page.getByPlaceholder('Describe the need, goals and relevant context…').fill('Fictional private summary');
  await page.getByLabel('Patient initials', {exact:true}).fill('FX');
  await page.getByLabel('Patient phone', {exact:true}).fill('0412345678');
  await page.getByRole('button',{name:'Find practitioners'}).click();
}
async function consent(page) {
  await page.getByLabel('Permission to contact',{exact:true}).selectOption('documented_permission');
  await page.getByRole('checkbox',{name:'I have permission to send this referral notification.',exact:true}).check();
  await page.getByRole('checkbox',{name:'I confirm the patient has consented and the information is accurate.',exact:true}).check();
}

test('directory option uses one inline send and recovers its committed invitation after a lost response',async({page})=>{
  test.skip(!process.env.RW_LOCAL_STACK_DIR,'Requires isolated local Auth.');
  await page.setViewportSize({width:375,height:900});
  const f=await directoryFixture(page,{dropInvitationResponseOnce:true});
  await fillReferral(page);
  await expect(page.getByRole('button',{name:'Invite a practitioner',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Recipient work email',{exact:true})).toHaveCount(0);
  await selectFixturePractitioner(page,f.directoryClinic);
  await expect(page.getByRole('radio',{name:new RegExp(f.directoryClinic)}).locator('..')).toContainText('Needs confirmation');
  await page.getByRole('button',{name:'Review referral'}).click();
  await consent(page);
  await page.getByRole('button',{name:'Send referral',exact:true}).dblclick();
  await expect(page.getByRole('alert')).toContainText(/could not (be )?confirm/);
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  await page.getByRole('button',{name:'Check and retry',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Referral recorded',level:1})).toBeVisible();
  expect(f.local.sql(`select count(*) from public.referrals where created_by='${f.doctor.userId}'`)).toBe('1');
  expect(f.local.sql(`select count(*) from private.email_jobs j join public.workspace_invitations i on i.id=j.related_id where i.invited_by='${f.doctor.userId}' and j.family='invitation'`)).toBe('1');
  expect(f.local.sql(`select count(*) from public.notification_outbox o join public.referrals r on r.id=o.referral_id where r.created_by='${f.doctor.userId}'`)).toBe('0');
  await expect(page.getByText(/needs delivery configuration|configuration needed/i).first()).toBeVisible();
  await page.getByRole('button',{name:'View referral',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Patient contact',exact:true})).toBeVisible();
  await expect(page.getByText('0412345678',{exact:true})).toBeVisible();
  await expect(page.getByText('Waiting for recipient signup',{exact:true})).toBeVisible();
  const results=await new AxeBuilder({page}).analyze();
  expect(results.violations.filter(v=>['critical','serious'].includes(v.impact??''))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('editing contact details requires a new recipient selection and consent',async({page})=>{
  test.skip(!process.env.RW_LOCAL_STACK_DIR,'Requires isolated local Auth.');
  const f=await directoryFixture(page);
  await fillReferral(page);
  await selectFixturePractitioner(page,f.directoryClinic);
  await page.getByRole('button',{name:'Review referral'}).click();
  await consent(page);
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Edit referral need',exact:true}).click();
  await page.getByLabel('Preferred contact method',{exact:true}).selectOption('email');
  await expect(page.getByLabel('Patient phone',{exact:true})).toHaveCount(0);
  await page.getByLabel('Patient email',{exact:true}).fill('fictional-patient@example.test');
  await page.getByRole('button',{name:'Find practitioners'}).click();
  await expect(page.getByRole('radio',{checked:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Review referral'})).toBeDisabled();
  await selectFixturePractitioner(page,f.directoryClinic);
  await page.getByRole('button',{name:'Review referral'}).click();
  await expect(page.getByRole('button',{name:'Send referral',exact:true})).toBeDisabled();
  await expect(page.getByRole('checkbox',{checked:true})).toHaveCount(0);
});

test('withdrawn source requires reselection rather than substituting a recipient',async({page})=>{
  test.skip(!process.env.RW_LOCAL_STACK_DIR,'Requires isolated local Auth.');
  const f=await directoryFixture(page);
  await fillReferral(page);
  await selectFixturePractitioner(page,f.directoryClinic);
  await page.getByRole('button',{name:'Review referral'}).click();
  await consent(page);
  f.local.sql(`update private.directory_contact_routes set active=false where practice_key=lower('${f.directoryClinic}');`);
  await page.getByRole('button',{name:'Send referral',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  await expect(page.getByRole('button',{name:'Review referral',exact:true})).toBeDisabled();
  expect(f.local.sql(`select count(*) from public.referrals where created_by='${f.doctor.userId}'`)).toBe('0');
});

test('operator authority does not add administration to customer choices',async({page})=>{
  test.skip(!process.env.RW_LOCAL_STACK_DIR,'Requires isolated local Auth.');
  const f=await doctorBrowser(page);
  f.local.sql(`insert into private.platform_operators(user_id) values('${f.doctor.userId}');
    insert into public.practitioner_applications(id,user_id,status,revision_practitioner_id,terms_version,privacy_version) values('${randomUUID()}','${f.doctor.userId}','draft','${f.practitionerId}','${f.local.env.TERMS_VERSION}','${f.local.env.PRIVACY_VERSION}');`);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Choose your workspace',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'ReturnWell administration',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Practice —/})).toBeVisible();
  await expect(page.getByRole('button',{name:'My practitioner application',exact:true})).toBeVisible();
});
