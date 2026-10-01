import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { localRuntime } from "./helpers/local-runtime.mjs";
import { enrollFixtureMfa } from "./helpers/mfa.mjs";
test(
  "revoked inviter loses direct REST reads and known mutation replays with the same session",
  { skip: process.env.RW_LOCAL_JOURNEY !== "1" },
  async () => {
    const local = localRuntime();
    const inviter = await local.verifiedFixtureUser(
      `revoked-inviter-${randomUUID()}@example.test`,
    );
    const operator = await local.verifiedFixtureUser(
      `invitation-reviewer-${randomUUID()}@example.test`,
    );
    const organisationId = randomUUID();
    local.sql(`insert into private.platform_operators(user_id) values ('${operator.userId}');
    insert into public.organisations(id,name) values ('${organisationId}','Fictional Revocation Practice');
    insert into public.organisation_memberships(organisation_id,user_id,role) values ('${organisationId}','${inviter.userId}','referrer');
    insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${inviter.userId}','${organisationId}','Dr Fictional','Fictional Revocation Practice','${operator.userId}');`);
    const create = {
      operation: "create",
      kind: "practitioner",
      organisationId,
      recipientName: "Fictional Receiver",
      recipientEmail: `revoked-recipient-${randomUUID()}@example.test`,
      consentConfirmed: true,
      requestId: randomUUID(),
    };
    const first = await local.call(
      "manage-invitations",
      create,
      inviter.client,
    );
    assert.equal(first.status, 200, first.body.code);
    const invitationId = first.body.id;
    local.sql(
      `update public.workspace_invitations set updated_at=now()-interval '2 minutes' where id='${invitationId}'`,
    );
    const resend = {
      operation: "resend",
      invitationId,
      expectedVersion: first.body.version,
      requestId: randomUUID(),
    };
    const second = await local.call(
      "manage-invitations",
      resend,
      inviter.client,
    );
    assert.equal(second.status, 200, second.body.code);
    const revoke = {
      operation: "revoke",
      invitationId,
      expectedVersion: second.body.version,
      requestId: randomUUID(),
    };
    assert.equal(
      (await local.call("manage-invitations", revoke, inviter.client)).status,
      200,
    );
    const activeRead = await inviter.client
      .from("workspace_invitations")
      .select("id,recipient_email")
      .eq("id", invitationId);
    assert.equal(activeRead.error, null);
    assert.equal(activeRead.data.length, 1);
    await enrollFixtureMfa(operator.client);
    const memberId = local.sql(
      `select id from public.organisation_memberships where organisation_id='${organisationId}' and user_id='${inviter.userId}'`,
    );
    const revoked = await local.call(
      "manage-practice",
      {
        operation: "revokeMember",
        organisationId,
        memberId,
        expectedVersion: 0,
        reason: "Fictional access review",
        requestId: randomUUID(),
      },
      operator.client,
    );
    assert.equal(revoked.status, 200, revoked.body.code);
    const leakedRead = await inviter.client
      .from("workspace_invitations")
      .select("id,recipient_email")
      .eq("id", invitationId);
    assert.equal(leakedRead.error, null);
    const replayStatuses = [];
    for (const command of [create, resend, revoke]) {
      const replay = await local.call(
        "manage-invitations",
        command,
        inviter.client,
      );
      replayStatuses.push(replay.status);
    }
    assert.deepEqual(
      { readCount: leakedRead.data.length, replayStatuses },
      { readCount: 0, replayStatuses: [403, 403, 403] },
      "Revoked session must lose direct reads and all known mutation replays",
    );
  },
);
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
