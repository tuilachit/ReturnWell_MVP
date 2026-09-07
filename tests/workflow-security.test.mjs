import assert from "node:assert/strict";
import test from "node:test";

const security = await import(
  "../supabase/functions/_shared/workflow-security.ts"
).catch(() => ({}));

test("invitation credentials have 256 bits of randomness and are never their own lookup hash", async () => {
  assert.equal(
    typeof security.newInvitationToken,
    "function",
    "secure invitation generation must be implemented",
  );
  const a = security.newInvitationToken();
  const b = security.newInvitationToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.match(await security.hashToken(a), /^[a-f0-9]{64}$/);
  assert.notEqual(await security.hashToken(a), a);
});

test("credential envelopes authenticate context and reject tampering", async () => {
  assert.equal(
    typeof security.seal,
    "function",
    "encrypted retry payloads must be implemented",
  );
  const key = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  );
  const envelope = await security.seal(
    { token: "secret-token" },
    key,
    "key-1",
    "invite-1",
  );
  assert.doesNotMatch(JSON.stringify(envelope), /secret-token/);
  assert.deepEqual(await security.unseal(envelope, key, "invite-1"), {
    token: "secret-token",
  });
  await assert.rejects(() => security.unseal(envelope, key, "invite-2"));
  await assert.rejects(() =>
    security.unseal(
      { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + "AAAA" },
      key,
      "invite-1",
    )
  );
});

test("invitation messages use reviewed identity, canonical links and no pressure or hidden redirects", () => {
  assert.equal(
    typeof security.invitationEmail,
    "function",
    "trusted invitation template must be implemented",
  );
  const message = security.invitationEmail(
    {
      kind: "practitioner",
      recipient_name: "Alex <script>",
      inviter_name: "Dr Test",
      practice_name: "Fictional Practice",
    },
    "abc",
    {
      appUrl: "https://returnwell.example.test",
      businessName: "Fictional ReturnWell",
      supportEmail: "support@example.test",
      privacyUrl: "https://returnwell.example.test/privacy",
      termsUrl: "https://returnwell.example.test/terms",
      websiteUrl: "https://returnwell.example.test",
      termsVersion: "v1",
      privacyVersion: "v1",
    },
  );
  assert.match(message.text, /Dr Test/);
  assert.match(message.text, /Fictional Practice/);
  assert.match(
    message.text,
    /https:\/\/returnwell.example.test\/join#invite=abc/,
  );
  assert.match(message.text, /decline/i);
  assert.doesNotMatch(message.html, /<script>/);
  assert.doesNotMatch(message.text, /patient.*waiting|urgent|payment/i);
});
