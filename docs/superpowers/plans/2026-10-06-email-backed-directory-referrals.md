# Email-backed Directory Referrals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing doctor form and matching results to one-click referral notifications for email-backed directory contacts, followed by secure recipient signup and referral access.

**Architecture:** Preserve imported research records and confirmed members as separate identities. Add a minimal authenticated recipient projection and source-bound send command, reuse the existing referral invitation/release and email queue machinery, and add protected patient-contact storage. Integrate these capabilities into the existing form, results and confirmation UI rather than a separate invitation screen.

**Tech Stack:** React 19, TypeScript, Supabase Auth/Postgres/Edge Functions, existing Resend transport, Node tests, disposable Postgres and Playwright. No new product dependencies, AI, booking or clinic-team subsystem.

**Spec:** `docs/superpowers/specs/2026-10-06-email-backed-directory-referrals-design.md`

**Status:** Native execution approved and tasks 1–5 implemented locally. Task 6 acceptance and independent review are in progress. No production release; see [acceptance record](../email-backed-referral-acceptance-2026-10-07.md).

## Global Constraints

- Keep original candidate records and observations private. Do not delete records without email, mass-create active practitioners or alter credential status.
- Unknown funding, language, services, intake and appointment formats remain unknown. Directory contacts must not be labelled eligible clinical matches.
- Never infer a coordinate from a nearby postcode or widen a radius silently.
- There must be no separate invitation form, manual email entry or administrative screen in this journey.
- Public availability alone does not satisfy permission-to-contact confirmation.
- An invitation link alone grants no clinical access. Retain independent intended-recipient ownership/credential review before release.
- Preserve the existing seven-day consent window and authoritative release checks.
- Patient initials/contact details remain private; none in email, URLs, analytics, directory queries or logs.
- The customer workspace chooser and navigation exclude administration; backend staff authorization remains intact.
- No bulk emails, hosted fixture users, inferred approvals or unrelated checkout edits.
- Use the existing clean managed checkout `/Users/ReturnWellMvp/.worktrees/pilot-readiness`; preserve any pre-existing work. Do not copy or edit the dirty prototype checkout.
- Before Supabase implementation, read its skill and current changelog/docs. Generate migration filenames using `supabase migration new <name>`; the logical names below are not invented timestamps.

## Review Focus

1. Two practitioners share one mailbox: signup must not release the wrong person's referrals (Task 3).
2. Candidate source/email changes after selection: sending fails with reselection required, not a silent recipient substitution (Tasks 1 and 3).
3. Provider accepted a send but the response was lost: retry retains its payload/key and creates no duplicate referral or notification (Task 4).
4. Changing patient-contact data after consent: the release snapshot invalidates the earlier consent (Task 2).
5. Unknown capabilities versus known incompatibility: unknown options are labelled; incompatible options never become confirmed matches (Tasks 1 and 5).

## File and Interface Map

- `app/lib/referral-recipients.ts` (new): discriminated recipient types and authenticated directory/send client adapters.
- `app/lib/patient-contact.ts` (new): structured contact type and draft/final validation.
- `app/components/referral-recipient-options.tsx` (new): recipient selection/results, without duplicating the doctor portal.
- `app/components/patient-contact-fields.tsx` (new): contact controls shared by form/recovery.
- `app/components/referral-send-panel.tsx` (new): inline consent/contact basis and one send/retry action.
- Existing `app/doctor-portal.tsx`, `app/types.ts`, `app/lib/referral-drafts.ts`, `app/lib/referrals.ts`, `app/referral-overview.tsx`, `app/auth-gate.tsx`: integrate new units with current form, recovery, authorised details and navigation.
- Existing `_shared/workflow-http.ts`, `_shared/dispatch.ts`, `_shared/workflow-security.ts`: operation mapping, scoped dispatch and generic branded mail.
- New migrations: `email_backed_directory`, `referral_patient_contact`, `directory_referral_claim_binding`, `scoped_referral_dispatch`. Append wrappers to the current workflow router rather than rewriting historic migrations.
- Existing Node/Postgres/local-journey/browser suites plus focused new tests named in tasks below.

## Task 1: Email-backed recipient projection and deterministic selection

**Files:** new `app/lib/referral-recipients.ts`, `tests/referral-recipients.test.mjs`, `tests/helpers/directory-recipient-db.mjs`; modify `supabase/functions/_shared/workflow-http.ts`, `tests/workflow-db.test.mjs`; new `email_backed_directory` migration.

