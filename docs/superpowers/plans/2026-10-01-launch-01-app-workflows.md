# ReturnWell App Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all existing roles usable, consistent and recoverable, and complete the referral-coordination lifecycle.

**Architecture:** Extract only shared presentation and domain helpers from the existing screens. Add server drafts and transactional lifecycle/contact operations through the existing Edge/RPC boundary; do not introduce patient booking or a second state framework.

**Tech Stack:** Current React/Vinext/TypeScript, Supabase Auth/Postgres/Edge Functions, existing Hugeicons and CSS; local Node and browser tests from D1.

**Spec:** [Launch-readiness design](../specs/2026-10-01-launch-readiness-design.md), especially sections 3–4.4. Proposed; execution waits for plan review.

## Global Constraints

- Preserve unrelated dirty files and private research; never deploy the checkout wholesale.
- No hosted writes, external sends, paid services, push or deployment without explicit release scope.
- Never put patient content or credentials in URL paths/queries, analytics, logs or browser persistence; only the existing short-lived auth fragment flow may carry link credentials, which must be scrubbed.
- Keep public signup disabled and the current recipient restriction until an approved pilot expansion.
- Never import candidates as active or infer identity, registration, funding or availability from scraping.
- Server-side membership, participant and credential checks remain authoritative; the UI is not an access boundary.
- Preserve stable request IDs, server consent timestamps, optimistic versions and append-only audit events.
- Keep the current React/Vinext/Supabase stack initially; pin dependency changes and test both build targets.
- Keep charcoal/red, native system fonts and the existing Hugeicons adapter; no new icon library or visual rebrand.
- Distinguish saved, queued, sent, delivered, accepted and externally arranged outcomes everywhere.

## Review Focus

- Ambiguous save followed by reload/account switch: A2/A7 must recover the same authorised record or fail closed.
- Acceptance racing cancellation: A3 must persist one transition/event and suppress inappropriate unsent mail.
- Same-organisation but different draft creator: A2 must deny draft reads/edits even though submitted referrals are practice-visible.
- Long data, narrow viewport and keyboard-only dialogs: A1/A7 must retain labels, focus and operability.
- Operator/self-review confusion: A5/A6 must not grant clinical access or approve one's own credentials.

## File boundaries and prerequisites

D1 creates the isolated baseline and local browser harness. Existing files are
the source of behaviour; never replace `doctor-portal.tsx` wholesale. Shared
components live under `app/components/`, contracts under `app/lib/`. New SQL is
created with `supabase migration new <name>` at execution; the generated timestamp
is not invented in this plan. Never edit a previously applied migration.

### A1. Shared interface and honest status presentation

**Files:** Create `app/components/field.tsx`, `app/components/page-state.tsx`,
`app/components/confirm-dialog.tsx`, `app/components/app-error-boundary.tsx`,
`app/lib/referral-status.ts`, `tests/referral-status.test.mjs`,
`tests/browser/shared-ui.spec.ts`. Modify `app/globals.css`, `app/layout.tsx`,
`app/workflow-shell.tsx`, `app/referral-overview.tsx`, `app/doctor-portal.tsx`,
`app/sign-in.tsx`, `app/onboarding-panel.tsx`, `app/review-panel.tsx`,
`app/practitioner-panel.tsx`, `app/invitations-panel.tsx` and the existing design master.

**Interfaces:** `referralStatusLabel(status: Referral['status']): string`;
`PageState({kind:'loading'|'empty'|'error',title,description,onRetry?})`;
`Field({id,label,error?,hint?,children})`; `ConfirmDialog({open,title,description,
confirmLabel,busy,onConfirm,onCancel})`. Components contain no Supabase calls.

