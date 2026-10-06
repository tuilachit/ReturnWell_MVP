# Email-backed referral acceptance — 7 October 2026

Status: local implementation; independent review complete, final fix-pass verification
in progress. No release.

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

Current verification (final fix-pass whole-suite run in progress):

| Layer | Command / result |
| --- | --- |
| Build and Node | `npm test`: 185 total, 175 pass, 10 opt-in skips, 0 failures |
| Static checks | `npm run lint` and `npm run typecheck`: passed |
| Actual Postgres | Fresh fix-pass `npm run test:database`: 111/111 passed; combined 5,000-member p95 199.267 ms, geographic p95 177.268 ms, both below 500 ms |
| Browser journeys | Pre-review full suite: 92/92 passed; two new fix regressions passed; full rerun in progress |
| Local Auth/HTTP/PostgREST | Fresh 46-migration stack plus `npm run test:local-journey`: 26/26 passed after fixes |
| SQL lint | Isolated local `supabase db lint --schema public,private --level error --fail-on error`: no errors |
| Backend manifest | `npm run backend:prepare`: 14 functions, 46 migrations; `60ff34a6dadc2c6e30f5ab7164e4562fa82d51e000aef2b9f9fc6327221a1f72` |
| Offline Vercel artifact | `npm run build:vercel`: passed in private-test mode; existing optional trace-include warnings remain |
| Artifact browser | `RW_PRODUCTION_BROWSER=1 node --test tests/production-preview.test.mjs`: 1/1 passed, including nonce/CSP hydration |

The ten default opt-in skips are separately covered by the full database run,
focused recipient/contact/source-bound checks (also included in the 111-check run), all local journeys,
and the built-artifact browser run. No test skip is counted as a pass. These do
not demonstrate real Google provider exchange, hosted release or received mail.
The independent review is recorded below. Earlier red runs found and reproduced a member-query
operator-precedence bug, draft-contact object-order dirty checking, and missing
invitation delivery evidence. Corrected tests also removed the obsolete customer
admin-link expectation without changing MFA or backend authorization rules.

## Independent review and fix pass

A fresh whole-branch reviewer examined `e616ec1..4a73b7d` read-only. No critical
disclosure was confirmed. Five important findings entered one regression-led
fix pass; only the final whole-browser run remains in progress:

1. A request lost **before** commit followed by a source change could leave the
   doctor stuck retrying. The source-specific `recipient_changed` rejection now
   unlocks reselection even after ambiguity: the transaction checks the durable
   request record before returning that rejection. A committed response loss still
   replays the original referral. Both paths have real-Auth browser coverage.
2. Operator-only accounts lost invitation administration. Explicit
   `/admin/invitations` restores the staff workflow for operator-only and mixed-role
   accounts. Customer pages do not show administration; revoked current backend
   authority denies the staff route. Existing MFA remains enforced.
3. SQL POSIX alpha rejected browser-valid combining initials. Pinned Unicode L/M
   and N/Cc/Cf ranges now match permitted initials and reject numeric/control/format
   characters, with JS-equivalent trimming. Composed/decomposed, non-Latin,
   supplementary-plane and nonbreaking-space fixtures pass. Entered spelling is
   preserved in consent, not silently NFC-rewritten.
4. Missing physical location plus `telehealth=false` incorrectly entered the remote
   group. Missing/unknown location is now unknown unless remote availability is
   explicitly supported or the doctor requests telehealth (still excluding known
   false). Explicit physical/telehealth send checks retain current source checks.
5. Combined search previously exhausted every member page. It now makes exactly
   one bounded authoritative member query, carries a member cursor inside the
   filter-bound combined cursor, preserves current counts, and crosses into the
   directory tier once. A 5,000-member fixture plus one contact traverses without
   duplicates; targeted p95 was 159.164 ms over 30 runs, below the unchanged 500 ms
   local budget. This is local timing, not a hosted service SLA.

All five regressions failed before repair and passed targeted checks. The reviewer
did not independently rerun the supplied suites; the fix pass is verified by the
implementer's fresh tests, not a second reviewer or a fabricated sign-off.

Deferred minor: the unused legacy `createReferral` direct-INSERT helper validates
an optional contact but does not persist it. No production UI calls this helper;
the doctor flow uses atomic draft finalisation. Before reusing this legacy API,
explicitly reject contact-bearing calls or route them through that private workflow.

## Execution decisions carried forward

These are the executor's rulings, including every behavior the independent
reviewer declined to judge. Costs are explicit; they are not implied approvals.

| Decision | Reason | Cost if wrong / remaining limitation |
| --- | --- | --- |
| Keep the managed worktree and locked dependencies | Already isolated; no dependency changes needed | Baseline checks must catch dependency drift |
| Keep changes local until explicit release | Implementation is not authority for production clinical sends | Production stays on the prior build until release |
| Use repository Playwright | `agent-browser` is not installed; real local Auth/HTTP harness exists | Separate interactive visual inspection remains unperformed |
| Require contacts for authenticated sends, keep preview optional | Fictional preview saves/sends nothing | Preview is not real patient-entry acceptance |
| Count only the queried distance group | Projection does not supply all groups' totals | Users must switch groups to obtain their counts |
| Add delivery evidence repair during acceptance | Missing evidence made invitation status inaccurate | Backend migration/manifest must precede the frontend |
| Leave DNS/SMTP, hosted release, Google exchange and mailbox acceptance external | No deployment/send performed in local execution | No production reliability claim before the controlled live journey |
| Require human wording/review owners | Code tests cannot approve clinical/privacy notices or staff review | Clinical launch remains gated on real owners and notices |
| Exclude delegated clinic teams | Approved model authorizes the intended practitioner | Team workflows require separate authorization design |
| Treat undefined raw service/age text as unknown | Importer defines no normalized candidate capability contract | Future structured sources need contradiction filtering before use |

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
