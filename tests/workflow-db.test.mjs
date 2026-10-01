import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { directoryScaleFixtureSql } from "./helpers/directory-scale-fixture.mjs";
import { matchPractitioners } from "../app/lib/matching.ts";
import { referralGrowthChecks } from "./helpers/referral-growth-db.mjs";

// Opt-in, isolated Postgres. Never opens a URL or uses the application's hosted credentials.
const enabled = process.env.RW_DATABASE_TEST === "1";
const container = `returnwell-workflow-test-${process.pid}`;
function sql(query) {
  return execFileSync(
    "docker",
    [
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
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
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
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "-d",
        "--name",
        container,
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "postgres:17-alpine",
      ],
      { stdio: "pipe" },
    );
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
      for (const file of readdirSync(
        new URL("../supabase/migrations/", import.meta.url),
      )
        .filter((x) => x.endsWith(".sql"))
        .sort()) {
        sql(
          readFileSync(
            new URL(`../supabase/migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
      }
      await t.test(
        "service-only workflow endpoint exists; browser roles cannot impersonate an actor",
        () => {
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
        },
      );
      if (
        sql(
          "select to_regprocedure('public.rw_workflow(uuid,text,jsonb)') is not null",
        ) !== "t"
      )
        return;
      sql(`insert into auth.users(id,email,email_confirmed_at) values
      ('${id(1)}','operator@example.test',now()),('${id(
        2,
      )}','doctor@example.test',now()),('${id(
        3,
      )}','practitioner@example.test',now()),('${id(
        4,
      )}','stranger@example.test',now());
      insert into private.platform_operators(user_id) values ('${id(1)}');
      insert into public.profiles(id,display_name) values ('${id(
        2,
      )}','Editable name');
      insert into public.organisations(id,name,notification_email) values ('${id(
        10,
      )}','Fictional Practice','practice@example.test'),('${id(
        11,
      )}','Other Practice',null);
      insert into public.organisation_memberships(organisation_id,user_id,role) values ('${id(
        10,
      )}','${id(2)}','referrer');
      insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${id(
        2,
      )}','${id(10)}','Dr Reviewed','Fictional Practice','${id(1)}');`);
      await t.test(
        "practice administration is independent, audited, versioned and loses access immediately on revoke",
        () => {
          assert.throws(
            () =>
              rpc(id(2), "practice.create", {
                name: "Escalation",
                ownerUserId: id(2),
                requestId: id(9701),
                evidenceReference: "check",
              }),
            /denied/,
          );
          sql(
            `insert into auth.users(id,email) values ('${id(9700)}','unverified-owner@example.test')`,
          );
          assert.throws(
            () =>
              rpc(id(1), "practice.create", {
                name: "Invalid owner",
                ownerUserId: id(9700),
                requestId: id(9702),
                evidenceReference: "check",
              }),
            /verified_owner_required/,
          );
          assert.throws(
            () =>
              rpc(id(1), "practice.create", {
                name: "Self approval",
                ownerUserId: id(1),
                requestId: id(9703),
                evidenceReference: "check",
              }),
            /denied/,
          );
          sql(
            `update auth.users set email_confirmed_at=now() where id='${id(9700)}'`,
          );
          const create = {
            name: "Independently reviewed practice",
            ownerUserId: id(9700),
            requestId: id(9704),
            evidenceReference: "Owner identity checked offline",
          };
          const created = rpc(id(1), "practice.create", create);
          assert.ok(created.organisationId);
          assert.deepEqual(rpc(id(1), "practice.create", create), created);
          const org = created.organisationId;
          assert.equal(
            sql(
              `select count(*) from private.practice_admin_events where organisation_id='${org}'`,
            ),
            "1",
          );
          const record = rpc(id(1), "practice.list", { organisationId: org })
            .practices[0];
          assert.equal(record.contact, null);
          const owner = record.members[0];
          assert.equal(owner.role, "owner");
          assert.throws(
            () =>
              rpc(id(4), "practice.reviewContact", {
                organisationId: org,
                expectedVersion: 0,
                requestId: id(9705),
                contactPhone: "02 1234 5678",
                evidenceReference: "self",
              }),
            /denied/,
          );
          assert.throws(
            () =>
              rpc(id(1), "practice.reviewContact", {
                organisationId: org,
                expectedVersion: 0,
                requestId: id(9706),
                contactPhone: "02 1234 5678",
              }),
            /evidence_required/,
          );
          const contact = {
            organisationId: org,
            expectedVersion: 0,
            requestId: id(9707),
            contactPhone: "02 1234 5678",
            secureInstructions:
              "Call for the secure handover channel. No patient information in email.",
            contactEmail: "work@example.test",
            evidenceReference: "Called independently sourced practice number",
          };
          const saved = rpc(id(1), "practice.reviewContact", contact);
          assert.equal(saved.version, 1);
          assert.deepEqual(
            rpc(id(1), "practice.reviewContact", contact),
            saved,
          );
          assert.throws(
            () =>
              rpc(id(1), "practice.reviewContact", {
                ...contact,
                requestId: id(9708),
              }),
            /conflict/,
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(2)}'; select count(*) from public.organisations where id='${org}'`,
            ),
            "0",
          );
          assert.throws(
            () =>
              sql(
                "set role authenticated; select * from private.practice_contacts",
              ),
            /permission denied/,
          );
          assert.throws(
            () =>
              sql(
                `set role authenticated; set request.jwt.claim.sub='${id(9700)}'; update public.organisations set notification_email='unreviewed@example.test' where id='${org}'`,
              ),
            /permission denied/,
          );
          assert.throws(
            () =>
              rpc(id(1), "practice.revokeMember", {
                organisationId: org,
                memberId: owner.id,
                expectedVersion: 0,
                reason: "Cannot remove the last owner",
                requestId: id(9709),
              }),
            /last_owner/,
          );
          sql(
            `insert into public.organisation_memberships(organisation_id,user_id,role) values ('${org}','${id(2)}','referrer')`,
          );
          const member = rpc(id(1), "practice.list", {
            organisationId: org,
          }).practices[0].members.find((m) => m.userId === id(2));
          const identity = {
            organisationId: org,
            memberId: member.id,
            expectedVersion: 1,
            displayName: "Dr Independently Reviewed",
            evidenceReference: "Identity and practice relationship checked",
            requestId: id(9710),
          };
          rpc(id(1), "practice.reviewInviter", identity);
          assert.equal(
            sql(
              `select display_name from private.inviter_identities where user_id='${id(2)}' and organisation_id='${org}'`,
            ),
            "Dr Independently Reviewed",
          );
          sql(
            `update public.profiles set display_name='Changed by user' where id='${id(2)}'`,
          );
          assert.equal(
            sql(
              `select display_name from private.inviter_identities where user_id='${id(2)}' and organisation_id='${org}'`,
            ),
            "Dr Independently Reviewed",
          );
          const revoke = {
            organisationId: org,
            memberId: member.id,
            expectedVersion: 0,
            reason: "Practice relationship ended",
            requestId: id(9711),
          };
          rpc(id(1), "practice.revokeMember", revoke);
          assert.deepEqual(rpc(id(1), "practice.revokeMember", revoke), {
            ok: true,
            version: 1,
          });
          assert.throws(
            () => rpc(id(2), "referral.list", { organisationId: org }),
            /denied/,
          );
          assert.equal(
            sql(
              `select active from private.inviter_identities where user_id='${id(2)}' and organisation_id='${org}'`,
            ),
            "f",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(1)}'; select count(*) from public.referrals`,
            ),
            "0",
          );
          assert.equal(
            sql(`select count(*) from private.platform_operators`),
            "1",
          );
          sql(
            `insert into auth.users(id,email,email_confirmed_at) values ('${id(9720)}','second-owner@example.test',now()); insert into public.organisation_memberships(organisation_id,user_id,role) values ('${org}','${id(9720)}','owner')`,
          );
          const ownerRevoke = {
            organisationId: org,
            memberId: owner.id,
            expectedVersion: 0,
            reason: "Owner change",
            requestId: id(9721),
          };
          assert.throws(
            () => rpc(id(1), "practice.revokeMember", ownerRevoke),
            /last_owner/,
          );
          sql(
            `insert into private.practice_member_reviews(member_id,reviewed_by,evidence_reference) select id,'${id(1)}','Fictional independently checked successor' from public.organisation_memberships where organisation_id='${org}' and user_id='${id(9720)}'`,
          );
          assert.equal(
            rpc(id(1), "practice.revokeMember", ownerRevoke).ok,
            true,
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(9700)}'; select count(*) from public.organisations where id='${org}'`,
            ),
            "0",
          );
          sql(
            `update public.profiles set display_name='Editable name' where id='${id(2)}'`,
          );
        },
      );
      await t.test(
        "credential policies fail closed until independently configured",
        () => {
          assert.equal(
            sql(
              "select count(*) from private.profession_policies where enabled",
            ),
            "0",
          );
          assert.equal(
            sql("select count(*) from private.profession_policies"),
            "34",
          );
          assert.throws(
            () =>
              sql(
                "set role authenticated; select * from private.professional_credentials",
              ),
            /permission denied/,
          );
          assert.throws(
            () =>
              sql(
                "update private.profession_policies set enabled=true where profession_id='exercise_physiologist'",
              ),
            /check constraint/,
          );
        },
      );
      // Fictional test policy only; production policies remain unapproved.
      sql(
        `update private.profession_policies set enabled=true,review_interval_days=7,identifier_pattern='^PHY[0-9]{10}$',approved_by='${id(1)}',approved_at=now(),evidence_reference='Fictional local test policy' where profession_id='physiotherapist'`,
      );
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
      await t.test(
        "cross-practice invitations and role escalation fail",
        () => {
          assert.throws(
            () =>
              rpc(id(2), "invitations.create", {
                ...inviteInput,
                organisationId: id(11),
              }),
            /denied/,
          );
          assert.throws(
            () =>
              rpc(id(2), "invitations.create", {
                ...inviteInput,
                kind: "doctor",
              }),
            /denied/,
          );
          assert.throws(
            () =>
              rpc(id(2), "invitations.create", {
                ...inviteInput,
                consentConfirmed: false,
              }),
            /consent/,
          );
        },
      );
      const invitation = rpc(id(2), "invitations.create", inviteInput);
      await t.test(
        "reviewed branding and idempotency cannot be overridden",
        () => {
          assert.equal(invitation.inviter_name, "Dr Reviewed");
          assert.equal(
            rpc(id(2), "invitations.create", inviteInput).id,
            invitation.id,
          );
          assert.throws(
            () =>
              rpc(id(2), "invitations.create", {
                ...inviteInput,
                recipientName: "different",
              }),
            /conflict/,
          );
          assert.equal(
            sql(
              `select count(*) from private.email_jobs where related_id='${invitation.id}'`,
            ),
            "1",
          );
        },
      );
      await t.test(
        "inspection masks email and never creates a role or consumes the invitation",
        () => {
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
              `select count(*) from public.practitioner_users where user_id='${id(
                3,
              )}'`,
            ),
            "0",
          );
        },
      );
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
      await t.test(
        "forwarded invitation cannot be claimed by another verified mailbox",
        () => {
          assert.throws(
            () =>
              rpc(id(4), "invitation.claim", {
                invitationId: invitation.id,
                attemptId: attempt.attemptId,
                displayName: "Impostor",
                requestId: id(22),
              }),
            /denied/,
          );
        },
      );
      const claim = rpc(id(3), "invitation.claim", {
        invitationId: invitation.id,
        attemptId: attempt.attemptId,
        displayName: "Fictional Clinician",
        requestId: id(23),
      });
      const appId = claim.applicationId;
      await t.test(
        "application policy metadata is owner scoped and excludes independent verification evidence",
        () => {
          const own = rpc(id(3), "application.load", { applicationId: appId });
          assert.ok(Array.isArray(own.professionPolicies));
          assert.equal(
            own.professionPolicies.find(
              (p) => p.professionId === "physiotherapist",
            ).enabled,
            true,
          );
          assert.deepEqual(Object.keys(own.professionPolicies[0]).sort(), [
            "authorityId",
            "enabled",
            "professionId",
            "route",
            "scope",
          ]);
          assert.throws(
            () => rpc(id(4), "application.load", { applicationId: appId }),
            /denied/,
          );
        },
      );
      await t.test(
        "claim creates only one private draft and counts acceptance once",
        () => {
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
              `select count(*) from public.practitioner_applications where user_id='${id(
                3,
              )}'`,
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
              `select count(*) from public.practitioner_users where user_id='${id(
                3,
              )}'`,
            ),
            "0",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                4,
              )}'; select count(*) from public.practitioner_applications;`,
            ),
            "0",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                3,
              )}'; select count(*) from public.verified_practitioners;`,
            ),
            "0",
          );
        },
      );
      const profile = {
        displayName: "Fictional Clinician",
        profession: "physiotherapist",
        registrationNumber: "PHY0001234567",
        practiceName: "Fictional Allied Health",
        services: ["Physiotherapy"],
        funding: ["Self funded"],
        languages: ["English"],
        telehealth: false,
        acceptingNewReferrals: true,
        locations: [
          {
            suburb: "Sydney",
            postcode: "2000",
            state: "NSW",
            isPrimary: true,
          },
        ],
      };
      await t.test(
        "unknown booleans, trust overrides and missing consent cannot submit",
        () => {
          assert.throws(
            () =>
              rpc(id(4), "application.save", {
                applicationId: appId,
                expectedVersion: 0,
                profile,
              }),
            /denied/,
          );
          assert.throws(
            () =>
              rpc(id(3), "application.save", {
                applicationId: appId,
                expectedVersion: 0,
                profile: { ...profile, lifecycleStatus: "active" },
              }),
            /invalid_profile/,
          );
          assert.throws(
            () =>
              rpc(id(3), "application.submit", {
                applicationId: appId,
                expectedVersion: 0,
                profileConfirmed: true,
                referralConsent: true,
                termsVersion: "v1",
              }),
            /invalid_profile/,
          );
        },
      );
      const saved = rpc(id(3), "application.save", {
        applicationId: appId,
        expectedVersion: 0,
        profile,
      });
      assert.throws(
        () =>
          rpc(id(3), "application.save", {
            applicationId: appId,
            expectedVersion: 0,
            profile,
          }),
        /conflict/,
      );
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
      await t.test(
        "review requires an independent operator and evidence",
        () => {
          assert.throws(() => rpc(id(3), "review.decide", review), /denied/);
          sql(
            `insert into private.platform_operators(user_id) values ('${id(3)}')`,
          );
          assert.throws(
            () => rpc(id(3), "review.decide", review),
            /denied/,
            "operator role must not permit self-approval",
          );
          sql(
            `delete from private.platform_operators where user_id='${id(3)}'`,
          );
          assert.throws(
            () =>
              rpc(id(1), "review.decide", { ...review, identityEvidence: {} }),
            /evidence_required/,
          );
          assert.equal(sql(`select count(*) from public.practitioners`), "0");
        },
      );
      const approved = rpc(id(1), "review.decide", review);
      await t.test(
        "approval is atomic and only approved fields become directory-visible",
        () => {
          assert.equal(approved.status, "approved");
          assert.equal(
            sql(
              `select count(*) from public.practitioner_users where user_id='${id(
                3,
              )}' and active`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                2,
              )}'; select count(*) from public.verified_practitioners`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                4,
              )}'; select count(*) from public.practitioners`,
            ),
            "0",
          );
          assert.throws(
            () =>
              sql(
                `set role authenticated; set request.jwt.claim.sub='${id(
                  3,
                )}'; select * from private.practitioner_reviews`,
              ),
            /permission denied/,
          );
        },
      );
      const practitionerId = approved.practitioner_id;
      await t.test(
        "credential status projection is owner-only and never exposes identifiers or evidence",
        () => {
          const summary = rpc(id(3), "application.credentials", {
            practitionerId,
          });
          assert.equal(summary.eligibleForNewReferral, true);
          assert.equal(summary.credentials[0].professionId, "physiotherapist");
          assert.doesNotMatch(
            JSON.stringify(summary),
            /PHY0001234567|evidence|reviewer|owner_user/,
          );
          assert.throws(
            () => rpc(id(2), "application.credentials", { practitionerId }),
            /denied/,
          );
          assert.throws(
            () => rpc(id(1), "application.credentials", { practitionerId }),
            /denied/,
          );
          assert.throws(
            () =>
              sql(
                `set role authenticated; set request.jwt.claim.sub='${id(2)}'; select ahpra_registration_number from public.practitioners`,
              ),
            /permission denied/,
          );
        },
      );
      await t.test(
        "credential freshness and suspension gate directory and acceptance independently of intake",
        () => {
          assert.equal(
            sql(
              `select private.practitioner_is_eligible('${practitionerId}','physiotherapist',now())`,
            ),
            "t",
          );
          assert.equal(
            sql(
              `begin; update private.professional_credentials set expires_at=now() where practitioner_id='${practitionerId}'; select private.practitioner_is_eligible('${practitionerId}','physiotherapist',now()); rollback;`,
            ),
            "f",
          );
          assert.equal(
            sql(
              `begin; update public.practitioners set accepting_new_referrals=false where id='${practitionerId}'; select private.practitioner_has_access('${practitionerId}') and private.practitioner_credential_current('${practitionerId}','physiotherapist',now()) and not private.practitioner_is_eligible('${practitionerId}','physiotherapist',now()); rollback;`,
            ),
            "t",
          );
          assert.equal(
            sql(
              `begin; update public.practitioners set access_suspended_at=now() where id='${practitionerId}'; select private.practitioner_has_access('${practitionerId}'); rollback;`,
            ),
            "f",
          );
          assert.equal(
            sql(
              `select private.practitioner_is_eligible('${practitionerId}','psychologist',now())`,
            ),
            "f",
          );
          assert.equal(
            sql(
              `select private.practitioner_is_eligible('${practitionerId}','physiotherapist',now()+interval '8 days')`,
            ),
            "f",
          );
          assert.equal(
            sql(
              `begin; update private.profession_policies set review_interval_days=1 where profession_id='physiotherapist'; select private.practitioner_is_eligible('${practitionerId}','physiotherapist',now()+interval '2 days'); rollback;`,
            ),
            "f",
          );
        },
      );
      await t.test(
        "legacy approvals require independent evidence and are never given invented review deadlines",
        () => {
          const remove = `delete from private.practitioner_professions where practitioner_id='${practitionerId}'; delete from private.professional_credentials where practitioner_id='${practitionerId}';`;
          assert.equal(
            sql(
              `begin; ${remove} select private.practitioner_is_eligible('${practitionerId}','physiotherapist',now()); rollback;`,
            ),
            "f",
          );
          assert.equal(
            sql(
              `begin; ${remove} select private.reconcile_legacy_credentials(); select private.practitioner_has_access('${practitionerId}') and not private.practitioner_is_eligible('${practitionerId}','physiotherapist',now()); rollback;`,
            ).trim(),
            "t",
          );
          assert.equal(
            sql(
              `begin; ${remove} update private.practitioner_reviews set registration_evidence=jsonb_set(registration_evidence,'{checkedAt}','"malformed"') where application_id='${appId}'; select private.reconcile_legacy_credentials(); select count(*) from private.professional_credentials where practitioner_id='${practitionerId}'; rollback;`,
            ).trim(),
            "0",
          );
        },
      );
      for (const offset of ["+ interval '5 minutes'", "- interval '1 day'"]) {
        await t.test(
          `consent uses database time despite client clock ${offset}`,
          () => {
            assert.equal(
              sql(`begin; set role authenticated; set request.jwt.claim.sub='${id(2)}';
            insert into public.referrals(reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
            values('RW-CLOCK','${id(10)}','${id(2)}','Fictional','2000','physiotherapist','Fictional','Self funded','in_person','doctor','${practitionerId}',now() ${offset})
            returning consent_confirmed_at = now(); rollback;`),
              "t",
            );
          },
        );
      }
      await t.test(
        "server timestamp cannot manufacture missing consent",
        () => {
          assert.throws(() =>
            sql(`begin; set role authenticated; set request.jwt.claim.sub='${id(2)}';
          insert into public.referrals(reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
          values('RW-NO-CONSENT','${id(10)}','${id(2)}','Fictional','2000','physiotherapist','Fictional','Self funded','in_person','doctor','${practitionerId}',null); rollback;`),
          );
        },
      );
      await t.test(
        "a doctor cannot forge response status through the initial INSERT endpoint",
        () => {
          assert.throws(
            () =>
              sql(
                `begin; set role authenticated; set request.jwt.claim.sub='${id(
                  2,
                )}'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at,status,version)
        values('${id(96)}','RW-FORGED','${id(10)}','${id(
          2,
        )}','Fictional','2000','physiotherapist','Fictional','Self funded','in_person','doctor','${practitionerId}',now(),'accepted',9); rollback;`,
              ),
            /permission denied/,
          );
        },
      );
      sql(
        `set role authenticated; set request.jwt.claim.sub='${id(
          2,
        )}'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
      values('${id(30)}','RW-TEST-1','${id(10)}','${id(
        2,
      )}','Fictional patient','2000','physiotherapist','Fictional details only','Self funded','in_person','doctor','${practitionerId}',now());`,
      );
      await t.test(
        "pause removes matching but keeps assigned access; strangers cannot respond",
        () => {
          rpc(id(3), "application.availability", {
            practitionerId,
            acceptingNewReferrals: false,
          });
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                2,
              )}'; select count(*) from public.verified_practitioners`,
            ),
            "0",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                3,
              )}'; select count(*) from public.referrals`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                2,
              )}'; select display_name from public.practitioners where id='${practitionerId}'`,
            ),
            "Fictional Clinician",
          );
          assert.throws(
            () =>
              rpc(id(4), "referral.respond", {
                referralId: id(30),
                expectedVersion: 0,
                decision: "accepted",
                requestId: id(31),
              }),
            /denied/,
          );
        },
      );
      const responseInput = {
        referralId: id(30),
        expectedVersion: 0,
        decision: "accepted",
        requestId: id(32),
      };
      await t.test(
        "handover is participant-only, uses reviewed practice contacts and loses access with current membership",
        () => {
          const input = { referralId: id(30) };
          assert.throws(() => rpc(id(1), "referral.handover", input), /denied/);
          assert.throws(() => rpc(id(4), "referral.handover", input), /denied/);
          const missing = rpc(id(3), "referral.handover", input);
          assert.equal(missing.reviewedAt, null);
          assert.equal(missing.contactPhone, null);
          assert.equal(
            JSON.stringify(missing).includes("clinical_summary"),
            false,
          );
          assert.match(missing.nextAction, /reviewed practice contact/i);
          const contact = {
            organisationId: id(10),
            expectedVersion: 0,
            contactPhone: "02 5555 1212",
            contactEmail: "practice@example.test",
            secureInstructions: "Use https://secure.example.test/handover",
            evidenceReference: "Fictional independent callback",
            requestId: id(9750),
          };
          rpc(id(1), "practice.reviewContact", contact);
          const value = rpc(id(3), "referral.handover", input);
          assert.equal(value.contactPhone, "02 5555 1212");
          assert.ok(value.reviewedAt);
          assert.equal(value.practiceName, "Fictional Practice");
          assert.deepEqual(rpc(id(2), "referral.handover", input), value);
          assert.equal(
            sql(
              `begin; update public.organisation_memberships set active=false where organisation_id='${id(10)}' and user_id='${id(2)}'; set role service_role; select public.rw_workflow('${id(3)}','referral.handover','${JSON.stringify(input)}')->>'contactPhone'; rollback;`,
            ),
            "02 5555 1212",
          );
          assert.throws(
            () =>
              sql(
                `begin; update public.organisation_memberships set active=false where organisation_id='${id(10)}' and user_id='${id(2)}'; set role service_role; select public.rw_workflow('${id(2)}','referral.handover','${JSON.stringify(input)}'); rollback;`,
              ),
            /denied/,
          );
          assert.throws(
            () =>
              sql(
                `begin; update public.practitioner_users set active=false where user_id='${id(3)}'; set role service_role; select public.rw_workflow('${id(3)}','referral.handover','${JSON.stringify(input)}'); rollback;`,
              ),
            /denied/,
          );
          assert.throws(
            () =>
              sql(
                `begin; update public.practitioners set access_suspended_at=now() where id='${practitionerId}'; set role service_role; select public.rw_workflow('${id(3)}','referral.handover','${JSON.stringify(input)}'); rollback;`,
              ),
            /denied/,
          );
          for (const [status, expected] of [
            ["awaiting_onboarding", "not been released"],
            ["accepted", "secure external handover"],
            ["declined", "Do not continue handover"],
            ["cancelled", "cancelled referral"],
            ["closed", "Coordination is closed"],
            ["booked", "historical booking status"],
          ]) {
            const guidance = sql(
              `begin; update public.referrals set status='${status}' where id='${id(30)}'; set role service_role; select public.rw_workflow('${id(2)}','referral.handover','${JSON.stringify(input)}')->>'nextAction'; rollback;`,
            );
            assert.ok(guidance.includes(expected), status);
          }
          assert.throws(
            () =>
              sql(
                `begin; update public.referrals set status='awaiting_onboarding' where id='${id(30)}'; set role service_role; select public.rw_workflow('${id(3)}','referral.handover','${JSON.stringify(input)}'); rollback;`,
              ),
            /denied/,
          );
          // Keep later legacy-email fixtures unchanged.
          sql(
            `delete from private.practice_contacts where organisation_id='${id(10)}'; update public.organisations set notification_email='practice@example.test' where id='${id(10)}'`,
          );
        },
      );
      await t.test(
        "operator administration does not confer clinical referral access",
        () => {
          assert.equal(
            sql(`select count(*) from public.referrals where id='${id(30)}'`),
            "1",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(1)}'; select count(*) from public.referrals where id='${id(30)}'`,
            ),
            "0",
          );
          assert.equal(
            JSON.stringify(
              rpc(id(1), "practice.list", { organisationId: id(10) }),
            ).includes("clinical_summary"),
            false,
          );
          assert.throws(
            () => rpc(id(1), "referral.list", { organisationId: id(10) }),
            /denied/,
          );
        },
      );
      await t.test(
        "expiry rejects acceptance and REST creation but preserves historical reads; suspension denies reads",
        () => {
          sql(
            `update private.professional_credentials set expires_at=now() where practitioner_id='${practitionerId}'`,
          );
          assert.throws(
            () => rpc(id(3), "referral.respond", responseInput),
            /recipient_ineligible/,
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(3)}'; select count(*) from public.referrals where id='${id(30)}'`,
            ),
            "1",
          );
          assert.throws(
            () =>
              sql(
                `begin; set role authenticated; set request.jwt.claim.sub='${id(2)}'; insert into public.referrals(reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at) values('RW-EXPIRED','${id(10)}','${id(2)}','FICTIONAL','2000','physiotherapist','Fictional','Self funded','in_person','doctor','${practitionerId}',now()); rollback;`,
              ),
            /recipient_ineligible/,
          );
          sql(
            `update private.professional_credentials set expires_at=null where practitioner_id='${practitionerId}'; update public.practitioners set access_suspended_at=now() where id='${practitionerId}'`,
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(3)}'; select count(*) from public.referrals where id='${id(30)}'`,
            ),
            "0",
          );
          assert.throws(
            () => rpc(id(3), "referral.notifications", { referralId: id(30) }),
            /denied/,
          );
          assert.equal(rpc(id(3), "workspace.access").practitioners.length, 0);
          sql(
            `update public.practitioners set access_suspended_at=null where id='${practitionerId}'`,
          );
        },
      );
      const response = rpc(id(3), "referral.respond", responseInput);
      await t.test(
        "response commits one event and one new notification; retries never duplicate",
        () => {
          assert.equal(response.status, "accepted");
          assert.equal(response.version, 1);
          assert.deepEqual(
            rpc(id(3), "referral.respond", responseInput),
            response,
          );
          assert.throws(
            () =>
              rpc(id(3), "referral.respond", {
                ...responseInput,
                decision: "declined",
                reasonCode: "capacity",
              }),
            /conflict/,
          );
          assert.equal(
            sql(
              `select count(*) from public.referral_events where referral_id='${id(
                30,
              )}' and event_type='accepted' and actor_user_id='${id(3)}'`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `select count(*) from public.notification_outbox where referral_id='${id(
                30,
              )}'`,
            ),
            "2",
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                2,
              )}'; select count(*) from public.referral_events where referral_id='${id(
                30,
              )}'`,
            ),
            "2",
          );
        },
      );
      await t.test(
        "revoked practitioner linkage immediately blocks existing-session clinical access",
        () => {
          sql(
            `update public.practitioner_users set active=false,revoked_at=now() where user_id='${id(
              3,
            )}'`,
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(
                3,
              )}'; select count(*) from public.referrals`,
            ),
            "0",
          );
          assert.throws(
            () => rpc(id(3), "referral.respond", responseInput),
            /denied/,
          );
          sql(
            `update public.practitioner_users set active=true,revoked_at=null where user_id='${id(
              3,
            )}'`,
          );
        },
      );
      await t.test(
        "unconfigured delivery does not use an attempt; workers cannot share a lease",
        () => {
          assert.deepEqual(
            rpc(null, "email.claim", { configured: false, limit: 20 }),
            [],
          );
          assert.equal(
            sql(`select max(attempts) from private.email_jobs`),
            "0",
          );
          const jobs = rpc(null, "email.claim", {
            configured: true,
            limit: 20,
          });
          assert.equal(jobs.filter((j) => j.family === "referral").length, 1);
          assert.equal(
            sql(
              `select status from public.notification_outbox where referral_id='${id(30)}' and kind='referral_created'`,
            ),
            "cancelled",
          );
          assert.deepEqual(
            rpc(null, "email.claim", { configured: true, limit: 20 }),
            [],
          );
          assert.throws(
            () =>
              rpc(null, "email.finish", {
                jobId: jobs[0].id,
                leaseId: id(98),
                outcome: "sent",
                providerId: "invalid",
              }),
            /lease/,
          );
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
        },
      );
      await t.test(
        "missing practice email persists configuration-needed without rolling back decline",
        () => {
          sql(
            `update public.organisations set notification_email=null where id='${id(
              10,
            )}'; update public.practitioners set accepting_new_referrals=true where id='${practitionerId}';
        set role authenticated; set request.jwt.claim.sub='${id(
          2,
        )}'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
        values('${id(40)}','RW-TEST-2','${id(10)}','${id(
          2,
        )}','Fictional patient','2000','physiotherapist','Fictional details','Self funded','in_person','doctor','${practitionerId}',now());`,
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
            `update public.organisations set notification_email='practice@example.test' where id='${id(
              10,
            )}'`,
          );
        },
      );
      await t.test(
        "interrupted auth generation can recover the same request; mismatched consent cannot",
        () => {
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
          assert.throws(
            () =>
              rpc(null, "invitation.begin", {
                ...input,
                termsVersion: "different",
              }),
            /conflict/,
          );
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
            () =>
              rpc(null, "invitation.inspect", { tokenHash: "b".repeat(64) }),
            /unavailable/,
          );
        },
      );
      await t.test(
        "authentic unmatched webhook is retained then reconciled and suppresses retries",
        () => {
          // A current notice, not the now-obsolete initial notice for a declined referral.
          sql(
            `set role authenticated;set request.jwt.claim.sub='${id(2)}';insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at) values('${id(450)}','RW-WEBHOOK','${id(10)}','${id(2)}','Fictional webhook','2000','physiotherapist','Fictional protected summary','Self funded','in_person','doctor','${practitionerId}',now());`,
          );
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
          const jobs = rpc(null, "email.claim", {
            configured: true,
            limit: 20,
          });
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
            sql(
              `select state from private.email_jobs where id='${jobs[0].id}'`,
            ),
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
        },
      );
      await t.test(
        "two concurrent conflicting decisions produce exactly one outcome and audit event",
        async () => {
          sql(
            `set role authenticated; set request.jwt.claim.sub='${id(
              2,
            )}'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
        values('${id(60)}','RW-TEST-3','${id(10)}','${id(
          2,
        )}','Fictional patient','2000','physiotherapist','Fictional details','Self funded','in_person','doctor','${practitionerId}',now());`,
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
                `set role service_role; select public.rw_workflow('${id(
                  3,
                )}','referral.respond','${JSON.stringify({
                  referralId: id(60),
                  expectedVersion: 0,
                  decision,
                  reasonCode: "capacity",
                  requestId: id(61 + i),
                })}');`,
              ]),
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
              `select count(*) from public.referral_events where referral_id='${id(
                60,
              )}' and event_type in ('accepted','declined')`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `select count(*) from public.notification_outbox where referral_id='${id(
                60,
              )}' and kind in ('referral_accepted','referral_declined')`,
            ),
            "1",
          );
        },
      );
      await t.test(
        "a crash after the fifth attempt becomes review-needed, never a sixth send",
        () => {
          sql(
            `insert into private.email_jobs(id,family,related_id,related_version,idempotency_key,recipient_email,state,attempts,lease_id,lease_expires_at,first_attempt_at) values('${id(
              70,
            )}','referral','${id(
              30,
            )}',1,'crash-final','crash@example.test','processing',5,'${id(
              71,
            )}',now()-interval '1 second',now()-interval '5 minutes')`,
          );
          const jobs = rpc(null, "email.claim", {
            configured: true,
            limit: 20,
          });
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
        },
      );
      await t.test("a paused job cannot monopolise every worker batch", () => {
        sql(
          `insert into private.email_jobs(id,family,related_id,related_version,idempotency_key,recipient_email,due_at) values('${id(
            74,
          )}','referral','${id(
            30,
          )}',1,'paused-oldest','paused@example.test',now()-interval '2 days'),('${id(
            75,
          )}','referral','${id(
            30,
          )}',1,'next-allowed','allowed@example.test',now()-interval '1 day')`,
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
      await t.test(
        "a timeout on the fifth provider attempt remains an ambiguity requiring review",
        () => {
          sql(
            `insert into private.email_jobs(id,family,related_id,related_version,idempotency_key,recipient_email,state,attempts,lease_id,lease_expires_at,first_attempt_at) values('${id(
              76,
            )}','referral','${id(
              30,
            )}',1,'timeout-final','timeout@example.test','processing',4,'${id(
              77,
            )}',now()+interval '1 minute',now()-interval '5 minutes')`,
          );
          sql(
            `update private.email_jobs set payload=jsonb_build_object('kind','referral_accepted','referralId','${id(30)}') where id='${id(76)}'`,
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
        },
      );
      await t.test(
        "recipient resend ceiling is atomic across different practices and inviters",
        async () => {
          sql(
            `insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values('${id(
              1,
            )}','${id(11)}','Fictional Operator','Other Practice','${id(1)}')`,
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
            [
              [id(2), a, "e"],
              [id(1), b, "f"],
            ].map(([actor, inv, hex], i) =>
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
                `set role service_role; select public.rw_workflow('${actor}','invitations.resend','${JSON.stringify(
                  {
                    invitationId: inv.id,
                    expectedVersion: inv.version,
                    requestId: id(82 + i),
                    tokenHash: hex.repeat(64),
                    envelope: { fixture: true },
                    keyId: "test",
                  },
                )}');`,
              ]),
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
        },
      );
      await t.test(
        "drafts are creator scoped, versioned and save no mail",
        () => {
          const before = sql("select count(*) from public.notification_outbox");
          sql(
            `insert into public.organisation_memberships(organisation_id,user_id,role) values ('${id(10)}','${id(4)}','referrer')`,
          );
          const input = {
            id: id(101),
            organisationId: id(10),
            expectedVersion: -1,
            requestId: id(102),
            input: {
              patientReference: "FICTIONAL-DRAFT",
              clinicalSummary: "Fictional unsent summary",
            },
          };
          const draft = rpc(id(2), "draft.save", input);
          assert.equal(draft.version, 0);
          assert.deepEqual(rpc(id(2), "draft.save", input), draft);
          assert.equal(
            rpc(id(2), "draft.list", { organisationId: id(10) }).drafts[0].id,
            draft.id,
          );
          assert.equal(
            rpc(id(4), "draft.list", { organisationId: id(10) }).drafts.length,
            0,
          );
          assert.equal(
            sql(
              "select has_table_privilege('authenticated','public.referral_drafts','insert')",
            ),
            "f",
          );
          assert.equal(
            sql(
              "select has_table_privilege('authenticated','public.referral_drafts','update')",
            ),
            "f",
          );
          assert.throws(
            () =>
              rpc(id(2), "draft.save", {
                ...input,
                input: { clinicalSummary: "Different payload" },
              }),
            /conflict/,
          );
          assert.equal(
            sql("select count(*) from public.notification_outbox"),
            before,
          );
          assert.throws(
            () => rpc(id(4), "draft.load", { id: input.id }),
            /denied/,
          );
          assert.throws(
            () => rpc(id(1), "draft.load", { id: input.id }),
            /denied/,
          );
          assert.equal(
            sql(
              `set role authenticated; set request.jwt.claim.sub='${id(4)}'; select count(*) from public.referral_drafts`,
            ),
            "0",
          );
          assert.throws(
            () => rpc(id(2), "draft.save", { ...input, requestId: id(103) }),
            /conflict/,
          );
          assert.throws(
            () =>
              rpc(id(2), "draft.save", {
                ...input,
                id: id(104),
                requestId: id(105),
                input: { patientName: "Forbidden" },
              }),
            /invalid_draft/,
          );
          sql(
            `delete from public.organisation_memberships where organisation_id='${id(10)}' and user_id='${id(4)}'`,
          );
        },
      );
      await t.test(
        "draft finalisation replays one referral and rechecks eligibility",
        () => {
          sql(
            `update public.practitioners set accepting_new_referrals=true where id='${practitionerId}'`,
          );
          const input = {
            patientReference: "FICTIONAL-DRAFT",
            patientPostcode: "2000",
            profession: "physiotherapist",
            clinicalSummary: "Fictional summary",
            fundingPath: "Self funded",
            appointmentFormat: "either",
            selectedPractitionerId: practitionerId,
          };
          const draft = rpc(id(2), "draft.save", {
            id: id(110),
            organisationId: id(10),
            expectedVersion: -1,
            requestId: id(111),
            input,
          });
          const send = {
            id: draft.id,
            expectedVersion: draft.version,
            requestId: id(112),
            consentConfirmed: true,
          };
          assert.throws(
            () =>
              rpc(id(2), "draft.finalize", {
                ...send,
                consentConfirmed: false,
              }),
            /consent_required/,
          );
          sql(
            `update public.practitioners set accepting_new_referrals=false where id='${practitionerId}'`,
          );
          assert.throws(
            () => rpc(id(2), "draft.finalize", send),
            /recipient_ineligible/,
          );
          sql(
            `update public.practitioners set accepting_new_referrals=true where id='${practitionerId}'`,
          );
          const result = rpc(id(2), "draft.finalize", send);
          assert.equal(result.id, draft.id);
          assert.deepEqual(rpc(id(2), "draft.finalize", send), result);
          assert.equal(
            sql(
              `select count(*) from public.notification_outbox where referral_id='${draft.id}'`,
            ),
            "1",
          );
          assert.equal(
            rpc(id(2), "draft.load", { id: draft.id }).finalizedReferralId,
            draft.id,
          );
        },
      );
      await t.test(
        "malformed notification configuration cannot roll back a clinical response",
        () => {
          sql(
            `update public.organisations set notification_email='invalid' where id='${id(
              10,
            )}'; set role authenticated; set request.jwt.claim.sub='${id(
              2,
            )}'; insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at)
        values('${id(93)}','RW-INVALID-CONFIG','${id(10)}','${id(
          2,
        )}','Fictional','2000','physiotherapist','Fictional','Self funded','in_person','doctor','${practitionerId}',now());`,
          );
          const result = rpc(id(3), "referral.respond", {
            referralId: id(93),
            expectedVersion: 0,
            decision: "accepted",
            requestId: id(94),
          });
          assert.equal(result.status, "accepted");
          assert.equal(result.notification, "configuration_needed");
        },
      );
      await t.test(
        "profile revisions preserve the approved snapshot and require fresh independent review",
        () => {
          const originalCredential = JSON.parse(
            sql(
              `select to_jsonb(c) from private.professional_credentials c join private.practitioner_professions pp on pp.credential_id=c.id where pp.practitioner_id='${practitionerId}'`,
            ),
          );
          const start = { practitionerId, requestId: id(130) };
          const revision = rpc(id(3), "application.revision_start", start);
          assert.deepEqual(
            rpc(id(3), "application.revision_start", start),
            revision,
          );
          assert.equal(
            sql(
              `select private.practitioner_is_eligible('${practitionerId}','physiotherapist',now())`,
            ),
            "f",
          );
          assert.equal(
            sql(`select private.practitioner_has_access('${practitionerId}')`),
            "t",
          );
          const edited = rpc(id(3), "application.save", {
            applicationId: revision.id,
            expectedVersion: revision.version,
            profile: { ...profile, practiceName: "Reviewed New Practice" },
          });
          assert.equal(
            sql(
              `select practice_name from public.practitioners where id='${practitionerId}'`,
            ),
            profile.practiceName,
          );
          const submitted = rpc(id(3), "application.submit", {
            applicationId: revision.id,
            expectedVersion: edited.version,
            profileConfirmed: true,
            referralConsent: true,
            termsVersion: "v1",
            privacyVersion: "v1",
          });
          assert.throws(
            () =>
              rpc(id(1), "review.decide", {
                ...review,
                applicationId: revision.id,
                expectedVersion: edited.version,
                requestId: id(131),
              }),
            /conflict/,
          );
          const next = rpc(id(1), "review.decide", {
            ...review,
            applicationId: revision.id,
            expectedVersion: submitted.version,
            requestId: id(132),
          });
          assert.equal(next.practitioner_id, practitionerId);
          assert.equal(
            sql(
              `select practice_name from public.practitioners where id='${practitionerId}'`,
            ),
            "Reviewed New Practice",
          );
          assert.equal(
            sql(
              `select count(*) from public.practitioners where id='${practitionerId}'`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `select private.practitioner_is_eligible('${practitionerId}','physiotherapist',now())`,
            ),
            "t",
          );
          assert.equal(
            rpc(id(3), "application.load", { applicationId: appId }).profile
              .practiceName,
            profile.practiceName,
          );
          assert.deepEqual(
            JSON.parse(
              sql(
                `select to_jsonb(c) from private.professional_credentials c where id='${originalCredential.id}'`,
              ),
            ),
            originalCredential,
          );
          assert.notEqual(
            sql(
              `select credential_id from private.practitioner_professions where practitioner_id='${practitionerId}'`,
            ),
            originalCredential.id,
          );
          assert.equal(
            sql(
              "select has_table_privilege('service_role','private.professional_credentials','update')",
            ),
            "f",
          );
          assert.equal(
            sql(
              "select has_table_privilege('service_role','private.professional_credentials','delete')",
            ),
            "f",
          );
        },
      );
      await t.test(
        "reopening a profile update while approval holds its application lock does not deadlock",
        async () => {
          const revision = rpc(id(3), "application.revision_start", {
            practitionerId,
            requestId: id(160),
          });
          const submitted = rpc(id(3), "application.submit", {
            applicationId: revision.id,
            expectedVersion: revision.version,
            profileConfirmed: true,
            referralConsent: true,
            termsVersion: "v1",
            privacyVersion: "v1",
          });
          const run = promisify(execFile);
          const asyncSql = (query) =>
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
              query,
            ]);
          const approve = asyncSql(
            `begin; set local application_name='rw-review-lock-test'; set local statement_timeout='8s'; select 1 from public.practitioner_applications where id='${revision.id}' for update; select pg_sleep(1); set local role service_role; select public.rw_workflow('${id(1)}','review.decide','${JSON.stringify({ ...review, applicationId: revision.id, expectedVersion: submitted.version, requestId: id(161) })}'); commit;`,
          );
          // Observe the real transaction, not a timing-only launch of two promises.
          // The approval holds the application throughout this deliberate overlap.
          let observedLock = false;
          for (let i = 0; i < 50; i++) {
            if (
              sql(
                "select exists(select 1 from pg_stat_activity where application_name='rw-review-lock-test' and wait_event='PgSleep')",
              ) === "t"
            ) {
              observedLock = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          const reopen = asyncSql(
            `begin; set local statement_timeout='8s'; set local role service_role; select public.rw_workflow('${id(3)}','application.revision_start','${JSON.stringify({ practitionerId, requestId: id(162) })}'); commit;`,
          );
          const results = await Promise.allSettled([approve, reopen]);
          assert.equal(
            observedLock,
            true,
            "approval application lock was observed before reopen",
          );
          assert.equal(
            results.filter((r) => r.status === "rejected").length,
            0,
            JSON.stringify(results),
          );
          // Reopen creates a pending revision after approval; finish it so later
          // tests retain their independently approved baseline.
          const current = rpc(id(3), "application.revision_start", {
            practitionerId,
            requestId: id(163),
          });
          const submittedAgain = rpc(id(3), "application.submit", {
            applicationId: current.id,
            expectedVersion: current.version,
            profileConfirmed: true,
            referralConsent: true,
            termsVersion: "v1",
            privacyVersion: "v1",
          });
          rpc(id(1), "review.decide", {
            ...review,
            applicationId: current.id,
            expectedVersion: submittedAgain.version,
            requestId: id(164),
          });
        },
      );
      await t.test(
        "access suspension and restoration are operator-only, versioned and audited",
        () => {
          const state = rpc(id(1), "review.access_detail", { practitionerId });
          const input = {
            practitionerId,
            expectedVersion: state.version,
            requestId: id(140),
            reason: "Fictional access review",
            evidenceReference: "Fictional independently checked evidence",
          };
          assert.throws(() => rpc(id(2), "review.suspend", input), /denied/);
          const suspended = rpc(id(1), "review.suspend", input);
          assert.deepEqual(rpc(id(1), "review.suspend", input), suspended);
          assert.equal(
            sql(`select private.practitioner_has_access('${practitionerId}')`),
            "f",
          );
          assert.throws(
            () =>
              rpc(id(1), "review.restore", { ...input, requestId: id(141) }),
            /conflict/,
          );
          rpc(id(1), "review.restore", {
            ...input,
            expectedVersion: suspended.version,
            requestId: id(142),
          });
          assert.equal(
            sql(`select private.practitioner_has_access('${practitionerId}')`),
            "t",
          );
          assert.equal(
            sql(
              `select count(*) from private.profile_access_events where practitioner_id='${practitionerId}'`,
            ),
            "2",
          );
        },
      );
      await t.test(
        "due-review work is operator-only and exposes no credential identifiers or clinical data",
        () => {
          assert.throws(() => rpc(id(2), "review.due"), /denied/);
          const rows = JSON.parse(
            sql(
              `begin; update private.professional_credentials set expires_at=now() where practitioner_id='${practitionerId}'; set local role service_role; select public.rw_workflow('${id(1)}','review.due','{}'); rollback;`,
            ),
          ).items;
          const due = rows.find((row) => row.practitionerId === practitionerId);
          assert.ok(due);
          assert.equal(due.professionId, "physiotherapist");
          assert.equal(due.reason, "credential_expired");
          assert.equal(Object.hasOwn(due, "identifier_normalized"), false);
          assert.equal(Object.hasOwn(due, "clinical_summary"), false);
          assert.equal(
            sql(
              `begin; update public.practitioners set lifecycle_status='inactive',provider_confirmation_status='declined' where id='${practitionerId}'; select private.practitioner_has_access('${practitionerId}'); rollback;`,
            ),
            "f",
          );
        },
      );
      await t.test(
        "professional-body review uses its own credential route without a fabricated AHPRA number",
        () => {
          // Synthetic authority configuration only. No new real profession is enabled.
          const revisedProfile = {
            ...profile,
            profession: "exercise_physiologist",
            registrationNumber: "TEST999",
          };
          const evidence = {
            ...review,
            registrationEvidence: {
              ...review.registrationEvidence,
              method: "professional_body_register",
              registrationNumber: "TEST999",
            },
            requestId: id(153),
          };
          const result = sql(`begin;
          update private.profession_policies set catalogue_scope='supported',authority_id='fictional_test_authority',enabled=true,review_interval_days=7,identifier_pattern='^TEST[0-9]{3}$',approved_by='${id(1)}',approved_at=now(),evidence_reference='Fictional protocol solely for local test' where profession_id='exercise_physiologist';
          do $test$ declare a jsonb; begin
            a:=public.rw_workflow('${id(3)}','application.revision_start','${JSON.stringify({ practitionerId, requestId: id(150) })}');
            a:=public.rw_workflow('${id(3)}','application.save',jsonb_build_object('applicationId',a->>'id','expectedVersion',a->'version','profile','${JSON.stringify(revisedProfile)}'::jsonb));
            a:=public.rw_workflow('${id(3)}','application.submit',jsonb_build_object('applicationId',a->>'id','expectedVersion',a->'version','profileConfirmed',true,'referralConsent',true,'termsVersion','v1','privacyVersion','v1'));
            perform public.rw_workflow('${id(1)}','review.decide','${JSON.stringify(evidence)}'::jsonb || jsonb_build_object('applicationId',a->>'id','expectedVersion',a->'version'));
          end $test$;
          select ahpra_registration_number is null and ahpra_verification_status='not_checked' and private.practitioner_is_eligible(id,'exercise_physiologist',now()) from public.practitioners where id='${practitionerId}'; rollback;`);
          assert.equal(result, "t");
        },
      );
      await t.test(
        "structured requirements are enforced at finalisation and direct INSERT",
        () => {
          const input = {
            patientReference: "FICTIONAL-CAPABILITY",
            patientPostcode: "2000",
            profession: "physiotherapist",
            clinicalSummary: "Fictional assessment",
            fundingPath: "self_funded",
            appointmentFormat: "in_person",
            preferredLanguage: "english",
            accessNotes: "wheelchair access",
            requiredServiceIds: ["persistent_pain"],
            patientAgeGroupId: "adult",
            selectedPractitionerId: practitionerId,
          };
          const draft = rpc(id(2), "draft.save", {
            id: id(170),
            organisationId: id(10),
            expectedVersion: -1,
            requestId: id(171),
            input,
          });
          const finalize = {
            id: draft.id,
            expectedVersion: draft.version,
            requestId: id(172),
            consentConfirmed: true,
          };
          assert.throws(
            () => rpc(id(2), "draft.finalize", finalize),
            /recipient_ineligible/,
          );
          const proposal = rpc(id(3), "application.revision_start", {
            practitionerId,
            requestId: id(175),
          });
          const edited = rpc(id(3), "application.save", {
            applicationId: proposal.id,
            expectedVersion: proposal.version,
            profile: {
              ...profile,
              serviceIds: ["persistent_pain"],
              ageGroupIds: ["adult"],
            },
          });
          const submitted = rpc(id(3), "application.submit", {
            applicationId: proposal.id,
            expectedVersion: edited.version,
            profileConfirmed: true,
            referralConsent: true,
            termsVersion: "v1",
            privacyVersion: "v1",
          });
          rpc(id(1), "review.decide", {
            ...review,
            applicationId: proposal.id,
            expectedVersion: submitted.version,
            requestId: id(176),
          });
          assert.equal(
            sql(
              `select service_ids[1] from public.practitioners where id='${practitionerId}'`,
            ),
            "persistent_pain",
          );
          const sent = rpc(id(2), "draft.finalize", finalize);
          assert.deepEqual(sent.required_service_ids, ["persistent_pain"]);
          assert.equal(sent.patient_age_group_id, "adult");
          assert.equal(sent.preferred_language, "english");
          assert.equal(sent.access_notes, "wheelchair access");
          assert.equal(
            sql(
              `select private.practitioner_meets_requirements('${practitionerId}','physiotherapist','Self-funded','in_person',' ENGLISH ',array['persistent_pain'],'adult')`,
            ),
            "t",
          );
          assert.equal(
            sql(
              `select private.practitioner_meets_requirements('${practitionerId}','physiotherapist','Private','in_person','',array[]::text[],null)`,
            ),
            "f",
          );
          assert.throws(
            () =>
              sql(
                `begin; set role authenticated; set request.jwt.claim.sub='${id(2)}'; insert into public.referrals(reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at,required_service_ids) values('RW-FORGED-CAPABILITY','${id(10)}','${id(2)}','FICTIONAL','2000','physiotherapist','Fictional','Self funded','in_person','doctor','${practitionerId}',now(),array['unknown']); rollback;`,
              ),
            /recipient_ineligible|invalid_requirements/,
          );
          assert.equal(
            sql(
              `select private.normalize_term('language','wheelchair access') is null and private.normalize_term('language','Chinese') is null`,
            ),
            "t",
          );
          assert.throws(
            () =>
              sql(
                `select private.validate_practitioner_profile('${JSON.stringify({ ...profile, serviceIds: ["made_up"] })}',false)`,
              ),
            /invalid_profile/,
          );
        },
      );
      await t.test(
        "practice lifecycle transitions are versioned, idempotent and participant-only",
        () => {
          sql(
            `set role authenticated;set request.jwt.claim.sub='${id(2)}';insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at) values('${id(400)}','RW-LIFECYCLE','${id(10)}','${id(2)}','Fictional lifecycle','2000','physiotherapist','Fictional protected summary','Self funded','in_person','doctor','${practitionerId}',now());`,
          );
          const cancel = {
            referralId: id(400),
            expectedVersion: 0,
            requestId: id(401),
            action: "cancel",
            reasonCode: "entered_in_error",
            note: "Fictional internal cancellation note",
          };
          sql(
            `insert into private.email_jobs(id,family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,state,payload,lease_id,lease_expires_at) select '${id(408)}','referral',referral_id,0,id,idempotency_key,recipient_email,'processing',jsonb_build_object('kind',kind,'referralId',referral_id),'${id(409)}',now()+interval '1 minute' from public.notification_outbox where referral_id='${id(400)}' and kind='referral_created'`,
          );
          assert.throws(
            () => rpc(id(4), "referral.transition", cancel),
            /denied/,
          );
          assert.throws(
            () => rpc(id(1), "referral.transition", cancel),
            /denied/,
          );
          assert.throws(
            () => rpc(id(3), "referral.transition", cancel),
            /denied/,
          );
          const result = rpc(id(2), "referral.transition", cancel);
          assert.equal(result.referral.status, "cancelled");
          assert.equal(result.referral.version, 1);
          assert.deepEqual(rpc(id(2), "referral.transition", cancel), result);
          assert.equal(
            sql(
              `select count(*) from public.referral_events where referral_id='${id(400)}' and event_type='cancelled'`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `select count(*) from public.notification_outbox where referral_id='${id(400)}' and kind='referral_cancelled'`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `select count(*) from private.email_jobs where related_id='${id(400)}' and state not in ('sent','cancelled') and payload->>'kind'='referral_created'`,
            ),
            "0",
          );
          assert.deepEqual(
            rpc(null, "email.start", { jobId: id(408), leaseId: id(409) }),
            { sendAllowed: false },
          );
          assert.equal(
            sql(
              `select attempts from private.email_jobs where id='${id(408)}'`,
            ),
            "0",
          );
          assert.throws(
            () =>
              rpc(id(3), "referral.respond", {
                referralId: id(400),
                expectedVersion: 0,
                decision: "accepted",
                requestId: id(402),
              }),
            /conflict/,
          );
          const replacement = {
            referralId: id(400),
            expectedVersion: 1,
            requestId: id(403),
          };
          const draft = rpc(id(2), "referral.replace", replacement);
          assert.deepEqual(rpc(id(2), "referral.replace", replacement), draft);
          assert.equal(draft.supersedesReferralId, id(400));
          assert.notEqual(draft.id, id(400));
          assert.equal(draft.input.selectedPractitionerId, null);
          assert.equal(Object.hasOwn(draft.input, "consentConfirmed"), false);
          assert.throws(
            () =>
              rpc(id(2), "draft.finalize", {
                id: draft.id,
                expectedVersion: draft.version,
                requestId: id(404),
                consentConfirmed: true,
              }),
            /invalid_draft/,
          );
          assert.equal(
            sql(`select status from public.referrals where id='${id(400)}'`),
            "cancelled",
          );
          const revised = rpc(id(2), "draft.save", {
            id: draft.id,
            organisationId: id(10),
            expectedVersion: draft.version,
            input: { ...draft.input, selectedPractitionerId: practitionerId },
            requestId: id(405),
          });
          assert.throws(
            () =>
              rpc(id(2), "draft.finalize", {
                id: revised.id,
                expectedVersion: revised.version,
                consentConfirmed: false,
                requestId: id(406),
              }),
            /consent_required/,
          );
          const replacementRef = rpc(id(2), "draft.finalize", {
            id: revised.id,
            expectedVersion: revised.version,
            consentConfirmed: true,
            requestId: id(407),
          });
          assert.equal(replacementRef.supersedes_referral_id, id(400));
          assert.equal(
            sql(
              `select count(*) from public.notification_outbox where referral_id='${replacementRef.id}'`,
            ),
            "1",
          );
        },
      );
      await t.test(
        "lifecycle matrix rejects stale, terminal and legacy-booked transitions",
        () => {
          for (const status of [
            "awaiting_onboarding",
            "sent",
            "accepted",
            "declined",
            "cancelled",
            "closed",
            "booked",
          ]) {
            for (const action of ["cancel", "close"]) {
              const allowed =
                action === "cancel"
                  ? ["awaiting_onboarding", "sent", "accepted"].includes(status)
                  : status === "accepted";
              const input = {
                referralId: id(400),
                expectedVersion: 1,
                requestId: id(410),
                action,
                reasonCode: action === "cancel" ? "other" : "unable_to_arrange",
              };
              const run = () =>
                sql(
                  `begin;update public.referrals set status='${status}',version=1 where id='${id(400)}';delete from private.workflow_requests where actor_id='${id(2)}' and request_id='${id(410)}';delete from private.email_jobs where related_id='${id(400)}' and payload->>'kind' in ('referral_cancelled','referral_closed');delete from public.notification_outbox where referral_id='${id(400)}' and kind in ('referral_cancelled','referral_closed');select public.rw_workflow('${id(2)}','referral.transition','${JSON.stringify(input)}');rollback;`,
                );
              if (allowed)
                assert.equal(
                  JSON.parse(run()).referral.status,
                  action === "cancel" ? "cancelled" : "closed",
                );
              else assert.throws(run, /conflict/);
            }
          }
          assert.throws(
            () =>
              sql(
                `begin;update public.referrals set status='accepted' where id='${id(400)}';select public.rw_workflow('${id(2)}','referral.transition','${JSON.stringify({ referralId: id(400), expectedVersion: 1, requestId: id(411), action: "close", reasonCode: "handover_completed" })}');rollback;`,
              ),
            /consent_required/,
          );
        },
      );
      await t.test(
        "acceptance and cancellation race has one winning state and event",
        async () => {
          sql(
            `set role authenticated;set request.jwt.claim.sub='${id(2)}';insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at) values('${id(420)}','RW-CANCEL-RACE','${id(10)}','${id(2)}','Fictional race','2000','physiotherapist','Fictional summary','Self funded','in_person','doctor','${practitionerId}',now());`,
          );
          const run = promisify(execFile);
          const requests = [
            {
              actor: id(2),
              action: "referral.transition",
              body: {
                referralId: id(420),
                expectedVersion: 0,
                requestId: id(421),
                action: "cancel",
                reasonCode: "other",
              },
            },
            {
              actor: id(3),
              action: "referral.respond",
              body: {
                referralId: id(420),
                expectedVersion: 0,
                requestId: id(422),
                decision: "accepted",
              },
            },
          ];
          const results = await Promise.allSettled(
            requests.map((r) =>
              run("docker", [
                "exec",
                container,
                "psql",
                "-U",
                "postgres",
                "-X",
                "-q",
                "-A",
                "-t",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                `set statement_timeout='8s';set role service_role;select public.rw_workflow('${r.actor}','${r.action}','${JSON.stringify(r.body)}');`,
              ]),
            ),
          );
          assert.equal(
            results.filter((x) => x.status === "fulfilled").length,
            1,
          );
          assert.match(
            results.find((x) => x.status === "rejected").reason.stderr,
            /conflict/,
          );
          assert.equal(
            sql(
              `select count(*) from public.referral_events where referral_id='${id(420)}' and event_type in ('accepted','cancelled')`,
            ),
            "1",
          );
        },
      );
      await t.test(
        "bounded directory pages separate format groups and reject forged scope or cursor",
        () => {
          const query = {
            needs: {
              professionId: "physiotherapist",
              fundingId: "self_funded",
              appointmentFormat: "either",
              requiredServiceIds: [],
            },
            distanceGroup: "unknown",
            limit: 1,
          };
          assert.throws(() => rpc(id(4), "directory.search", query), /denied/);
          assert.throws(() => rpc(id(1), "directory.search", query), /denied/);
          const page = rpc(id(2), "directory.search", query);
          assert.equal(page.items.length, 1);
          assert.equal(page.items[0].practitioner.id, practitionerId);
          assert.equal(page.groupCounts.unknown, 1);
          assert.equal(page.groupCounts.local, 0);
          assert.equal(page.items[0].distanceKm, null);
          assert.equal(
            JSON.stringify(page).includes("identifier_normalized"),
            false,
          );
          assert.throws(
            () =>
              rpc(id(2), "directory.search", {
                ...query,
                cursor: "not-base64",
              }),
            /invalid_cursor/,
          );
          assert.throws(
            () => rpc(id(2), "directory.search", { ...query, radiusKm: 10 }),
            /geography_unavailable/,
          );
          assert.equal(
            rpc(id(2), "directory.search", {
              ...query,
              needs: { ...query.needs, requiredServiceIds: ["unknown"] },
            }).items.length,
            0,
          );
        },
      );
      await t.test(
        "referral pages use current membership, bounded metadata and whole-filter counts",
        () => {
          const page = rpc(id(2), "referral.list", {
            organisationId: id(10),
            limit: 1,
          });
          assert.equal(page.items.length, 1);
          assert.ok(page.counts.all > 1);
          assert.ok(page.nextCursor);
          assert.equal(Object.hasOwn(page.items[0], "clinical_summary"), false);
          const next = rpc(id(2), "referral.list", {
            organisationId: id(10),
            limit: 1,
            cursor: page.nextCursor,
          });
          assert.notEqual(next.items[0].id, page.items[0].id);
          assert.throws(
            () => rpc(id(4), "referral.list", { organisationId: id(10) }),
            /denied/,
          );
          assert.throws(
            () =>
              rpc(id(2), "referral.list", {
                organisationId: id(11),
                cursor: page.nextCursor,
              }),
            /denied/,
          );
          assert.throws(
            () =>
              rpc(id(2), "referral.list", {
                organisationId: id(10),
                search: "different",
                cursor: page.nextCursor,
              }),
            /invalid_cursor/,
          );
        },
      );
      await t.test(
        "SQL and pure matching agree on golden requirements, reasons and ordering",
        () => {
          sql(
            directoryScaleFixtureSql({
              ownerId: id(3),
              reviewerId: id(1),
              tag: "GOLDEN",
              count: 12,
            }),
          );
          sql(
            `update public.practitioners set display_name=case right(display_name,3) when '002' then 'ábaco' when '004' then 'Zara' when '006' then 'Alex' else 'alex' end where practice_name='GOLDEN';`,
          );
          const base = {
            professionId: "physiotherapist",
            fundingId: "Medicare",
            appointmentFormat: "either",
            requiredServiceIds: [],
          };
          const candidates = rpc(id(2), "directory.search", {
            query: "GOLDEN",
            distanceGroup: "remote",
            needs: { ...base, appointmentFormat: "telehealth" },
          }).items.map((x) => x.practitioner);
          assert.equal(candidates.length, 12);
          const selected = candidates[0].id;
          for (const change of [
            `update public.practitioners set access_suspended_at=now() where id='${selected}'`,
            `update public.practitioners set accepting_new_referrals=false where id='${selected}'`,
            `update public.practitioners set profile_revision_pending=true where id='${selected}'`,
            `update public.practitioners set contact_email=null where id='${selected}'`,
            `update private.professional_credentials set review_due_at=now()-interval '1 second',checked_at=now()-interval '1 day' where practitioner_id='${selected}'`,
            `update private.professional_credentials set checked_at=now()-interval '2 days' where practitioner_id='${selected}'; update private.profession_policies set review_interval_days=1 where profession_id='physiotherapist'`,
            `update public.practitioner_users set active=false where practitioner_id='${selected}'`,
            `update auth.users set email_confirmed_at=null where id='${id(3)}'`,
            `update private.profession_policies set enabled=false where profession_id='physiotherapist'`,
          ]) {
            const result = JSON.parse(
              sql(
                `begin;${change};select jsonb_build_object('eligible',private.practitioner_is_eligible('${selected}','physiotherapist',now()),'page',private.directory_page('${id(2)}','${JSON.stringify({ query: "GOLDEN", needs: { ...base, appointmentFormat: "telehealth" }, distanceGroup: "remote" })}'));rollback;`,
              ),
            );
            assert.equal(result.eligible, false);
            assert.equal(
              result.page.items.some((x) => x.practitioner.id === selected),
              false,
            );
          }
          for (const needs of [
            base,
            { ...base, appointmentFormat: "telehealth" },
            {
              ...base,
              preferredLanguageId: "ENGLISH",
              requiredServiceIds: ["Persistent pain"],
              patientAgeGroupId: "adult",
            },
            { ...base, fundingId: "Private" },
            { ...base, preferredLanguageId: "Chinese" },
            { ...base, requiredServiceIds: ["unknown"] },
            { ...base, patientAgeGroupId: "child" },
          ]) {
            for (const distanceGroup of ["unknown", "remote"]) {
              const expected = matchPractitioners(candidates, needs).filter(
                (x) =>
                  needs.appointmentFormat === "telehealth"
                    ? distanceGroup === "remote"
                    : (x.practitioner.location ? "unknown" : "remote") ===
                      distanceGroup,
              );
              const actual = rpc(id(2), "directory.search", {
                query: "GOLDEN",
                needs,
                distanceGroup,
              });
              assert.equal(actual.totalEligible, expected.length);
              assert.deepEqual(
                actual.items.map((x) => ({
                  id: x.practitioner.id,
                  reasons: x.reasons,
                  warnings: x.warnings,
                })),
                expected.map((x) => ({
                  id: x.practitioner.id,
                  reasons: x.reasons,
                  warnings: x.warnings,
                })),
              );
            }
          }
        },
      );
      await t.test(
        "5000 synthetic profiles have stable bounded pages, disjoint groups and measured query timing",
        () => {
          sql(directoryScaleFixtureSql({ ownerId: id(3), reviewerId: id(1) }));
          const query = {
            needs: {
              professionId: "physiotherapist",
              fundingId: "medicare",
              appointmentFormat: "either",
              requiredServiceIds: ["persistent_pain"],
              patientAgeGroupId: "adult",
            },
            query: "SYNTHETIC-SCALE",
            distanceGroup: "unknown",
            limit: 5000,
          };
          const first = rpc(id(2), "directory.search", query);
          assert.equal(first.items.length, 50);
          assert.equal(first.totalEligible, 2500);
          assert.deepEqual(first.groupCounts, {
            local: 0,
            unknown: 2500,
            remote: 2500,
          });
          assert.deepEqual(rpc(id(2), "directory.search", query), first);
          const next = rpc(id(2), "directory.search", {
            ...query,
            cursor: first.nextCursor,
          });
          assert.equal(next.items.length, 50);
          assert.equal(
            new Set(
              [...first.items, ...next.items].map((x) => x.practitioner.id),
            ).size,
            100,
          );
          assert.throws(
            () =>
              rpc(id(2), "directory.search", {
                ...query,
                query: "changed",
                cursor: first.nextCursor,
              }),
            /invalid_cursor/,
          );
          const malformed = JSON.parse(
            Buffer.from(first.nextCursor, "base64").toString(),
          );
          delete malformed.v;
          assert.throws(
            () =>
              rpc(id(2), "directory.search", {
                ...query,
                cursor: Buffer.from(JSON.stringify(malformed)).toString(
                  "base64",
                ),
              }),
            /invalid_cursor/,
          );
          const remote = rpc(id(2), "directory.search", {
            ...query,
            distanceGroup: "remote",
          });
          assert.equal(remote.totalEligible, 2500);
          assert.equal(
            remote.items.some((x) => x.practitioner.location !== null),
            false,
          );
          assert.equal(
            rpc(id(2), "directory.search", {
              ...query,
              distanceGroup: "remote",
              needs: { ...query.needs, appointmentFormat: "telehealth" },
            }).totalEligible,
            5000,
          );
          const timings = JSON.parse(
            sql(
              `do $test$ declare started timestamptz; elapsed jsonb:='[]'; begin for n in 1..30 loop started:=clock_timestamp(); perform private.directory_page('${id(2)}','${JSON.stringify(query)}'); elapsed:=elapsed||to_jsonb(extract(epoch from clock_timestamp()-started)*1000); end loop; perform set_config('returnwell.fixture_timings',elapsed::text,false); end $test$; select current_setting('returnwell.fixture_timings');`,
            ),
          ).sort((a, b) => a - b);
          assert.equal(
            sql(
              `begin;set local role authenticated;set local request.jwt.claim.sub='${id(4)}';set local statement_timeout='500ms';select count(*) from public.verified_practitioners;rollback;`,
            ),
            "0",
          );
          assert.equal(
            sql(
              `begin;set local role authenticated;set local request.jwt.claim.sub='${id(4)}';set local statement_timeout='500ms';select count(*) from public.practitioners;rollback;`,
            ),
            "0",
          );
          const p50 = timings[14],
            p95 = timings[28],
            bytes = Buffer.byteLength(JSON.stringify(first));
          console.log(
            JSON.stringify({
              fixtureProfiles: 5000,
              queryRuns: 30,
              p50Ms: p50,
              p95Ms: p95,
              firstPageBytes: bytes,
            }),
          );
          assert.ok(
            p95 < 500,
            `Local p95 exceeded proposed 500ms budget: ${p95}ms`,
          );
        },
      );
      // Growth fixtures have their own notifications; keep them after the legacy
      // single-job lease assertions so those fixtures remain independent.
      await referralGrowthChecks(t, {
        rpc,
        sql,
        id,
        profile,
        review,
        sqlAsync: async (query) => {
          const result = await promisify(execFile)("docker", [
            "exec",
            container,
            "psql",
            "-U",
            "postgres",
            "-X",
            "-q",
            "-A",
            "-t",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            query,
          ]);
          return result.stdout.trim();
        },
      });
    } finally {
      execFileSync("docker", ["stop", container], { stdio: "pipe" });
    }
  },
);
