import test from "node:test";
import assert from "node:assert/strict";
const worker = await import("../supabase/functions/_shared/dispatch.ts").catch(
  () => ({}),
);
test("delivery defaults to disabled and calls no email provider", async () => {
  assert.equal(
    typeof worker.dispatchJobs,
    "function",
    "email worker must be implemented",
  );
  const operations = [];
  const result = await worker.dispatchJobs(
    {
      env: {},
      rpc: async (_actor, action, input) => {
        operations.push([action, input]);
        return [];
      },
    },
    10,
    async () => {
      throw Error("provider must remain disabled");
    },
  );
  assert.equal(result.processed, 0);
  assert.equal(result.configurationNeeded, true);
  assert.deepEqual(operations, [["email.claim", {
    configured: false,
    limit: 10,
  }]]);
});
test("generic notification dispatch freezes one payload then records the provider result with its lease", async () => {
  assert.equal(typeof worker.dispatchJobs, "function");
  const env = {
    EMAIL_DELIVERY_ENABLED: "true",
    RESEND_API_KEY: "fake-key",
    RESEND_FROM: "ReturnWell <notifications@example.test>",
    INVITATION_KEY_ID: "test",
    INVITATION_ENCRYPTION_KEY: btoa("a".repeat(32)),
    APP_URL: "https://returnwell.example.test",
    WEBSITE_URL: "https://returnwell.example.test",
    RETURNWELL_BUSINESS_NAME: "Fictional ReturnWell",
    SUPPORT_EMAIL: "support@example.test",
    PRIVACY_URL: "https://returnwell.example.test/privacy",
    TERMS_URL: "https://returnwell.example.test/terms",
    TERMS_VERSION: "v1",
    PRIVACY_VERSION: "v1",
  };
  const job = {
    id: "job-1",
    family: "referral",
    related_id: "00000000-0000-4000-8000-000000000030",
    recipient_email: "practice@example.test",
    lease_id: "lease-1",
    idempotency_key: "response-1",
    payload: {
      kind: "referral_accepted",
      referralId: "00000000-0000-4000-8000-000000000030",
    },
  };
  const calls = [];
  let payload;
  await worker.dispatchJobs(
    {
      env,
      rpc: async (_actor, action, input) => {
        calls.push([action, input]);
        return action === "email.claim"
          ? [job]
          : action === "email.start"
          ? job
          : { ok: true };
      },
    },
    1,
    async (message, key) => {
      payload = message;
      assert.equal(key, "response-1");
      return new Response('{"id":"provider-1"}', { status: 200 });
    },
  );
  assert.deepEqual(calls.map((c) => c[0]), [
    "email.claim",
    "email.prepare",
    "email.start",
    "email.finish",
  ]);
  assert.equal(calls.at(-1)[1].leaseId, "lease-1");
  assert.equal(calls.at(-1)[1].providerId, "provider-1");
  assert.doesNotMatch(
    JSON.stringify(payload),
    /diagnosis|patient|postcode|clinical_summary/,
  );
  assert.match(
    payload.text,
    /\/referrals\/00000000-0000-4000-8000-000000000030/,
  );
  assert.doesNotMatch(JSON.stringify(calls[1]), /A referral has been accepted/);
});
