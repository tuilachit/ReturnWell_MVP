# Implementation evidence — 7 September 2026

Subsequent release note: the backend has now been deployed with signup restricted and email disabled. See [hosted deployment evidence](2026-09-07-backend-deployment.md). The implementation/testing record below describes the earlier local implementation turn; it does not establish a completed hosted pilot.

All three approved phases are implemented in the existing checkout. This is a **local implementation**, not a production release or proof of hosted email delivery.

## Delivered

1. **Trusted invitation and signup:** individually addressed doctor/practitioner invitations; reviewed inviter and practice identity; exact email preview; explicit recipient-consent confirmation; expiry, resend rotation and revocation; mailbox verification; existing-account reuse; atomic claim and signup tracking. Links are passive until the recipient chooses to continue. Tokens and verification credentials are encrypted server-side and never returned by management endpoints.
2. **Practitioner onboarding and review:** private versioned drafts; explicit service, funding, language, location and intake confirmation; terms/privacy and referral consent; independent identity evidence and manual AHPRA review; operator-only activation; feedback and immutable review history. Unreviewed profiles are excluded from matching. Intake pause preserves access to already-assigned referrals; revoked access does not.
3. **Referral response and notification automation:** assigned-only inbox, accept/decline with conflict protection, participant-only reasons and persisted doctor timeline; generic notification emails; transactional outbox; encrypted prepared messages, exclusive leases, stable provider idempotency keys, bounded retries and ambiguity review; signed webhook deduplication and terminal bounce/complaint suppression. Missing email configuration never rolls back a valid clinical workflow response.

The frontend includes invitation management, public invitation/confirmation, onboarding, operator review, practitioner inbox and referral detail routes. The existing empty first-use experience and explicit demo remain. No candidate dataset has been published or imported.

## Verification

- `npm test`: production build passed; 37 tests passed, two explicitly opt-in integration suites skipped in the ordinary run.
- `npm run lint` and `npm run typecheck`: passed.
- `npm run test:database`: 24 reported tests passed (23 cases plus suite). Real Postgres transactions and roles cover isolation, trust review, concurrency, idempotency, revoked access, direct-write denial, queue fairness, ambiguity and suppression.
- `RW_LOCAL_STACK_DIR=<isolated-directory> npm run test:local-journey`: 13 reported tests passed (12 cases plus suite). Genuine local Supabase Auth, generated verification links, REST and RLS exercise doctor reuse, practitioner signup/claim/review, referrals, both response outcomes and immediate access revocation.
- All ten Edge entrypoints passed Deno type checking. Production dependency audit reported zero known vulnerabilities.
- Independent security review findings were fixed and rechecked. Regressions now cover global recipient resend races, forged referral status insertion, malformed practice notification email, queue starvation and ambiguous final attempts. The real Supabase journey also exposed a managed `auth.users` privilege difference that the initial database harness did not model; the migration and harness now use explicit column-limited grants.
- All ten actual local Edge entrypoints boot. Authenticated endpoints and the worker deny unauthorised calls; missing invitations are unavailable, and the unsigned/unconfigured webhook fails closed. A Colima filesystem-sharing issue was reproduced, diagnosed and addressed in the local setup helpers rather than by changing global Docker settings.
- Authenticated browser checks passed for doctor deep-link/detail, practitioner acceptance, operator review/known-practice selection and the doctor's updated accepted timeline. These used real local sessions and actual local Edge endpoints. The browser finished signed out; acceptance was explicitly distinguished from booking, and email remained pending rather than falsely delivered.

Detailed browser evidence is maintained in [the UI implementation report](ui-implementation-report.md). Integration fixtures are fictional and isolated; no real mailbox, patient record or hosted account was used. Local handler tests do not substitute for a hosted authenticated pilot.

## Release boundary

No hosted migrations or functions were applied this turn. No real emails were sent, worker schedule enabled, sender domain provisioned or production legal identity invented. Existing hosted credentials and `.env.local` were not changed. The private 200-practitioner candidate/review list remains private and unverified.

Before a pilot, follow the [release runbook](launch-runbook.md): reconcile the actual hosted migration history; configure the real business/domain/support/legal details; provision reviewed operators/practices; deploy and configure Auth/functions; verify the sender domain and webhook; approve named pilot recipients; then enable and validate actual delivery. Worker scheduling SQL is supplied but intentionally not installed remotely.

AI ranking, maps/travel-time integration, bulk outreach, automatic AHPRA scraping, attachments, booking and patient self-selection were outside these approved phases.

## Development notes

Test-first implementation and independent review drove the explicit database grants, mailbox-binding tests and retry/concurrency protections. No commit was created: the checkout has no initial HEAD, and all pre-existing work was preserved. Build warnings from the current Vinext/Node tooling remain non-fatal; authenticated hosted end-to-end validation is still a launch requirement.
