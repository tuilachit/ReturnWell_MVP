# Hosted backend repair — 2 October 2026

## Scope and outcome

User approved fixing the hosted backend/frontend mismatch. This is deployment
repair evidence, not approval for a clinical pilot, external email sends, or
publication of candidate practitioner data.

- Source: `b743cb8273d84b22c317d96d955c30c7de403446` on `main`.
- Frontend: `https://return-well-mvp.vercel.app` (existing deployment unchanged).
- Supabase: `ivutegjvttkrmxctegub`, Return Well MVP, Sydney region.
- Before repair: only six repository migrations applied; latest was
  `20260930103336_referral_consent_server_time`.
- `manage-referral`, `search-practitioners`, `manage-practice` and
  `email-operations` were missing. The deployed GP workspace could not refresh.

## Changes applied

1. Verified remote migration history matched the repository; normal CLI dry run
   selected exactly 28 pending migrations. No history repair or database reset.
2. Set hosted `EMAIL_DELIVERY_ENABLED=false` and `RELEASE_MODE=private_test`.
   Other secrets, recipients, encryption keys and Auth settings were unchanged.
3. Saved pre-change schema and data dumps for `public`, `private` and
   `supabase_migrations` in the local private cache. Files have mode 0600 and
   are not part of Git. Also verified a completed provider physical backup at
   2026-10-01 21:45:55 UTC. PITR is not enabled. No hosted restore was performed.
4. Applied the 28 pending migrations, ending at
   `20261001222515_location_matching`, with `--skip-vault`, no seeds or roles.
5. Deployed all 14 Edge Functions and their shared dependencies from the same
   source. Custom authentication remains in place: verified Supabase user and
   claims, current database authority, MFA for privileged changes; worker secret
   for dispatch and signed webhook verification. No anonymous workflow grant.
6. Confirmed a second migration dry run reports up to date, with no pending files.

## Verification performed

- Fresh isolated database regression: 72 passed, zero failed/skipped.
- Fresh HTTP/workflow regression: 22 passed, zero failed/skipped.
- Hosted SQL: all 34 migrations present; directory/referral paging, private
  drafts and geography schema exist; every public/private application table has
  RLS. Browser roles cannot execute the service-only workflow RPC directly.
- Real authenticated browser on the canonical hosted frontend, using the
  existing fictional practice account: refresh reaches the empty referral list
  without the previous workspace error; directory loads; postcode 2000 lookup
  reports that distance matching is not configured, without inventing distance.
- Saved `FICTIONAL-DEPLOY-CHECK-20261002` as one private draft with explicitly
  fictional text. Reloaded the page, resumed the same draft, and ran its
  shortlist. The result correctly contains zero eligible practitioners.
- The verification draft remains saved and unfinalized. No referral, invitation,
  practitioner approval or outbound message was created by this test.
- Direct unauthenticated POSTs to the four new endpoints return 401; dispatch
  without its secret returns 401; an unapproved browser origin returns 403.
- Hosted request logs during the initial post-deploy checks show successful
  manage-referral/search-practitioners requests. Expected negative probes are
  401/403. The existing scheduled worker returns 200 and records a heartbeat.
- Existing data counts preserved: one organisation, membership, profile,
  application and invitation; two already-sent email jobs and six email events.
  No pending jobs or notification outbox rows. Email delivery remains disabled.
- Hosted application-review, practice-administration and email-delivery screens
  also loaded successfully as the existing operator. No privileged edits or
  approvals were performed. The practice contact remains unreviewed. The email
  screen displays the two historical delivered jobs and a current worker
  heartbeat; these are not new acceptance sends from this repair.

## Gates still open

- No approved practitioner profiles and no enabled profession-verification
  policies exist in this hosted project. Independent policy/evidence review and
  practitioner onboarding are needed for real shortlist results.
- No approved geography edition is imported. Nearest-suburb/radius results
  cannot be exercised with real data yet; the safe no-distance state is live.
- Mailbox/provider delivery, Auth SMTP, approved sender/recipients and new-user
  email onboarding were not exercised. Sending remains deliberately paused.
- Founder/clinical/privacy/retention sign-off, hosted recovery rehearsal and
  monitoring ownership remain separate launch requirements. Release evidence
  was not fabricated or changed to bypass these gates.
- Security advisor: existing leaked-password-protection warning remains;
  see https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
  The 30 no-policy RLS notices correspond to service-only tables with no browser
  row policies; adding permissive browser policies is not the remediation.
  Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.

Prefer a forward repair if a further issue is found. Do not reset the hosted
database or replay sent email jobs. Keep sending disabled during recovery and
reconcile provider receipts before any approved resumption.
