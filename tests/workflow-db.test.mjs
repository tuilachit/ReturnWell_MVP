import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Opt-in, isolated Postgres. Never opens a URL or uses the application's hosted credentials.
const enabled = process.env.RW_DATABASE_TEST === "1";
const container = `returnwell-workflow-test-${process.pid}`;
function sql(query) {
  return execFileSync("docker", [
    "exec",
    "-i",
    container,
    "psql",
    "-h",
    "127.0.0.1",
    "-X",
    "-q",
    "-A",
    "-t",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "postgres",
  ], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    .trim();
}
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function rpc(actor, action, input = {}) {
  return JSON.parse(
    sql(
      `set role service_role; select public.rw_workflow(${
        actor ? `'${actor}'` : "null"
      },'${action}','${JSON.stringify(input).replaceAll("'", "''")}'::jsonb);`,
    ),
  );
}
test(
  "actual Postgres transactions enforce invitation and referral permissions",
  { skip: !enabled },
  async (t) => {
    execFileSync("docker", [
      "run",
      "--rm",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "postgres:17-alpine",
    ], { stdio: "pipe" });
    try {
      for (let i = 0; i < 60; i++) {
        try {
          sql("select 1");
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      sql(
        `create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      create function public.rls_auto_enable() returns void language sql as $$select$$;`,
      );
      for (
        const file of readdirSync(
          new URL("../supabase/migrations/", import.meta.url),
        ).filter((x) => x.endsWith(".sql")).sort()
      ) {
        sql(
          readFileSync(
            new URL(`../supabase/migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
      }
      await t.test("service-only workflow endpoint exists; browser roles cannot impersonate an actor", () => {
        assert.equal(
          sql(
            "select to_regprocedure('public.rw_workflow(uuid,text,jsonb)') is not null",
          ),
          "t",
        );
        assert.equal(
          sql(
            "select has_function_privilege('authenticated','public.rw_workflow(uuid,text,jsonb)','execute')",
          ),
          "f",
        );
        assert.equal(
          sql(
            "select has_function_privilege('anon','public.rw_workflow(uuid,text,jsonb)','execute')",
          ),
          "f",
        );
        assert.equal(
          sql(
            "select has_table_privilege('authenticated','public.workspace_invitations','truncate')",
          ),
          "f",
        );
        assert.equal(
          sql(
            "select has_table_privilege('authenticated','public.practitioner_applications','truncate')",
          ),
          "f",
        );
        assert.equal(
          sql(
            "select has_table_privilege('anon','public.workspace_invitations','select')",
          ),
          "f",
        );
      });
      if (
        sql(
          "select to_regprocedure('public.rw_workflow(uuid,text,jsonb)') is not null",
        ) !== "t"
      ) return;
      sql(`insert into auth.users(id,email,email_confirmed_at) values
      ('${id(1)}','operator@example.test',now()),('${
        id(2)
      }','doctor@example.test',now()),('${
        id(3)
      }','practitioner@example.test',now()),('${
        id(4)
      }','stranger@example.test',now());
      insert into private.platform_operators(user_id) values ('${id(1)}');
      insert into public.profiles(id,display_name) values ('${
        id(2)
      }','Editable name');
      insert into public.organisations(id,name,notification_email) values ('${
        id(10)
      }','Fictional Practice','practice@example.test'),('${
        id(11)
      }','Other Practice',null);
      insert into public.organisation_memberships(organisation_id,user_id,role) values ('${
        id(10)
      }','${id(2)}','referrer');
      insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${
        id(2)
      }','${id(10)}','Dr Reviewed','Fictional Practice','${id(1)}');`);
      const inviteInput = {
        kind: "practitioner",
        organisationId: id(10),
        recipientName: "Fictional Clinician",
        recipientEmail: "practitioner@example.test",
        consentConfirmed: true,
        requestId: id(20),
        tokenHash: "a".repeat(64),
        envelope: { test: "encrypted" },
        keyId: "test",
      };
      await t.test("cross-practice invitations and role escalation fail", () => {
        assert.throws(() =>
          rpc(id(2), "invitations.create", {
            ...inviteInput,
            organisationId: id(11),
          }), /denied/);
        assert.throws(
          () =>
            rpc(id(2), "invitations.create", {
              ...inviteInput,
              kind: "doctor",
            }),
          /denied/,
        );
        assert.throws(() =>
          rpc(id(2), "invitations.create", {
            ...inviteInput,
            consentConfirmed: false,
          }), /consent/);
      });
      const invitation = rpc(id(2), "invitations.create", inviteInput);
      await t.test("reviewed branding and idempotency cannot be overridden", () => {
        assert.equal(invitation.inviter_name, "Dr Reviewed");
        assert.equal(
          rpc(id(2), "invitations.create", inviteInput).id,
          invitation.id,
        );
        assert.throws(() =>
          rpc(id(2), "invitations.create", {
            ...inviteInput,
            recipientName: "different",
          }), /conflict/);
        assert.equal(
          sql(
            `select count(*) from private.email_jobs where related_id='${invitation.id}'`,
          ),
          "1",
        );
      });
      await t.test("inspection masks email and never creates a role or consumes the invitation", () => {
        const info = rpc(null, "invitation.inspect", {
          tokenHash: "a".repeat(64),
        });
        assert.equal(info.maskedEmail, "p***@example.test");
        assert.equal(
          JSON.stringify(info).includes("practitioner@example.test"),
          false,
        );
        assert.equal(
          sql(
            `select status from public.workspace_invitations where id='${invitation.id}'`,
          ),
          "pending",
        );
        assert.equal(
          sql(
            `select count(*) from public.practitioner_users where user_id='${
              id(3)
            }'`,
          ),
          "0",
        );
      });
      const attempt = rpc(null, "invitation.begin", {
        tokenHash: "a".repeat(64),
        termsVersion: "v1",
        privacyVersion: "v1",
        consentAccepted: true,
        requestId: id(21),
      });
      rpc(null, "invitation.attach_auth", {
        attemptId: attempt.attemptId,
        authLeaseId: attempt.authLeaseId,
        authUserId: id(3),
        tokenType: "magiclink",
        envelope: { test: "encrypted" },
      });
      await t.test("forwarded invitation cannot be claimed by another verified mailbox", () => {
        assert.throws(() =>
          rpc(id(4), "invitation.claim", {
            invitationId: invitation.id,
            attemptId: attempt.attemptId,
            displayName: "Impostor",
            requestId: id(22),
          }), /denied/);
      });
      const claim = rpc(id(3), "invitation.claim", {
        invitationId: invitation.id,
        attemptId: attempt.attemptId,
        displayName: "Fictional Clinician",
        requestId: id(23),
      });
      const appId = claim.applicationId;
      await t.test("claim creates only one private draft and counts acceptance once", () => {
        assert.equal(
          rpc(id(3), "invitation.claim", {
            invitationId: invitation.id,
            attemptId: attempt.attemptId,
            displayName: "Fictional Clinician",
            requestId: id(23),
          }).applicationId,
          appId,
        );
        assert.equal(
          sql(
            `select count(*) from public.practitioner_applications where user_id='${
              id(3)
            }'`,
          ),
          "1",
        );
        assert.equal(
          sql(
            `select count(*) from private.invitation_secrets where invitation_id='${invitation.id}'`,
          ),
          "0",
        );
        assert.equal(
          sql(
            `select count(*) from public.practitioner_users where user_id='${
              id(3)
            }'`,
          ),
          "0",
        );
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(4)
            }'; select count(*) from public.practitioner_applications;`,
          ),
          "0",
        );
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(3)
            }'; select count(*) from public.verified_practitioners;`,
          ),
          "0",
        );
      });
      const profile = {
        displayName: "Fictional Clinician",
        profession: "physiotherapist",
        registrationNumber: "PHY0001234567",
        practiceName: "Fictional Allied Health",
        services: ["Physiotherapy"],
        funding: ["Private"],
        languages: ["English"],
        telehealth: false,
        acceptingNewReferrals: true,
        locations: [{
          suburb: "Sydney",
          postcode: "2000",
          state: "NSW",
          isPrimary: true,
        }],
      };
      await t.test("unknown booleans, trust overrides and missing consent cannot submit", () => {
        assert.throws(() =>
          rpc(id(4), "application.save", {
            applicationId: appId,
            expectedVersion: 0,
            profile,
          }), /denied/);
        assert.throws(() =>
          rpc(id(3), "application.save", {
            applicationId: appId,
            expectedVersion: 0,
            profile: { ...profile, lifecycleStatus: "active" },
          }), /invalid_profile/);
        assert.throws(() =>
          rpc(id(3), "application.submit", {
            applicationId: appId,
            expectedVersion: 0,
            profileConfirmed: true,
            referralConsent: true,
            termsVersion: "v1",
          }), /invalid_profile/);
      });
      const saved = rpc(id(3), "application.save", {
        applicationId: appId,
        expectedVersion: 0,
        profile,
      });
      assert.throws(() =>
        rpc(id(3), "application.save", {
          applicationId: appId,
          expectedVersion: 0,
          profile,
        }), /conflict/);
      const submitted = rpc(id(3), "application.submit", {
        applicationId: appId,
        expectedVersion: saved.version,
        profileConfirmed: true,
        referralConsent: true,
        termsVersion: "v1",
        privacyVersion: "v1",
      });
      const review = {
        applicationId: appId,
        expectedVersion: submitted.version,
        decision: "approved",
        requestId: id(24),
        identityEvidence: {
          method: "independent_practice_contact",
          matched: true,
          reference: "Fictional phone verification reference",
          checkedAt: new Date().toISOString(),
        },
        registrationEvidence: {
          method: "manual_register",
          matched: true,
          reference: "Fictional register evidence reference",
          registrationNumber: "PHY0001234567",
          checkedAt: new Date().toISOString(),
        },
      };
      await t.test("review requires an independent operator and evidence", () => {
        assert.throws(() => rpc(id(3), "review.decide", review), /denied/);
        assert.throws(
          () =>
            rpc(id(1), "review.decide", { ...review, identityEvidence: {} }),
          /evidence_required/,
        );
        assert.equal(sql(`select count(*) from public.practitioners`), "0");
      });
      const approved = rpc(id(1), "review.decide", review);
      await t.test("approval is atomic and only approved fields become directory-visible", () => {
        assert.equal(approved.status, "approved");
        assert.equal(
          sql(
            `select count(*) from public.practitioner_users where user_id='${
              id(3)
            }' and active`,
          ),
          "1",
        );
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(2)
            }'; select count(*) from public.verified_practitioners`,
          ),
          "1",
        );
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(4)
            }'; select count(*) from public.practitioners`,
          ),
          "0",
        );
        assert.throws(() =>
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(3)
            }'; select * from private.practitioner_reviews`,
          ), /permission denied/);
      });
      const practitionerId = approved.practitioner_id;
      await t.test("a doctor cannot forge response status through the initial INSERT endpoint", () => {
        assert.throws(() =>
          sql(
            `begin; set role authenticated; set request.jwt.claim.sub='${
              id(2)
            }'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at,status,version)
        values('${id(96)}','RW-FORGED','${id(10)}','${
              id(2)
            }','Fictional','2000','physiotherapist','Fictional','Private','in_person','doctor','${practitionerId}',now(),'accepted',9); rollback;`,
          ), /permission denied/);
      });
      sql(
        `set role authenticated; set request.jwt.claim.sub='${
          id(2)
        }'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
      values('${id(30)}','RW-TEST-1','${id(10)}','${
          id(2)
        }','Fictional patient','2000','physiotherapist','Fictional details only','Private','in_person','doctor','${practitionerId}',now());`,
      );
      await t.test("pause removes matching but keeps assigned access; strangers cannot respond", () => {
        rpc(id(3), "application.availability", {
          practitionerId,
          acceptingNewReferrals: false,
        });
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(2)
            }'; select count(*) from public.verified_practitioners`,
          ),
          "0",
        );
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(3)
            }'; select count(*) from public.referrals`,
          ),
          "1",
        );
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(2)
            }'; select display_name from public.practitioners where id='${practitionerId}'`,
          ),
          "Fictional Clinician",
        );
        assert.throws(() =>
          rpc(id(4), "referral.respond", {
            referralId: id(30),
            expectedVersion: 0,
            decision: "accepted",
            requestId: id(31),
          }), /denied/);
      });
      const responseInput = {
        referralId: id(30),
        expectedVersion: 0,
        decision: "accepted",
        requestId: id(32),
      };
      const response = rpc(id(3), "referral.respond", responseInput);
      await t.test("response commits one event and one new notification; retries never duplicate", () => {
        assert.equal(response.status, "accepted");
        assert.equal(response.version, 1);
        assert.deepEqual(
          rpc(id(3), "referral.respond", responseInput),
          response,
        );
        assert.throws(() =>
          rpc(id(3), "referral.respond", {
            ...responseInput,
            decision: "declined",
            reasonCode: "capacity",
          }), /conflict/);
        assert.equal(
          sql(
            `select count(*) from public.referral_events where referral_id='${
              id(30)
            }' and event_type='accepted' and actor_user_id='${id(3)}'`,
          ),
          "1",
        );
        assert.equal(
          sql(
            `select count(*) from public.notification_outbox where referral_id='${
              id(30)
            }'`,
          ),
          "2",
        );
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(2)
            }'; select count(*) from public.referral_events where referral_id='${
              id(30)
            }'`,
          ),
          "2",
        );
      });
      await t.test("revoked practitioner linkage immediately blocks existing-session clinical access", () => {
        sql(
          `update public.practitioner_users set active=false,revoked_at=now() where user_id='${
            id(3)
          }'`,
        );
        assert.equal(
          sql(
            `set role authenticated; set request.jwt.claim.sub='${
              id(3)
            }'; select count(*) from public.referrals`,
          ),
          "0",
        );
        assert.throws(
          () => rpc(id(3), "referral.respond", responseInput),
          /denied/,
        );
        sql(
          `update public.practitioner_users set active=true,revoked_at=null where user_id='${
            id(3)
          }'`,
        );
      });
      await t.test("unconfigured delivery does not use an attempt; workers cannot share a lease", () => {
        assert.deepEqual(
          rpc(null, "email.claim", { configured: false, limit: 20 }),
          [],
        );
        assert.equal(sql(`select max(attempts) from private.email_jobs`), "0");
        const jobs = rpc(null, "email.claim", { configured: true, limit: 20 });
        assert.equal(
          jobs.filter((j) => j.family === "referral").length,
          2,
        );
        assert.deepEqual(
          rpc(null, "email.claim", { configured: true, limit: 20 }),
          [],
        );
        assert.throws(() =>
          rpc(null, "email.finish", {
            jobId: jobs[0].id,
            leaseId: id(98),
            outcome: "sent",
            providerId: "invalid",
          }), /lease/);
        for (const [i, j] of jobs.entries()) {
          rpc(null, "email.finish", {
            jobId: j.id,
            leaseId: j.lease_id,
            outcome: "sent",
            providerId: `email-${i}`,
          });
        }
        assert.deepEqual(
          rpc(null, "email.claim", { configured: true, limit: 20 }),
          [],
        );
      });
      await t.test("missing practice email persists configuration-needed without rolling back decline", () => {
        sql(
          `update public.organisations set notification_email=null where id='${
            id(10)
          }'; update public.practitioners set accepting_new_referrals=true where id='${practitionerId}';
        set role authenticated; set request.jwt.claim.sub='${
            id(2)
          }'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
        values('${id(40)}','RW-TEST-2','${id(10)}','${
            id(2)
          }','Fictional patient','2000','physiotherapist','Fictional details','Private','in_person','doctor','${practitionerId}',now());`,
        );
        const res = rpc(id(3), "referral.respond", {
          referralId: id(40),
          expectedVersion: 0,
          decision: "declined",
          reasonCode: "capacity",
          note: "Fictional test response",
          requestId: id(41),
        });
        assert.equal(res.notification, "configuration_needed");
        assert.equal(
          rpc(id(2), "referral.notifications", { referralId: id(40) }).status,
          "configuration_needed",
        );
        assert.equal(
          sql(`select status from public.referrals where id='${id(40)}'`),
          "declined",
        );
        sql(
          `update public.organisations set notification_email='practice@example.test' where id='${
            id(10)
          }'`,
        );
      });
      await t.test("interrupted auth generation can recover the same request; mismatched consent cannot", () => {
        const inv = rpc(id(2), "invitations.create", {
          ...inviteInput,
          recipientEmail: "recover@example.test",
          requestId: id(50),
          tokenHash: "b".repeat(64),
        });
        const input = {
          tokenHash: "b".repeat(64),
          termsVersion: "v1",
          privacyVersion: "v1",
          consentAccepted: true,
          requestId: id(51),
        };
        const first = rpc(null, "invitation.begin", input);
        assert.throws(
          () => rpc(null, "invitation.begin", input),
          /rate_limited/,
        );
        assert.throws(() =>
          rpc(null, "invitation.begin", {
            ...input,
            termsVersion: "different",
          }), /conflict/);
        sql(
          `update private.invitation_auth_attempts set auth_lease_expires_at=now()-interval '1 second' where id='${first.attemptId}'`,
        );
        const retried = rpc(null, "invitation.begin", input);
        assert.equal(retried.attemptId, first.attemptId);
        assert.notEqual(retried.authLeaseId, first.authLeaseId);
        assert.equal(retried.alreadyRequested, undefined);
        sql(
          `update private.email_jobs set prepared_payload='{"ciphertext":"fixture"}' where related_id='${inv.id}'`,
        );
        rpc(id(2), "invitations.revoke", {
          invitationId: inv.id,
          expectedVersion: inv.version,
          requestId: id(52),
        });
        assert.equal(
          sql(
            `select count(*) from private.email_jobs where related_id='${inv.id}' and (payload is not null or prepared_payload is not null)`,
          ),
          "0",
        );
        assert.throws(
          () => rpc(null, "invitation.inspect", { tokenHash: "b".repeat(64) }),
          /unavailable/,
        );
      });
      await t.test("authentic unmatched webhook is retained then reconciled and suppresses retries", () => {
        rpc(null, "email.webhook", {
          eventId: "early-bounce",
          providerId: "early-provider",
          eventType: "bounced",
          occurredAt: new Date().toISOString(),
        });
        assert.equal(
          sql(
            `select count(*) from private.email_events where provider_event_id='early-bounce' and matched_job_id is null`,
          ),
          "1",
        );
        const jobs = rpc(null, "email.claim", { configured: true, limit: 20 });
        assert.equal(jobs.length, 1);
        rpc(null, "email.start", {
          jobId: jobs[0].id,
          leaseId: jobs[0].lease_id,
        });
        rpc(null, "email.finish", {
          jobId: jobs[0].id,
          leaseId: jobs[0].lease_id,
          outcome: "sent",
          providerId: "early-provider",
        });
        assert.equal(
          sql(`select state from private.email_jobs where id='${jobs[0].id}'`),
          "suppressed",
        );
        assert.equal(
          sql(
            `select reason from private.email_suppressions where email='practitioner@example.test'`,
          ),
          "bounce",
        );
        rpc(null, "email.webhook", {
          eventId: "early-bounce",
          providerId: "early-provider",
          eventType: "bounced",
          occurredAt: new Date().toISOString(),
        });
        assert.equal(
          sql(
            `select count(*) from private.email_events where provider_event_id='early-bounce'`,
          ),
          "1",
        );
        assert.deepEqual(
          rpc(null, "email.claim", { configured: true, limit: 20 }),
          [],
        );
      });
      await t.test("two concurrent conflicting decisions produce exactly one outcome and audit event", async () => {
        sql(
          `set role authenticated; set request.jwt.claim.sub='${
            id(2)
          }'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
        values('${id(60)}','RW-TEST-3','${id(10)}','${
            id(2)
          }','Fictional patient','2000','physiotherapist','Fictional details','Private','in_person','doctor','${practitionerId}',now());`,
        );
        const run = promisify(execFile);
        const results = await Promise.allSettled(
          ["accepted", "declined"].map((decision, i) =>
            run("docker", [
              "exec",
              container,
              "psql",
              "-X",
              "-q",
              "-A",
              "-t",
              "-v",
              "ON_ERROR_STOP=1",
              "-U",
              "postgres",
              "postgres",
              "-c",
              `set role service_role; select public.rw_workflow('${
                id(3)
              }','referral.respond','${
                JSON.stringify({
                  referralId: id(60),
                  expectedVersion: 0,
                  decision,
                  reasonCode: "capacity",
                  requestId: id(61 + i),
                })
              }');`,
            ])
          ),
        );
        assert.equal(
          results.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.equal(
          results.filter((r) => r.status === "rejected").length,
          1,
        );
        assert.equal(
          sql(
            `select count(*) from public.referral_events where referral_id='${
              id(60)
            }' and event_type in ('accepted','declined')`,
          ),
          "1",
        );
        assert.equal(
          sql(
            `select count(*) from public.notification_outbox where referral_id='${
              id(60)
            }' and kind in ('referral_accepted','referral_declined')`,
          ),
          "1",
        );
      });
      await t.test("a crash after the fifth attempt becomes review-needed, never a sixth send", () => {
        sql(
          `insert into private.email_jobs(id,family,related_id,related_version,idempotency_key,recipient_email,state,attempts,lease_id,lease_expires_at,first_attempt_at) values('${
            id(70)
          }','referral','${
            id(30)
          }',1,'crash-final','crash@example.test','processing',5,'${
            id(71)
          }',now()-interval '1 second',now()-interval '5 minutes')`,
        );
        const jobs = rpc(null, "email.claim", { configured: true, limit: 20 });
        assert.equal(
          jobs.some((j) => j.id === id(70)),
          false,
        );
        assert.equal(
          sql(`select state from private.email_jobs where id='${id(70)}'`),
          "needs_review",
        );
        assert.equal(
          sql(`select attempts from private.email_jobs where id='${id(70)}'`),
          "5",
        );
      });
      await t.test("a paused job cannot monopolise every worker batch", () => {
        sql(
          `insert into private.email_jobs(id,family,related_id,related_version,idempotency_key,recipient_email,due_at) values('${
            id(74)
          }','referral','${
            id(30)
          }',1,'paused-oldest','paused@example.test',now()-interval '2 days'),('${
            id(75)
          }','referral','${
            id(30)
          }',1,'next-allowed','allowed@example.test',now()-interval '1 day')`,
        );
        const [first] = rpc(null, "email.claim", {
          configured: true,
          limit: 1,
        });
        assert.equal(first.id, id(74));
        rpc(null, "email.finish", {
          jobId: first.id,
          leaseId: first.lease_id,
          outcome: "paused_configuration",
        });
        const [next] = rpc(null, "email.claim", { configured: true, limit: 1 });
        assert.equal(next.id, id(75));
      });
      await t.test("a timeout on the fifth provider attempt remains an ambiguity requiring review", () => {
        sql(
          `insert into private.email_jobs(id,family,related_id,related_version,idempotency_key,recipient_email,state,attempts,lease_id,lease_expires_at,first_attempt_at) values('${
            id(76)
          }','referral','${
            id(30)
          }',1,'timeout-final','timeout@example.test','processing',4,'${
            id(77)
          }',now()+interval '1 minute',now()-interval '5 minutes')`,
        );
        rpc(null, "email.start", { jobId: id(76), leaseId: id(77) });
        rpc(null, "email.finish", {
          jobId: id(76),
          leaseId: id(77),
          outcome: "transient",
        });
        assert.equal(
          sql(`select state from private.email_jobs where id='${id(76)}'`),
          "needs_review",
        );
      });
      await t.test("recipient resend ceiling is atomic across different practices and inviters", async () => {
        sql(
          `insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values('${
            id(1)
          }','${id(11)}','Fictional Operator','Other Practice','${id(1)}')`,
        );
        const a = rpc(id(2), "invitations.create", {
          ...inviteInput,
          recipientEmail: "shared@example.test",
          tokenHash: "c".repeat(64),
          requestId: id(80),
        });
        const b = rpc(id(1), "invitations.create", {
          ...inviteInput,
          organisationId: id(11),
          recipientEmail: "shared@example.test",
          tokenHash: "d".repeat(64),
          requestId: id(81),
        });
        sql(
          `update public.workspace_invitations set updated_at=now()-interval '2 minutes' where id in ('${a.id}','${b.id}'); insert into private.invitation_events(invitation_id,kind) values('${a.id}','invitations.resend'),('${b.id}','invitations.resend')`,
        );
        sql(
          `create function private.fixture_resend_delay() returns trigger language plpgsql as $$begin perform pg_sleep(0.3); return new; end$$; create trigger fixture_resend_delay before update on public.workspace_invitations for each row when (new.recipient_email_normalized='shared@example.test') execute function private.fixture_resend_delay();`,
        );
        const run = promisify(execFile);
        const results = await Promise.allSettled(
          [[id(2), a, "e"], [id(1), b, "f"]].map(([actor, inv, hex], i) =>
            run("docker", [
              "exec",
              container,
              "psql",
              "-X",
              "-q",
              "-A",
              "-t",
              "-v",
              "ON_ERROR_STOP=1",
              "-U",
              "postgres",
              "postgres",
              "-c",
              `set role service_role; select public.rw_workflow('${actor}','invitations.resend','${
                JSON.stringify({
                  invitationId: inv.id,
                  expectedVersion: inv.version,
                  requestId: id(82 + i),
                  tokenHash: hex.repeat(64),
                  envelope: { fixture: true },
                  keyId: "test",
                })
              }');`,
            ])
          ),
        );
        assert.equal(
          results.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.equal(
          sql(
            `select count(*) from private.invitation_events e join public.workspace_invitations i on i.id=e.invitation_id where i.recipient_email_normalized='shared@example.test' and e.kind='invitations.resend'`,
          ),
          "3",
        );
      });
      await t.test("malformed notification configuration cannot roll back a clinical response", () => {
        sql(
          `update public.organisations set notification_email='invalid' where id='${
            id(10)
          }'; set role authenticated; set request.jwt.claim.sub='${
            id(2)
          }'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
        values('${id(93)}','RW-INVALID-CONFIG','${id(10)}','${
            id(2)
          }','Fictional','2000','physiotherapist','Fictional','Private','in_person','doctor','${practitionerId}',now());`,
        );
        const result = rpc(id(3), "referral.respond", {
          referralId: id(93),
          expectedVersion: 0,
          decision: "accepted",
          requestId: id(94),
        });
        assert.equal(result.status, "accepted");
        assert.equal(result.notification, "configuration_needed");
      });
    } finally {
      execFileSync("docker", ["stop", container], { stdio: "pipe" });
    }
  },
);
