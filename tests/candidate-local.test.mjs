import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localRuntime } from "./helpers/local-runtime.mjs";
import { enrollFixtureMfa } from "./helpers/mfa.mjs";
import { prepareCandidateBatch } from "../scripts/candidates/normalise.mjs";
import { legacyCandidate } from "./fixtures/candidate-records.mjs";
const ok = (result) => {
  assert.equal(result.status, 200, result.body?.code);
  return result.body;
};
test(
  "real local candidate evidence connects to self-onboarding only through independent approval",
  { skip: process.env.RW_LOCAL_JOURNEY !== "1", timeout: 120000 },
  async () => {
    const l = localRuntime(),
      tag = randomUUID().slice(0, 8);
    const operator = await l.verifiedFixtureUser(
        `candidate-op-${tag}@example.test`,
      ),
      doctor = await l.verifiedFixtureUser(`candidate-gp-${tag}@example.test`),
      receiver = await l.verifiedFixtureUser(
        `candidate-owner-${tag}@example.test`,
      );
    await enrollFixtureMfa(operator.client);
    l.sql(
      `insert into private.platform_operators(user_id) values ('${operator.userId}');update private.profession_policies set enabled=true,review_interval_days=7,identifier_pattern='^[A-Z0-9-]{3,80}$',approved_by='${operator.userId}',approved_at=now(),evidence_reference='Fictional candidate journey policy' where profession_id='physiotherapist'`,
    );
    const signup = {
      operation: "register",
      consentConfirmed: true,
      termsVersion: l.env.TERMS_VERSION,
      privacyVersion: l.env.PRIVACY_VERSION,
    };
    ok(
      await l.call(
        "workspace-access",
        {
          ...signup,
          role: "doctor",
          displayName: "Fictional candidate GP",
          practiceName: "Fictional candidate GP practice",
          registrationNumber: "MED-FIXTURE",
          requestId: randomUUID(),
        },
        doctor.client,
      ),
    );
    const application = ok(
      await l.call(
        "workspace-access",
        {
          ...signup,
          role: "practitioner",
          displayName: "Fictional candidate receiver",
          requestId: randomUUID(),
        },
        receiver.client,
      ),
    ).applicationId;
    const counts = () =>
      l.sql(
        "select jsonb_build_array((select count(*) from public.practitioners),(select count(*) from private.professional_credentials),(select count(*) from private.email_jobs))",
      );
    const before = counts();
    const batch = prepareCandidateBatch([
      {
        label: tag,
        bytes: Buffer.from(
          JSON.stringify([legacyCandidate({ candidate_id: `journey-${tag}` })]),
        ),
      },
    ]);
    const importOnce = async () => {
      const { data, error } = await l.admin.rpc("rw_import_candidate_batch", {
        p_actor: operator.userId,
        p_manifest: batch.manifest,
        p_records: batch.records,
      });
      assert.equal(error, null);
      return data;
    };
    const first = await importOnce(),
      replay = await importOnce();
    assert.equal(first.batchId, replay.batchId);
    assert.equal(replay.replayed, true);
    assert.equal(counts(), before);
    for (const user of [doctor, receiver])
      assert.equal(
        (
          await l.call(
            "review-practitioner",
            { operation: "candidate_list" },
            user.client,
          )
        ).status,
        403,
      );
    const summary = ok(
      await l.call(
        "review-practitioner",
        { operation: "candidate_list", search: "Fictional Legacy Person" },
        operator.client,
      ),
    ).items.find(
      (x) =>
        x.id ===
        l.sql(
          `select id from private.practitioner_candidates where source_id='journey-${tag}'`,
        ),
    );
    assert.ok(summary);
    ok(
      await l.call(
        "review-practitioner",
        {
          operation: "candidate_dispose",
          candidateId: summary.id,
          expectedVersion: summary.version,
          disposition: "reviewed_for_onboarding",
          reason: "Fictional reviewed source",
          evidenceReference: "Fictional source reference",
          requestId: randomUUID(),
        },
        operator.client,
      ),
    );
    assert.equal(counts(), before);
    const profile = {
      displayName: "Fictional candidate receiver",
      profession: "physiotherapist",
      registrationNumber: `CAND${tag.toUpperCase()}`,
      practiceName: `Fictional candidate clinic ${tag}`,
      services: ["Physiotherapy"],
      funding: ["Self funded"],
      languages: ["English"],
      telehealth: false,
      acceptingNewReferrals: true,
      locations: [
        { suburb: "Sydney", postcode: "2000", state: "NSW", isPrimary: true },
      ],
    };
    const saved = ok(
      await l.call(
        "practitioner-onboarding",
        {
          operation: "save",
          applicationId: application,
          expectedVersion: 0,
          profile,
        },
        receiver.client,
      ),
    );
    const submitted = ok(
      await l.call(
        "practitioner-onboarding",
        {
          operation: "submit",
          applicationId: application,
          expectedVersion: saved.version,
          profileConfirmed: true,
          referralConsent: true,
          termsVersion: l.env.TERMS_VERSION,
          privacyVersion: l.env.PRIVACY_VERSION,
        },
        receiver.client,
      ),
    );
    const detail = ok(
      await l.call(
        "review-practitioner",
        { operation: "candidate_detail", candidateId: summary.id },
        operator.client,
      ),
    );
    ok(
      await l.call(
        "review-practitioner",
        {
          operation: "candidate_link_application",
          candidateId: summary.id,
          expectedVersion: detail.version,
          applicationId: application,
          reason: "Fictional matching application",
          evidenceReference: "Fictional proof",
          requestId: randomUUID(),
        },
        operator.client,
      ),
    );
    assert.equal(counts(), before);
    const approved = ok(
      await l.call(
        "review-practitioner",
        {
          operation: "decide",
          applicationId: application,
          expectedVersion: submitted.version,
          decision: "approved",
          identityEvidence: {
            method: "independent_practice_contact",
            matched: true,
            reference: "Fictional independent contact",
            checkedAt: new Date().toISOString(),
          },
          registrationEvidence: {
            method: "manual_register",
            matched: true,
            reference: "Fictional register check",
            registrationNumber: profile.registrationNumber,
            checkedAt: new Date().toISOString(),
          },
          applicantFeedback: "",
          requestId: randomUUID(),
        },
        operator.client,
      ),
    );
    const directory = () =>
      l.call(
        "search-practitioners",
        { query: profile.practiceName },
        doctor.client,
      );
    const results = ok(await directory());
    assert.ok(JSON.stringify(results).includes(profile.practiceName));
    const id =
      approved.practitioner_id ||
      l.sql(
        `select practitioner_id from public.practitioner_applications where id='${application}'`,
      );
    ok(
      await l.call(
        "practitioner-onboarding",
        {
          operation: "availability",
          practitionerId: id,
          acceptingNewReferrals: false,
        },
        receiver.client,
      ),
    );
    assert.equal(
      JSON.stringify(ok(await directory())).includes(profile.practiceName),
      false,
    );
    assert.equal(
      (await operator.client.from("referrals").select("id")).data?.length,
      0,
    );
  },
);
