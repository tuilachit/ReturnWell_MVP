import assert from "node:assert/strict";
import test from "node:test";

import { matchPractitioners } from "../app/lib/matching.ts";

test("name order uses the same ASCII-folded codepoint key as database cursors", () => {
  const result = matchPractitioners(
    ["Zara", "ábaco", "Alex", "alex", "😀", "\uE000"].map((displayName, i) =>
      candidate({ id: String(i), displayName }),
    ),
    needs,
  );
  assert.deepEqual(
    result.map((x) => x.practitioner.id),
    ["2", "3", "0", "1", "5", "4"],
  );
});

const needs = {
  profession: "physiotherapist",
  appointmentFormat: "telehealth",
  fundingPath: "Medicare",
  language: "Mandarin",
};

const candidate = (overrides = {}) => ({
  id: "p-1",
  displayName: "Avery Hart",
  practiceName: "Example Allied Health",
  profession: "physiotherapist",
  lifecycleStatus: "active",
  ahpraVerificationStatus: "verified",
  credentials: [
    {
      professionId: "physiotherapist",
      authorityId: "ahpra_physiotherapy",
      route: "ahpra",
      status: "verified",
      policyEnabled: true,
      checkedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: null,
      reviewDueAt: new Date(Date.now() + 86400000).toISOString(),
    },
  ],
  providerConfirmationStatus: "confirmed",
  acceptingNewReferrals: true,
  telehealth: true,
  funding: ["Medicare"],
  languages: ["English", "Mandarin"],
  services: ["Persistent pain"],
  location: { suburb: "Sydney", postcode: "2000" },
  distanceKm: 4.2,
  ...overrides,
});

test("returns only active, verified, confirmed practitioners accepting referrals", () => {
  const result = matchPractitioners(
    [
      candidate(),
      candidate({ id: "inactive", lifecycleStatus: "inactive" }),
      candidate({ id: "unchecked", credentials: [] }),
      candidate({
        id: "unconfirmed",
        providerConfirmationStatus: "not_contacted",
      }),
      candidate({ id: "closed", acceptingNewReferrals: false }),
    ],
    needs,
  );

  assert.deepEqual(
    result.map((item) => item.practitioner.id),
    ["p-1"],
  );
});

test("applies profession, format, funding and language as literal eligibility rules", () => {
  const result = matchPractitioners(
    [
      candidate(),
      candidate({ id: "wrong-profession", profession: "psychologist" }),
      candidate({ id: "no-telehealth", telehealth: false }),
      candidate({ id: "wrong-funding", funding: ["Self funded"] }),
      candidate({ id: "wrong-language", languages: ["English"] }),
    ],
    needs,
  );

  assert.deepEqual(
    result.map((item) => item.practitioner.id),
    ["p-1"],
  );
});

test("sorts by known distance then name and explains the order without a score", () => {
  const result = matchPractitioners(
    [
      candidate({ id: "far", displayName: "Alex Lee", distanceKm: 8.1 }),
      candidate({ id: "unknown", displayName: "Bri Nguyen", distanceKm: null }),
      candidate({ id: "near-z", displayName: "Zara Cole", distanceKm: 2.3 }),
      candidate({ id: "near-a", displayName: "Ari Cole", distanceKm: 2.3 }),
    ],
    { ...needs, appointmentFormat: "in_person" },
  );

  assert.deepEqual(
    result.map((item) => item.practitioner.id),
    ["near-a", "near-z", "far", "unknown"],
  );
  assert.deepEqual(result[0].reasons, [
    "Registration verified",
    "Provider details confirmed",
    "Accepting new referrals",
    "Funding pathway reported: Medicare",
    "Speaks Mandarin",
    "Approx. 2.3 km between postcode areas",
  ]);
  assert.equal("score" in result[0], false);
});

test("canonical capability requirements need explicit provider confirmation, not free-text inference", () => {
  const structured = {
    professionId: "physiotherapist",
    appointmentFormat: "either",
    fundingId: "medicare",
    preferredLanguageId: "mandarin",
    requiredServiceIds: ["persistent_pain"],
    patientAgeGroupId: "adult",
  };
  const result = matchPractitioners(
    [
      candidate({ id: "text-only" }),
      candidate({
        id: "wrong-age",
        serviceIds: ["persistent_pain"],
        ageGroupIds: ["child"],
      }),
      candidate({
        id: "confirmed",
        serviceIds: ["persistent_pain"],
        ageGroupIds: ["adult"],
      }),
    ],
    structured,
  );
  assert.deepEqual(
    result.map((x) => x.practitioner.id),
    ["confirmed"],
  );
  assert.ok(result[0].reasons.includes("Service: Persistent pain"));
  assert.ok(result[0].warnings.some((x) => x.includes("rebate")));
  assert.equal(
    matchPractitioners([candidate()], {
      ...structured,
      requiredServiceIds: ["made_up"],
      patientAgeGroupId: undefined,
    }).length,
    0,
  );
  assert.equal(
    matchPractitioners([candidate()], {
      ...structured,
      requiredServiceIds: [],
      patientAgeGroupId: undefined,
    }).length,
    1,
  );
});
test("known aliases normalise, but ambiguous funding and access notes never become criteria", () => {
  const base = {
    professionId: "physiotherapist",
    appointmentFormat: "either",
    fundingId: " private HEALTH insurance ",
    preferredLanguageId: " MANDARIN ",
    requiredServiceIds: [],
    accessNotes: "wheelchair access",
  };
  assert.equal(
    matchPractitioners([candidate({ funding: ["private_health"] })], base)
      .length,
    1,
  );
  assert.equal(
    matchPractitioners([candidate({ funding: ["Private"] })], {
      ...base,
      fundingId: "Private",
    }).length,
    0,
  );
  assert.equal(
    matchPractitioners([candidate()], {
      ...base,
      fundingId: "medicare",
      preferredLanguageId: "Chinese",
    }).length,
    0,
  );
});
test("telehealth ignores distance and clinical text, and duplicate names tie-break by id", () => {
  const providers = [
    candidate({ id: "z", distanceKm: 0 }),
    candidate({ id: "a", distanceKm: 100 }),
  ];
  const result = matchPractitioners(providers, {
    ...needs,
    clinicalSummary: "Do not rank based on this text",
  });
  assert.deepEqual(
    result.map((x) => x.practitioner.id),
    ["a", "z"],
  );
  assert.equal(result[0].distanceKm, null);
  assert.equal(
    result[0].reasons.some((x) => x.includes("km")),
    false,
  );
  assert.equal(
    matchPractitioners([candidate({ profileRevisionPending: true })], needs)
      .length,
    0,
  );
});
