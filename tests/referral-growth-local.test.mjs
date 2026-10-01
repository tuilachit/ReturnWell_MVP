import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { localRuntime } from "./helpers/local-runtime.mjs";
import { enrollFixtureMfa } from "./helpers/mfa.mjs";
test(
  "real local new and existing mailbox journeys release only after independent approval",
  { skip: process.env.RW_LOCAL_JOURNEY !== "1", timeout: 120000 },
  async () => {
    const local = localRuntime(),
      suffix = randomUUID().slice(0, 8),
      org = randomUUID();
    const operator = await local.verifiedFixtureUser(
      `growth-reviewer-${suffix}@example.test`,
    );
    const doctor = await local.verifiedFixtureUser(
      `growth-doctor-${suffix}@example.test`,
    );
    const outsider = await local.verifiedFixtureUser(
      `growth-outsider-${suffix}@example.test`,
    );
    await enrollFixtureMfa(operator.client);
    local.sql(`insert into private.platform_operators(user_id) values ('${operator.userId}');
    insert into public.organisations(id,name) values ('${org}','Fictional Referral Growth Practice');
    insert into public.organisation_memberships(organisation_id,user_id,role) values ('${org}','${doctor.userId}','referrer');
    insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${doctor.userId}','${org}','Dr Fictional Reviewed','Fictional Referral Growth Practice','${operator.userId}');
    update private.profession_policies set enabled=true,review_interval_days=7,identifier_pattern='^[A-Z0-9-]{3,80}$',approved_by='${operator.userId}',approved_at=now(),evidence_reference='Fictional local growth policy' where profession_id='physiotherapist';`);
    const call = async (endpoint, input, client) => {
      const result = await local.call(endpoint, input, client);
      assert.equal(
        result.status,
        200,
        `HTTP ${result.status}, ${result.body?.code ?? "unknown"}`,
      );
      return result.body;
    };
    const email = `growth-receiver-${suffix}@example.test`;
    async function invite() {
      const draft = await call(
        "manage-referral",
        {
          operation: "draft.save",
          id: randomUUID(),
          organisationId: org,
          expectedVersion: -1,
          requestId: randomUUID(),
          input: {
            patientReference: "Fictional growth reference",
            patientPostcode: "2000",
            profession: "physiotherapist",
            clinicalSummary: "Fictional private local summary",
            fundingPath: "self_funded",
            appointmentFormat: "in_person",
          },
        },
        doctor.client,
      );
      return call(
        "manage-referral",
        {
          operation: "draft.invite",
          id: draft.id,
          expectedVersion: draft.version,
          requestId: randomUUID(),
          recipientName: "Fictional Receiver",
          recipientEmail: email,
          contactBasis: "recipient_requested",
          contactConsentConfirmed: true,
          consentConfirmed: true,
        },
        doctor.client,
      );
    }
    async function verify(linked) {
      const token = await local.invitationToken(linked.invitationId);
      await call("invitation-entry", {
        operation: "beginSignup",
        token,
        termsVersion: local.env.TERMS_VERSION,
        privacyVersion: local.env.PRIVACY_VERSION,
        consentAccepted: true,
        requestId: randomUUID(),
      });
      const message = await local.verificationMessage(linked.invitationId);
      assert.doesNotMatch(
        message.email.text,
        /Fictional private local summary|Fictional growth reference/,
      );
      const actor = await local.verify(message.values);
      const body = {
        invitationId: linked.invitationId,
        attemptId: message.attemptId,
        displayName: "Fictional Receiver",
        requestId: randomUUID(),
      };
      assert.equal(
        (await local.call("claim-invitation", body, outsider.client)).status,
        403,
      );
      const claim = await call("claim-invitation", body, actor.client);
      return { actor, claim };
    }
    const linked = await invite();
    const { actor, claim } = await verify(linked);
    const pending = await actor.client
      .from("referrals")
      .select("id")
      .eq("id", linked.referralId);
    assert.equal(pending.error, null);
    assert.equal(pending.data.length, 0);
    assert.equal(
      (
        await call(
          "manage-referral",
          { operation: "onboarding.status", referralId: linked.referralId },
          doctor.client,
        )
      ).status,
      "awaiting_review",
    );
    const application = await call(
      "practitioner-onboarding",
      { operation: "load", applicationId: claim.applicationId },
      actor.client,
    );
    const profile = {
      displayName: "Fictional Receiver",
      profession: "physiotherapist",
      registrationNumber: `GROWTH${suffix.toUpperCase()}`,
      practiceName: "Fictional Receiving Clinic",
      services: ["Physiotherapy"],
      funding: ["self_funded"],
      languages: ["english"],
      telehealth: false,
      acceptingNewReferrals: true,
      locations: [
        { suburb: "Sydney", postcode: "2000", state: "NSW", isPrimary: true },
      ],
    };
    const saved = await call(
      "practitioner-onboarding",
      {
        operation: "save",
        applicationId: application.id,
        expectedVersion: application.version,
        profile,
      },
      actor.client,
    );
    const submitted = await call(
      "practitioner-onboarding",
      {
        operation: "submit",
        applicationId: application.id,
        expectedVersion: saved.version,
        profileConfirmed: true,
        referralConsent: true,
        termsVersion: local.env.TERMS_VERSION,
        privacyVersion: local.env.PRIVACY_VERSION,
      },
      actor.client,
    );
    const checkedAt = new Date().toISOString();
    const approved = await call(
      "review-practitioner",
      {
        operation: "decide",
        applicationId: application.id,
        expectedVersion: submitted.version,
        requestId: randomUUID(),
        decision: "approved",
        identityEvidence: {
          method: "independent_practice_contact",
          matched: true,
          reference: "Fictional independent evidence",
          checkedAt,
        },
        registrationEvidence: {
          method: "manual_register",
          matched: true,
          reference: "Fictional register evidence",
          registrationNumber: profile.registrationNumber,
          checkedAt,
        },
        applicantFeedback: "",
      },
      operator.client,
    );
    const released = await call(
      "manage-referral",
      { operation: "onboarding.status", referralId: linked.referralId },
      doctor.client,
    );
    assert.equal(released.status, "released");
    assert.equal(released.accountWasNew, true);
    assert.equal(
      local.sql(
        `select count(*) from public.notification_outbox where referral_id='${linked.referralId}'`,
      ),
      "1",
    );
    const visible = await actor.client
      .from("referrals")
      .select("id,version")
      .eq("id", linked.referralId)
      .single();
    assert.equal(visible.error, null);
    const accepted = await call(
      "respond-to-referral",
      {
        referralId: linked.referralId,
        expectedVersion: visible.data.version,
        requestId: randomUUID(),
        decision: "accepted",
      },
      actor.client,
    );
    assert.equal(accepted.status, "accepted");
    await call(
      "manage-practice",
      {
        operation: "reviewContact",
        organisationId: org,
        expectedVersion: 0,
        requestId: randomUUID(),
        contactPhone: "0299990000",
        secureInstructions: "Use the independently agreed clinical channel.",
        evidenceReference: "Fictional verified work contact",
      },
      operator.client,
    );
    const handover = await call(
      "manage-referral",
      { operation: "handover.read", referralId: linked.referralId },
      actor.client,
    );
    assert.equal(handover.contactPhone, "0299990000");
    const closed = await call(
      "manage-referral",
      {
        operation: "transition",
        referralId: linked.referralId,
        expectedVersion: accepted.version,
        requestId: randomUUID(),
        action: "close",
        reasonCode: "handover_completed",
        handoverConfirmed: true,
      },
      doctor.client,
    );
    assert.equal(closed.referral.status, "closed");
    const second = await invite();
    const reused = await verify(second);
    assert.equal(reused.actor.userId, actor.userId);
    const secondProgress = await call(
      "manage-referral",
      { operation: "onboarding.status", referralId: second.referralId },
      doctor.client,
    );
    assert.equal(secondProgress.status, "released");
    assert.equal(secondProgress.accountWasNew, false);
    assert.equal(
      local.sql(
        `select count(*) from public.practitioner_applications where user_id='${actor.userId}'`,
      ),
      "1",
    );
    assert.equal(
      local.sql(
        `select selected_practitioner_id from public.referrals where id='${second.referralId}'`,
      ),
      approved.practitioner_id,
    );
  },
);
