import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
export async function recoveryChecks(t, { container, sql }) {
  if (!/^returnwell-workflow-test-\d+$/.test(container))
    throw Error("Only a disposable fictional database is permitted");
  await t.test(
    "canonical fictional database restore keeps counts and cannot replay queued mail",
    () => {
      const started = Date.now(),
        counts = sql(
          "select jsonb_build_object('referrals',(select count(*) from public.referrals),'events',(select count(*) from public.referral_events),'jobs',(select count(*) from private.email_jobs))",
        );
      const dump = execFileSync(
        "docker",
        [
          "exec",
          container,
          "pg_dump",
          "-U",
          "postgres",
          "--no-owner",
          "postgres",
        ],
        { maxBuffer: 100 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
      );
      sql("create database returnwell_restore");
      const restored = (query) =>
        execFileSync(
          "docker",
          [
            "exec",
            "-i",
            container,
            "psql",
            "-U",
            "postgres",
            "-d",
            "returnwell_restore",
            "-X",
            "-q",
            "-A",
            "-t",
            "-v",
            "ON_ERROR_STOP=1",
          ],
          {
            input: query,
            encoding: "utf8",
            maxBuffer: 100 * 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
          },
        ).trim();
      restored(dump);
      assert.equal(
        restored(
          "select jsonb_build_object('referrals',(select count(*) from public.referrals),'events',(select count(*) from public.referral_events),'jobs',(select count(*) from private.email_jobs))",
        ),
        counts,
      );
      // New restored target has no public listener or worker. Set the database
      // latch before any worker can be attached, even one with copied env flags.
      restored(
        "update private.delivery_quarantine set active=true,reason_code='restore_reconciliation',activated_at=now() where singleton",
      );
      restored(
        "insert into private.email_jobs(family,related_id,related_version,idempotency_key,recipient_email) values ('referral','00000000-0000-4000-8000-000099999999',0,'restore-fixture','restored@example.test')",
      );
      assert.equal(
        restored(
          "set role service_role;select public.rw_workflow(null,'email.claim','{\"configured\":true,\"limit\":20}')",
        ),
        "[]",
      );
      assert.equal(
        restored(
          'set role service_role;select public.rw_workflow(null,\'email.start\',\'{"jobId":"00000000-0000-4000-8000-000099999999","leaseId":"00000000-0000-4000-8000-000099999998"}\')',
        ),
        '{"sendAllowed": false}',
      );
      assert.throws(
        () =>
          restored(
            "set role authenticated;update private.delivery_quarantine set active=false",
          ),
        /permission denied/,
      );
      assert.equal(
        restored(
          "select attempts from private.email_jobs where idempotency_key='restore-fixture'",
        ),
        "0",
      );
      console.log(
        JSON.stringify({
          recoveryLayer: "disposable-postgres",
          restoreElapsedMs: Date.now() - started,
          sendGateDisabled: true,
          countsPreserved: true,
        }),
      );
    },
  );
}
