import assert from "node:assert/strict";
import test from "node:test";
const api = await import("../app/lib/profile-validation.ts").catch(() => ({}));
const policies = [
  {
    professionId: "physiotherapist",
    enabled: true,
    scope: "supported",
    route: "ahpra",
  },
];
const complete = {
  displayName: "Fictional Person",
  practiceName: "Fictional Practice",
  profession: "physiotherapist",
  registrationNumber: "PHY0001234567",
  services: ["Physiotherapy"],
  funding: ["medicare"],
  languages: ["english"],
  telehealth: true,
  acceptingNewReferrals: false,
  locations: [],
};
test("partial drafts are saveable without guessing missing answers", () => {
  assert.equal(typeof api.validateProfile, "function");
  assert.deepEqual(
    api.validateProfile({ displayName: "Draft" }, policies, false),
    [],
  );
  const issues = api.validateProfile({ displayName: "Draft" }, policies);
  for (const field of [
    "profession",
    "registrationNumber",
    "practiceName",
    "telehealth",
    "acceptingNewReferrals",
    "languages",
    "services",
  ])
    assert.ok(
      issues.some((i) => i.field === field),
      field,
    );
});
test("complete validation respects enabled protocol, limits, controlled terms and location completeness", () => {
  assert.equal(typeof api.validateProfile, "function");
  assert.deepEqual(api.validateProfile(complete, policies), []);
  assert.ok(
    api
      .validateProfile(complete, [{ ...policies[0], enabled: false }])
      .some((i) => i.field === "profession"),
  );
  assert.ok(
    api
      .validateProfile({ ...complete, languages: ["Chinese"] }, policies)
      .some((i) => i.field === "languages"),
  );
  assert.ok(
    api
      .validateProfile({ ...complete, telehealth: false }, policies)
      .some((i) => i.field === "locations"),
  );
  assert.ok(
    api
      .validateProfile(
        {
          ...complete,
          locations: [
            {
              suburb: "Sydney",
              postcode: "20",
              state: "NSW",
              isPrimary: false,
            },
          ],
        },
        policies,
      )
      .some((i) => i.field === "locations.0.postcode"),
  );
  assert.ok(
    api
      .validateProfile(
        { ...complete, displayName: "x".repeat(161) },
        policies,
        false,
      )
      .some((i) => i.field === "displayName"),
  );
});
test("submission needs explicit current confirmations; edited notices invalidate prior consent", () => {
  assert.equal(typeof api.canConfirmProfile, "function");
  const current = {
    current_terms_version: "terms-2",
    current_privacy_version: "privacy-2",
  };
  assert.equal(
    api.canConfirmProfile(current, {
      profileConfirmed: true,
      referralConsent: true,
      termsVersion: "terms-1",
      privacyVersion: "privacy-2",
    }),
    false,
  );
  assert.equal(
    api.canConfirmProfile(current, {
      profileConfirmed: true,
      referralConsent: false,
      termsVersion: "terms-2",
      privacyVersion: "privacy-2",
    }),
    false,
  );
  assert.equal(
    api.canConfirmProfile(current, {
      profileConfirmed: true,
      referralConsent: true,
      termsVersion: "terms-2",
      privacyVersion: "privacy-2",
    }),
    true,
  );
  assert.equal(
    api.canConfirmProfile(
      {},
      { profileConfirmed: true, referralConsent: true },
    ),
    false,
  );
});
