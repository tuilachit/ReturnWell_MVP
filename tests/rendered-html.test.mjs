import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders a safe ReturnWell entry screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ReturnWell GP Referrals<\/title>/i);
  assert.match(html, /ReturnWell/);
  assert.match(html, /Sign in to your referral workspace/);
  assert.doesNotMatch(html, /Preview empty workspace|Explore the workspace|Load demo workspace/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("all customer application entry routes require sign-in without a preview bypass", async () => {
  for (const pathname of ["/", "/account/setup", "/practitioner", "/onboarding", "/invitations", "/referrals/3bbc9fd4-2da2-4a72-80e4-b920ad033692"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Welcome to ReturnWell/, pathname);
    assert.match(html, /Work email/, pathname);
    assert.doesNotMatch(html, /Preview empty workspace|Explore the workspace|Load demo workspace/, pathname);
  }
});

test("does not server-render fictional clinical or practice records", async () => {
  const response = await render();
  const html = await response.text();
  for (const fictionalValue of [
    "Green Square Medical",
    "Dr Alex Morgan",
    "RW-1048",
    "Dr Maya Chen",
    "DEMO-204",
  ]) {
    assert.doesNotMatch(html, new RegExp(fictionalValue, "i"));
  }
});

test("publishes matching social metadata for the GP referral portal", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /og:title/i);
  assert.match(html, /ReturnWell GP Referrals/);
  assert.match(html, /Find, send and track allied health referrals/);
  assert.match(html, /og\.png/);
  assert.match(html, /summary_large_image/);
});

test("provides a real authenticated landing route for opaque email links", async () => {
  const response = await render(
    "/referrals/3bbc9fd4-2da2-4a72-80e4-b920ad033692",
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Sign in to your referral workspace/);
  assert.doesNotMatch(
    html,
    /patient_reference|clinical_summary|patient_postcode/i,
  );
});

test("makes draft test notices accessible before authentication", async () => {
  for (const pathname of ["/privacy", "/terms"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} must not require a session`);
    const html = await response.text();
    assert.match(html, /<h1[^>]*>[^<]*(Privacy|Terms)/i);
    assert.match(html, /name="robots" content="[^"]*noindex/i);
    assert.match(html, /href="mailto:nguyenvanlocdhqt@gmail\.com"/);
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /href="\/terms"/);
    assert.doesNotMatch(html, /<form\b/i, "reading a notice must not start signup");
  }
});

test("provides notice links on the unauthenticated entry screen", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
});

test("email entry pages expose test notices before a recipient signs up", async () => {
  for (const pathname of ["/join", "/auth/confirm"]) {
    const response = await render(pathname);
    const html = await response.text();
    assert.match(html, /aria-label="Test information"/, pathname);
    assert.match(html, /href="\/privacy"/, pathname);
    assert.match(html, /href="\/terms"/, pathname);
    assert.match(html, /Not for clinical use/, pathname);
  }
});

test("verification entry checks its link before asking for identity details", async () => {
  const response = await render("/auth/confirm");
  const html = await response.text();
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /<input\b/, "do not show an unusable identity form during the link check");
});
