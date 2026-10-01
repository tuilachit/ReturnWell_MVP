import test from "node:test";
import assert from "node:assert/strict";
const api = await import("../app/lib/security-headers.ts").catch(() => ({}));
test("production headers use a fresh nonce, exact data origin and no sensitive caching", () => {
  assert.equal(typeof api.securityHeaders, "function");
  const first = api.securityHeaders({
      supabaseUrl: "https://fixture.supabase.co",
    }),
    second = api.securityHeaders({
      supabaseUrl: "https://fixture.supabase.co",
    });
  assert.notEqual(
    first["content-security-policy"],
    second["content-security-policy"],
  );
  assert.match(
    first["content-security-policy"],
    /script-src 'self' 'nonce-[A-Za-z0-9_-]{32,}'/,
  );
  assert.doesNotMatch(
    first["content-security-policy"],
    /unsafe-inline.*script|unsafe-eval|\*\.supabase/,
  );
  assert.match(
    first["content-security-policy"],
    /connect-src 'self' https:\/\/fixture.supabase.co/,
  );
  assert.match(first["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(first["content-security-policy"], /object-src 'none'/);
  assert.equal(first["cache-control"], "no-store");
  assert.equal(first["referrer-policy"], "no-referrer");
  assert.equal(first["x-content-type-options"], "nosniff");
  assert.equal(first["x-frame-options"], "DENY");
});
test("malformed or credential-bearing origins never become CSP directives", () => {
  for (const url of [
    "https://a.test; script-src *",
    "https://secret@a.test",
    "javascript:alert(1)",
    "http://a.test",
    "https://a.test/path?token=x",
  ]) {
    const headers = api.securityHeaders({ supabaseUrl: url });
    assert.match(headers["content-security-policy"], /connect-src 'self';/);
    assert.doesNotMatch(
      headers["content-security-policy"],
      /secret|token=|javascript|script-src \*/,
    );
  }
});
test("workflow API rejection responses enforce non-sniffable private headers", async () => {
  const { workflowHandler } =
    await import("../supabase/functions/_shared/workflow-http.ts");
  const response = await workflowHandler("workspace-access", {
    env: {},
    getUser: async () => null,
    rpc: async () => {
      throw Error("never");
    },
  })(new Request("https://api.example.test", { method: "POST", body: "{}" }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
