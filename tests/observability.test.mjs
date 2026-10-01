import test from "node:test";
import assert from "node:assert/strict";
const api =
  await import("../supabase/functions/_shared/observability.ts").catch(
    () => ({}),
  );
test("operational signals reject sensitive fields and permit only route templates", () => {
  assert.equal(typeof api.operationalEvent, "function");
  const input = {
    event: "dispatch_completed",
    routeTemplate: "dispatch-email-jobs",
    status: 200,
    durationMs: 23,
    requestId: "00000000-0000-4000-8000-000000000001",
    releaseId: "abcdef0",
  };
  assert.deepEqual(api.operationalEvent(input), input);
  for (const extra of [
    { message: "clinical secret" },
    { error: new Error("secret") },
    { url: "https://a.test/#token" },
    { email: "test@example.test" },
    { body: { token: "secret" } },
  ])
    assert.equal(api.operationalEvent({ ...input, ...extra }), null);
  assert.equal(
    api.operationalEvent({ ...input, routeTemplate: "/referrals/patient-123" }),
    null,
  );
});
test("queue age and heartbeat detect a stall, unchanged alerts deduplicate", () => {
  const healthy = {
    pendingCount: 1,
    oldestPendingSeconds: 10,
    authOverdueCount: 0,
    needsReviewCount: 0,
    failedCount: 0,
    lastDispatchAt: new Date().toISOString(),
    webhookFailureCount: 0,
  };
  assert.deepEqual(api.healthAlerts(healthy), []);
  const unhealthy = {
    ...healthy,
    oldestPendingSeconds: 400,
    authOverdueCount: 1,
    needsReviewCount: 1,
    lastDispatchAt: null,
    webhookFailureCount: 2,
  };
  const alerts = api.healthAlerts(unhealthy);
  assert.deepEqual(alerts, [
    "dispatcher_stalled",
    "auth_overdue",
    "queue_aged",
    "delivery_needs_review",
    "webhook_persistence_failed",
  ]);
  assert.deepEqual(api.changedAlerts(alerts, alerts), []);
  assert.deepEqual(api.changedAlerts([], alerts), alerts);
});
test("authorised dispatcher records durable heartbeat and failures without logging thrown content", async (t) => {
  const { dispatchHandler } =
    await import("../supabase/functions/_shared/dispatch-http.ts");
  const output = [];
  t.mock.method(console, "info", (value) => output.push(value));
  let actions = [];
  const handler = dispatchHandler(
    {
      env: { EMAIL_WORKER_SECRET: "fictional-worker" },
      rpc: async (_actor, action, input) => {
        actions.push([action, input]);
        return action === "email.claim" ? [] : { ok: true };
      },
    },
    async () => {
      throw Error("must not send");
    },
  );
  const request = () =>
    new Request("https://worker.example.test", {
      method: "POST",
      headers: { authorization: "Bearer fictional-worker" },
      body: "{}",
    });
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(
    actions.map((x) => x[0]),
    ["operations.record", "email.claim", "operations.record"],
  );
  assert.equal(actions.at(-1)[1].event, "dispatch_completed");
  actions = [];
  assert.equal(
    (
      await handler(
        new Request("https://worker.example.test", {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
    401,
  );
  assert.equal(actions.length, 0);
  const failing = dispatchHandler({
    env: { EMAIL_WORKER_SECRET: "fictional-worker" },
    rpc: async () => {
      throw Error("FICTIONAL CLINICAL SECRET token=password");
    },
  });
  assert.equal((await failing(request())).status, 503);
  assert.doesNotMatch(
    output.join(""),
    /CLINICAL|SECRET|password|fictional-worker/,
  );
});
