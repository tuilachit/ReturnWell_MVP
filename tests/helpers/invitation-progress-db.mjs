import assert from "node:assert/strict";
export async function invitationProgressChecks(t, { rpc, sql, id: sourceId }) {
  const id = (n) => sourceId(500000 + n);
  let n = 100;
  const next = () => id(++n);
  sql(`insert into auth.users(id,email,email_confirmed_at) values ('${id(1)}','progress-reviewer@example.test',now()),('${id(2)}','progress-doctor@example.test',now()),('${id(3)}','progress-existing@example.test',now()),('${id(4)}','progress-outsider@example.test',now());
    insert into public.organisations(id,name) values ('${id(10)}','Fictional Progress Practice');
    insert into public.organisation_memberships(organisation_id,user_id,role) values ('${id(10)}','${id(2)}','referrer');
    insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${id(2)}','${id(10)}','Dr Fictional','Fictional Progress Practice','${id(1)}');`);
  const create = (email) =>
    rpc(id(2), "invitations.create", {
      kind: "practitioner",
      organisationId: id(10),
      recipientName: "Fictional Person",
      recipientEmail: email,
      consentConfirmed: true,
      requestId: next(),
      tokenHash: (++n).toString(16).padStart(64, "e"),
      keyId: "test",
      envelope: { test: "encrypted" },
    });
  const get = (invite) =>
    rpc(id(2), "invitations.list", { organisationId: id(10) }).invitations.find(
      (row) => row.id === invite.id,
    ).progress;
  const sent = (invite) => {
    const job = sql(
      `update private.email_jobs set state='sent',provider_message_id='progress-${++n}' where related_id='${invite.id}' and related_version=${invite.generation} returning id`,
    );
    return job;
  };
  const event = (job, type, when = "now()") =>
    sql(
      `insert into private.email_events(provider_event_id,provider_message_id,event_type,occurred_at,matched_job_id) select 'progress-event-${++n}',provider_message_id,'${type}',${when},id from private.email_jobs where id='${job}'`,
    );
  await t.test(
    "invitation list projects safe current-generation delivery and bounce dominates earlier delivery",
    () => {
      const invite = create("progress-one@example.test");
      assert.equal(get(invite)?.delivery.state, "pending");
      const job = sent(invite);
      assert.equal(get(invite).delivery.state, "sent");
      event(job, "delivered");
      event(job, "delivery_delayed", "now()+interval '1 minute'");
      assert.equal(get(invite).delivery.state, "delivered");
      event(job, "bounced", "now()-interval '1 minute'");
      assert.equal(get(invite).delivery.state, "suppressed");
      assert.doesNotMatch(
        JSON.stringify(get(invite)),
        /envelope|provider_message|token_hash|recipient_email/,
      );
      assert.throws(
        () => rpc(id(4), "invitations.list", { organisationId: id(10) }),
        /denied|reviewed_identity_required/,
      );
      assert.throws(
        () => sql("set role authenticated;select * from private.email_events"),
        /permission denied/,
      );
      assert.throws(
        () => sql("set role authenticated;select * from private.email_jobs"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "resend starts a new delivery generation and a claimed existing account retains separate delivery evidence",
    () => {
      let invite = create("progress-existing@example.test");
      const first = sent(invite);
      event(first, "delivered");
      sql(
        `update public.workspace_invitations set updated_at=now()-interval '2 minutes' where id='${invite.id}'`,
      );
      const tokenHash = (++n).toString(16).padStart(64, "e");
      invite = rpc(id(2), "invitations.resend", {
        invitationId: invite.id,
        expectedVersion: 0,
        requestId: next(),
        tokenHash,
        keyId: "test",
        envelope: { test: "rotated" },
      });
      assert.equal(get(invite).generation, 2);
      assert.equal(get(invite).delivery.state, "pending");
      const second = sent(invite);
      event(second, "delivered");
      const attempt = rpc(null, "invitation.begin", {
        tokenHash,
        termsVersion: "v1",
        privacyVersion: "v1",
        consentAccepted: true,
        requestId: next(),
      });
      const deadline=JSON.parse(sql(`select jsonb_build_object('expected',least(a.expires_at,i.expires_at),'live',least(a.expires_at,i.expires_at)>now(),'duration',extract(epoch from a.expires_at-a.created_at)) from private.invitation_auth_attempts a join public.workspace_invitations i on i.id=a.invitation_id where a.id='${attempt.attemptId}'`));
      assert.equal(Date.parse(attempt.expiresAt),Date.parse(deadline.expected));
      assert.equal(deadline.live,true);assert.equal(deadline.duration,900);
      rpc(null, "invitation.attach_auth", {
        attemptId: attempt.attemptId,
        authLeaseId: attempt.authLeaseId,
        authUserId: id(3),
        tokenType: "magiclink",
        envelope: { test: "encrypted" },
      });
      const recovery = rpc(id(3), "invitation.recovery", {
        invitationId: invite.id,
        attemptId: attempt.attemptId,
      });
      assert.equal(recovery.attempts[0].attemptId, attempt.attemptId);
      assert.doesNotMatch(
        JSON.stringify(recovery),
        /token|envelope|email|clinical/i,
      );
      assert.equal(
        rpc(id(4), "invitation.recovery", { invitationId: invite.id }).attempts
          .length,
        0,
      );
      assert.throws(() => rpc(null, "invitation.recovery", {}), /denied/);
      sql(
        `update private.invitation_auth_attempts set expires_at=now()-interval '1 minute' where id='${attempt.attemptId}'`,
      );
      assert.equal(rpc(id(3), "invitation.recovery", {}).attempts.length, 0);
      sql(
        `update private.invitation_auth_attempts set expires_at=now()+interval '10 minutes' where id='${attempt.attemptId}'`,
      );
      rpc(id(3), "invitation.claim", {
        invitationId: invite.id,
        attemptId: attempt.attemptId,
        displayName: "Fictional Existing User",
        requestId: next(),
      });
      const progress = get(invite);
      assert.equal(progress.status, "claimed");
      assert.equal(progress.accountWasNew, false);
      assert.ok(progress.signupCompletedAt);
      assert.equal(progress.delivery.state, "delivered");
      assert.equal(
        rpc(id(3), "invitation.recovery", { invitationId: invite.id })
          .attempts[0].claimed,
        true,
      );
    },
  );
}