- [ ] Write status tests: `sent` is “Awaiting response”; `accepted` is not “Booked”; legacy `booked` is “Previously recorded as booked”; zero records produce no invented metrics. Write browser assertions for first-invalid focus, dialog Escape/return focus, icon-button names and 320px layout.
- [ ] Run `node --test tests/referral-status.test.mjs` and `npm run test:browser -- tests/browser/shared-ui.spec.ts`; confirm new assertions fail before implementation.
- [ ] Implement components/tokens and adopt them across the named screens. Replace booking summary shortcuts with awaiting response, accepted and needs attention; retain legacy records in All. Add closed/cancelled views and extend the status union only when A3 supplies those persisted states. Add a runtime error fallback without logging content or auto-retrying mutations.
- [ ] Rerun the targeted commands, `npm run typecheck` and `npm run lint`. Browser evidence includes 320/375/768/1024/1440px, 200% zoom and reduced motion; run accessibility assertions. Confirm recovery does not silently discard a pending submission.
- [ ] Commit reviewed A1 files only as `feat: unify accessible ReturnWell workflow surfaces`.

### A2. Validated server drafts and recoverable submission

**Dependencies:** A1 and B1 terminology. **Files:** Create `app/lib/referral-drafts.ts`,
`app/referral-draft-panel.tsx`, `supabase/functions/manage-referral/index.ts`,
`tests/referral-drafts.test.mjs`, `tests/browser/referral-drafts.spec.ts`; modify
`app/lib/referrals.ts`, `app/types.ts`, `app/doctor-portal.tsx`, shared workflow
runtime/HTTP routing and `tests/workflow-db.test.mjs`, `tests/local-journey.test.mjs`.
Generate additive migration `referral_drafts`.

**Interfaces:** `ReferralDraft` = `{id,organisationId,createdBy,version,input,
updatedAt,finalizedReferralId:null|string}`; `input` is partial unsent referral
data, with separate `preferredLanguageId` and `accessNotes`.
`saveReferralDraft(client,{id,expectedVersion,input,requestId}): Promise<ReferralDraft>`;
`loadReferralDraft(client,id): Promise<ReferralDraft>`;
`finalizeReferralDraft(client,{id,expectedVersion,consentConfirmed:true,requestId}): Promise<Referral>`.
Edge `manage-referral` operations `draft.load|draft.save|draft.finalize`; SQL
`private.referral_draft_workflow(actor uuid, action text, input jsonb) returns jsonb`,
routed by `rw_workflow`. Draft rows are creator + active organisation scoped.

- [ ] Add `drafts_are_creator_scoped`, `saving_a_draft_sends_no_email`, `finalize_replay_returns_one_referral`, `lost_response_then_reload_recovers_same_id` and `invalid_or_changed_fields_retain_edits`. Assert limits 120/4000/500, four-digit string postcodes, server consent time, one referral/outbox on finalise and denial to another creator in the same practice.
- [ ] Run `node --test tests/referral-drafts.test.mjs`, `npm run test:database` and the draft browser spec; observe the missing-contract failures, not environment failures.
- [ ] Implement draft schema, explicit UI Save draft/load, dirty-navigation confirmation, structured validation and transactional finalisation using draft UUID as referral UUID. Preserve the current direct-create path during rollout. Scope request replay to actor+operation+payload; recheck profession/capability/availability on finalise. Never restore drafts from another account or store patient data in browser persistence.
- [ ] Run targeted tests plus `npm run test:local-journey`. Confirm browser offline/double-click cases, a definite rejection followed by correction, a prior ambiguous commit followed by a rejected retry, and sign-out clearing all content. New draft referral submission keeps the existing stable-ID safeguards.
- [ ] Commit A2 scope as `feat: add private referral drafts and resumable finalisation`.

### A3. Cancellation, closure and linked re-referral

**Dependencies:** A2/B2. **Files:** Create `app/lib/referral-actions.ts`,
`app/referral-actions.tsx`, `tests/referral-actions.test.mjs`,
`tests/browser/referral-actions.spec.ts`; modify `app/types.ts`, GP/practitioner
panels, overview/activity, `manage-referral`, workflow routing, shared mail kind
types/dispatch and DB/local journey tests. Generate `referral_lifecycle` migration.

