import assert from "node:assert/strict";
import test from "node:test";
import { isEligibleForNewReferral } from "../app/lib/credentials.ts";
const now = new Date("2026-10-01T10:00:00Z");
const credential = {
  professionId: "physiotherapist",
  authorityId: "ahpra_physiotherapy",
  route: "ahpra",
  status: "verified",
  checkedAt: "2026-10-01T00:00:00Z",
  reviewDueAt: "2026-10-08T00:00:00Z",
  expiresAt: null,
  policyEnabled: true,
};
const profile = {
  lifecycleStatus: "active",
  providerConfirmationStatus: "confirmed",
  acceptingNewReferrals: true,
  accessSuspended: false,
  credentials: [credential],
};
test("eligibility requires a current independently reviewed credential, not legacy flags", () => {
  assert.equal(isEligibleForNewReferral(profile, "physiotherapist", now), true);
  for (const patch of [
    { credentials: [] },
    { credentials: undefined },
    { accessSuspended: true },
    { acceptingNewReferrals: false },
    { providerConfirmationStatus: "not_contacted" },
  ]) {
    assert.equal(
      isEligibleForNewReferral(
        { ...profile, ...patch },
        "physiotherapist",
        now,
      ),
      false,
    );
  }
});
test("authority, route, policy approval, expiry and review boundary all fail closed", () => {
  for (const patch of [
    { authorityId: "ahpra_psychology" },
    { route: "professional_body" },
    { policyEnabled: false },
    { reviewDueAt: null },
    { reviewDueAt: now.toISOString() },
    { expiresAt: now.toISOString() },
    { expiresAt: "invalid" },
    { checkedAt: null },
    { checkedAt: "invalid" },
    { checkedAt: "2026-10-02T00:00:00Z" },
    { status: "failed" },
  ]) {
    assert.equal(
      isEligibleForNewReferral(
        { ...profile, credentials: [{ ...credential, ...patch }] },
        "physiotherapist",
        now,
      ),
      false,
      JSON.stringify(patch),
    );
  }
  assert.equal(
    isEligibleForNewReferral(profile, "exercise_physiologist", now),
    false,
  );
});
