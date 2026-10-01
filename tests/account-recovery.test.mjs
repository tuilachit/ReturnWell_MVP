import assert from "node:assert/strict";
import test from "node:test";
import { invoke, invitationEntry } from "../app/lib/workflow.ts";
const recovery = await import("../app/lib/account-recovery.ts").catch(
  () => ({}),
);
const errors = await import("../app/lib/workflow-error.ts").catch(() => ({}));
test("typed failures preserve Retry-After but never show server bodies", async () => {
  assert.equal(typeof errors.parseWorkflowFailure, "function");
  for (const header of ["120", new Date(Date.now() + 90000).toUTCString()]) {
    const error = await errors.parseWorkflowFailure(
      new Response('{"code":"rate_limited","error":"SECRET"}', {
        status: 429,
        headers: { "Retry-After": header },
      }),
    );
    assert.equal(error.code, "rate_limited");
    assert.equal(error.status, 429);
    assert.ok(error.retryAfterSeconds >= 89);
    assert.ok(error.retryAfterSeconds <= 120);
    assert.doesNotMatch(error.message, /SECRET/);
  }
  for (const text of [
    "",
    "<html>SECRET</html>",
    '{"error":"SECRET", "code":"private.sql"}',
  ]) {
    const error = await errors.parseWorkflowFailure(
      new Response(text, { status: 500 }),
    );
    assert.equal(error.code, "request_failed");
    assert.doesNotMatch(error.message, /SECRET|html|private/);
  }
});
test("network ambiguity remains distinguishable from a definitive rejection", async () => {
  const client = {
    functions: {
      invoke: async () => ({ error: { message: "SECRET" }, data: null }),
    },
  };
  await assert.rejects(
    invoke(client, "workspace-access"),
    (error) =>
      error.status === null &&
      error.code === "network_error" &&
      !error.message.includes("SECRET"),
  );
});
test("only a validated same-account attempt can complete an interrupted claim", () => {
  assert.equal(typeof recovery.accountRecovery, "function");
  assert.equal(
    recovery.accountRecovery({
      signedIn: false,
      invitation: "valid",
      attempt: "expired",
      sameAccount: false,
    }).next,
    "request_verification",
  );
  assert.equal(
    recovery.accountRecovery({
      signedIn: false,
      invitation: "expired",
      attempt: "expired",
      sameAccount: false,
    }).next,
    "contact_inviter",
  );
  assert.equal(
    recovery.accountRecovery({
      signedIn: true,
      invitation: "valid",
      attempt: "valid",
      sameAccount: true,
    }).next,
    "complete_claim",
  );
  assert.equal(
    recovery.accountRecovery({
      signedIn: true,
      invitation: "valid",
      attempt: "valid",
      sameAccount: false,
    }).next,
    "sign_in",
  );
  assert.notEqual(
    recovery.accountRecovery({
      signedIn: false,
      invitation: "valid",
      attempt: "valid",
      sameAccount: false,
    }).next,
    "complete_claim",
  );
});
test("public invitation errors use the same safe typed parser", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    fetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fictional.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "fictional";
  globalThis.fetch = async () =>
    new Response("SECRET invalid JSON", {
      status: 429,
      headers: { "Retry-After": "75" },
    });
  try {
    await assert.rejects(
      invitationEntry({ operation: "inspect" }),
      (error) =>
        error.retryAfterSeconds === 75 && !error.message.includes("SECRET"),
    );
  } finally {
    globalThis.fetch = fetch;
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (key === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
  }
});