**Interfaces:** `transitionReferral(client,{referralId,expectedVersion,requestId,
action:'cancel'|'close',reasonCode,note?}): Promise<{referral:Referral,notification:string}>`;
`startReplacementDraft(client,{referralId,expectedVersion,requestId}): Promise<ReferralDraft>`.
Reason sets: cancel = `entered_in_error|no_longer_required|other`; close =
`handover_completed|no_longer_required|unable_to_arrange`. Notes max 500.
Persist `supersedes_referral_id` for the replacement. New mail kinds:
`referral_cancelled|referral_closed`, always generic participant notices.

- [ ] Write `only_allowed_transitions_succeed`, `accept_cancel_race_has_one_winner`, `repeat_action_has_one_event`, `replacement_needs_new_selection_and_consent`, `cancelled_referral_cannot_send_stale_initial_notice`. Enumerate sent/accepted/declined/cancelled/closed/legacy-booked and owner/outsider roles.
- [ ] Run action tests and `npm run test:database`; verify RED on missing transitions.
- [ ] Implement spec section 4.3 with row locks, expected version and request ledger. No client UPDATE grants. Re-referral copies only the original practice's authorised fields into a new editable draft; original remains unchanged. Cancel unsent now-inappropriate jobs and check state immediately before dispatch; preserve already-sent history and enqueue one update.
- [ ] Run focused DB/HTTP/browser tests and the local full journey. Assert no stale acceptance control after cancellation, no duplicate event/outbox, no silent booking and no private decline-note propagation into provider email.
- [ ] Commit A3 scope as `feat: complete referral coordination lifecycle`.

### A4. Participant-only handover contact and next steps

**Dependencies:** A3/A6. **Files:** Create `app/handover-panel.tsx`,
`app/lib/handover.ts`, `tests/handover.test.mjs`,
`tests/browser/handover.spec.ts`; modify GP/practitioner panels, referral guide,
workflow routing and DB tests. Generate `referral_handover_contacts` migration.

**Interfaces:** `getReferralHandover(client,referralId): Promise<{status,
practiceName,contactPhone:string|null,secureInstructions:string|null,
reviewedAt:string|null,nextAction:string}>`. Reads through authenticated
`manage-referral` operation `handover.read`; current active referral participants only.
Contact source is A6 reviewed practice data, not user metadata or scraped pages.

- [ ] Write `accepted_referral_shows_arrange_handover_not_booking`, `outsider_and_operator_only_denied`, `missing_reviewed_contact_shows_support`, `mailto_contains_no_patient_data`. Verify guidance for awaiting/accepted/declined/cancelled/closed states.
- [ ] Run `node --test tests/handover.test.mjs` and the handover browser spec; confirm RED.
- [ ] Implement participant-only projection and clear responsibilities. Do not collect patient phone, DOB or email. Gate Close as handover completed behind an explicit confirmation; do not infer it from acceptance/delivery. Render contact instructions as text and validated HTTPS links, not arbitrary HTML.
- [ ] Run DB/RLS/browser tests; have the pilot clinician validate that the external handover can actually be completed using this information before D7.
- [ ] Commit A4 as `feat: clarify secure referral handover responsibilities`.

### A5. Guided practitioner onboarding and review recovery

**Dependencies:** A1/B2/B3. **Files:** Create `app/lib/profile-validation.ts`,
`tests/profile-validation.test.mjs`, `tests/browser/onboarding-review.spec.ts`;
modify onboarding/review/profile panels, `app/lib/workflow.ts`, workflow HTTP
errors and corresponding HTTP/DB/local tests. Reuse B2/B3 credential schema.

**Interfaces:** `validateProfile(profile,professionPolicies): FieldIssue[]` where
`FieldIssue={field:string,code:string,message:string}`; server remains authoritative.
Uses B2 `CredentialSummary`/review payload and B3 revision operation. Consent
versions remain explicit; completeness is not a credential approval percentage.