**Interfaces:**
- `DirectorySelection = { candidateId: string; observationHash: string; routeId: string }`.
- `RecipientCommon = { displayName: string; professionId: string; practiceName: string; location: Practitioner['location']; distanceKm: number | null; reasons: string[]; warnings: string[]; requirementStatus: 'confirmed' | 'needs_confirmation' }`.
- `RecipientOption = RecipientCommon & ({ kind: 'member'; practitionerId: string } | { kind: 'directory'; selection: DirectorySelection })`.
- `RecipientPage = { items: RecipientOption[]; nextCursor: string | null; counts: { confirmed: number; needsConfirmation: number }; geography: DirectoryPage['geography'] }`.
- `searchReferralRecipients(client, input: Parameters<typeof searchPractitioners>[1]): Promise<RecipientPage>` invokes `search-practitioners` operation `recipients`, routed to `directory.recipients`. Existing default directory behavior remains compatible.
- Private `directory_contact_routes`: UUID route ID, candidate/observation identity, practice key, normalized email, association evidence and active flag. Refresh/resolve routines are service-only; every route is tied to source-supported practice/mailbox association.

- [x] Write failing unit/database cases: no-email, blank/malformed email, suppressed/withdrawn/unsuitable/duplicate contact excluded; anonymous/outsider denied; projection contains no raw observations or patient data; ambiguous multi-practice association excluded. Pin stale source and unknown-versus-incompatible requirements.
  Test contract example: `assert.equal(page.items.some(x => x.kind === 'directory' && x.selection.candidateId === fixture.noEmailId), false)` and `assert.equal(option.requirementStatus, 'needs_confirmation')` for an unknown-funding fixture.
- [x] Run `node --test tests/referral-recipients.test.mjs` and `npm run test:database`; observe failures for missing behavior before writing production code.
- [x] Implement projection/refresh, current-source support checks, actor authorization, normalized email/suppression checks, stable cursor ordering and explicit unknown-distance grouping. Derive practice association only from evidence, not name similarity. Known contradictions are excluded; unknown capabilities cannot pass the confirmed tier. Reuse supported geography rules.
- [x] Refresh routes in the candidate import/disposition/withdrawal workflow transaction; do not activate candidates or queue emails. Backfill only unambiguous supported routes, and report counts/exclusions without raw mailboxes. Preserve existing confirmed-member search.
- [x] Re-run unit and disposable Postgres tests; verify deterministic pagination, no duplicates and route invalidation after source withdrawal. Commit only this task's files.

## Task 2: Private patient initials and contact information

**Files:** new `app/lib/patient-contact.ts`, `tests/patient-contact.test.mjs`; modify `app/types.ts`, `app/lib/referral-drafts.ts`, `app/lib/referrals.ts`, `tests/helpers/referral-growth-db.mjs`; new `referral_patient_contact` migration.

**Interfaces:**
- `PatientContact = { initials: string; preferredMethod: 'phone' | 'email'; phone: string; email: string }`.
- `validatePatientContact(input: Partial<PatientContact>, final: boolean): string[]`: incomplete drafts allowed; final submission requires initials and the selected method's usable contact.
- Optional `patientContact?: PatientContact` added to `ReferralInput`, `Referral` and `DraftInput` for historical compatibility. New UI sends require it; older persisted referrals display unavailable, never fabricated data.
- Store contacts in `private.referral_patient_contacts`, keyed to referral ID; expose `referral.contact.read` through `manage-referral` operation `contact.read`, returning `PatientContact | null` only to the same active referring practice or authorised released recipient. No anonymous/table grants.

- [x] Write failing validation, draft recovery and database cases; invalid chosen phone/email rejected, unchosen contact not required, partial draft accepted. Contact read is denied to outsiders, unrelated practitioners and the intended but not-yet-approved recipient.
  Snapshot assertion: after a contact change, `assert.equal(rpc(doctor, 'growth.status', { referralId }).status, 'needs_reconfirmation')`.
- [x] Run `node --test tests/patient-contact.test.mjs` and `npm run test:database`; confirm feature failures.
- [x] Implement validation consistently server/client: trimmed initials 1–16 Unicode characters, no digits/control characters; email bounded to 254 characters and existing mailbox syntax; phone bounded to 32 input characters with 8–15 digits and optional leading `+`. Store only the chosen method. Do not infer a patient/carer relationship; delegated/carer contact is outside this approved minimum workflow.
- [x] Extend draft allowlist/normalization and all finalisation paths to persist contact data atomically; extend the consent digest to include the canonical contact object. On contact correction, apply the same referral lock and authorization, invalidate pending release consent, and avoid outbox payload/log inclusion. Preserve historical digest compatibility for absent contacts.
- [x] Run the validation/draft/growth/security suites plus Postgres tests and commit the task. Verify final contact absence from directory projections, growth status, notification payloads and operational events.

## Task 3: Source-bound send and intended-recipient claim

