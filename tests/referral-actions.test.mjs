import assert from "node:assert/strict";
import test from "node:test";
import { buildNotification } from "../supabase/functions/_shared/email.ts";
const actions = await import("../app/lib/referral-actions.ts").catch(
  () => ({}),
);
test("only the permitted practice lifecycle actions are offered", () => {
  assert.equal(typeof actions.allowedReferralActions, "function");
  for (const [status, expected] of Object.entries({
    sent: ["cancel"],
    awaiting_onboarding: ["cancel"],
    accepted: ["cancel", "close"],
    declined: ["replace"],
    cancelled: ["replace"],
    closed: [],
    booked: [],
  }))
    assert.deepEqual(actions.allowedReferralActions(status), expected);
});
test("cancel and close emails contain only generic coordination copy", () => {
  for (const kind of ["referral_cancelled", "referral_closed"]) {
    const message = buildNotification(
      {
        id: "job",
        referralId: "00000000-0000-4000-8000-000000000001",
        kind,
        recipientEmail: "fictional@example.test",
        idempotencyKey: "stable",
        templateData: { note: "PRIVATE COORDINATION NOTE" },
      },
      "https://returnwell.example.test",
      {
        websiteUrl: "https://returnwell.example.test",
        supportEmail: "support@example.test",
        businessName: "Fictional ReturnWell",
      },
    );
    assert.match(message.subject, /ReturnWell/);
    assert.doesNotMatch(
      message.text + message.html,
      /PRIVATE COORDINATION NOTE/,
    );
  }
});
test("action requests retain caller idempotency and reject invalid reasons or long notes", async () => {
  const calls = [];
  const client = {
    functions: {
      invoke: async (name, { body }) => {
        calls.push({ name, body });
        return {
          data: { referral: { id: "ref", status: "cancelled", version: 1 } },
          error: null,
        };
      },
    },
  };
  assert.equal(typeof actions.transitionReferral, "function");
  const input = {
    referralId: "ref",
    expectedVersion: 0,
    requestId: "stable",
    action: "cancel",
    reasonCode: "entered_in_error",
    note: "Fictional internal note",
  };
  await actions.transitionReferral(client, input);
  await actions.transitionReferral(client, input);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].body.operation, "transition");
  await assert.rejects(
    actions.transitionReferral(client, {
      ...input,
      reasonCode: "handover_completed",
    }),
  );
  await assert.rejects(
    actions.transitionReferral(client, { ...input, note: "x".repeat(501) }),
  );
  assert.equal(calls.length, 2);
});
