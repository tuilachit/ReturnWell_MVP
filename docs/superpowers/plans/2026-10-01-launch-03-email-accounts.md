# ReturnWell Email and Account Journeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invitations, verification, returning-user login and delivery recovery trustworthy and understandable to real recipients.

**Architecture:** Keep application email jobs/leases and signed callbacks. Add safe status projections and typed client recovery, consistent templates, and a production Supabase Auth SMTP configuration using the existing provider. Auth transport and application transport remain explicitly separate.

**Tech Stack:** Supabase Auth/Edge Functions/Postgres, Resend, Vercel's existing one-minute dispatcher, React and local tests. No new marketing automation platform.

**Spec:** [Launch-readiness design](../specs/2026-10-01-launch-readiness-design.md), section 4.6. Proposed; live configuration/sends remain separately approval-gated.

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

- Old-generation invite events after a resend: C1 cannot show the old email as current or revive a revoked link.
- Consumed verification token but interrupted claim: C2 recovers the authenticated original claimant without new credentials/accounts.
- HTML-injected names or credential-bearing telemetry: C3 escapes input and never emits private content.
- Provider acceptance then timeout/lease loss: C4 retains key/payload and reconciles, never force-resends under a new key.
- Default Auth mail working only for a team account: C5 separately verifies new-user and returning-user production transport.

### C1. Safe invitation, account and delivery progress

**Dependency:** A1. **Files:** Create `app/lib/invitation-progress.ts`,
`tests/invitation-progress.test.mjs`, `tests/browser/invitation-progress.spec.ts`;
modify `app/invitations-panel.tsx`, `app/lib/workflow.ts`, `manage-invitations`
routing and DB/HTTP tests. Generate `invitation_delivery_summary` migration.

**Interfaces:** `EmailDeliverySummary={state:'pending'|'sent'|'delivered'|
'delayed'|'suppressed'|'failed'|'configuration_needed'|'needs_review'|'cancelled'|
'unknown',updatedAt:string|null,nextRetryAt:string|null}`;
`InvitationProgress={invitationId,status,expiresAt,generation,
signupCompletedAt:string|null,accountWasNew:boolean|null,delivery:EmailDeliverySummary}`.
`invitationProgressLabel(progress):string`. `manage-invitations list` returns
the existing inviter-authorised records plus this projection, never raw jobs.

- [ ] Write `existing_account_is_not_new_signup`, `delivered_is_not_accepted`, `expiry_is_not_pending_forever`, `latest_generation_only`, `bounce_overrides_earlier_delivery`, `outsider_cannot_query_delivery`. Include event reordering and a claimed invitation whose mail was delivered earlier.
- [ ] Run `node --test tests/invitation-progress.test.mjs` and `npm run test:database`; observe new projection/wording failures.
- [ ] Implement per-invitation current-generation status derivation and clear UI columns. Keep invited email visibility limited to already-authorised inviters. Respect the server cooldown for explicit resend, require confirmation for token rotation/revoke, and surface Retry-After from C2 without inventing success.
- [ ] Run HTTP/DB/browser tests. Verify claimed existing-account copy, no link token in DOM tables, no “read” metric, and no browser SELECT access to private.email_jobs/events.
- [ ] Commit C1 as `feat: expose truthful invitation and delivery progress`.

### C2. Typed errors and account/verification recovery

**Dependencies:** C1/D1. **Files:** Create `app/lib/workflow-error.ts`,
`app/lib/account-recovery.ts`, `tests/account-recovery.test.mjs`,
`tests/browser/account-recovery.spec.ts`; modify sign-in/auth gate, join/confirm
pages, `app/lib/workflow.ts`, shared workflow HTTP and existing HTTP/security tests.
Generate an additive migration only if a bounded recovery RPC needs new state.

**Interfaces:** `WorkflowError extends Error {code:string;status:number|null;
retryAfterSeconds:number|null;fieldErrors:Record<string,string>}`;
`parseWorkflowFailure(response:Response):Promise<WorkflowError>` handles malformed
or empty bodies without showing raw server text. Recovery returns
`{next:'sign_in'|'request_verification'|'complete_claim'|'contact_inviter',message}`
from known validated state; it never returns an auth token or email override.
Existing mutation `requestId` is retained across ambiguous retries.