**Files:** modify `app/lib/referral-recipients.ts`, `app/lib/referral-growth.ts`, `supabase/functions/_shared/workflow-http.ts`, `app/onboarding-panel.tsx`; new `directory_referral_claim_binding` migration; new `tests/helpers/directory-referral-db.mjs`, `tests/directory-referral-local.test.mjs`; modify local/Postgres test runners.

**Interfaces:**
- `sendDirectoryReferral(client, input: { id: string; expectedVersion: number; requestId: string; selection: DirectorySelection; consentConfirmed: true; contactConsentConfirmed: true; contactBasis: InviteReferral['contactBasis'] }): Promise<ReferralGrowth>`.
- `manage-referral` operation `draft.directoryInvite` maps to `growth.directoryInvite`. It resolves name/mailbox from the current route server-side, accepts no client recipient name/email and uses the existing token/envelope and idempotency mechanism.
- Persist candidate/observation/route binding beside `private.referral_invitations`; expose only minimal intended identity to the signup/onboarding screen. Keep patient contact/summary inaccessible there.

- [x] Add failing tests for stale hashes, revoked routes, tampered email fields, inactive practice, missing inviter review, unconfirmed consent, suppressed mail and replay conflicts. Two candidates sharing one mailbox must create separately bound intended identities, not authorize a mailbox-wide profile claim.
  Assert two retries return the same referral/invitation IDs and `email_jobs` increases by exactly one for the logical invitation, not every click.
- [x] Run `npm run test:database` and opt-in local journey cases; confirm failures for source-bound operations and same-mailbox/wrong-profile release.
- [x] Implement one locked transaction resolving the source-bound contact, finalising the private referral/contact, recording the binding and reusing/creating its notification. An invitation already bound to another directory identity must not be reused solely because its mailbox matches.
- [x] Carry directory identity into claims and private application linkage without overwriting imported evidence or treating the claim as approval. Extend the existing release predicate to require independently reviewed identity/profession/practice association with the intended directory contact, not just matching mailbox. Record operator evidence through the existing staff review tools; signup remains awaiting review when needed.
- [x] Verify wrong-mailbox, forwarded-link, shared-inbox/different-practitioner, new/existing-account, approval, declined invitation, expiry, cancellation and reconfirmation cases through actual local Auth/HTTP/PostgREST. Confirm one release event and one generic notification. Commit the task.

## Task 4: Immediate scoped dispatch and honest delivery status

**Files:** modify `supabase/functions/_shared/dispatch.ts`, `_shared/workflow-http.ts`, `_shared/workflow-security.ts`, `app/lib/referral-growth.ts`; new `scoped_referral_dispatch` migration; extend `tests/workflow-dispatch.test.mjs`, `tests/workflow-http.test.mjs`, `tests/helpers/referral-growth-db.mjs`.

**Interfaces:**
- `DispatchScope = { family: 'invitation' | 'referral'; relatedId: string }`. Extend `dispatchJobs(runtime, limit, send, scope?: DispatchScope)` with its existing inferred summary return type; absent scope retains the scheduled-worker behavior. Scope is server-derived, never accepted from the browser for arbitrary job dispatch.
- A service-only scoped claim checks exact invitation/current generation or referral/current event, as selected by scope, and uses existing prepare/start/finish leases, suppressions and provider idempotency. Actor receives only the existing safe growth/delivery projection; no tokens, payloads, provider secrets or raw errors.

- [x] Write failing tests: committed invitation immediately invokes only its own job; another practice's jobs remain untouched; missing sender returns configuration-needed, not delivered; provider timeout followed by retry retains the key and prepared payload. Race scheduled/scoped workers and assert one start lease.
- [x] Run `node --test tests/workflow-dispatch.test.mjs tests/workflow-http.test.mjs` and database cases; observe intended failures.
- [x] Add post-commit best-effort scoped dispatch to directory sends and existing member notification sends. Bound the request, preserve the durable referral after dispatch failure, and use persisted current delivery status on idempotent replay. Never call transport from the database transaction or expose the worker secret in clients.
- [x] Extend branded invitation copy using reviewed doctor/practice and intended recipient; include safe purpose/support links only. Test patient initials, reference, phone, email contact and clinical text absence in every outgoing message. Continue secure key rotation, suppression and webhook behavior.
- [x] Verify sent-to-provider versus delivered distinctions, retry scheduling and lost-response recovery. Document the existing scheduled retry worker/configuration checks, without claiming setup is complete. Commit the task.

## Task 5: Existing doctor journey, recipient details and separate admin navigation

