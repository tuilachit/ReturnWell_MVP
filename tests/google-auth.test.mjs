import assert from "node:assert/strict";
import test from "node:test";
import { googleReturn, browserAuthOptions, googleSignInEnabled } from "../app/lib/google-auth.ts";

test("Google is unavailable unless deliberately enabled after provider setup", () => {
  const original = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED;
    assert.equal(googleSignInEnabled(), false);
    for (const value of ["false", "TRUE", "1", ""]) {
      process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = value;
      assert.equal(googleSignInEnabled(), false);
    }
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = "true";
    assert.equal(googleSignInEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED;
    else process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = original;
  }
});

test("Google return preserves approved destinations, never invitation secrets or external redirects", () => {
  const referral = "/referrals/10000000-0000-4000-8000-000000000001";
  assert.deepEqual(googleReturn(`?code=fictional-code&next=${encodeURIComponent(referral)}`, ""), {
    kind: "callback", code: "fictional-code", flowId: undefined, destination: referral,
  });
  for (const destination of ["https://attacker.test", "//attacker.test", "/join#token=secret", "/auth/confirm", "/auth/google", "/security?secret=x"]) {
    assert.equal(googleReturn(`?start=1&next=${encodeURIComponent(destination)}`, "").destination, "/");
  }
});

test("Google cancellation and failures are static messages, with no raw provider details", () => {
  for (const [search, hash] of [["?error=access_denied&error_description=private-value", ""], ["", "#error=access_denied&error_description=private-value"]]) {
    const result = googleReturn(search, hash);
    assert.equal(result.kind, "error");
    assert.match(result.message, /cancelled/);
    assert.doesNotMatch(result.message, /private-value/);
  }
  assert.equal(googleReturn("?code=a&code=b", "").kind, "error");
  assert.equal(googleReturn("", "#access_token=not-an-oauth-code").kind, "error");
  assert.equal(googleReturn("", "").kind, "error");
  assert.equal(googleReturn("?start=1&error=server_error", "").kind, "error");
});

test("OAuth uses PKCE in its dedicated document without changing email or invitation callbacks", () => {
  assert.deepEqual(browserAuthOptions("/auth/google"), { flowType: "pkce", detectSessionInUrl: false });
  assert.deepEqual(browserAuthOptions("/auth/confirm"), { flowType: "implicit", detectSessionInUrl: false });
  assert.deepEqual(browserAuthOptions("/"), { flowType: "implicit", detectSessionInUrl: true });
  assert.equal(googleReturn("?code=fictional&sb_flow_id=flow-one", "").flowId, "flow-one");
});