- [ ] Write `expired_invite_needs_inviter`, `expired_auth_can_request_again_with_original_valid_invite`, `consumed_token_failed_claim_can_finish_for_same_user`, `different_signed_in_user_cannot_claim`, `forwarded_link_proves_no_mailbox`, `429_respects_retry_after`, `invalid_json_has_safe_error`, `deep_link_survives_login`, `session_switch_clears_clinical_state`.
- [ ] Run `node --test tests/account-recovery.test.mjs tests/ui-workflow.test.mjs` and the account browser spec; confirm RED on newly missing recovery.
- [ ] Implement typed error propagation, explicit safe retry/support actions and sign-in cooldown UX. Keep passive landing pages; no automatic verification on load. If OTP succeeded but claim failed, reuse the same authenticated user and original server attempt. Recheck roles on focus/sensitive actions without wiping a same-account in-progress form on token refresh. Server-authorisation failures clear stale actionable data. Generic sign-in wording must not enumerate existing accounts.
- [ ] Run real local new-user/existing-user journeys, replay/revoke/race tests and browser navigation cases. Inspect logs/URLs: credentials remain only in the intended fragment flow and are removed after claim; do not persist them to recover a reload. Never use an admin-generated link as hosted inbox proof.
- [ ] Commit C2 as `fix: recover account and verification journeys safely`.

### C3. Accessible consistent transactional email templates

**Dependencies:** A1/C2; include A3 mail kinds when available. **Files:** Create
`supabase/functions/_shared/email-layout.ts`, `tests/email-templates.test.mjs`,
`docs/superpowers/email-template-preview.md`; modify shared `email.ts`,
`workflow-security.ts`, verification message construction in `workflow-http.ts`
and dispatch payload typing. Add reviewed Auth template assets under
`supabase/templates/` for C5, using documented Supabase template variables.

**Interfaces:** `renderTransactionalEmail({heading,bodyParagraphs:string[],
action:{label,url}|null,supportEmail,websiteUrl}):{html:string,text:string}`.
Content builders retain domain validation and own message purpose/expiry;
layout never accepts arbitrary HTML. Snapshot outputs use example.test only.

- [ ] Write `all_templates_have_text_equivalent`, `all_user_strings_are_escaped`, `auth_mail_contains_no_clinical_or_promotional_fields`, `only_valid_https_action`, `visible_brand_and_monitored_support`, `new_lifecycle_notices_are_generic`. Include ampersands, quotes, long names and malicious markup.
- [ ] Run `node --test tests/email-templates.test.mjs tests/notification.test.mjs tests/workflow-security.test.mjs`; confirm expected new-format failures.
- [ ] Implement a restrained email-compatible red/neutral layout, inline styles, language/title, descriptive links, readable body text, meaningful heading order and large tap action. Preserve the same purpose in text/HTML. Add explicit actual expiry and an independently recognisable canonical domain. Keep open/click tracking disabled for credential messages; no stock graphics or promotional content.
- [ ] Run the template/security tests and render local fixtures at mobile/desktop widths. In C5, inspect actual Gmail and another approved mailbox/client; a web preview is not full email-client acceptance. No real mail is sent by snapshot tests.
- [ ] Commit C3 as `feat: align accessible ReturnWell transactional emails`.

### C4. Queue edge cases and redacted operator diagnostics

**Dependencies:** C1/A3. **Files:** Modify
`supabase/functions/_shared/dispatch.ts`, `runtime.ts`, `workflow-http.ts`,
`supabase/functions/resend-webhook/index.ts`, `app/api/cron/dispatch-email-jobs/route.ts`;
create `supabase/functions/email-operations/index.ts`, `app/admin/email/page.tsx`,
`app/email-operations-panel.tsx`, `app/lib/email-operations.ts`;
extend dispatch/HTTP/DB/cron tests. Generate `email_operations` migration.

