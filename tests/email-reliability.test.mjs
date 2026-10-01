import assert from "node:assert/strict";
import test from "node:test";
import { dispatchJobs } from "../supabase/functions/_shared/dispatch.ts";
import { seal } from "../supabase/functions/_shared/workflow-security.ts";
const provider =
  await import("../supabase/functions/_shared/provider-transport.ts").catch(
    () => ({}),
  );
const webhook =
  await import("../supabase/functions/_shared/webhook-http.ts").catch(
    () => ({}),
  );
const env = {
  EMAIL_DELIVERY_ENABLED: "true",
  EMAIL_TEST_ALLOWLIST: "fixture@example.test",
  RESEND_API_KEY: "fictional",
  RESEND_FROM: "ReturnWell <mail@example.test>",
  APP_URL: "https://returnwell.example.test",
  WEBSITE_URL: "https://returnwell.example.test",
  SUPPORT_EMAIL: "support@example.test",
  RETURNWELL_BUSINESS_NAME: "Fictional",
  PRIVACY_URL: "https://returnwell.example.test/privacy",
  TERMS_URL: "https://returnwell.example.test/terms",
  TERMS_VERSION: "v1",
  PRIVACY_VERSION: "v1",
  INVITATION_KEY_ID: "fixture",
  INVITATION_ENCRYPTION_KEY: btoa("a".repeat(32)),
};
test("provider transport bounds even an unresponsive fetch and aborts without exposing payload", async () => {
  assert.equal(provider.PROVIDER_TIMEOUT_MS, 15000);
  assert.equal(typeof provider.sendProviderEmail, "function");
  let signal;
  const started = Date.now();
  await assert.rejects(
    provider.sendProviderEmail(env, { text: "FICTIONAL SECRET" }, "stable", {
      timeoutMs: 20,
      fetch: async (_url, init) => {
        signal = init.signal;
        return new Promise(() => {});
      },
    }),
    /provider_timeout/,
  );
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - started < 1000);
});
test("429 sends provider delay to durable retry scheduling; malformed success stays uncertain with the same frozen payload and key", async () => {
  const payload = {
    from: env.RESEND_FROM,
    to: ["fixture@example.test"],
    subject: "Fixture",
    text: "Fictional stable email",
  };
  const job = {
    id: "job",
    lease_id: "lease",
    idempotency_key: "stable",
    recipient_email: "fixture@example.test",
    prepared_payload: await seal(
      payload,
      env.INVITATION_ENCRYPTION_KEY,
      env.INVITATION_KEY_ID,
      "job",
    ),
  };
  const finishes = [];
  let sends = 0;
  const runtime = {
    env,
    rpc: async (_actor, action, input) => {
      if (action === "email.claim") return [job];
      if (action === "email.finish") finishes.push(input);
      return { sendAllowed: true };
    },
  };
  await dispatchJobs(runtime, 1, async (message, key) => {
    sends++;
    assert.deepEqual(message, payload);
    assert.equal(key, "stable");
    return new Response("{}", {
      status: 429,
      headers: { "retry-after": "600" },
    });
  });
  assert.equal(finishes[0].retryAfterSeconds, 600);
  await dispatchJobs(runtime, 1, async (message, key) => {
    sends++;
    assert.deepEqual(message, payload);
    assert.equal(key, "stable");
    return new Response("malformed", { status: 200 });
  });
  assert.equal(finishes[1].outcome, "transient");
  assert.equal(sends, 2);
});
async function signedEvent(secret, payload) {
  const eventId = "fixture-event",
    timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret.replace("whsec_", ""), "base64"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${eventId}.${timestamp}.${payload}`),
    ),
  ).toString("base64");
  return new Request("https://api.example.test", {
    method: "POST",
    headers: {
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": "v1," + signature,
    },
    body: payload,
  });
}
test("signed callback only acknowledges durable persistence and never forwards raw private event fields", async () => {
  assert.equal(typeof webhook.webhookHandler, "function");
  const secret = "whsec_" + Buffer.from("s".repeat(32)).toString("base64");
  const payload = JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: {
      email_id: "provider-fixture",
      to: ["SECRET@example.test"],
      subject: "PRIVATE",
    },
  });
  const writes = [];
  const handler = webhook.webhookHandler({
    env: { RESEND_WEBHOOK_SECRET: secret },
    rpc: async (...args) => writes.push(args),
  });
  assert.equal(
    (
      await handler(
        new Request("https://api.example.test", {
          method: "POST",
          body: payload,
        }),
      )
    ).status,
    401,
  );
  assert.equal(writes.length, 0);
  assert.equal((await handler(await signedEvent(secret, payload))).status, 200);
  assert.doesNotMatch(JSON.stringify(writes), /SECRET|PRIVATE|"to"/);
  const failing = webhook.webhookHandler({
    env: { RESEND_WEBHOOK_SECRET: secret },
    rpc: async () => {
      throw Error("SECRET");
    },
  });
  const failure = await failing(await signedEvent(secret, payload));
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /SECRET/);
});
