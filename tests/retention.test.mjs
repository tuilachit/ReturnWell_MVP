import test from "node:test";
import assert from "node:assert/strict";
const api = await import("../app/lib/retention-policy.ts").catch(() => ({}));
test("unapproved retention cannot authorise purging and legal holds always win", () => {
  assert.equal(typeof api.canPurgeRecord, "function");
  const old = "2000-01-01T00:00:00Z";
  assert.equal(api.canPurgeRecord(null, old, false), false);
  const policy = {
    recordClass: "fictional_test",
    keepForDays: 1,
    approvedBy: "Fictional test owner",
    approvedAt: "2026-01-01T00:00:00Z",
    legalHoldBehaviour: "retain",
  };
  assert.equal(api.canPurgeRecord(policy, old, true), false);
  assert.equal(
    api.canPurgeRecord({ ...policy, approvedBy: "" }, old, false),
    false,
  );
  assert.equal(
    api.canPurgeRecord({ ...policy, keepForDays: NaN }, old, false),
    false,
  );
  assert.equal(api.canPurgeRecord(policy, "invalid", false), false);
  assert.equal(api.canPurgeRecord(policy, old, false), true);
});
