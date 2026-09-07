import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { localRuntime } from "./helpers/local-runtime.mjs";
import { createReferral, listReferrals } from "../app/lib/referrals.ts";

const enabled = process.env.RW_LOCAL_JOURNEY === "1";
const ok = (result, expected = 200) => {
  assert.equal(
    result.status,
    expected,
    `HTTP status ${result.status}; code ${result.body?.code || "none"}`,
  );
  return result.body;
};
const noError = (result) => {
  assert.equal(
    result.error,
    null,
    `Data API error: ${result.error?.code || "none"}`,
  );
  return result.data;
};

test(
  "isolated real Supabase auth, HTTP workflows and RLS referral journey",
  { skip: !enabled, timeout: 120000 },
  async (t) => {
    const local = localRuntime();
    const suffix = randomUUID().slice(0, 8);
    const operator = await local.verifiedFixtureUser(
      `operator-${suffix}@example.test`,
    );
    const outsider = await local.verifiedFixtureUser(
      `outsider-${suffix}@example.test`,
    );
    const org = randomUUID();
    local.sql(`insert into private.platform_operators(user_id) values (${local.uuidSql(operator.userId)});
    insert into public.organisations(id,name,notification_email) values (${local.uuidSql(org)},'Fictional Journey Practice','practice-${suffix}@example.test');
    insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values
    (${local.uuidSql(operator.userId)},${local.uuidSql(org)},'Fictional Operator','Fictional Journey Practice',${local.uuidSql(operator.userId)}),
    (${local.uuidSql(operator.userId)},null,'Fictional Operator','ReturnWell Test Administration',${local.uuidSql(operator.userId)});`);

    const doctorEmail = `doctor-${suffix}@example.test`;
    const existingDoctor = await local.verifiedFixtureUser(doctorEmail);
    const doctorInvitation = ok(
      await local.call(
        "manage-invitations",
        {
          operation: "create",
          kind: "doctor",
          organisationId: org,
          recipientName: "Fictional Doctor",
          recipientEmail: doctorEmail,
          consentConfirmed: true,
          requestId: randomUUID(),
          role: "owner",
          actorId: outsider.userId,
        },
        operator.client,
      ),
    );
    const doctorToken = await local.invitationToken(doctorInvitation.id);
    ok(
      await local.call("invitation-entry", {
        operation: "beginSignup",
        token: doctorToken,
        termsVersion: local.env.TERMS_VERSION,
        privacyVersion: local.env.PRIVACY_VERSION,
        consentAccepted: true,
        requestId: randomUUID(),
      }),
    );
    const doctorMessage = await local.verificationMessage(doctorInvitation.id);
    const doctor = await local.verify(doctorMessage.values);
    ok(
      await local.call(
        "claim-invitation",
        {
          invitationId: doctorInvitation.id,
          attemptId: doctorMessage.attemptId,
          displayName: "Fictional Doctor",
          requestId: randomUUID(),
          role: "owner",
        },
        doctor.client,
      ),
    );
    local.sql(
      `insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values (${local.uuidSql(doctor.userId)},${local.uuidSql(org)},'Dr Reviewed Fictional','Fictional Journey Practice',${local.uuidSql(operator.userId)});`,
    );
    await t.test(
      "doctor invitation creates a real verified referrer without caller role escalation",
      async () => {
        assert.equal(doctor.userId, existingDoctor.userId);
        assert.equal(
          local.sql(
            `select account_was_new::text from public.workspace_invitations where id=${local.uuidSql(doctorInvitation.id)}`,
          ),
          "false",
        );
        const access = ok(
          await local.call("workspace-access", {}, doctor.client),
        );
        assert.equal(
          access.doctors.find((row) => row.organisationId === org)?.role,
          "referrer",
        );
        assert.equal(access.operator, false);
        const operatorAccess = ok(
          await local.call("workspace-access", {}, operator.client),
        );
        assert.ok(
          operatorAccess.invitationOrganisations.some(
            (row) => row.organisationId === org,
          ),
        );
      },
    );

    const email = `practitioner-${suffix}@example.test`;
    const invitation = ok(
      await local.call(
        "manage-invitations",
        {
          operation: "create",
          kind: "practitioner",
          organisationId: org,
          recipientName: "Fictional Practitioner",
          recipientEmail: email,
          consentConfirmed: true,
          requestId: randomUUID(),
        },
        doctor.client,
      ),
    );
    const token = await local.invitationToken(invitation.id);
    await t.test(
      "inspection is passive, masks the mailbox and returns matching legal metadata",
      async () => {
        const before = local.generatedTypes.length;
        const inspected = ok(
          await local.call("invitation-entry", { operation: "inspect", token }),
        );
        assert.equal(local.generatedTypes.length, before);
        assert.equal(inspected.inviterName, "Dr Reviewed Fictional");
        assert.equal(inspected.maskedEmail.includes(email), false);
        assert.equal(inspected.termsUrl, local.env.TERMS_URL);
        assert.equal(
          local.sql(
            `select status from public.workspace_invitations where id=${local.uuidSql(invitation.id)}`,
          ),
          "pending",
        );
      },
    );
    ok(
      await local.call("invitation-entry", {
        operation: "beginSignup",
        token,
        termsVersion: local.env.TERMS_VERSION,
        privacyVersion: local.env.PRIVACY_VERSION,
        consentAccepted: true,
        requestId: randomUUID(),
        recipientEmail: "substituted@example.test",
        redirectTo: "https://evil.example.test",
      }),
    );
    const message = await local.verificationMessage(invitation.id);
    await t.test(
      "real auth account remains unconfirmed and unassigned until explicit OTP exchange",
      async () => {
        assert.equal(
          local.sql(
            `select count(*) from public.practitioner_applications where invitation_id=${local.uuidSql(invitation.id)}`,
          ),
          "0",
        );
        assert.equal(
          local.sql(
            `select (u.email_confirmed_at is null)::text from auth.users u join private.invitation_auth_attempts a on a.auth_user_id=u.id where a.id=${local.uuidSql(message.attemptId)}`,
          ),
          "true",
        );
        assert.equal(
          message.email.text.includes("substituted@example.test"),
          false,
        );
        assert.equal(message.email.text.includes("evil.example.test"), false);
        ok(
          await local.call(
            "claim-invitation",
            {
              invitationId: invitation.id,
              attemptId: message.attemptId,
              displayName: "Impostor",
              requestId: randomUUID(),
            },
            outsider.client,
          ),
          403,
        );
      },
    );
    const practitioner = await local.verify(message.values);
    const claimBody = {
      invitationId: invitation.id,
      attemptId: message.attemptId,
      displayName: "Fictional Practitioner",
      requestId: randomUUID(),
    };
    const claimed = ok(
      await local.call("claim-invitation", claimBody, practitioner.client),
    );
    const applicationId = claimed.applicationId;
    await t.test(
      "verified claim creates one private draft and pending account cannot read directory or service RPC",
      async () => {
        assert.equal(
          ok(
            await local.call(
              "claim-invitation",
              claimBody,
              practitioner.client,
            ),
          ).applicationId,
          applicationId,
        );
        assert.equal(
          local.sql(
            `select count(*) from public.practitioner_applications where invitation_id=${local.uuidSql(invitation.id)}`,
          ),
          "1",
        );
        assert.equal(
          noError(
            await practitioner.client
              .from("verified_practitioners")
              .select("*"),
          ).length,
          0,
        );
        assert.equal(
          noError(
            await outsider.client
              .from("practitioner_applications")
              .select("*")
              .eq("id", applicationId),
          ).length,
          0,
        );
        assert.ok(
          (
            await practitioner.client.rpc("rw_workflow", {
              p_actor: operator.userId,
              p_action: "workspace.access",
              p_input: {},
            })
          ).error,
        );
        const access = ok(
          await local.call("workspace-access", {}, practitioner.client),
        );
        assert.equal(access.applicationId, applicationId);
        assert.equal(access.practitioners.length, 0);
      },
    );
    const initial = ok(
      await local.call(
        "practitioner-onboarding",
        { operation: "load", applicationId },
        practitioner.client,
      ),
    );
    assert.equal(initial.current_terms_url, local.env.TERMS_URL);
    const profile = {
      displayName: "Fictional Practitioner",
      profession: "physiotherapist",
      registrationNumber: `PHY${suffix.toUpperCase()}`,
      practiceName: "Fictional Movement Practice",
      services: ["Physiotherapy"],
      funding: ["Private"],
      languages: ["English"],
      telehealth: false,
      acceptingNewReferrals: true,
      locations: [
        { suburb: "Sydney", postcode: "2000", state: "NSW", isPrimary: true },
      ],
    };
    const saved = ok(
      await local.call(
        "practitioner-onboarding",
        {
          operation: "save",
          applicationId,
          expectedVersion: initial.version,
          profile,
        },
        practitioner.client,
      ),
    );
    await t.test(
      "draft versions and legal consent are enforced through the production HTTP boundary",
      async () => {
        ok(
          await local.call(
            "practitioner-onboarding",
            {
              operation: "save",
              applicationId,
              expectedVersion: initial.version,
              profile,
            },
            practitioner.client,
          ),
          409,
        );
        ok(
          await local.call(
            "practitioner-onboarding",
            {
              operation: "submit",
              applicationId,
              expectedVersion: saved.version,
              profileConfirmed: true,
              referralConsent: true,
              termsVersion: "stale",
              privacyVersion: local.env.PRIVACY_VERSION,
            },
            practitioner.client,
          ),
          409,
        );
      },
    );
    const submitted = ok(
      await local.call(
        "practitioner-onboarding",
        {
          operation: "submit",
          applicationId,
          expectedVersion: saved.version,
          profileConfirmed: true,
          referralConsent: true,
          termsVersion: local.env.TERMS_VERSION,
          privacyVersion: local.env.PRIVACY_VERSION,
        },
        practitioner.client,
      ),
    );
    const review = {
      operation: "decide",
      applicationId,
      expectedVersion: submitted.version,
      decision: "approved",
      identityEvidence: {
        method: "independent_practice_contact",
        matched: true,
        reference: "Fictional independently verified practice contact",
        checkedAt: new Date().toISOString(),
      },
      registrationEvidence: {
        method: "manual_register",
        matched: true,
        reference: "Fictional current register check",
        registrationNumber: profile.registrationNumber,
        checkedAt: new Date().toISOString(),
      },
      applicantFeedback: "",
      requestId: randomUUID(),
    };
    await t.test(
      "incomplete review cannot activate the real local account",
      async () => {
        ok(
          await local.call(
            "review-practitioner",
            { ...review, identityEvidence: {} },
            operator.client,
          ),
          400,
        );
        assert.equal(
          ok(await local.call("workspace-access", {}, practitioner.client))
            .practitioners.length,
          0,
        );
      },
    );
    const approved = ok(
      await local.call("review-practitioner", review, operator.client),
    );
    const practitionerId = approved.practitioner_id;
    await t.test(
      "operator approval atomically publishes the profile and practitioner workspace",
      async () => {
        assert.equal(approved.status, "approved");
        assert.equal(
          ok(await local.call("workspace-access", {}, practitioner.client))
            .practitioners[0].practitionerId,
          practitionerId,
        );
        assert.equal(
          noError(
            await doctor.client
              .from("verified_practitioners")
              .select("id")
              .eq("id", practitionerId),
          ).length,
          1,
        );
      },
    );
    const workspace = {
      organisationId: org,
      organisationName: "Fictional Journey Practice",
      displayName: "Fictional Doctor",
    };
    const input = {
      patientReference: `FICTIONAL-${suffix}`,
      patientPostcode: "2000",
      profession: "physiotherapist",
      clinicalSummary: "FICTIONAL CLINICAL DETAIL NOT FOR EMAIL",
      fundingPath: "Private",
      appointmentFormat: "in_person",
      languageOrAccess: "",
      selectionMode: "doctor",
      selectedPractitionerId: practitionerId,
      consentConfirmed: true,
    };
    const referral = await createReferral(
      doctor.client,
      workspace,
      doctor.userId,
      input,
    );
    const responseBody = {
      referralId: referral.id,
      expectedVersion: 0,
      decision: "accepted",
      requestId: randomUUID(),
    };
    await t.test(
      "doctor-created referral is assigned-only and browsers cannot update its status",
      async () => {
        assert.equal(
          noError(
            await outsider.client
              .from("referrals")
              .select("id")
              .eq("id", referral.id),
          ).length,
          0,
        );
        assert.equal(
          noError(
            await practitioner.client
              .from("referrals")
              .select("id")
              .eq("id", referral.id),
          ).length,
          1,
        );
        assert.ok(
          (
            await practitioner.client
              .from("referrals")
              .update({ status: "accepted" })
              .eq("id", referral.id)
          ).error,
        );
        ok(
          await local.call(
            "respond-to-referral",
            responseBody,
            outsider.client,
          ),
          403,
        );
        ok(
          await local.call("respond-to-referral", responseBody, doctor.client),
          403,
        );
      },
    );
    const accepted = ok(
      await local.call(
        "respond-to-referral",
        responseBody,
        practitioner.client,
      ),
    );
    await t.test(
      "real practitioner response is atomic, idempotent and visible in doctor timeline",
      async () => {
        assert.equal(accepted.status, "accepted");
        assert.equal(accepted.version, 1);
        assert.equal(
          ok(
            await local.call(
              "respond-to-referral",
              responseBody,
              practitioner.client,
            ),
          ).version,
          1,
        );
        ok(
          await local.call(
            "respond-to-referral",
            {
              ...responseBody,
              decision: "declined",
              reasonCode: "capacity",
              requestId: randomUUID(),
            },
            practitioner.client,
          ),
          409,
        );
        assert.equal(
          (await listReferrals(doctor.client, org)).find(
            (row) => row.id === referral.id,
          )?.status,
          "accepted",
        );
        const events = noError(
          await doctor.client
            .from("referral_events")
            .select("event_type,actor_user_id")
            .eq("referral_id", referral.id)
            .eq("event_type", "accepted"),
        );
        assert.equal(events.length, 1);
        assert.equal(events[0].actor_user_id, practitioner.userId);
        const notifications = ok(
          await local.call(
            "send-referral-notification",
            { referralId: referral.id },
            doctor.client,
          ),
        );
        assert.ok(
          notifications.notifications.some(
            (row) => row.kind === "referral_accepted",
          ),
        );
        const emailPayloads = local.sql(
          `select coalesce(jsonb_agg(payload),'[]') from private.email_jobs where related_id=${local.uuidSql(referral.id)}`,
        );
        assert.equal(emailPayloads.includes(input.clinicalSummary), false);
        assert.equal(emailPayloads.includes(input.patientReference), false);
      },
    );
    await t.test(
      "decline reason reaches participants but stays out of email payloads",
      async () => {
        const declinedReferral = await createReferral(
          doctor.client,
          workspace,
          doctor.userId,
          { ...input, patientReference: `FICTIONAL-DECLINE-${suffix}` },
        );
        const note = "Fictional participant-only capacity note";
        const declined = ok(
          await local.call(
            "respond-to-referral",
            {
              referralId: declinedReferral.id,
              expectedVersion: 0,
              decision: "declined",
              reasonCode: "capacity",
              note,
              requestId: randomUUID(),
            },
            practitioner.client,
          ),
        );
        assert.equal(declined.status, "declined");
        const events = noError(
          await doctor.client
            .from("referral_events")
            .select("details")
            .eq("referral_id", declinedReferral.id)
            .eq("event_type", "declined"),
        );
        assert.equal(events[0].details.reasonCode, "capacity");
        assert.equal(events[0].details.note, note);
        assert.equal(
          local
            .sql(
              `select coalesce(jsonb_agg(payload),'[]') from private.email_jobs where related_id=${local.uuidSql(declinedReferral.id)}`,
            )
            .includes(note),
          false,
        );
      },
    );
    await t.test(
      "competing real HTTP responses persist exactly one decision and event",
      async () => {
        const raceReferral = await createReferral(
          doctor.client,
          workspace,
          doctor.userId,
          { ...input, patientReference: `FICTIONAL-RACE-${suffix}` },
        );
        const results = await Promise.all([
          local.call(
            "respond-to-referral",
            {
              referralId: raceReferral.id,
              expectedVersion: 0,
              decision: "accepted",
              requestId: randomUUID(),
            },
            practitioner.client,
          ),
          local.call(
            "respond-to-referral",
            {
              referralId: raceReferral.id,
              expectedVersion: 0,
              decision: "declined",
              reasonCode: "capacity",
              requestId: randomUUID(),
            },
            practitioner.client,
          ),
        ]);
        assert.deepEqual(results.map((row) => row.status).sort(), [200, 409]);
        assert.equal(
          local.sql(
            `select count(*) from public.referral_events where referral_id=${local.uuidSql(raceReferral.id)} and event_type in ('accepted','declined')`,
          ),
          "1",
        );
        assert.equal(
          local.sql(
            `select count(*) from private.email_jobs where related_id=${local.uuidSql(raceReferral.id)} and payload->>'kind' in ('referral_accepted','referral_declined')`,
          ),
          "1",
        );
      },
    );
    await t.test(
      "pause retains existing assignments and revocation removes access using the same real session",
      async () => {
        ok(
          await local.call(
            "practitioner-onboarding",
            {
              operation: "availability",
              practitionerId,
              acceptingNewReferrals: false,
            },
            practitioner.client,
          ),
        );
        assert.equal(
          noError(
            await doctor.client
              .from("verified_practitioners")
              .select("id")
              .eq("id", practitionerId),
          ).length,
          0,
        );
        assert.equal(
          noError(
            await practitioner.client
              .from("referrals")
              .select("id")
              .eq("id", referral.id),
          ).length,
          1,
        );
        local.sql(
          `update public.practitioner_users set active=false,revoked_at=now() where user_id=${local.uuidSql(practitioner.userId)} and practitioner_id=${local.uuidSql(practitionerId)}`,
        );
        assert.equal(
          noError(
            await practitioner.client
              .from("referrals")
              .select("id")
              .eq("id", referral.id),
          ).length,
          0,
        );
        ok(
          await local.call(
            "respond-to-referral",
            responseBody,
            practitioner.client,
          ),
          403,
        );
      },
    );
    assert.ok(local.requestCount() > 20);
    assert.ok(local.generatedTypes.includes("invite"));
    assert.ok(local.generatedTypes.includes("magiclink"));
  },
);
