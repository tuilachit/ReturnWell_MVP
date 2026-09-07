import assert from "node:assert/strict";
import test from "node:test";

import { matchPractitioners } from "../app/lib/matching.ts";

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
  const result = matchPractitioners([
    candidate(),
    candidate({ id: "inactive", lifecycleStatus: "inactive" }),
    candidate({ id: "unchecked", ahpraVerificationStatus: "not_checked" }),
    candidate({ id: "unconfirmed", providerConfirmationStatus: "not_contacted" }),
    candidate({ id: "closed", acceptingNewReferrals: false }),
  ], needs);

  assert.deepEqual(result.map((item) => item.practitioner.id), ["p-1"]);
});

test("applies profession, format, funding and language as literal eligibility rules", () => {
  const result = matchPractitioners([
    candidate(),
    candidate({ id: "wrong-profession", profession: "psychologist" }),
    candidate({ id: "no-telehealth", telehealth: false }),
    candidate({ id: "wrong-funding", funding: ["Self funded"] }),
    candidate({ id: "wrong-language", languages: ["English"] }),
  ], needs);

  assert.deepEqual(result.map((item) => item.practitioner.id), ["p-1"]);
});

test("sorts by known distance then name and explains the order without a score", () => {
  const result = matchPractitioners([
    candidate({ id: "far", displayName: "Alex Lee", distanceKm: 8.1 }),
    candidate({ id: "unknown", displayName: "Bri Nguyen", distanceKm: null }),
    candidate({ id: "near-z", displayName: "Zara Cole", distanceKm: 2.3 }),
    candidate({ id: "near-a", displayName: "Ari Cole", distanceKm: 2.3 }),
  ], needs);

  assert.deepEqual(result.map((item) => item.practitioner.id), ["near-a", "near-z", "far", "unknown"]);
  assert.deepEqual(result[0].reasons, [
    "Registration verified",
    "Provider details confirmed",
    "Accepting new referrals",
    "Offers telehealth",
    "Supports Medicare",
    "Speaks Mandarin",
    "2.3 km from the patient postcode",
  ]);
  assert.equal("score" in result[0], false);
});
