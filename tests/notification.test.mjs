import assert from "node:assert/strict";
import test from "node:test";

import { buildNotification, verifyWebhookSignature } from "../supabase/functions/_shared/email.ts";

const job = {
  id: "8f493956-2d35-4a45-b3f1-ec3d84be9789",
  referralId: "3bbc9fd4-2da2-4a72-80e4-b920ad033692",
  kind: "referral_created",
  recipientEmail: "practice@example.test",
  idempotencyKey: "referral:3bbc9fd4-2da2-4a72-80e4-b920ad033692:created",
  templateData: { recipient_name: "Practice team" },
};

test("builds a generic transactional email with an opaque referral link", () => {
  const first = buildNotification(job, "https://app.returnwell.example");
  const second = buildNotification(job, "https://app.returnwell.example/");

  assert.equal(first.to, "practice@example.test");
  assert.equal(first.subject, "A referral needs your response");
  assert.equal(first.idempotencyKey, job.idempotencyKey);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.match(first.text, /Sign in to ReturnWell/);
  assert.match(first.text, /referrals\/3bbc9fd4-2da2-4a72-80e4-b920ad033692/);
  assert.doesNotMatch(first.subject + first.text + first.html, /patient|diagnosis|postcode|back pain/i);
});

test("rejects patient and clinical data even when nested", () => {
  assert.throws(
    () => buildNotification({ ...job, templateData: { details: { clinical_summary: "private" } } }, "https://app.returnwell.example"),
    /clinical data/i,
  );
  assert.throws(
    () => buildNotification({ ...job, templateData: { patient_name: "Private" } }, "https://app.returnwell.example"),
    /clinical data/i,
  );
});

test("requires HTTPS and a supported notification kind", () => {
  assert.throws(() => buildNotification(job, "http://example.test"), /HTTPS/);
  assert.throws(() => buildNotification({ ...job, kind: "marketing" }, "https://app.returnwell.example"), /notification kind/i);
});

test("verifies signed webhooks and rejects replays outside the timestamp window", async () => {
  const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "email-1" } });
  const eventId = "msg_123";
  const timestamp = Math.floor(Date.now() / 1000);
  const rawSecret = crypto.getRandomValues(new Uint8Array(32));
  const secret = `whsec_${Buffer.from(rawSecret).toString("base64")}`;
  const key = await crypto.subtle.importKey("raw", rawSecret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${eventId}.${timestamp}.${payload}`));
  const signatureHeader = `v1,${Buffer.from(signature).toString("base64")}`;

  assert.equal(await verifyWebhookSignature({ payload, eventId, timestamp: String(timestamp), signatureHeader, secret }), true);
  assert.equal(await verifyWebhookSignature({ payload, eventId, timestamp: String(timestamp - 601), signatureHeader, secret }), false);
  assert.equal(await verifyWebhookSignature({ payload: `${payload} `, eventId, timestamp: String(timestamp), signatureHeader, secret }), false);
});
