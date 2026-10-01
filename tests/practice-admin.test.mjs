import assert from "node:assert/strict";
import test from "node:test";
import { workflowHandler } from "../supabase/functions/_shared/workflow-http.ts";
test("practice endpoints bind actor to verified identity and discard forged authority", async () => {
  const calls = [];
  const handle = workflowHandler("manage-practice", {
    env: {},
    getUser: async () => ({ id: "operator", aal: "aal2" }),
    rpc: async (...args) => {
      calls.push(args);
      return { ok: true };
    },
  });
  const result = await handle(
    new Request("https://api.example.test", {
      method: "POST",
      headers: { authorization: "Bearer verified" },
      body: JSON.stringify({
        operation: "create",
        name: "Fictional practice",
        ownerUserId: "owner",
        evidenceReference: "independent-check",
        requestId: "stable",
        role: "operator",
        actorId: "victim",
      }),
    }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [
    [
      "operator",
      "practice.create",
      {
        name: "Fictional practice",
        ownerUserId: "owner",
        evidenceReference: "independent-check",
        requestId: "stable",
      },
    ],
  ]);
});
test("typed practice client forwards operation without browser-side role inference", async () => {
  const api = await import("../app/lib/practice-admin.ts").catch(() => ({}));
  assert.equal(typeof api.managePractice, "function");
  let captured;
  const client = {
    functions: {
      invoke: async (name, options) => {
        captured = { name, ...options };
        return { data: { practices: [] }, error: null };
      },
    },
  };
  assert.deepEqual(await api.managePractice(client, { operation: "list" }), {
    practices: [],
  });
  assert.deepEqual(captured, {
    name: "manage-practice",
    body: { operation: "list" },
  });
});