- [ ] Write `partial_draft_is_saveable`, `submit_requires_current_confirmations`, `stale_version_preserves_local_fields`, `changed_notices_require_reconsent`, `reviewer_cannot_approve_self`. Browser cases include returning to a changes-requested profile and route-specific credential labels.
- [ ] Run profile tests and onboarding browser spec, then confirm missing behaviours fail.
- [ ] Implement progressive sections, field errors, save/submit distinction, saved-version comparison, submission receipt, feedback and reviewed-update entry. Keep full professional evidence private to appropriate review roles; no missing data silently defaults to yes.
- [ ] Run HTTP/DB/local/browser tests. A draft reload retains values; stale responses cannot update a new account's screen; operator-only reviews remain independent.
- [ ] Commit A5 as `feat: guide practitioner onboarding and review recovery`.

### A6. Safe practice, identity and membership administration

**Dependencies:** A1/B2. **Files:** Create `app/admin/practices/page.tsx`,
`app/practice-admin-panel.tsx`, `app/lib/practice-admin.ts`,
`supabase/functions/manage-practice/index.ts`, `tests/practice-admin.test.mjs`,
`tests/browser/practice-admin.spec.ts`; modify access/navigation/HTTP routing,
DB/local tests and `supabase/config.toml`. Generate `practice_administration` migration.

**Interfaces:** `managePractice(client, {operation:'list'|'create'|'reviewContact'|
'reviewInviter'|'revokeMember',requestId, ...operationFields})`; define a
discriminated union in `practice-admin.ts`. Create requires name + verified owner
account; reviewed contact requires evidence reference + work contact + version;
revoke requires organisationId/memberId/expectedVersion/reason. SQL actor comes
from verified session. Return only practice/member/review metadata, no referrals.

- [ ] Add `owner_cannot_create_operator`, `operator_cannot_read_clinical_records`, `unverified_owner_rejected`, `contact_change_requires_review`, `last_owner_revocation_rejected`, `revoked_membership_loses_access`. Test forged organisation/actor/role input.
- [ ] Run practice-admin tests and `npm run test:database`; observe RED.
- [ ] Implement operator-only provisioning/review and explicit revoke confirmation with audit. Non-operator doctor invitations remain fixed referrer grants; do not introduce arbitrary role assignment. A different reviewed owner must exist before revoking the last active owner. Enforce server-side privileged step-up from D3 before release.
- [ ] Run permission-matrix/local/browser tests. Confirm independently reviewed invitation branding cannot be changed by editing display name, and contact revisions do not leak to unrelated practices.
- [ ] Commit A6 as `feat: add audited practice administration`.

### A7. Whole-app browser recovery and accessibility acceptance

**Dependencies:** A1–A6/B6/C1/C2/D1 harness. **Files:** Create
`tests/browser/role-journey.spec.ts`, `tests/browser/recovery.spec.ts`,
`tests/browser/accessibility.spec.ts`; extend fixture helpers and rendered/UI
tests. Record evidence in `docs/superpowers/launch-ui-acceptance.md` (no tokens).

**Interfaces:** Uses the local-only D1 fixture harness and the contracts above;
no production data or real sends. Screenshots/traces contain fictional data only.

- [ ] Add exact browser journeys for doctor, practitioner and operator; add dropped POST response after commit, blocked follow-up read, stale optimistic versions, session expiry, wrong workspace, interrupted module load, slow/no network and long-content viewport cases.
- [ ] Run the specs against the pre-fix release baseline and record which defects reproduce; do not make every check artificially fail if existing behaviour is correct.
- [ ] Fix only reproduced UX failures in their owning components; new domain changes return to their owning task. Use accessible names for selectors, not fragile CSS structure. Preserve focused field and user text when retrying reads.
- [ ] Run `npm run test:browser`, `npm test`, typecheck/lint and local journey. Require no serious/critical automated accessibility findings on tested screens plus manual keyboard/screen-reader spot checks; automated scans alone do not certify WCAG.
- [ ] Commit test/fix scope as `test: verify complete ReturnWell role journeys`; attach viewport and negative-case results to the evidence note.
