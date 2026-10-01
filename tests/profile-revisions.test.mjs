import assert from "node:assert/strict";
import test from "node:test";
import { startProfileRevision } from "../app/lib/profile-revisions.ts";
test("reviewed revisions preserve caller request identity and use the private workflow", async () => {
  const calls = [];
  const client = {
    functions: {
      invoke: async (name, { body }) => {
        calls.push({ name, body });
        return { data: { id: "revision" }, error: null };
      },
    },
  };
  await startProfileRevision(client, {
    practitionerId: "profile",
    requestId: "stable",
  });
  assert.deepEqual(calls, [
    {
      name: "practitioner-onboarding",
      body: {
        operation: "revision_start",
        practitionerId: "profile",
        requestId: "stable",
      },
    },
  ]);
});
