import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { localRuntime } from "./local-runtime.mjs";
import { createReferral } from "../../app/lib/referrals.ts";

const local = localRuntime();
const suffix = randomUUID().slice(0, 8);
const users = {};
for (const role of ["doctor", "practitioner", "operator", "applicant"]) {
  const email = `browser-${role}-${suffix}@example.test`;
  users[role] = { ...(await local.verifiedFixtureUser(email)), email };
}
const org = randomUUID();
const practitionerId = randomUUID();
const literal = local.uuidSql;
local.sql(`insert into public.organisations(id,name,notification_email) values (${literal(org)},'Fictional Browser Practice','browser-practice-${suffix}@example.test');
  insert into private.platform_operators(user_id) values (${literal(users.operator.userId)});
  insert into public.organisation_memberships(organisation_id,user_id,role) values (${literal(org)},${literal(users.doctor.userId)},'referrer');
  insert into public.profiles(id,display_name) values (${literal(users.doctor.userId)},'Dr Browser Fictional') on conflict(id) do update set display_name=excluded.display_name;
  insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values
  (${literal(users.operator.userId)},${literal(org)},'Browser Operator','Fictional Browser Practice',${literal(users.operator.userId)}),
  (${literal(users.operator.userId)},null,'Browser Operator','ReturnWell Test Administration',${literal(users.operator.userId)}),
  (${literal(users.doctor.userId)},${literal(org)},'Dr Browser Fictional','Fictional Browser Practice',${literal(users.operator.userId)});
  insert into public.practitioners(id,display_name,profession,practice_name,contact_email,lifecycle_status,ahpra_registration_number,ahpra_verification_status,ahpra_verified_at,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages) values
  (${literal(practitionerId)},'Browser Practitioner','physiotherapist','Fictional Browser Movement','${users.practitioner.email}','active','BROWSER${suffix}','verified',now(),'confirmed',now(),true,false,array['Physiotherapy'],array['Private'],array['English']);
  insert into public.practitioner_locations(practitioner_id,suburb,postcode,state,is_primary) values (${literal(practitionerId)},'Sydney','2000','NSW',true);
  insert into public.practitioner_users(practitioner_id,user_id) values (${literal(practitionerId)},${literal(users.practitioner.userId)});`);
const invitationResponse = await local.call("manage-invitations", { operation: "create", kind: "practitioner", organisationId: org, recipientName: "Browser Applicant", recipientEmail: users.applicant.email, consentConfirmed: true, requestId: randomUUID() }, users.operator.client);
if (invitationResponse.status !== 200) throw new Error(`Local fixture invitation failed (${invitationResponse.status}).`);
const profile = { displayName: "Browser Applicant", profession: "physiotherapist", registrationNumber: `BAPP${suffix}`, practiceName: "Fictional Applicant Practice", services: ["Physiotherapy"], funding: ["Private"], languages: ["English"], telehealth: false, acceptingNewReferrals: true, locations: [{ suburb: "Sydney", postcode: "2000", state: "NSW", isPrimary: true }] };
local.sql(`insert into public.practitioner_applications(invitation_id,user_id,status,profile,submitted_at,profile_confirmed_at,referral_consent_at,terms_version,privacy_version) values (${literal(invitationResponse.body.id)},${literal(users.applicant.userId)},'submitted','${JSON.stringify(profile)}',now(),now(),now(),'test-terms-v1','test-privacy-v1');`);
const referral = await createReferral(users.doctor.client, { organisationId: org, organisationName: "Fictional Browser Practice", displayName: "Dr Browser Fictional" }, users.doctor.userId, { patientReference: "BROWSER-FICTIONAL-PATIENT", patientPostcode: "2000", profession: "physiotherapist", clinicalSummary: "Fictional browser assessment request", fundingPath: "Private", appointmentFormat: "in_person", languageOrAccess: "", selectionMode: "doctor", selectedPractitionerId: practitionerId, consentConfirmed: true });
const links = {};
for (const role of ["doctor", "practitioner", "operator"]) {
  const destination = role === "doctor" ? `/referrals/${referral.id}` : role === "practitioner" ? "/practitioner" : "/admin/practitioners";
  const { data, error } = await local.admin.auth.admin.generateLink({ type: "magiclink", email: users[role].email, options: { redirectTo: `http://127.0.0.1:3000${destination}` } });
  if (error) throw new Error(`Local browser signin generation failed (${error.code || "unknown"}).`);
  const action = new URL(data.properties.action_link);
  if (!["127.0.0.1", "localhost"].includes(action.hostname) || action.port !== "55321") throw new Error("Non-local browser signin link refused.");
  links[role] = action.toString();
}
const output = join(process.env.RW_LOCAL_STACK_DIR, "browser-fixtures.json");
writeFileSync(output, JSON.stringify({ links, referralId: referral.id, organisationId: org, practitionerId }), { mode: 0o600 });
console.log("Fictional local browser fixtures ready; signin links kept only in the private stack artifact.");
