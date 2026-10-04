import assert from "node:assert/strict";
import test from "node:test";

test("new workflow routes server-render without exposing account or clinical data", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  for (const path of [
    "/invitations",
    "/onboarding",
    "/admin/practitioners",
    "/practitioner",
    "/join",
    "/auth/confirm",
    "/auth/google",
  ]) {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        headers: { accept: "text/html" },
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /ReturnWell/);
    assert.doesNotMatch(html, /Green Square Medical|DEMO-204|RW-1048/);
    if (path === "/join") {
      assert.match(html, /role="status"[^>]*>Checking invitation/);
      assert.doesNotMatch(
        html,
        /<input\b/,
        "invitation consent is unavailable until its details have been checked",
      );
    }
    if (path === "/auth/confirm") {
      assert.match(html, /Verify your email/);
      assert.match(html, /Opening this page does not verify or claim/);
    }
  }
});