**Interfaces:** Existing `dispatchJobs(runtime,limit,send)` contract stays.
Provider transport gets a 15-second AbortController timeout; a timeout after
`email.start` remains uncertain. Extend `email.finish` optional
`retryAfterSeconds` clamped 0–3600 and no automatic retry beyond the earlier of
job expiry and 24h dedupe boundary. Backoff is `max(existing backoff, provider delay)`.
Operator read model: `EmailJobHealth={id,family,state,attempts,dueAt,updatedAt,
safeErrorCode,delivery:EmailDeliverySummary,recipientMasked}`. No credentials,
payload, clinical data or public full mailbox list.

- [ ] Add tests `provider_acceptance_timeout_reuses_key`, `malformed_success_is_uncertain`, `429_does_not_retry_early`, `crashed_last_lease_needs_review`, `out_of_order_duplicate_callbacks_are_idempotent`, `invalid_signature_is_not_acked`, `persist_failure_returns_non_2xx`, `suppression_blocks_next_send`, `stale_referral_notice_cancelled`, `operator_view_has_no_payload`.
- [ ] Run `npm run test:workflow` and `npm run test:database`; confirm genuinely missing cases fail and preserve existing passing lease/idempotency tests.
- [ ] Implement only the uncovered reliability changes. Honour durable callback persistence before 2xx and reconcile unmatched events later. Prioritise expiring auth jobs within bounded batches without starving other jobs. Add read-only operator diagnostics and explicit revoke/cancel paths; do not add a force-resend/new-key button for ambiguous attempts. Expose safe classification for provider rejection/configuration, never raw response bodies.
- [ ] Run concurrent local workers with controlled transport faults and signed local webhook fixtures. Verify one logical send, one matched event record, bounded timeouts, no stale event regression and no provider calls during status reads. Keep the single existing production schedule; no extra scheduler is created.
- [ ] Commit C4 as `fix: harden delivery recovery and expose safe queue health`.

### C5. Production sender, Auth SMTP and actual recipient acceptance

**Dependencies:** C2/C3/C4 and founder-owned domain/contact; explicit hosted scope.
**Files:** Update `supabase/functions/.env.example`, `.env.example`,
`docs/superpowers/launch-runbook.md`; create
`docs/superpowers/production-email-acceptance.md`. Never store actual keys or
token-bearing links. Configuration belongs in provider dashboards/secret stores.

**Interfaces:** Existing server `RESEND_FROM`, `APP_URL`, `WEBSITE_URL`,
`SUPPORT_EMAIL`, notice URLs/versions and allowlist. Supabase Auth SMTP is a
separate hosted configuration using Resend; no new hook is necessary by default.
Canonical origin changes require coordinated frontend/Auth redirect/trust config.

- [ ] Record pre-change sender/domain/SMTP/queue/allowlist state using redacted evidence; recheck current official docs linked in the design. Confirm approved test recipients and that queued jobs cannot reach unexpected addresses. If founder details are missing, mark this task blocked while local work continues.
- [ ] Validate founder domain ownership, provider-generated SPF/DKIM records and reviewed DMARC policy; use actual provider settings, not copied example DNS. Configure verified sender/reply/support and Supabase Auth custom SMTP only under the approved scope. Rotate previously exposed keys if still active; confirm revocation without displaying values. Do not disable public-signup protections.
- [ ] Run one approved application invitation/verification journey for a new recipient and one returning-user Auth sign-in. Check actual recipient Inbox/Spam, canonical links, claim/profile state and app callback matching. Auth SMTP may not have an application job ID: report its transport evidence separately.
- [ ] Exercise provider-supported bounce/suppression test addresses only in an approved isolated test setup. Confirm suppression/retry/callback behaviour without blasting real recipients. Test expiry/replay through local fixtures, not repeated live mail.
- [ ] Write acceptance results with provider/deployment IDs and redacted timestamps. A domain verification badge or SMTP Save is not acceptance; Spam placement remains a failed inbox-placement check. Commit documentation/template scope as `docs: record production email acceptance` only when that evidence exists.

## Operational handoff

Leave delivery recipient-scoped until D7 authorises expansion. Maintain separate
evidence for queued, provider accepted, callback delivered, mailbox received and
user completed. Never say “all email is working” based on one transport or mailbox.
No marketing/harvested-list campaigns are part of this plan.
