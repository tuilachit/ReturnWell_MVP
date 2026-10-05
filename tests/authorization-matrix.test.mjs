import assert from "node:assert/strict";
import test from "node:test";
import { workflowHandler } from "../supabase/functions/_shared/workflow-http.ts";

const request = (operation, extra = {}) =>
  new Request("https://api.example.test", {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body: JSON.stringify({ operation, ...extra }),
  });
test("privileged writes reject AAL1, missing assurance and forged body metadata before service RPC", async () => {
  for (const [endpoint, operation] of [
    ["review-practitioner", "decide"],
    ["review-practitioner", "suspend"],
    ["review-practitioner", "restore"],
    ["review-practitioner", "candidate_dispose"],
    ["review-practitioner", "candidate_withdraw_batch"],
    ...["create", "reviewContact", "reviewInviter", "revokeMember"].map(
      (op) => ["manage-practice", op],
    ),
  ]) {
    for (const user of [
      { id: "actor" },
      { id: "actor", aal: "aal1", user_metadata: { aal: "aal2" } },
    ]) {
      let calls = 0;
      const handle = workflowHandler(endpoint, {
        env: {},
        getUser: async () => user,
        rpc: async () => {
          calls++;
          return {};
        },
      });
      const response = await handle(
        request(operation, {
          aal: "aal2",
          role: "operator",
          actorId: "victim",
        }),
      );
      assert.equal(response.status, 403, `${endpoint}/${operation}`);
      assert.equal((await response.json()).code, "step_up_required");
      assert.equal(calls, 0);
    }
  }
});
test("verified AAL2 only unlocks the independent database authorization check", async () => {
  let actor;
  const handle = workflowHandler("review-practitioner", {
    env: {},
    getUser: async () => ({ id: "verified-subject", aal: "aal2" }),
    rpc: async (id, action, input) => {
      actor = id;
      assert.equal(action, "review.decide");
      assert.equal(input.aal, undefined);
      throw Error("denied");
    },
  });
  const response = await handle(
    request("decide", { actorId: "operator", aal: "aal2" }),
  );
  assert.equal(actor, "verified-subject");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "denied");
});
test("identity assurance requires provider verification and matching subject; removed factors fail closed", async () => {
  const api =
    await import("../supabase/functions/_shared/authorization.ts").catch(
      () => ({}),
    );
  assert.equal(typeof api.verifiedIdentity, "function");
  const auth = (
    claims,
    user = { id: "actor", factors: [{ status: "verified" }] },
    error = null,
  ) => ({
    getUser: async () => ({ data: { user }, error }),
    getClaims: async () => ({ data: { claims }, error }),
  });
  assert.deepEqual(
    await api.verifiedIdentity(auth({ sub: "actor", aal: "aal2" }), "token"),
    { id: "actor", aal: "aal2" },
  );
  assert.equal(
    await api.verifiedIdentity(auth({ sub: "wrong", aal: "aal2" }), "token"),
    null,
  );
  assert.equal(
    await api.verifiedIdentity(
      auth({ sub: "actor", aal: "aal2" }, null, new Error("invalid")),
      "forged",
    ),
    null,
  );
  assert.deepEqual(
    await api.verifiedIdentity(
      auth({ sub: "actor", aal: "aal2" }, { id: "actor", factors: [] }),
      "token",
    ),
    { id: "actor", aal: "aal1" },
  );
});
