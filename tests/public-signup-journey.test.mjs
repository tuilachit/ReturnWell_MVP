import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { localRuntime } from "./helpers/local-runtime.mjs";

test(
  "fresh public email signup creates an unverified identity without a workspace grant",
  {
    skip: process.env.RW_LOCAL_JOURNEY !== "1",
    timeout: 30000,
  },
  async () => {
    const local = localRuntime();
    const email = `public-signup-${randomUUID()}@example.test`;
    const client = local.freshClient();
    const response = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    assert.equal(
      response.error,
      null,
      `Signup rejected: ${response.error?.code ?? "none"}`,
    );
    assert.equal((await client.auth.getSession()).data.session, null);
    assert.equal(
      local.sql(
        `select count(*) from auth.users where email='${email}' and email_confirmed_at is null`,
      ),
      "1",
    );
    assert.equal(
      local.sql(
        `select count(*) from private.account_registrations r join auth.users u on u.id=r.user_id where u.email='${email}'`,
      ),
      "0",
    );
    const access = await local.call(
      "workspace-access",
      { operation: "registration_status" },
      client,
    );
    assert.equal(access.status, 401);
  },
);
