import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { localRuntime } from "./helpers/local-runtime.mjs";
import { enrollFixtureMfa } from "./helpers/mfa.mjs";
test(
  "real local Auth assurance and current operator state both gate practice administration",
  { skip: process.env.RW_LOCAL_JOURNEY !== "1" },
  async () => {
    const local = localRuntime();
    const operator = await local.verifiedFixtureUser(
      `privileged-${randomUUID()}@example.test`,
    );
    const owner = await local.verifiedFixtureUser(
      `reviewed-owner-${randomUUID()}@example.test`,
    );
    local.sql(
      `insert into private.platform_operators(user_id) values ('${operator.userId}')`,
    );
    const input = {
      operation: "create",
      name: "Fictional MFA practice",
      ownerUserId: owner.userId,
      evidenceReference: "Local identity proof only",
      requestId: randomUUID(),
      aal: "aal2",
      role: "operator",
    };
    const denied = await local.call("manage-practice", input, operator.client);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "step_up_required");
    await enrollFixtureMfa(operator.client);
    const created = await local.call("manage-practice", input, operator.client);
    assert.equal(created.status, 200, created.body.code);
    assert.ok(created.body.organisationId);
    assert.deepEqual(
      await local.call("manage-practice", input, operator.client),
      created,
    );
    const direct = await operator.client.rpc("rw_workflow", {
      p_actor: operator.userId,
      p_action: "practice.create",
      p_input: input,
    });
    assert.ok(direct.error, "Browser cannot invoke service RPC even with AAL2");
    const session = (await operator.client.auth.getSession()).data.session;
    const [header, payload, signature] = session.access_token.split(".");
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), sub: owner.userId })).toString("base64url")}.${signature}`;
    assert.equal(await local.runtime.getUser(forged), null);
    local.sql(
      `update private.platform_operators set active=false where user_id='${operator.userId}'`,
    );
    const revoked = await local.call("manage-practice", input, operator.client);
    assert.equal(revoked.status, 403);
    assert.equal(revoked.body.code, "denied");
    const wrong = await local.call(
      "manage-practice",
      { operation: "list" },
      owner.client,
    );
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, "denied");
  },
);
