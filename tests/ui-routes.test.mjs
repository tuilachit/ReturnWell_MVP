import assert from "node:assert/strict";
import test from "node:test";

test("new workflow routes server-render without exposing account or clinical data", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  for (const path of ["/invitations", "/onboarding", "/admin/practitioners", "/practitioner", "/join", "/auth/confirm"]) {
    const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /ReturnWell/);
    assert.doesNotMatch(html, /Green Square Medical|DEMO-204|RW-1048/);
    if (path === "/join") assert.match(html, /invited to ReturnWell/);
    if (path === "/auth/confirm") {
      assert.match(html, /Verify your email/);
      assert.match(html, /Opening this page does not verify or claim/);
    }
  }
});
