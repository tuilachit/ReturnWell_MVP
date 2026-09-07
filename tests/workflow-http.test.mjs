import assert from "node:assert/strict";
import test from "node:test";
const api = await import("../supabase/functions/_shared/workflow-http.ts")
  .catch(() => ({}));
const base = {
  env: {
    APP_URL: "https://returnwell.example.test",
    ALLOWED_ORIGINS: "https://returnwell.example.test",
  },
  getUser: async () => null,
  rpc: async () => {
    throw Error("RPC should not be reached");
  },
};
test("HTTP origin, method, session and size checks fail before database actions", async () => {
  assert.equal(
    typeof api.workflowHandler,
    "function",
    "HTTP security boundary must be implemented",
  );
  const handle = api.workflowHandler("workspace-access", base);
  assert.equal(
    (await handle(new Request("https://api.example.test", { method: "GET" })))
      .status,
    405,
  );
  assert.equal(
    (await handle(
      new Request("https://api.example.test", {
        method: "POST",
        headers: { origin: "https://evil.test" },
        body: "{}",
      }),
    )).status,
    403,
  );
  assert.equal(
    (await handle(
      new Request("https://api.example.test", { method: "POST", body: "{}" }),
    )).status,
    401,
  );
  assert.equal(
    (await handle(
      new Request("https://api.example.test", {
        method: "POST",
        body: JSON.stringify({ large: "x".repeat(17000) }),
      }),
    )).status,
    413,
  );
  const options = await handle(
    new Request("https://api.example.test", {
      method: "OPTIONS",
      headers: { origin: "https://returnwell.example.test" },
    }),
  );
  assert.equal(options.status, 204);
  assert.equal(
    options.headers.get("access-control-allow-origin"),
    "https://returnwell.example.test",
  );
});
test("authenticated endpoint cannot dispatch arbitrary service-only actions or trust request actor", async () => {
  assert.equal(typeof api.workflowHandler, "function");
  const calls = [];
  const handle = api.workflowHandler("manage-invitations", {
    ...base,
    getUser: async () => ({ id: "trusted-user" }),
    rpc: async (...args) => {
      calls.push(args);
      return { invitations: [] };
    },
  });
  const response = await handle(
    new Request("https://api.example.test", {
      method: "POST",
      headers: { authorization: "Bearer verified" },
      body: JSON.stringify({
        operation: "list",
        organisationId: null,
        actorId: "victim",
        tokenHash: "attacker",
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["trusted-user", "invitations.list", {
    organisationId: null,
  }]]);
  assert.equal(
    (await handle(
      new Request("https://api.example.test", {
        method: "POST",
        headers: { authorization: "Bearer verified" },
        body: '{"operation":"email.claim"}',
      }),
    )).status,
    400,
  );
});
test("public invitation inspection cannot create an account or expose server credential fields", async () => {
  assert.equal(typeof api.workflowHandler, "function");
  const calls = [];
  const handle = api.workflowHandler("invitation-entry", {
    ...base,
    env: {
      ...base.env,
      RETURNWELL_BUSINESS_NAME: "Fictional",
      SUPPORT_EMAIL: "support@example.test",
      WEBSITE_URL: "https://returnwell.example.test",
      PRIVACY_URL: "https://returnwell.example.test/privacy",
      TERMS_URL: "https://returnwell.example.test/terms",
      TERMS_VERSION: "v1",
      PRIVACY_VERSION: "v1",
    },
    rpc: async (...args) => {
      calls.push(args);
      return { invitationId: "opaque-id", maskedEmail: "a***@example.test" };
    },
    generateLink: () => {
      throw Error("must not generate on inspection");
    },
  });
  const res = await handle(
    new Request("https://api.example.test", {
      method: "POST",
      body: JSON.stringify({
        operation: "inspect",
        token: "a".repeat(43),
        email: "attacker@test",
        redirectTo: "https://evil.test",
      }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "invitation.inspect");
  assert.deepEqual(Object.keys(calls[0][2]), ["tokenHash"]);
  assert.doesNotMatch(await res.text(), /attacker|evil.test|tokenHash/);
});
