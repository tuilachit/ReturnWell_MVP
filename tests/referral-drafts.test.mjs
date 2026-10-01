import assert from "node:assert/strict";
import test from "node:test";
import {
  validateDraft,
  saveReferralDraft,
  finalizeReferralDraft,
} from "../app/lib/referral-drafts.ts";
test("partial drafts are valid but unknown clinical identity fields are rejected", () => {
  assert.deepEqual(
    validateDraft({ clinicalSummary: "Unsent fictional notes" }),
    [],
  );
  assert.ok(validateDraft({ patientName: "Must not store" }).length);
  assert.ok(validateDraft({ patientPostcode: 2000 }).length);
  assert.ok(validateDraft({ patientPostcode: "20" }).length);
  assert.ok(validateDraft({ clinicalSummary: "x".repeat(4001) }).length);
  assert.ok(validateDraft({ accessNotes: "x".repeat(501) }).length);
  assert.deepEqual(
    validateDraft({
      patientReference: "x".repeat(120),
      accessNotes: "x".repeat(500),
    }),
    [],
  );
});
test("save and finalise use stable supplied IDs; no browser persistence or implicit consent", async () => {
  const calls = [];
  const client = {
    functions: {
      invoke: async (name, { body }) => {
        calls.push({ name, body });
        return { data: { id: "draft" }, error: null };
      },
    },
  };
  await saveReferralDraft(client, {
    id: "draft",
    organisationId: "org",
    expectedVersion: -1,
    input: {},
    requestId: "save",
  });
  await finalizeReferralDraft(client, {
    id: "draft",
    expectedVersion: 0,
    consentConfirmed: true,
    requestId: "send",
  });
  assert.equal(calls[0].name, "manage-referral");
  assert.equal(calls[0].body.operation, "draft.save");
  assert.equal(calls[1].body.operation, "draft.finalize");
  assert.equal(calls[1].body.id, "draft");
  assert.equal(calls[1].body.consentConfirmed, true);
});
