import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmationDetails,
  invoke,
  invitationEntry,
  notificationLabel,
  safeDestination,
} from "../app/lib/workflow.ts";

test("confirmation requires complete fragment context before any credential exchange", () => {
  const valid =
    "#token_hash=fictional-hash&type=invite&invitationId=10000000-0000-4000-8000-000000000001&attemptId=10000000-0000-4000-8000-000000000002";
  assert.equal(confirmationDetails(valid).type, "invite");
  assert.equal(
    confirmationDetails(valid.replace("type=invite", "type=recovery")),
    null,
  );
  assert.equal(confirmationDetails(valid.split("&attemptId")[0]), null);
  assert.equal(confirmationDetails(""), null);
});

test("email states distinguish persisted send, delivery, failure and configuration", () => {
  assert.match(
    notificationLabel({ status: "sent" }),
    /delivery not yet confirmed/,
  );
  assert.match(
    notificationLabel({ status: "sent", delivered: true }),
    /does not mean read/,
  );
  assert.match(
    notificationLabel({ status: "exhausted", delivered: true }),
    /failed/,
  );
  assert.match(
    notificationLabel({ status: "paused_configuration" }),
    /configuration/,
  );
  assert.match(notificationLabel({ status: "pending" }), /pending/);
  assert.match(
    notificationLabel({ status: "new_unknown_state" }),
    /unavailable/,
  );
});

test("changed legal versions retain an explicit consent reconciliation message", async () => {
  const client = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: new Response(
            JSON.stringify({ error: "Notice changed", code: "terms_changed" }),
            { status: 409 },
          ),
        },
      }),
    },
  };
  await assert.rejects(
    invoke(client, "practitioner-onboarding"),
    /confirm consent again/,
  );
});

test("login destinations preserve referral detail and reject external or arbitrary routes", () => {
  const detail = "/referrals/10000000-0000-4000-8000-000000000001";
  assert.equal(safeDestination(detail), detail);
  assert.equal(safeDestination("/practitioner"), "/practitioner");
  for (const path of [
    "https://attacker.test",
    "//attacker.test",
    "/join#invite=secret",
    "/unknown",
    "/referrals/invalid",
  ])
    assert.equal(safeDestination(path), "/");
});

test("authenticated invocation uses endpoint body and returns persisted raw state", async () => {
  const expected = { status: "accepted", version: 2 };
  const client = {
    functions: {
      invoke: async (name, options) => {
        assert.equal(name, "respond-to-referral");
        assert.deepEqual(options.body, {
          referralId: "referral",
          expectedVersion: 1,
          decision: "accepted",
        });
        assert.equal("actorId" in options.body, false);
        return { data: expected, error: null };
      },
    },
  };
  assert.deepEqual(
    await invoke(client, "respond-to-referral", {
      referralId: "referral",
      expectedVersion: 1,
      decision: "accepted",
    }),
    expected,
  );
});

test("stale mutations give reconciliation guidance, not a success result", async () => {
  const client = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: new Response(JSON.stringify({ error: "stale_version" }), {
            status: 409,
          }),
        },
      }),
    },
  };
  await assert.rejects(
    invoke(client, "practitioner-onboarding"),
    /Your edits are retained/,
  );
});

test("structured application errors cannot masquerade as successful responses", async () => {
  const client = {
    functions: {
      invoke: async () => ({
        data: { error: "Access unavailable" },
        error: null,
      }),
    },
  };
  await assert.rejects(
    invoke(client, "workspace-access"),
    /Access unavailable/,
  );
});

test("public invitation inspection uses no auth exchange and no token-bearing URL", async () => {
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const priorFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fictional.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    "fictional-publishable-key";
  globalThis.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://fictional.example.test/functions/v1/invitation-entry",
    );
    assert.equal(options.headers.apikey, "fictional-publishable-key");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.cache, "no-store");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.deepEqual(JSON.parse(options.body), {
      operation: "inspect",
      token: "fictional-secret",
    });
    return new Response(JSON.stringify({ maskedEmail: "a***@example.test" }));
  };
  try {
    assert.deepEqual(
      await invitationEntry({
        operation: "inspect",
        token: "fictional-secret",
      }),
      { maskedEmail: "a***@example.test" },
    );
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
    if (priorKey === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = priorKey;
  }
});
