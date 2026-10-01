import { randomUUID } from "node:crypto";
// Test-only synthetic evidence; never a production migration or private import.
export function credentialFixtureSql({
  practitionerId,
  ownerId,
  reviewerId,
  organisationId,
}) {
  for (const id of [practitionerId, ownerId, reviewerId, organisationId])
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Error("Invalid fixture UUID");
  if (ownerId === reviewerId) throw Error("Fixture review must be independent");
  const invitation = randomUUID(),
    application = randomUUID(),
    credential = randomUUID();
  return `
  update private.profession_policies set enabled=true,review_interval_days=7,identifier_pattern='^[A-Z0-9-]{3,80}$',approved_by='${reviewerId}',approved_at=now(),evidence_reference='Fictional local test policy' where profession_id='physiotherapist';
  insert into public.workspace_invitations(id,kind,organisation_id,invited_by,inviter_name,practice_name,recipient_name,recipient_email,recipient_email_normalized,consent_recorded_at,status,claimed_by) values('${invitation}','practitioner','${organisationId}','${reviewerId}','Fictional Reviewer','Fictional Practice','Fictional Receiver','${ownerId}@example.test','${ownerId}@example.test',now(),'claimed','${ownerId}');
  insert into public.practitioner_applications(id,invitation_id,user_id,status,practitioner_id,terms_version,privacy_version) values('${application}','${invitation}','${ownerId}','approved','${practitionerId}','test-v1','test-v1');
  update public.practitioner_applications set profile=(select jsonb_build_object('displayName',display_name,'profession',profession,'registrationNumber',ahpra_registration_number,'practiceName',practice_name,'telehealth',telehealth,'acceptingNewReferrals',accepting_new_referrals,'services',services,'funding',funding,'languages',languages,'locations','[]'::jsonb) from public.practitioners where id='${practitionerId}') where id='${application}';
  insert into private.professional_credentials(id,practitioner_id,owner_user_id,authority_id,identifier_normalized,route,status,checked_at,review_due_at,reviewed_by,application_id,identity_evidence,registration_evidence) values('${credential}','${practitionerId}','${ownerId}','ahpra_physiotherapy','FIXTURE${practitionerId}','ahpra','verified',now(),now()+interval '7 days','${reviewerId}','${application}','{"testOnly":true}','{"testOnly":true}');
  insert into private.practitioner_professions(practitioner_id,profession_id,credential_id) values('${practitionerId}','physiotherapist','${credential}');
  insert into public.practitioner_users(practitioner_id,user_id) values('${practitionerId}','${ownerId}') on conflict do nothing;
  `;
}
