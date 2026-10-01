// Fictional records in a disposable database only. No network/provider access.
export function directoryScaleFixtureSql({
  ownerId,
  reviewerId,
  tag = "SYNTHETIC-SCALE",
  count = 5000,
}) {
  if (
    ![ownerId, reviewerId].every((id) => /^[0-9a-f-]{36}$/.test(id)) ||
    ownerId === reviewerId ||
    !/^[A-Z0-9-]{1,44}$/.test(tag) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 5000
  )
    throw Error("Invalid scale fixture");
  return `
 create temp table scale_seed as select n,gen_random_uuid() practitioner,gen_random_uuid() application,gen_random_uuid() credential from generate_series(1,${count}) n;
 insert into public.practitioners(id,display_name,profession,practice_name,contact_email,lifecycle_status,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages,service_ids,age_group_ids)
 select practitioner,'Fictional Duplicate '||lpad((n%100)::text,3,'0'),'physiotherapist','${tag}','fixture@example.test','active','confirmed',now(),true,true,array['Fictional service'],array['medicare'],array['english'],array['persistent_pain'],array['adult'] from scale_seed;
 insert into public.practitioner_locations(practitioner_id,suburb,postcode,state,is_primary) select practitioner,'Fictional Suburb','2000','NSW',true from scale_seed where n%2=0;
 insert into public.practitioner_users(practitioner_id,user_id) select practitioner,'${ownerId}' from scale_seed;
 insert into public.practitioner_applications(id,user_id,status,practitioner_id,revision_practitioner_id,terms_version,privacy_version)
 select application,'${ownerId}','approved',practitioner,practitioner,'fictional-only','fictional-only' from scale_seed;
 insert into private.professional_credentials(id,practitioner_id,owner_user_id,authority_id,identifier_normalized,route,status,checked_at,review_due_at,reviewed_by,application_id,identity_evidence,registration_evidence)
 select credential,practitioner,'${ownerId}','ahpra_physiotherapy','${tag}'||practitioner::text,'ahpra','verified',now(),now()+interval '7 days','${reviewerId}',application,'{"testOnly":true}','{"testOnly":true}' from scale_seed;
 insert into private.practitioner_professions(practitioner_id,profession_id,credential_id) select practitioner,'physiotherapist',credential from scale_seed;
 drop table scale_seed;
 -- Bulk fixtures need representative statistics before measuring plans.
 analyze public.practitioners; analyze public.practitioner_locations;
 analyze public.practitioner_users; analyze auth.users;
 analyze private.practitioner_professions; analyze private.professional_credentials;
 analyze private.profession_policies;
 `;
}
