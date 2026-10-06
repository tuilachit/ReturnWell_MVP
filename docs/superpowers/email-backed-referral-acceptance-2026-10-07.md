# Email-backed referral acceptance — 7 October 2026

Status: local implementation; final verification/review in progress. No release.

## Delivered scope

- The existing doctor form collects initials plus one chosen contact method, saves
  partial private drafts, and searches confirmed members plus contactable source
  records. Directory contacts are explicitly **Needs confirmation**, not verified
  practitioners or confirmed capability matches. Known incompatibilities are excluded.
- Selection identifies a member or one source-bound person/practice/contact route.
  The server resolves the address; there is no separate invite form or manual
  recipient-email input. Contact/requirements changes invalidate selection/consent.
- One Send referral creates the private referral, intended-person invitation and
  durable job atomically. Inline patient consent and recorded contact permission
  remain necessary; a public email alone does not establish permission.
- A bounded post-commit attempt processes only that notification. Retry preserves
  the request, job, frozen payload and provider key. Provider acceptance and matched
  delivery-webhook evidence are distinct; neither means read.
- Google/email signup, mailbox proof and an independently reviewed link to the
  selected person/practice/profession precede release. A shared clinic inbox cannot
  acquire every associated practitioner's referrals. Seven-day consent,
  reconfirmation, cancellation, expiry, decline and suppression remain authoritative.
- Private contacts appear only in authorised doctor/practitioner details. No patient
  initials, contact, reference or summary appears in directory/signup/mail payloads.
- Customer chooser/navigation has no administration choice. Explicit staff routes
  retain current backend authorization and MFA. No AI, booking or bulk outreach.

## Evidence layers

The tests use fictional data and isolated local Postgres/Supabase. Real local Auth,
HTTP-handler and PostgREST journeys are distinct from provider delivery. Browser
tests use the real local Edge/Auth boundary where specified; OAuth-provider
handoff and selected presentation/fault boundaries are explicitly simulated.
No hosted fixture accounts or real outbound messages are created.

Current verification (independent review still pending):

| Layer | Command / result |
| --- | --- |
| Build and Node | `npm test`: 185 total, 175 pass, 10 opt-in skips, 0 failures |
| Static checks | `npm run lint` and `npm run typecheck`: passed |
| Actual Postgres | `npm run test:database`: 107/107 passed, including unchanged geographic performance budget |
| Browser journeys | `npm run test:browser`: 92/92 passed; mobile, keyboard/accessibility, scoped customer/staff routes and recovery |
| Local Auth/HTTP/PostgREST | Fresh tracked-migration stack plus `npm run test:local-journey`: 26/26 passed |
| SQL lint | Isolated local `supabase db lint --schema public,private --level error --fail-on error`: no errors |
| Backend manifest | `npm run backend:prepare`: 14 functions, 45 migrations; `dbf669fd76c845c285139b30b284aadf5428b7a0186c35e6b786902a5c4626c0` |
| Offline Vercel artifact | `npm run build:vercel`: passed in private-test mode; existing optional trace-include warnings remain |
| Artifact browser | `RW_PRODUCTION_BROWSER=1 node --test tests/production-preview.test.mjs`: 1/1 passed, including nonce/CSP hydration |

The ten default opt-in skips are separately covered by the full database run,
focused recipient/contact/source-bound Postgres run (16/16), all local journeys,
and the built-artifact browser run. No test skip is counted as a pass. These do
not demonstrate real Google provider exchange, hosted release or received mail.
Independent review findings will be recorded after review. Earlier red runs found and reproduced a member-query
operator-precedence bug, draft-contact object-order dirty checking, and missing
invitation delivery evidence. Corrected tests also removed the obsolete customer
admin-link expectation without changing MFA or backend authorization rules.

## Read-only production preflight

- Supabase `ivutegjvttkrmxctegub`, ap-southeast-2: ACTIVE_HEALTHY; 39 migrations,
  609 private candidates, 0 member profiles, 0 enabled professional policies;
  directory routes and private contacts for this feature are not installed.
- Vercel: expected `fitment/return-well-mvp`, owner ReturnWell, project
  `prj_up3rfmMQkEjZGj1HzGQwIVVXlLnr` confirmed by CLI. Connector returned 403 for
  that scope; no deployment or permission change made.
- Resend domain `returnwell.com.au`: `not_started`, sending capability enabled but
  domain verification not complete. No DNS change or domain-verification request.
- `check:backend` cannot run its authenticated hosted check from this shell:
  `BACKEND_RELEASE_CHECK_SECRET` is unavailable. Hosted missing migrations are
  independently established by read-only SQL; no compatibility claim is made.
- Current Auth SMTP, completed real Google/email signup, scheduler/secret alignment,
  signed webhook operation and real mailbox acceptance are not verified in this run.

## Required before release and clinical use

1. Authorize deployment of the reviewed branch. Apply its additive migrations and
   deploy all fourteen matching functions/manifest **before** the frontend. Never
   reset hosted data or fabricate member approvals from imported contacts.
2. Recheck both backend/frontend identities, migration history and canonical served
   SHA. Production build must pass the authenticated backend compatibility check;
   an offline Vercel build is not an override or deployment approval.
3. Complete sender DNS, sender/support identity, Auth SMTP, canonical URLs,
   scheduler/worker-secret alignment and signed-webhook configuration. Preserve
   quarantine, suppression, bounded retries and approved recipient restrictions.
4. Supply responsible professional/identity-review owners and evidence/policies,
   plus approved published notices, clinical/privacy/retention and incident ownership.
   Candidate import and CEO dataset permission are not fabricated credential checks.
5. Explicitly approve one controlled doctor/recipient mailbox journey with fictional
   patient information. Verify received message, secure new/existing signup,
   intended-person review/release, private contacts, response/timeline and cancellation.
   Record received-email and authenticated hosted evidence separately.

Until these are established, describe this as implemented locally—not ready for
real-patient rollout. No automatic messages to the imported list are authorised.