**Files:** new `app/components/referral-recipient-options.tsx`, `patient-contact-fields.tsx`, `referral-send-panel.tsx`; modify `app/doctor-portal.tsx`, `app/referral-overview.tsx`, `app/auth-gate.tsx`, `app/referral-growth-panel.tsx`; new `tests/browser/directory-referral.spec.ts`; extend auth/draft/growth/location/accessibility browser tests.

**Interfaces:**
- `ReferralRecipientOptions({ page, selected, busy, onSelect })` uses Task 1's discriminated options, never puts a directory UUID into `selectedPractitionerId`.
- `PatientContactFields({ value, disabled, onChange })` renders Task 2's contact controls.
- `ReferralSendPanel` consumes `selected: RecipientOption | null`, `contactBasis: InviteReferral['contactBasis'] | ''`, `contactConsentConfirmed: boolean`, `consentConfirmed: boolean`, `busy: boolean`, `uncertain: boolean`, `onSend: () => Promise<void>` and boolean/basis change callbacks. It renders the single final action; submission retains existing request identity across retry and disables editing during an uncertain save.

- [x] Write failing browser cases: existing form → Find practitioners → select email-backed directory option → inline confirmations → one Send referral button. Assert there is no separate invite form or recipient email input, no customer administration choice, and no false eligible label for unknown capability.
- [x] Run the focused Playwright cases and observe missing feature failures.
- [x] Integrate recipient search and selection while retaining the existing profession/location/funding form and deterministic matched-member behavior. Reset selection/consent when requirements, location or contacts change. Keep verified and needs-confirmation groups on one page; explicitly show distance unavailability and shared practice email routing.
- [x] Integrate structured contact fields with draft save/reload, validation focus and review. Send directory selections through Task 3; confirmed members through their existing secure path. Replace hard-coded disabled-email copy with actual configuration/delivery status. Preserve fictional preview with no real sends or hosted data queries.
- [x] Display private contacts only via Task 2's authorised reader on practitioner/doctor referral details. Preserve requested-referral continuation across Google/email signup and show waiting-for-review honestly. Exclude operator choices in ordinary customer navigation; include them only on explicit staff routes after server role checks.
- [x] Run browser regression for new/existing accounts, approval wait, same-inbox identity mismatch, lost responses, stale selection, double click, cancellation, consent changes, mobile layout, keyboard focus and accessibility. Commit the task.

## Task 6: Full acceptance and release handoff

**Files:** modify `docs/superpowers/launch-acceptance-matrix.md`, `docs/superpowers/real-data-release-record.md`; refresh existing backend manifest via repository scripts. No production sends in automated tests.

- [ ] Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:database`, `npm run test:local-stack`, `npm run test:local-journey` and `npm run test:browser`. Report failed and skipped checks individually; a mocked UI run is not hosted acceptance.
- [ ] Self-check every spec requirement against tasks and test results. Review final changes for raw data/secrets, patient leakage, shared-mailbox release, omitted actor checks and misleading matching/delivery labels. Complete the independent review required by the chosen execution method and address confirmed defects.
- [ ] Run `npm run backend:prepare`, `npm run check:backend` and `npm run build:vercel` with validated configuration. Confirm generated manifest includes the actual new migration IDs and function sources; commit generated artifacts and evidence.
- [ ] Before publishing, verify target project `ivutegjvttkrmxctegub` and Vercel ReturnWell scope `fitment`, check sender/DNS/Auth SMTP and existing configuration evidence read-only, and name unresolved external prerequisites. Do not fabricate reviewers/sign-offs or silently weaken release controls.
- [ ] With explicit release authority, apply reviewed migrations/functions before the matching frontend, verify manifest/history/served SHA, and run a controlled authorised mailbox journey with fictional patient details. Existing broad launch approval does not authorize sending messages to the whole candidate list.
- [ ] Record local versus hosted versus real received-email evidence separately. If sender/reviewer/notice prerequisites are missing, hand off the implemented and tested code with the exact remaining dependencies; do not label the app clinical-launch ready.

## Plan Self-review and Execution Handoff

The six tasks cover the approved form/search/select/send/signup/detail flow, patient-contact protection, intended-recipient review, honest unknown requirements, source/email changes, scoped dispatch, separate admin navigation and acceptance. Task interfaces retain current member-search compatibility and use the existing invitation/release machinery. No new dependencies or unrelated UI rebuild are required.

Recommended execution: **Native** — implement task-by-task in this session using `superpowers:executing-plans`, then a fresh whole-branch reviewer. This avoids repeated implementation contexts while keeping one independent final review. Alternatively, choose **Subagent-driven** for a fresh implementer and reviewer at each task. No delegation begins until the execution method is selected.

The user should review this newly written plan and select the execution method before product-code changes. External DNS/SMTP and responsible-review/launch-owner inputs remain explicit dependencies, not claimed approvals.
