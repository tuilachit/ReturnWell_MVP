import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /Preview empty workspace/);
  assert.doesNotMatch(html, /codex-preview/);
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

test("keeps the authenticated workspace empty by default with explicit demo opt-in", async () => {
  const source = await readFile(new URL("../app/doctor-portal.tsx", import.meta.url), "utf8");
  assert.match(source, /No referrals yet/i);
  assert.match(source, /Create your first referral/i);
  assert.match(source, /Load demo workspace/i);
  assert.match(source, /useState<Referral\[]>\(\[\]\)/);
  assert.match(source, /useState\(""\)/);
  assert.doesNotMatch(source, /const initialReferrals/);
  assert.doesNotMatch(source, /Green Square Medical/);
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
  const response = await render("/referrals/3bbc9fd4-2da2-4a72-80e4-b920ad033692");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Sign in to your referral workspace/);
  assert.doesNotMatch(html, /patient_reference|clinical_summary|patient_postcode/i);
});
