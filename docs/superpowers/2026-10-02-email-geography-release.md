# Restricted email, NSW geography and backend-first release

## Scope

User approved restoring sending to the existing test mailbox only and the
previously proposed NSW GeoNames import and deployment compatibility checks.
This remains `private_test`, fictional data only, not clinical launch approval.

## Verified hosted changes

- Restored `EMAIL_DELIVERY_ENABLED=true` with the exact existing one-address
  allowlist. Sender is `ReturnWell Test <onboarding@resend.dev>`. No pending
  messages existed when sending was enabled; no old jobs were replayed.
- Created one fictional practitioner invitation through the authenticated app.
  The existing cron delivered it. Resend confirmed delivery; signed webhook
  `sent` and `delivered` events both matched the job in Supabase at
  2026-10-01 23:45:37 UTC. This is provider/mail-server confirmation, not an
  assertion that the user read their inbox.
- Delivered link opened the correct canonical invitation page, with reviewed
  test-practice identity, masked recipient, expiry, support and explicit consent.
  Stopped before accepting terms pending user confirmation. No signup approval
  or completed referral is claimed; this mailbox already has an account.
- Imported GeoNames edition `geonames-nsw-2026-10-01-a7de4b2a61b8-accuracy46`:
  5,592 localities / 922 NSW postcodes; 4,525 documented reference points;
  1,067 unknown coordinates. See `geography-source-manifest.md` for provenance,
  licence evidence, limitations and rollback.
- Canonical signed-in UI: postcode 2000 shows nine explicit locality choices;
  Sydney South and Parliament House are labelled distance unavailable. Selecting
  Sydney enables a radius; selecting an unknown point disables it. A 10 km
  Sydney search displays attribution, approximate distance wording and no
  automatic radius expansion. Zero eligible practitioners is expected: none
  were approved or inserted by this task.
- Applied one additive migration `20261001234319_backend_release_health` and
  deployed all 14 Edge Functions from code commit `02c9d66`.
- Real hosted guard passes all 14 fingerprints and 35 migration versions.
  Deliberately wrong fingerprint and nonexistent migration both fail. Unauthed
  health probes return 401; anon/authenticated cannot execute history RPC.
- Created a separate read-only backend-check secret on Supabase and Vercel.
  No secret values, invitation links or downloaded source data are committed.

## Verification

- Main test command: 140 passed, zero failures, six opt-in integration skips.
- Disposable actual-Postgres suite: 73 passed, zero failures/skips.
- Focused new importer/guard suite: seven passed.
- Typecheck, lint, offline Vercel build and release-input checks passed.
- Independent read-only review found a cross-project URL gap; fixed and covered
  by a regression test observed failing before the change, then passing.
- Advisor: no new findings; existing leaked-password protection warning remains:
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
  Service-only RLS tables intentionally have no browser policies.

## Boundaries still open

- Await test-terms confirmation to continue mailbox verification and account flow.
- No enabled credential policies, independently approved practitioner profiles or
  practice locations were created. Live clinical referral acceptance is untested.
- Default Resend sender plus one-address allowlist is test-only. Verified founder
  sending domain, production legal/clinical sign-off and operational ownership
  remain required before an actual user pilot.
- Backend fingerprints detect bundle/version mismatch, not manual schema/history
  tampering. Promotions/rollbacks without rebuilding require the documented
  manual compatibility check. Never edit already-applied migration SQL.
- Main branch integration awaits the user's choice; implementation branch is
  `codex/location-release-guards`. Frontend deployment evidence follows below.

## Frontend deployment

- Vercel production build from implementation commit `02c9d66`:
  `dpl_5nFyYhfNAEkqUhqDFfL8DQXKNghK`.
- Build output confirmed the hosted 14-function / 35-migration gate passed.
  Build completed in 42 seconds; status Ready, Vinext/Vite/Nitro, server in syd1.
- Protected deployment smoke test returned HTTP 200 and the expected ReturnWell
  private-test sign-in content. No deployment protection setting was weakened.
- Promoted the same checked artifact to `https://return-well-mvp.vercel.app`.
  Unique URL: `https://return-well-g7fp6ru2v-fitment.vercel.app`.
- Git `main` has not been merged or pushed as part of this change; the production
  artifact was deployed directly from the reviewed implementation branch.
- Canonical alias inspection resolves to the new deployment. A fresh authenticated
  browser session loads administration and email diagnostics: latest invitation
  delivered in one attempt, zero pending/review/paused jobs, current completed
  dispatcher heartbeat. Ten-minute Vercel error-log queries returned no entries;
  this is a bounded smoke check, not a long-running monitoring guarantee.
- External alerting/drain setup and a named incident owner were not verified or
  changed; the diagnostics screen explicitly notes the alerting ownership gap.
