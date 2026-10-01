import test from "node:test";
import assert from "node:assert/strict";
const api = await import("../supabase/functions/_shared/release-mode.ts").catch(
  () => ({}),
);
test("private test cannot look like public release and unknown mode fails closed", () => {
  assert.equal(typeof api.validateReleaseConfig, "function");
  assert.equal(api.validateReleaseConfig({}).mode, "private_test");
  assert.equal(
    api.validateReleaseConfig({ RELEASE_MODE: "production" }).ready,
    false,
  );
  assert.equal(
    api.publicReleaseInfo({ RELEASE_MODE: "pilot" }).label,
    "Private test",
  );
});
test("pilot requires reviewed identity, notices, support and release approvals", () => {
  const result = api.validateReleaseConfig({
    RELEASE_MODE: "pilot",
    RETURNWELL_BUSINESS_NAME: "Test",
    SUPPORT_EMAIL: "founder@example.test",
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("pilot_approval_required"));
  assert.ok(result.blockers.includes("reviewed_notices_required"));
});
test("private test mail needs an explicit nonempty exact recipient allowlist and restore gate", () => {
  assert.equal(
    api.deliveryPermitted({ EMAIL_DELIVERY_ENABLED: "true" }),
    false,
  );
  assert.equal(
    api.deliveryPermitted({
      EMAIL_DELIVERY_ENABLED: "true",
      EMAIL_TEST_ALLOWLIST: "*",
    }),
    false,
  );
  const allowed = {
    EMAIL_DELIVERY_ENABLED: "true",
    EMAIL_TEST_ALLOWLIST: "test@example.test",
  };
  assert.equal(api.deliveryPermitted(allowed), true);
  assert.equal(
    api.deliveryPermitted({ ...allowed, RESTORE_QUARANTINE: "true" }),
    false,
  );
  assert.equal(
    api.deliveryPermitted({ ...allowed, RELEASE_MODE: "pilot" }),
    false,
  );
});
