import assert from "node:assert/strict";
import test from "node:test";
const api = await import("../app/lib/invitation-progress.ts").catch(() => ({}));
const progress = {
  invitationId: "test",
  status: "pending",
  expiresAt: "2026-10-10T00:00:00Z",
  generation: 1,
  signupCompletedAt: null,
  accountWasNew: null,
  delivery: { state: "delivered", updatedAt: null, nextRetryAt: null },
};
test("existing account confirmation is not a new signup", () => {
  assert.equal(typeof api.invitationProgressLabel, "function");
  assert.match(
    api.invitationProgressLabel({
      ...progress,
      status: "claimed",
      signupCompletedAt: "2026-10-02T00:00:00Z",
      accountWasNew: false,
    }),
    /Existing account/,
  );
  assert.match(
    api.invitationProgressLabel({
      ...progress,
      status: "claimed",
      signupCompletedAt: "2026-10-02T00:00:00Z",
      accountWasNew: true,
    }),
    /New account/,
  );
});
test("delivered is neither accepted nor read; expired pending invitation has a next action", () => {
  assert.equal(typeof api.deliveryProgressLabel, "function");
  assert.match(api.deliveryProgressLabel(progress.delivery), /not mean read/);
  assert.doesNotMatch(
    api.invitationProgressLabel(progress, Date.parse("2026-10-02")),
    /accepted|complete/i,
  );
  assert.match(
    api.invitationProgressLabel(progress, Date.parse("2026-10-12")),
    /expired/i,
  );
  for (const state of [
    "pending",
    "sent",
    "delivered",
    "delayed",
    "suppressed",
    "failed",
    "configuration_needed",
    "needs_review",
    "cancelled",
    "unknown",
  ])
    assert.ok(api.deliveryProgressLabel({ ...progress.delivery, state }));
});
