import assert from "node:assert/strict";
export async function emailOperationsChecks(t, { rpc, sql, id: sourceId }) {
  const id = (n) => sourceId(600000 + n);
  let sequence = 100;
  const next = () => id(++sequence);
  sql(`insert into auth.users(id,email,email_confirmed_at) values ('${id(1)}','email-operator@example.test',now()),('${id(2)}','email-doctor@example.test',now());
    insert into private.platform_operators(user_id) values ('${id(1)}');
    insert into public.organisations(id,name) values ('${id(10)}','Fictional Email Practice');
    insert into public.organisation_memberships(organisation_id,user_id,role) values ('${id(10)}','${id(2)}','referrer');
    insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${id(2)}','${id(10)}','Dr Fictional','Fictional Email Practice','${id(1)}');`);
  function fixture() {
    const invite = rpc(id(2), "invitations.create", {
      kind: "practitioner",
      organisationId: id(10),
      recipientName: "Fictional Email",
      recipientEmail: `email-operations-${++sequence}@example.test`,
      consentConfirmed: true,
      requestId: next(),
      tokenHash: (++sequence).toString(16).padStart(64, "d"),
      keyId: "test",
      envelope: { fictional: "encrypted" },
    });
    const job = sql(
        `select id from private.email_jobs where family='invitation' and related_id='${invite.id}'`,
      ),
      lease = next();
    sql(
      `update private.email_jobs set state='processing',lease_id='${lease}',lease_expires_at=now()+interval '2 minutes',prepared_payload='{"fictional":"frozen"}' where id='${job}'`,
    );
    rpc(null, "email.start", { jobId: job, leaseId: lease });
    return { invite, job, lease };
  }
  await t.test(
    "provider Retry-After never retries early or beyond the dedupe boundary",
    () => {
      const f = fixture();
      rpc(null, "email.finish", {
        jobId: f.job,
        leaseId: f.lease,
        outcome: "transient",
        retryAfterSeconds: 600,
      });
      assert.equal(
        sql(
          `select due_at>=now()+interval '590 seconds' from private.email_jobs where id='${f.job}'`,
        ),
        "t",
      );
      const late = fixture();
      sql(
        `update private.email_jobs set first_attempt_at=now()-interval '23 hours 59 minutes' where id='${late.job}'`,
      );
      rpc(null, "email.finish", {
        jobId: late.job,
        leaseId: late.lease,
        outcome: "transient",
        retryAfterSeconds: 600,
      });
      assert.equal(
        sql(`select state from private.email_jobs where id='${late.job}'`),
        "needs_review",
      );
    },
  );
  await t.test(
    "revocation during transport records uncertainty and late acceptance reconciles without reopening a send",
    () => {
      const f = fixture();
      rpc(id(2), "invitations.revoke", {
        invitationId: f.invite.id,
        expectedVersion: 0,
        requestId: next(),
      });
      assert.equal(
        sql(`select state from private.email_jobs where id='${f.job}'`),
        "needs_review",
      );
      rpc(null, "email.webhook", {
        eventId: "operations-late-event",
        providerId: "operations-late-provider",
        eventType: "delivered",
        occurredAt: new Date().toISOString(),
      });
      rpc(null, "email.finish", {
        jobId: f.job,
        leaseId: f.lease,
        outcome: "sent",
        providerId: "operations-late-provider",
      });
      rpc(null, "email.finish", {
        jobId: f.job,
        leaseId: f.lease,
        outcome: "sent",
        providerId: "operations-late-provider",
      });
      assert.equal(
        sql(
          `select provider_message_id from private.email_jobs where id='${f.job}'`,
        ),
        "operations-late-provider",
      );
      assert.equal(
        sql(`select state from private.email_jobs where id='${f.job}'`),
        "needs_review",
      );
      assert.equal(
        sql(
          `select matched_job_id from private.email_events where provider_event_id='operations-late-event'`,
        ),
        f.job,
      );
      assert.equal(
        sql(
          `select count(*) from private.email_attempts where job_id='${f.job}'`,
        ),
        "1",
      );
      assert.throws(
        () =>
          rpc(null, "email.finish", {
            jobId: f.job,
            leaseId: next(),
            outcome: "sent",
            providerId: "forged",
          }),
        /lease_unavailable/,
      );
    },
  );
  await t.test(
    "operator email diagnostics are bounded, read-only and contain no raw payload, addresses or credentials",
    () => {
      assert.throws(() => rpc(id(2), "operations.email", {}), /denied/);
      assert.throws(() => rpc(null, "operations.email", {}), /denied/);
      const before = sql("select sum(attempts) from private.email_jobs");
      const page = rpc(id(1), "operations.email", { limit: 5000 });
      assert.ok(page.jobs.length > 0);
      assert.ok(page.jobs.length <= 50);
      for (const job of page.jobs) {
        assert.ok(job.delivery);
        assert.ok(job.recipientMasked.includes("***"));
      }
      assert.doesNotMatch(
        JSON.stringify(page),
        /email-operations-\d+@|recipient_email|prepared_payload|token_hash|envelope|clinical|provider_message_id/,
      );
      assert.equal(sql("select sum(attempts) from private.email_jobs"), before);
      assert.throws(
        () =>
          sql("set role authenticated;select * from private.email_attempts"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "expiring verification is prioritised while aged ordinary mail cannot starve",
    () => {
      // Transaction-scoped fictional queue: rollback preserves all prior fixtures.
      const select = (aged) =>
        JSON.parse(
          sql(`begin;
      update private.email_jobs set due_at=now()+interval '1 day',lease_expires_at=now()+interval '1 day';
      insert into private.email_jobs(id,family,related_id,related_version,idempotency_key,recipient_email,due_at,expires_at)
      values ('${id(800)}','referral','${id(810)}',0,'priority-ordinary','priority@example.test',now()-interval '${aged ? "10 minutes" : "0 seconds"}',null),
      ('${id(801)}','auth_verification','${id(811)}',0,'priority-auth','priority@example.test',now(),now()+interval '60 seconds');
      select public.rw_workflow(null,'email.claim','{"configured":true,"limit":1}');rollback;`),
        );
      assert.equal(select(false)[0].id, id(801));
      assert.equal(select(true)[0].id, id(800));
    },
  );
}
