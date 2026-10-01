import assert from "node:assert/strict";
import { credentialFixtureSql } from "./credential-fixture.mjs";

// Runs inside the disposable Postgres matrix. All people and content are fictional.
export async function referralGrowthChecks(
  t,
  { rpc, sql, id: sourceId, profile, review, sqlAsync },
) {
  const id = (n) => sourceId(200000 + n),
    practitionerId = id(30);
  sql(`insert into auth.users(id,email,email_confirmed_at) values ('${id(1)}','growth-operator@example.test',now()),('${id(2)}','growth-doctor@example.test',now()),('${id(3)}','growth-practitioner@example.test',now()),('${id(4)}','growth-outsider@example.test',now());
    insert into private.platform_operators(user_id) values ('${id(1)}');
    insert into public.organisations(id,name,notification_email) values ('${id(10)}','Fictional Growth Practice','growth-practice@example.test');
    insert into public.organisation_memberships(organisation_id,user_id,role) values ('${id(10)}','${id(2)}','referrer');
    insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${id(2)}','${id(10)}','Fictional Growth Doctor','Fictional Growth Practice','${id(1)}');
    insert into public.practitioners(id,display_name,profession,practice_name,contact_email,lifecycle_status,ahpra_registration_number,ahpra_verification_status,ahpra_verified_at,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages)
    values ('${practitionerId}','Fictional Growth Receiver','physiotherapist','Fictional Growth Clinic','growth-practitioner@example.test','active','PHY9000000001','verified',now(),'confirmed',now(),true,true,array['Physiotherapy'],array['self_funded'],array['english']);
    insert into public.practitioner_locations(practitioner_id,suburb,postcode,state,is_primary) values ('${practitionerId}','Sydney','2000','NSW',true);`);
  sql(
    credentialFixtureSql({
      practitionerId,
      ownerId: id(3),
      reviewerId: id(1),
      organisationId: id(10),
    }),
  );
  let n = 90000;
  const next = () => id(++n);
  const fixture = (extra = {}) => {
    const draft = rpc(id(2), "draft.save", {
      id: next(),
      organisationId: id(10),
      expectedVersion: -1,
      requestId: next(),
      input: {
        patientReference: "Fictional growth case",
        patientPostcode: "2000",
        profession: "physiotherapist",
        clinicalSummary: "Fictional confidential summary",
        fundingPath: "self_funded",
        appointmentFormat: "in_person",
        ...extra,
      },
    });
    const input = {
      id: draft.id,
      expectedVersion: 0,
      requestId: next(),
      consentConfirmed: true,
      contactConsentConfirmed: true,
      contactBasis: "recipient_requested",
      recipientName: "Fictional Clinician",
      recipientEmail: "growth-practitioner@example.test",
      tokenHash: (++n).toString(16).padStart(64, "0"),
      envelope: { test: "encrypted" },
      keyId: "test",
    };
    return { draft, input };
  };
  const claim = (invitationId) => {
    const tokenHash = sql(
      `select token_hash from private.invitation_secrets where invitation_id='${invitationId}'`,
    );
    const attempt = rpc(null, "invitation.begin", {
      tokenHash,
      termsVersion: "v1",
      privacyVersion: "v1",
      consentAccepted: true,
      requestId: next(),
    });
    assert.equal(attempt.existingUserId, id(3));
    rpc(null, "invitation.attach_auth", {
      attemptId: attempt.attemptId,
      authLeaseId: attempt.authLeaseId,
      authUserId: id(3),
      tokenType: "magiclink",
      envelope: { test: "encrypted" },
    });
    assert.throws(
      () =>
        rpc(id(4), "invitation.claim", {
          invitationId,
          attemptId: attempt.attemptId,
          displayName: "Wrong mailbox",
          requestId: next(),
        }),
      /denied/,
    );
    return rpc(id(3), "invitation.claim", {
      invitationId,
      attemptId: attempt.attemptId,
      displayName: "Fictional Clinician",
      requestId: next(),
    });
  };
  const state = (referralId) => rpc(id(2), "growth.status", { referralId });
  let initial;
  await t.test(
    "linked invitation finalisation is atomic, creator scoped and private before mailbox proof",
    () => {
      const { draft, input } = fixture();
      for (const override of [
        { consentConfirmed: false },
        { contactConsentConfirmed: false },
        { contactBasis: "scraped_address" },
      ])
        assert.throws(
          () => rpc(id(2), "growth.invite", { ...input, ...override }),
          /consent_required|invalid_request/,
        );
      assert.throws(() => rpc(id(4), "growth.invite", input), /denied/);
      assert.throws(() => rpc(id(1), "growth.invite", input), /denied/);
      const result = rpc(id(2), "growth.invite", input);
      initial = result;
      assert.equal(result.referralId, draft.id);
      assert.equal(result.status, "awaiting_signup");
      assert.equal(
        sql(
          `select selected_practitioner_id is null and status='awaiting_onboarding' from public.referrals where id='${draft.id}'`,
        ),
        "t",
      );
      assert.equal(
        sql(
          `select count(*) from public.notification_outbox where referral_id='${draft.id}'`,
        ),
        "0",
      );
      assert.equal(
        sql(
          `select count(*) from private.email_jobs where related_id='${result.invitationId}' and family='invitation'`,
        ),
        "1",
      );
      assert.equal(
        sql(
          `select consent_valid_until=consent_confirmed_at+interval '7 days' from private.referral_invitations where referral_id='${draft.id}'`,
        ),
        "t",
      );
      assert.deepEqual(
        rpc(id(2), "growth.invite", {
          ...input,
          tokenHash: "f".repeat(64),
          envelope: { test: "retry" },
        }),
        result,
      );
      assert.throws(
        () =>
          rpc(id(2), "growth.invite", {
            ...input,
            recipientEmail: "other@example.test",
          }),
        /conflict/,
      );
      for (const actor of [id(1), id(3), id(4)]) {
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${actor}'; select count(*) from public.referrals where id='${draft.id}'`,
          ),
          "0",
        );
        assert.throws(
          () => rpc(actor, "growth.status", { referralId: draft.id }),
          /denied/,
        );
      }
      assert.doesNotMatch(
        JSON.stringify(state(draft.id)),
        /confidential summary|clinical_summary/,
      );
      assert.throws(
        () =>
          sql(
            "set role authenticated;select * from private.referral_invitations",
          ),
        /permission denied/,
      );
      rpc(null, "growth.sweep");
      assert.equal(state(draft.id).status, "awaiting_signup");
    },
  );
  await t.test(
    "existing verified account is reused and release records one assignment, event and notification",
    () => {
      const deadline = state(initial.referralId).consentValidUntil;
      sql(
        `update public.workspace_invitations set updated_at=now()-interval '2 minutes' where id='${initial.invitationId}'`,
      );
      rpc(id(2), "invitations.resend", {
        invitationId: initial.invitationId,
        expectedVersion: 0,
        requestId: next(),
        tokenHash: "b".repeat(64),
        envelope: { test: "resend" },
        keyId: "test",
      });
      assert.equal(
        state(initial.referralId).consentValidUntil,
        deadline,
        "resending must not extend doctor consent",
      );
      const before = sql(
        `select count(*) from public.practitioner_applications where user_id='${id(3)}'`,
      );
      claim(initial.invitationId);
      assert.equal(
        sql(
          `select count(*) from public.practitioner_applications where user_id='${id(3)}'`,
        ),
        before,
      );
      rpc(null, "growth.sweep");
      rpc(null, "growth.sweep");
      assert.equal(state(initial.referralId).status, "released");
      assert.equal(
        sql(
          `select selected_practitioner_id from public.referrals where id='${initial.referralId}'`,
        ),
        practitionerId,
      );
      assert.equal(
        sql(
          `select count(*) from public.referral_events where referral_id='${initial.referralId}' and event_type='sent'`,
        ),
        "1",
      );
      assert.equal(
        sql(
          `select count(*) from public.notification_outbox where referral_id='${initial.referralId}' and kind='referral_created'`,
        ),
        "1",
      );
      assert.equal(
        sql(
          `set role authenticated;set request.jwt.claim.sub='${id(3)}';select count(*) from public.referrals where id='${initial.referralId}'`,
        ),
        "1",
      );
    },
  );
  await t.test(
    "expired consent stays blocked after later eligibility and needs explicit doctor reconfirmation",
    () => {
      const { input } = fixture();
      const result = rpc(id(2), "growth.invite", input);
      claim(result.invitationId);
      sql(
        `update private.referral_invitations set consent_confirmed_at=now()-interval '8 days',consent_valid_until=now()-interval '1 day' where referral_id='${result.referralId}'`,
      );
      rpc(null, "growth.sweep");
      assert.equal(state(result.referralId).reason, "consent_expired");
      assert.equal(
        sql(
          `select selected_practitioner_id is null from public.referrals where id='${result.referralId}'`,
        ),
        "t",
      );
      const version = Number(
        sql(
          `select version from public.referrals where id='${result.referralId}'`,
        ),
      );
      assert.throws(
        () =>
          rpc(id(4), "growth.reconfirm", {
            referralId: result.referralId,
            expectedVersion: version,
            requestId: next(),
            consentConfirmed: true,
          }),
        /denied/,
      );
      const request = {
        referralId: result.referralId,
        expectedVersion: version,
        requestId: next(),
        consentConfirmed: true,
      };
      rpc(id(2), "growth.reconfirm", request);
      rpc(id(2), "growth.reconfirm", request);
      rpc(null, "growth.sweep");
      assert.equal(state(result.referralId).status, "released");
    },
  );
  await t.test(
    "requirement mismatch never silently reroutes or auto-releases after a later change",
    () => {
      const { input } = fixture({ preferredLanguage: "mandarin" });
      const result = rpc(id(2), "growth.invite", input);
      claim(result.invitationId);
      rpc(null, "growth.sweep");
      assert.equal(state(result.referralId).reason, "requirements_changed");
      rpc(null, "growth.sweep");
      assert.equal(state(result.referralId).status, "needs_reconfirmation");
      assert.equal(
        sql(
          `select count(*) from private.email_jobs where related_id='${result.referralId}' and family='coordination'`,
        ),
        "1",
      );
      assert.doesNotMatch(
        sql(
          `select payload::text from private.email_jobs where related_id='${result.referralId}' and family='coordination'`,
        ),
        /Fictional|clinical|mandarin/,
      );
      const lease = next();
      const jobId = sql(
        `update private.email_jobs set state='processing',lease_id='${lease}',lease_expires_at=now()+interval '2 minutes' where related_id='${result.referralId}' and family='coordination' returning id`,
      );
      assert.equal(
        rpc(null, "email.start", { jobId, leaseId: lease }).attempts,
        1,
      );
    },
  );
  await t.test(
    "cancellation wins before late approval and a revoked original doctor cannot release",
    () => {
      const { input } = fixture();
      const result = rpc(id(2), "growth.invite", input);
      rpc(id(2), "referral.transition", {
        referralId: result.referralId,
        expectedVersion: 0,
        action: "cancel",
        reasonCode: "no_longer_required",
        requestId: next(),
      });
      claim(result.invitationId);
      rpc(null, "growth.sweep");
      assert.equal(state(result.referralId).status, "cancelled");
      assert.equal(
        sql(
          `select count(*) from public.notification_outbox where referral_id='${result.referralId}' and kind='referral_created'`,
        ),
        "0",
      );
      const other = rpc(id(2), "growth.invite", fixture().input);
      claim(other.invitationId);
      sql(
        `update public.organisation_memberships set active=false where user_id='${id(2)}' and organisation_id='${id(10)}'`,
      );
      rpc(null, "growth.sweep");
      assert.equal(
        sql(
          `select selected_practitioner_id is null from public.referrals where id='${other.referralId}'`,
        ),
        "t",
      );
      sql(
        `update public.organisation_memberships set active=true where user_id='${id(2)}' and organisation_id='${id(10)}'`,
      );
      rpc(null, "growth.sweep");
      assert.equal(state(other.referralId).reason, "referrer_inactive");
    },
  );
  await t.test(
    "new practitioner gets a private application and release follows independent approval only",
    () => {
      const { input } = fixture();
      input.recipientEmail = "growth-new-person@example.test";
      const linked = rpc(id(2), "growth.invite", input);
      const attempt = rpc(null, "invitation.begin", {
        tokenHash: input.tokenHash,
        termsVersion: "v1",
        privacyVersion: "v1",
        consentAccepted: true,
        requestId: next(),
      });
      assert.equal(attempt.existingUserId, null);
      assert.equal(attempt.newUser, true);
      const owner = next();
      sql(
        `insert into auth.users(id,email) values ('${owner}','growth-new-person@example.test')`,
      );
      rpc(null, "invitation.attach_auth", {
        attemptId: attempt.attemptId,
        authLeaseId: attempt.authLeaseId,
        authUserId: owner,
        tokenType: "invite",
        envelope: { test: "encrypted" },
      });
      const claimInput = {
        invitationId: linked.invitationId,
        attemptId: attempt.attemptId,
        displayName: "Fictional New Receiver",
        requestId: next(),
      };
      assert.throws(() => rpc(owner, "invitation.claim", claimInput), /denied/);
      sql(`update auth.users set email_confirmed_at=now() where id='${owner}'`);
      const claim = rpc(owner, "invitation.claim", claimInput);
      rpc(null, "growth.sweep");
      assert.equal(state(linked.referralId).status, "awaiting_review");
      assert.equal(
        sql(
          `set role authenticated;set request.jwt.claim.sub='${owner}';select count(*) from public.referrals where id='${linked.referralId}'`,
        ),
        "0",
      );
      const saved = rpc(owner, "application.save", {
        applicationId: claim.applicationId,
        expectedVersion: 0,
        profile: {
          ...profile,
          displayName: "Fictional New Receiver",
          registrationNumber: "PHY9001234567",
        },
      });
      const submitted = rpc(owner, "application.submit", {
        applicationId: claim.applicationId,
        expectedVersion: saved.version,
        profileConfirmed: true,
        referralConsent: true,
        termsVersion: "v1",
        privacyVersion: "v1",
      });
      rpc(null, "growth.sweep");
      assert.equal(state(linked.referralId).status, "awaiting_review");
      rpc(id(1), "review.decide", {
        ...review,
        applicationId: claim.applicationId,
        expectedVersion: submitted.version,
        requestId: next(),
        registrationEvidence: {
          ...review.registrationEvidence,
          registrationNumber: "PHY9001234567",
        },
      });
      rpc(null, "growth.sweep");
      assert.equal(state(linked.referralId).status, "released");
      assert.equal(
        sql(
          `select count(*) from public.notification_outbox where referral_id='${linked.referralId}'`,
        ),
        "1",
      );
    },
  );
  await t.test(
    "release and cancellation race cannot create a duplicate or unlock a cancelled referral",
    async () => {
      const linked = rpc(id(2), "growth.invite", fixture().input);
      claim(linked.invitationId);
      const cancel = {
        referralId: linked.referralId,
        expectedVersion: 0,
        action: "cancel",
        reasonCode: "other",
        requestId: next(),
      };
      const results = await Promise.allSettled([
        sqlAsync(
          `set role service_role;select public.rw_workflow(null,'growth.sweep','{}')`,
        ),
        sqlAsync(
          `set role service_role;select public.rw_workflow('${id(2)}','referral.transition','${JSON.stringify(cancel)}'::jsonb)`,
        ),
        sqlAsync(
          `set role service_role;select public.rw_workflow(null,'growth.sweep','{}')`,
        ),
      ]);
      for (const result of results)
        if (result.status === "rejected")
          assert.match(String(result.reason), /conflict/);
      const status = sql(
        `select status from public.referrals where id='${linked.referralId}'`,
      );
      assert.ok(["sent", "cancelled"].includes(status));
      assert.equal(
        sql(
          `select count(*) from public.referral_events where referral_id='${linked.referralId}' and event_type='sent'`,
        ),
        status === "sent" ? "1" : "0",
      );
      assert.equal(
        sql(
          `select count(*) from public.notification_outbox where referral_id='${linked.referralId}' and kind='referral_created'`,
        ),
        status === "sent" ? "1" : "0",
      );
    },
  );
  await t.test(
    "intake pause, expired credentials and revoked ownership block automatic release",
    () => {
      for (const mode of ["pause", "expiry", "revoked"]) {
        const linked = rpc(id(2), "growth.invite", fixture().input);
        claim(linked.invitationId);
        if (mode === "pause")
          sql(
            `update public.practitioners set accepting_new_referrals=false where id='${practitionerId}'`,
          );
        if (mode === "expiry")
          sql(
            `update private.professional_credentials set expires_at=now()-interval '1 minute' where practitioner_id='${practitionerId}'`,
          );
        if (mode === "revoked")
          sql(
            `update public.practitioner_users set active=false,revoked_at=now() where practitioner_id='${practitionerId}'`,
          );
        rpc(null, "growth.sweep");
        assert.equal(state(linked.referralId).status, "needs_reconfirmation");
        assert.equal(
          sql(
            `select selected_practitioner_id is null from public.referrals where id='${linked.referralId}'`,
          ),
          "t",
        );
        if (mode === "pause")
          sql(
            `update public.practitioners set accepting_new_referrals=true where id='${practitionerId}'`,
          );
        if (mode === "expiry")
          sql(
            `update private.professional_credentials set expires_at=null where practitioner_id='${practitionerId}'`,
          );
        if (mode === "revoked")
          sql(
            `update public.practitioner_users set active=true,revoked_at=null where practitioner_id='${practitionerId}'`,
          );
        rpc(null, "growth.sweep");
        assert.equal(state(linked.referralId).status, "needs_reconfirmation");
      }
    },
  );
  await t.test(
    "changed clinical content cannot reuse the original doctor release consent",
    () => {
      const linked = rpc(id(2), "growth.invite", fixture().input);
      claim(linked.invitationId);
      sql(
        `update public.referrals set clinical_summary='Revised fictional clinical context' where id='${linked.referralId}'`,
      );
      rpc(null, "growth.sweep");
      assert.equal(state(linked.referralId).status, "needs_reconfirmation");
      assert.equal(
        sql(
          `select selected_practitioner_id is null from public.referrals where id='${linked.referralId}'`,
        ),
        "t",
      );
    },
  );
  await t.test(
    "practice colleagues see growth progress but not an inviter-only mailbox",
    () => {
      sql(
        `insert into public.organisation_memberships(organisation_id,user_id,role) values ('${id(10)}','${id(4)}','referrer')`,
      );
      try {
        const progress = rpc(id(4), "growth.status", {
          referralId: initial.referralId,
        });
        assert.equal(progress.recipientEmail, "g***@example.test");
        assert.equal(
          state(initial.referralId).recipientEmail,
          "growth-practitioner@example.test",
        );
      } finally {
        sql(
          `delete from public.organisation_memberships where organisation_id='${id(10)}' and user_id='${id(4)}'`,
        );
      }
    },
  );
}
