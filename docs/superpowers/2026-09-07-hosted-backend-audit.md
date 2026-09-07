# Hosted backend audit — 7 September 2026

Scope: read-only deployment comparison for `ivutegjvttkrmxctegub` (Return Well MVP). Database snapshot: 2026-09-07 03:40:32 UTC. No hosted configuration, schema, data, migration history or function was changed. No signup, invitation, provider call or email was triggered. Only this local report was added.

## Result

The intended hosted project is reachable and `ACTIVE_HEALTHY`, in `ap-southeast-2`, on PostgreSQL 17.6. The application's saved public backend URL points to this project. The Supabase connector is authenticated; CLI secret-name inventory also succeeded. The local checkout is not CLI-linked to a remote project.

The hosted project still contains the September 3 foundation, not the September 7 invitation/onboarding/response implementation.

| Area | Hosted snapshot | Required next |
| --- | --- | --- |
| Database migrations | Two original migrations | Reconcile baseline filenames, then apply the three new migrations |
| Functions | Two original version-1 functions | Add eight endpoints and replace the two old implementations |
| Accounts and app data | Zero Auth users; exact counts of all eleven public app tables are zero | Provision approved pilot identities later; do not import candidates |
| Signup | `disable_signup=false`, `mailer_autoconfirm=false` | Disable public signup; retain mailbox verification |
| Email configuration | Only platform-supplied `SUPABASE_*` secrets listed | Configure business/domain, encryption, worker and provider settings; explicitly keep delivery disabled until approved |
| Scheduled worker | No `cron.job`; neither `pg_cron` nor `pg_net` installed | Configure only after deployment and approved delivery setup |

## Migration comparison

| Migration | Local version | Hosted applied version |
| --- | --- | --- |
| `referral_foundation` | `20260903123723` | `20260903124001` |
| `harden_referral_foundation` | `20260903132000` | `20260903124217` |
| `invitation_signup` | `20260907001022` | Missing |
| `practitioner_review` | `20260907001024` | Missing |
| `referral_response` | `20260907001026` | Missing |

The stored hosted foundation SQL is byte-for-byte equal to the local foundation file despite its different timestamp. The hardening SQL has the same index/revoke operations, but the local copy now guards the `rls_auto_enable()` revoke with an existence check for clean local databases. The hosted function exists and its execution is denied to both browser roles. This explains the known source difference; it is not an exhaustive proof that every live schema object is identical to a reconstructed baseline.

Live catalog inspection confirms the expected foundation columns, policies, private trigger functions and security-invoker directory view. `public.workspace_invitations`, `public.practitioner_applications`, `private.email_jobs` and `public.rw_workflow(uuid,text,jsonb)` are absent. The new referral version and practitioner-link revocation fields are also absent.

Do not blindly push the five local files: the original two changes are already applied under different versions. After approval, preserve the hosted history and reconcile the local baseline identities/source difference, review the deployment diff and ensure only the three new changes are pending. Recheck counts and establish a recovery checkpoint immediately before deployment. Supabase documents the distinction between migration files and applied history in its [migration guide](https://supabase.com/docs/guides/deployment/database-migrations).

## Function and email differences

Hosted functions are only:

- `send-referral-notification`, version 1, gateway JWT verification enabled.
- `resend-webhook`, version 1, gateway JWT verification disabled.

The first still contains a direct provider-send path; the new local implementation makes it a read-only compatibility/status endpoint and moves sending into the separately authenticated worker. Its old deployed source does not implement the new `EMAIL_DELIVERY_ENABLED` gate. Do not configure a provider key or enable sending while leaving this older path in place.

The eight missing endpoints are `workspace-access`, `manage-invitations`, `invitation-entry`, `claim-invitation`, `practitioner-onboarding`, `review-practitioner`, `respond-to-referral` and `dispatch-email-jobs`. Both existing endpoints also need their new implementations and shared files. The new gateway settings intentionally rely on explicit session verification, worker authentication or webhook signatures in the respective handlers; do not change a gateway setting without its corresponding implementation.

The hosted secret-name inventory contains no `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET`, `APP_URL`, legal/business settings, invitation encryption keys or worker secret. No secret values were retrieved. The local frontend email flag is false, but a frontend flag is not a server delivery safeguard. Actual delivery was not tested.

## Access and advisor checks

- All eleven public application tables have RLS enabled.
- The `verified_practitioners` view has `security_invoker=true`.
- Browser roles have no usage on the current private schema and no execution on its privileged trigger functions.
- `notification_outbox` and `email_delivery_events` have no browser table grants and no RLS policies. The two informational security notices are consistent with their intended server-only access; do not add public policies merely to remove the notices. [Supabase notice/remediation reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- The security advisor returned no warning/error-level notices. This is not a complete security certification: the public-signup mismatch was found separately through the Auth settings endpoint.
- Performance notices are informational: fourteen unused indexes in the empty app database, and an absolute Auth connection limit of ten. Do not remove planned indexes on this basis. [Unused-index reference](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index); [production configuration checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

## What remains unverified

The read-only public Auth response establishes that signup is enabled and email auto-confirmation is disabled. It does not establish the hosted OTP expiry, full redirect allowlist, SMTP configuration, CAPTCHA/rate-limit settings or session policy. Those require the detailed configuration review during deployment.

This audit does not establish frontend hosting/domain/DNS status, sender-domain verification, backup restore readiness, real practitioner identity/AHPRA verification, reviewed legal materials or a successful hosted user journey. Zero counts are an observation at the audit timestamp, not permission to reset or overwrite the database.

## Next authorised step to request

Request approval for a controlled backend deployment: reconcile migration history locally, apply only the three new migrations, deploy all ten current function folders, turn off public signup and keep email delivery disabled. Do not create pilot accounts, send email or enable the worker schedule as part of that approval unless explicitly included. Real domain/support/business/legal details and approved pilot recipients remain needed for the subsequent pilot.

## Evidence sources

- Live project, migration, function and security/performance advisor reads through the Supabase connector.
- Read-only SQL transactions for exact aggregate counts, catalog/grant checks and stored migration statements; no patient/identity row contents were selected.
- Read-only retrieval of both deployed function bundles and comparison with local source.
- Hosted `GET /auth/v1/settings` with the configured public key, and CLI secret-name/digest listing (digests deliberately omitted from this report).
- Current local migration files, `supabase/config.toml`, public environment configuration (no keys included), and the [release runbook](launch-runbook.md).

The Supabase skill guided the migration-history comparison and the separate checks of RLS, grants, privileged functions and Auth settings. No fix was applied during this audit.
