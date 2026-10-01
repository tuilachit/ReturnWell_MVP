import assert from "node:assert/strict";
import test from "node:test";
import { invitationEmail } from "../supabase/functions/_shared/workflow-security.ts";
import {
  buildNotification,
  verificationEmail,
} from "../supabase/functions/_shared/email.ts";
const layout =
  await import("../supabase/functions/_shared/email-layout.ts").catch(
    () => ({}),
  );
const trust = {
  appUrl: "https://returnwell.example.test",
  websiteUrl: "https://returnwell.example.test",
  businessName: "Fictional ReturnWell",
  supportEmail: "support@example.test",
  termsUrl: "https://returnwell.example.test/terms",
  privacyUrl: "https://returnwell.example.test/privacy",
  termsVersion: "v1",
  privacyVersion: "v1",
};
test("verification is purpose-limited and uses the server attempt deadline in both formats", () => {
  const message = verificationEmail(
    trust,
    trust.appUrl + "/auth/confirm#token_hash=fictional",
    "2026-10-02T02:03:00Z",
  );
  for (const body of [message.text, message.html]) {
    assert.match(body, /2026-10-02T02:03:00.000Z/);
    assert.doesNotMatch(body, /patient|clinical|discount|payment/);
  }
  assert.match(message.html, />Review email verification<\/a>/);
});
test("shared layout escapes all text and includes equivalent action, canonical website and support", () => {
  assert.equal(typeof layout.renderTransactionalEmail, "function");
  const message = layout.renderTransactionalEmail({
    heading: 'A <script> & "quote"',
    bodyParagraphs: ["Hello <img src=x onerror=alert(1)>", "A".repeat(160)],
    action: {
      label: "Open & review",
      url: trust.appUrl + "/join#invite=fictional",
    },
    supportEmail: trust.supportEmail,
    websiteUrl: trust.websiteUrl,
  });
  assert.match(message.html, /lang="en"/);
  assert.match(message.html, /<title>/);
  assert.match(message.html, /&lt;script&gt;/);
  assert.doesNotMatch(message.html, /<img|<script/);
  assert.match(message.html, /mailto:support@example.test/);
  assert.match(message.text, /support@example.test/);
  assert.match(message.text, /Open & review/);
  assert.match(message.html, />Open &amp; review<\/a>/);
  assert.match(
    message.text,
    /https:\/\/returnwell.example.test\/join#invite=fictional/,
  );
});
test("layout permits only same-origin HTTPS actions and rejects URL credentials", () => {
  assert.equal(typeof layout.renderTransactionalEmail, "function");
  for (const url of [
    "javascript:alert(1)",
    "http://example.test",
    "https://evil.example.test",
    "https://user:password@returnwell.example.test",
  ])
    assert.throws(() =>
      layout.renderTransactionalEmail({
        heading: "Test",
        bodyParagraphs: [],
        action: { label: "Continue", url },
        supportEmail: trust.supportEmail,
        websiteUrl: trust.websiteUrl,
      }),
    );
});
test("invitation expiry is the original exact deadline, never a renewed seven-day promise", () => {
  const email = invitationEmail(
    {
      kind: "practitioner",
      recipient_name: "Name & <markup>",
      inviter_name: "Dr Fictional",
      practice_name: "Fictional Practice",
      expires_at: "2026-10-04T01:30:00Z",
    },
    "fictional",
    trust,
  );
  assert.match(email.text, /2026-10-04T01:30:00.000Z/);
  assert.doesNotMatch(email.text, /expires in seven days/);
  assert.match(email.html, /lang="en"/);
  assert.match(email.html, /Review invitation<\/a>/);
  assert.match(email.text, /decline/);
});
test("every lifecycle notification uses the shared layout without promoting services or exposing template fields", () => {
  for (const kind of [
    "referral_created",
    "referral_accepted",
    "referral_declined",
    "referral_cancelled",
    "referral_closed",
    "referral_reminder",
    "referral_action_required",
  ]) {
    const message = buildNotification(
      {
        id: "fixture",
        referralId: "10000000-0000-4000-8000-000000000001",
        kind,
        recipientEmail: "recipient@example.test",
        idempotencyKey: "fixture",
        templateData: { unusedSecret: "MUST-NOT-RENDER" },
      },
      trust.appUrl,
      trust,
    );
    assert.match(message.html, /lang="en"/);
    assert.match(message.html, /mailto:support@example.test/);
    assert.match(message.text, /support@example.test/);
    assert.doesNotMatch(
      message.html + message.text,
      /MUST-NOT-RENDER|upgrade|discount|payment|patient/i,
    );
  }
});
