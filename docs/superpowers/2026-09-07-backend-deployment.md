# Approved backend deployment — 7 September 2026

Project: `ivutegjvttkrmxctegub` / Return Well MVP. User approved deploying the backend updates, disabling public signup, keeping email off and creating no accounts. This release does **not** include frontend hosting, a real-user pilot, email activation or a worker schedule.

## Delivered and verified

- Three new migrations applied: `20260907001022_invitation_signup`, `20260907001024_practitioner_review`, `20260907001026_referral_response`.
- Local foundation filenames aligned to the existing hosted versions `20260903124001` and `20260903124217`. The original hosted migration history was preserved and neither baseline was replayed. The local existence guard around `rls_auto_enable()` remains for clean local installs; its difference from the stored historical SQL is documented in the earlier audit.
- All ten Edge Functions are deployed and active. Eight new endpoints are version 1; the existing notification/status and webhook endpoints are version 3 in the final inventory. Shared dependencies were uploaded with each entrypoint. No functions were pruned.
- Hosted Auth now returns `disable_signup=true` and `mailer_autoconfirm=false`. Only `disable_signup` was sent in the Auth configuration PATCH; the entire local configuration was not pushed.
- The hosted `EMAIL_DELIVERY_ENABLED` secret is explicitly `false`, verified by comparing its returned digest with the digest of the expected value. No provider credential or worker secret was configured.
- No hosted accounts, referrals, invitations, applications or email jobs were created. No scheduler extension/job was enabled, and no email-provider call was made.

## Verification evidence

The pre-deployment dry run listed exactly the three new migrations. The post-deployment dry run reports the remote database is up to date; no seeds, role files or Vault secrets were pushed.

Fresh local checks passed after filename reconciliation:

- Database workflow suite: 24 reported tests passed.
- Workflow helper/HTTP/email/UI suite: 16 tests passed.
- Production build and normal test suite: 37 passed, two opt-in integration suites skipped in that ordinary command.
- Lint and TypeScript checking passed.

Live hosted checks, without creating accounts:

- The eight session/worker-protected endpoints return HTTP 401 to unauthenticated POSTs.
- The public invitation endpoint returns HTTP 410 for a missing invitation token, before any signup action.
- The unconfigured webhook returns HTTP 503, failing closed rather than accepting an unsigned event.
- A public-key call to `rw_workflow` is denied (HTTP 401, database code `42501`).
- Both browser roles lack RPC execution and private-table grants; authenticated clients cannot insert a forged referral response status.
- All 13 public and 11 private application tables have RLS. The service role can read the three required identity columns on `auth.users`, but not `encrypted_password` through those grants.
- Post-deployment counts confirm no accounts or application data were introduced. The database still has no `cron.job` table.
- The security advisor returned only informational no-policy notices for server-only tables; no warning/error-level notices. Browser grants remain revoked, so public policies were not added to silence those notices. [Supabase notice reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

These are live deployment/access-denial checks, not an authenticated hosted end-to-end pilot. The earlier authenticated journeys were against the isolated local stack. No hosted user was created to expand this release's verification scope.

## Configuration discrepancy to retain

The full before/after Auth response comparison flagged `custom_oauth_max_providers` as different in addition to the requested `disable_signup` change. The PATCH body contained only `{"disable_signup":true}`. The exact prior provider-limit value was not retained, so the cause or previous effective value cannot be established from this run.

Two subsequent read-only requests consistently report the limit as `32767`, with `custom_oauth_enabled=false`, `oauth_server_enabled=false` and dynamic client registration disabled. No additional OAuth setting was patched or guessed back to a presumed value. This discrepancy remains recorded for provider/configuration review, particularly before enabling any OAuth feature. Do not claim that every unrelated Auth field remained identical.

## Still needed before a pilot

- Host the frontend at the chosen HTTPS domain and configure the exact allowed browser origins/redirects. Hosted Auth still has `site_url=http://localhost:3000`; no production domain was invented.
- Set the reviewed legal/business/support details and current terms/privacy URLs and versions.
- Complete the Auth configuration review. The existing hosted email OTP expiry remains 3600 seconds; the approved pilot target is 900. This narrow release changed signup only.
- Configure invitation encryption and rotation keys, then approved operators/practice identities. No operator or user was provisioned here.
- Configure a verified sender/provider/webhook and worker secret; keep delivery off until named pilot recipients and a test send are approved. Schedule the worker only as part of that separate activation.
- Run the hosted doctor/practitioner journey with fictional patient details before considering real clinical use. Address the recorded configuration discrepancy and remaining privacy/operational readiness checks.

Missing domain/legal/encryption settings intentionally cause affected browser/invitation flows to fail closed. Deployment alone does not make this a public or clinically ready service.

## Recovery and traceability

Pre-deployment checkpoints are retained privately at `/Users/locnguyen/.cache/returnwell-local/returnwell-release-hbA5mh/`:

- `before-schema.sql`: remote public/private schema dump, approximately 37 KB.
- `before-metadata.json`: original migration statements and the two original function bundles/metadata. No secret values or user rows are included.

The database was empty at preflight. These are recovery inputs, not proof of a rehearsed full restore. Any rollback requires a reviewed forward repair or carefully scoped restore; do not run a remote reset or silently re-enable public signup. The app checkout and `.env.local` were preserved. No Git commit or frontend release was made.

The Supabase skill guided the narrow configuration PATCH, history-preserving migration deployment and access checks. Verification-before-completion required fresh local tests and independent live read-backs. The unexpected Auth comparison was investigated using read-only checks rather than speculative configuration changes. See the [pre-deployment audit](2026-09-07-hosted-backend-audit.md) and [pilot runbook](launch-runbook.md).
