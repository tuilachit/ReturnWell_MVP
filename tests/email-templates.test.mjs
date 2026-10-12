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
    // 02:03 UTC on 2 Oct is 12:03 pm in Sydney (AEST, before daylight saving).
    assert.match(body, /Fri 2 Oct 2026, 12:03 pm \(Sydney time\)/);
    assert.doesNotMatch(body, /patient|clinical|discount|payment/);
  }
  assert.match(message.html, />Review email verification<\/a>/);
});
test("code verification shows the typed code prominently, with no extra button and no health data", () => {
  const link = trust.appUrl + "/auth/confirm#token_hash=fictional";
  const message = verificationEmail(trust, link, "2026-10-17T11:33:44Z", "482913");
  assert.equal(message.subject, "482913 is your ReturnWell code");
  assert.match(message.text, /^Your code: 482913$/m);
  assert.match(message.html, /aria-label="Your code">482913</);
  // After daylight saving starts (4 Oct 2026), Sydney is UTC+11.
  assert.match(message.text, /Sat 17 Oct 2026, 10:33 pm \(Sydney time\)/);
  assert.match(message.text, /never asks for passwords, bank, card or Medicare/);
  assert.match(message.text, new RegExp(`^${link.replaceAll(".", "\\.")}$`, "m"));
  assert.doesNotMatch(message.html, /<a href="https:\/\/returnwell\.example\.test\/auth/);
  assert.doesNotMatch(message.text + message.html, /patient details|clinical|diagnosis/);
  assert.throws(() => verificationEmail(trust, link, "2026-10-17T11:33:44Z", "12ab56"));
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
test("invitation identifies the requesting practice and separates referrer onboarding from practitioner review", () => {
  for (const kind of ["practitioner", "doctor"]) {
    const message = invitationEmail(
      {
        kind,
        recipient_name: "Alex Example",
        inviter_name: "Sam Example (practice administrator)",
        practice_name: "Fictional Example Practice",
      },
      "fictional",
      trust,
    );
    assert.match(message.subject, /Fictional Example Practice/);
    for (const body of [message.text, message.html]) {
      assert.match(body, /Sam Example \(practice administrator\) at Fictional Example Practice/);
      assert.match(body, /Sent by ReturnWell on behalf of Fictional Example Practice/);
      assert.match(body, /sign in or create an account/);
      assert.match(body, /contact details .*independently/);
      assert.doesNotMatch(body, /Dr\.? Sam|referral.*waiting|urgent|guaranteed|payment/i);
      if (kind === "practitioner") {
        assert.match(body, /identity and registration review/);
        assert.match(body, /does not immediately publish/);
      } else {
        assert.match(body, /join their practice/);
        assert.doesNotMatch(body, /practitioner profile|registration review/);
      }
    }
    assert.equal((message.html.match(/\/join#invite=fictional/g) || []).length, 1);
  }
});
test("practice names cannot inject subject headers or HTML into invitation attribution", () => {
  const message = invitationEmail(
    {
      kind: "practitioner",
      recipient_name: "Alex Example",
      inviter_name: "Sam <script>",
      practice_name: "Fictional <img src=x>\r\nBcc: attacker@example.test",
    },
    "fictional",
    trust,
  );
  assert.match(message.subject, /Fictional/);
  assert.doesNotMatch(message.subject, /[\r\n]/);
  assert.doesNotMatch(message.html, /<script>|<img/);
  assert.match(message.html, /Sam &lt;script&gt;/);
  assert.match(message.html, /Fictional &lt;img src=x&gt;/);
});
test("secondary invitation details follow the action in both formats and remain escaped", () => {
  const message = layout.renderTransactionalEmail({
    heading: "Invitation",
    preheader: "Preview <script> & context",
    bodyParagraphs: ["Primary message"],
    supportingParagraphs: ["Secondary detail <img src=x>"],
    action: { label: "Review invitation", url: trust.appUrl + "/join#invite=fictional" },
    supportEmail: trust.supportEmail,
    websiteUrl: trust.websiteUrl,
  });
  for (const body of [message.text, message.html]) {
    assert.match(body, /Secondary detail/);
    assert.ok(body.indexOf("Primary message") < body.indexOf("Review invitation"));
    assert.ok(body.indexOf("Review invitation") < body.indexOf("Secondary detail"));
  }
  assert.match(message.html, /Preview &lt;script&gt; &amp; context/);
  assert.match(message.html, /Secondary detail &lt;img src=x&gt;/);
  assert.doesNotMatch(message.html, /<script>|<img/);
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
