import test from "node:test";
import assert from "node:assert/strict";
import { workflowHandler } from "../supabase/functions/_shared/workflow-http.ts";
const env = {
  APP_URL: "https://returnwell.example.test",
  WEBSITE_URL: "https://returnwell.example.test",
  RETURNWELL_BUSINESS_NAME: "Fictional Test Business",
  SUPPORT_EMAIL: "support@example.test",
  PRIVACY_URL: "https://returnwell.example.test/privacy",
  TERMS_URL: "https://returnwell.example.test/terms",
  TERMS_VERSION: "test-terms-v1",
  PRIVACY_VERSION: "test-privacy-v1",
};
const req = (body) =>
  new Request(env.APP_URL, {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
test("self-entry uses authenticated actor, server notices and no caller membership authority", async () => {
  const calls = [];
  const handler = workflowHandler("workspace-access", {
    env,
    getUser: async () => ({ id: "verified", aal: "aal1" }),
    rpc: async (...args) => {
      calls.push(args);
      return { ok: true };
    },
  });
  const status = await handler(req({ operation: "registration_status" }));
  assert.equal(status.status, 200);
  const metadata = await status.json();
  assert.equal(metadata.currentTermsVersion, env.TERMS_VERSION);
  const response = await handler(
    req({
      operation: "register",
      role: "doctor",
      actor: "forged",
      organisationId: "victim",
      operator: true,
      displayName: "Fictional Doctor",
      practiceName: "Fictional Practice",
      registrationNumber: "MED-FIXTURE",
      consentConfirmed: true,
      termsVersion: env.TERMS_VERSION,
      privacyVersion: env.PRIVACY_VERSION,
      requestId: "request",
    }),
  );
  assert.equal(response.status, 200);
  const mutation = calls.at(-1);
  assert.equal(mutation[0], "verified");
  assert.equal(mutation[1], "account.register");
  assert.equal("organisationId" in mutation[2], false);
  assert.equal("operator" in mutation[2], false);
  assert.equal(mutation[2].currentTermsVersion, env.TERMS_VERSION);
  assert.equal(
    (
      await handler(
        req({
          operation: "register",
          termsVersion: "old",
          privacyVersion: "old",
        }),
      )
    ).status,
    409,
  );
});
