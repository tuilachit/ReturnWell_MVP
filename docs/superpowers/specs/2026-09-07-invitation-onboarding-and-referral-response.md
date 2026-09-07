# ReturnWell invitation, onboarding and referral response

Status: product design approved by Luke on 7 September 2026 and implemented locally. The older September 3 foundation remains the baseline. Verification and release configuration are documented separately in `../implementation-report.md` and `../launch-runbook.md`; no hosted deployment or real email send is implied.

## Outcome and scope

A verified doctor invites a known practitioner through ReturnWell. The practitioner sees the actual inviter and practice, verifies the invited mailbox, signs up, confirms a profile and receives a ReturnWell review. Only an approved practitioner becomes selectable for referrals. The practitioner can then accept or decline an assigned referral, and the referring practice sees the recorded response.

Deliver in three dependent, independently testable stages:

1. Invitation and signup, including operator-assisted doctor and practice onboarding.
2. Practitioner profile submission, administrator review and activation.
3. Practitioner inbox, atomic referral responses, timeline and notification dispatch.

Implementation plans are in `../plans/2026-09-07-01-invitations-and-signup.md`, `../plans/2026-09-07-02-practitioner-review.md` and `../plans/2026-09-07-03-referral-response.md`. Execute in that order. The approved choices do not require another design approval.

## Global constraints

- Work in `/Users/ReturnWellMvp/prototype`; preserve existing uncommitted files.
- Keep React 19.2.8, Vinext 1.0.0-beta.9, TypeScript 5.9.3 and supabase-js 2.114.0 unless a demonstrated compatibility problem requires a change; Node must be at least 22.13.0.
- Default workspaces are empty. Fictional fixtures require explicit demo opt-in and never write to the hosted project.
- Do not import, expose or send invitations to the private 200-practitioner candidate dataset.
- Invitations identify the actual authorised inviter and practice; never invent endorsements, testimonials, registration or business details.
- Patient and clinical details stay out of email content, invitation URLs, provider metadata and application logs.
- Account creation and email verification do not grant directory publication or referral access.
- Public tables use RLS and explicit grants; privileged credentials stay on the server.
- Build and test locally first. Hosted migrations, configuration changes and actual invitation sends are distinct release actions with explicit targets and recipients.
- AI ranking, maps, clinical attachments, booking, patient self-selection, automatic AHPRA access and practice-management integration are outside this phase.

## Baseline inspected on 7 September

The application uses a browser Supabase client and Edge Functions, with Postgres 17 in local configuration. `app/auth-gate.tsx` resolves only organisation membership, so a practitioner-only account currently reaches the unassigned screen. `app/doctor-portal.tsx` already recognises `/referrals/:id` for doctors. Preserve that behaviour when adding practitioner routing.

The migrations define practitioner trust fields, a filtered `verified_practitioners` view, practitioner/user links, referral events and an email outbox. They grant clients SELECT and INSERT on referrals, not UPDATE. Therefore an accept/decline interface also needs an authorised transactional write path. The current status trigger uses `auth.uid()` for audit attribution; a service-role update must supply the verified actor through the new transaction design instead of leaving it null.

The sender selects the earliest notification including already-sent rows; this can block later acceptance notifications. It has no exclusive claim or expired processing recovery. The webhook marks bounces and complaints as retryable failures. Fix these behaviours in stage 3 before enabling automated delivery.

Local migration versions are `20260903123723` and `20260903132000`. Previous hosted history records different version prefixes. Before a release, compare both migration histories and schema definitions. Do not blindly replay the local baseline or rename applied versions. This document makes no claim about newly inspected hosted state.

## People and permissions

| Person | Allowed actions | Access boundary |
| --- | --- | --- |
| ReturnWell operator | Provision a practice; invite doctors; invite known practitioners under their real operator identity; review applications | Operator permission stored in `private.platform_operators`, never in editable user metadata. Operator status alone does not grant clinical referral reads. |
| Practice owner/admin | Invite doctors into their own practice as `referrer`; invite known practitioners; see their practice's invitation statuses | Cannot create platform operators, approve practitioners or act for another practice. |
| Doctor/referrer | Invite a known practitioner; create and track their practice's referrals | Active practice membership plus a reviewed inviter identity required to send co-branded invitations. |
| Invited practitioner | Verify mailbox; create an account; edit their draft; submit and see review feedback | No directory browsing, publication or clinical referrals while awaiting approval. |
| Approved practitioner | See and respond to their assigned referrals; view own approved profile; pause new referrals | Requires active `practitioner_users` linkage and current approved trust state. |

Users with more than one permitted workspace get a workspace chooser; do not silently choose the first membership. Sign-out clears all workspace, application and clinical state. An expired or disabled membership is rechecked on sensitive server actions.

## Invitation and signup journey

1. The inviter enters the known practitioner's name and work email, confirms that the recipient agreed to be invited, and sees the exact email preview. Record that confirmation and inviter ID. Familiarity alone is not recorded as consent. Bulk import and bulk sending are excluded.
2. The server resolves inviter name and practice from reviewed identity records, checks active membership and creates an invitation. Names cannot come from client-submitted branding fields or the currently self-editable `profiles.display_name` alone.
3. Send from a verified ReturnWell domain. The body identifies ReturnWell, the inviter, purpose, what signup involves, the seven-day expiry, support and an option to decline. Provide a plain canonical website address so the recipient can independently visit ReturnWell. Do not imply a patient referral is waiting unless that is actually true; this phase invites before referrals can be assigned.
4. The recipient opens `/join#invite=<random-token>`. The page explains who invited them and why, using minimal metadata from a token-validated lookup. Show a masked invited email, not the full address. Page loading does not sign in, consume the token, create an account or decline anything.
5. On an explicit `Create my account` action with accepted terms/privacy version, the server sends email verification to the invitation's stored address. Never accept a substituted recipient or redirect URL from the browser. A new auth user can be provisioned at this point using Supabase's admin link API; an existing user signs in to the existing account. An incomplete auth record is not counted as a completed signup.
6. The verification email opens `/auth/confirm` with its credential in a fragment. A user action calls `verifyOtp`; the server then checks verified email, auth user ID, invitation state and a server-recorded verification attempt before claiming the invitation. The invitation and auth credential have independent expiries. A forwarded invitation alone cannot create membership for the forwarder's account.
7. A successful practitioner claim atomically creates a private-to-other-users draft application and profile. It does not create a practitioner link or active directory row. If the same authenticated user already owns an unfinished application, reuse that application when accepting another practice's invitation. If they already own an approved practitioner link, reuse their own approved workspace; never match another person's account by email or registration number. Doctor claims atomically link the invited `referrer` to the pre-approved practice and complete their profile.
8. A successful claim records `signup_completed_at` once. Existing-account acceptance is tracked separately from a new signup. A link open or sent email is never reported as a signup.

For a doctor invitation the purpose is joining the named practice; for an operator invitation the copy identifies the operator honestly. A practice owner who invited a doctor cannot grant owner/admin privileges using a request-body role override. Initial operator and practice-owner setup remains an explicit operator provisioning step.

### Trust presentation

Use the existing restrained UI: clear ReturnWell wordmark, readable text, named inviter and practice, one primary action and visible contact links. Avoid link shorteners, tracking redirects, attachment prompts, pressure language or requests for payment. Domain identity, legal business name, contact email, website, privacy URL and terms version must be supplied and validated before sending is enabled; do not invent these for production. Local previews may use visibly fictional `example.test` identities.

A seven-day invitation is a product default, not a guarantee about the separate Supabase auth token. Configure auth verification expiry to 15 minutes for the test environment and validate it during release. Disable click and open tracking for account emails. A declined invitation suppresses follow-up invitations to that email until an operator records a new recipient request. There are no automatic invitation reminder campaigns in this phase.

## States, persistence and concurrency

All IDs are UUIDs unless noted. Server timestamps use `timestamptz`; optimistic versions use nonnegative integer `version` values. Normalise work email by trim/lowercase only; do not remove plus suffixes or provider-specific dots. Store original display form separately. Treat normalisation as product matching, not proof of identity.

| Record | Required fields and constraints |
| --- | --- |
| `private.platform_operators` | `user_id` PK/FK auth.users, `active`, `created_at`. No client grants. |
| `private.inviter_identities` | `(user_id, organisation_id)` unique with NULLS NOT DISTINCT, reviewed `display_name`, `practice_name`, `verified_by`, `verified_at`, `active`. For operator invitations the organisation can be null and the role is labelled ReturnWell. Only operator provisioning updates reviewed branding. |
| `public.workspace_invitations` | `id`, `kind` (`doctor` or `practitioner`), `organisation_id`, `invited_by`, reviewed inviter/practice snapshot, `recipient_name`, `recipient_email`, `recipient_email_normalized`, `consent_recorded_at`, `status`, `expires_at`, `generation`, `claimed_by`, `signup_completed_at`, `account_was_new`, `version`, timestamps. `doctor` requires organisation and a fixed referrer role. `pending -> claimed/declined/revoked`; expiry is derived from time. Terminal invitations cannot be reopened. |
| `private.invitation_secrets` | Invitation FK, SHA-256 token hash, encrypted token envelope and key ID for deterministic email retry. The raw random token has 32 bytes of entropy. No raw token in public tables. Delete envelope on claim/decline/revoke/expiry cleanup. |
| `private.invitation_auth_attempts` | ID, invitation/generation, resulting auth user ID, token type (`invite` or `magiclink`), expiry, requested terms/privacy versions, verified/claimed timestamps, new-user flag. Never return auth link credentials from the request endpoint. |
| `private.invitation_events` | Append-only actor, invitation, event kind, time and reason code; no request body or credentials. |
| `public.practitioner_applications` | `id`, unique originating invitation FK, `user_id`, `status` (`draft`, `submitted`, `changes_requested`, `approved`, `rejected`), `version`, schema-validated profile JSON, `submitted_at`, `profile_confirmed_at`, `referral_consent_at`, `terms_version`, `privacy_version`, `applicant_feedback` (nullable, max 1000), `practitioner_id` after approval, timestamps. At most one unfinished application per user. |
| `private.practitioner_reviews` | Application/version, reviewer, decision, verification method (`manual_register`), registration number checked, check time, register evidence reference, identity comparison result, concise internal note and separate applicant-visible feedback. Immutable. |
| `private.email_jobs` | ID, family (`invitation`, `auth_verification`, `referral`), related ID and version, optional unique `source_outbox_id`, stable idempotency key, encrypted payload if it contains a credential, recipient, state (`pending`, `processing`, `sent`, `paused_configuration`, `suppressed`, `cancelled`, `exhausted`, `needs_review`), attempts, due time, lease ID/expiry, first-attempt time, provider ID, safe error code. Stage 1 implements this for invitations/auth; stage 3 unifies referral dispatch. |
| `private.email_events` | Unique provider-event ID, provider-message ID, event type, occurred time, matched job optional. Persist authentic unmatched events for later reconciliation. |
| `private.email_suppressions` | Normalised email PK, reason (`declined_invitation`, `bounce`, `complaint`, `provider_suppressed`), source event and time. Invitation-only suppression does not silently cancel unrelated transactional preferences. |

Use uniqueness to stop concurrent duplicate pending invitations for the same recipient, kind and organisation. When an old invitation has expired, transition it to revoked before issuing a fresh row. An explicit resend rotates its token/generation, invalidates old auth attempts, cancels unsent old-generation jobs and creates one new job. Repeated sends with the same client operation ID return the existing result. Database row locks make claim/revoke and claim/resend races deterministic; failed transactions leave no membership or application.

All exposed tables have RLS and explicit column grants. Inviting practices can see minimal invitation progress; applicants can read only their application and public review feedback; private tables have no client access. Mutation endpoints call service-role-only SQL transaction functions with the actor from `auth.getUser()`. These functions use `SECURITY INVOKER`, an empty search path, fully qualified names, explicit role checks, and revoke EXECUTE from PUBLIC/anon/authenticated. Never trust a request-body `actorId`. Keep the private schema outside the Data API; Edge Functions access it through explicit service-only RPCs, not by exposing that schema. Narrow private membership predicates needed by RLS may be SECURITY DEFINER with fixed search paths and only the required EXECUTE grants.

Active approved roles alone can query the clinical directory. Keep pending applicants from gaining directory access merely because they now have an authenticated Supabase account. Update table and location policies as well as the `security_invoker` view; a filtered view alone is not an access boundary. An approved practitioner can read their own profile while paused, without making the profile visible in doctor search.

## Profile, review and activation

Profile payload fields: `displayName` (1–160), `profession` (`physiotherapist`/`psychologist`), `registrationNumber` (normalised, 1–40), `practiceName` (1–200), `services` (1–30 entries, each 1–120), `funding` (0–20 entries, each 1–120), `languages` (1–20 entries, each 1–80), `telehealth` (explicit boolean), `acceptingNewReferrals` (explicit boolean), and `locations` (0–10 objects with suburb 1–120, four-digit postcode, NSW state, primary flag). At least one location is required for in-person services; exactly one primary location when any locations exist. No addresses or values are scraped into signup defaults.

Unknown is not yes: the practitioner must explicitly answer format and availability and confirm their profile and agreement to receive referrals. A registration-number format check only validates input; it is not registration verification. A work mailbox and a public registration number do not establish that the registrant owns the account. The operator records a manual identity check against an independently verified practice contact as well as a current register check.

Drafts save with `expectedVersion`; stale edits return 409 and retain the local form for reconciliation. `draft/changes_requested -> submitted` locks the submitted version. Only operators can transition `submitted -> approved/changes_requested/rejected`; an operator cannot approve their own practitioner application. Missing evidence or a duplicate/conflicting registration is returned for review, never auto-linked to an existing practitioner.

Approval runs in one transaction: lock application and version; validate current consent, submitted values, reviewed identity and registration; check normalised registration uniqueness; create the practitioner, its locations and an active `practitioner_users` link; store the immutable review; mark application approved. The database determines all trust flags and timestamps. A practitioner cannot set `verified`, `confirmed`, active lifecycle or reviewer fields via client JSON. If the practitioner chose not to accept new referrals, approval succeeds but they stay out of matching until they explicitly enable availability.

Request changes returns only applicant-facing feedback and editable fields. Rejection leaves the account without clinical privileges. Add active/revoked fields to `practitioner_users` and use them in every referral read/write policy. A suspended/inactive practitioner loses clinical access; simply pausing new referrals keeps existing assigned referrals accessible. Identity/registration edits to an approved profile require a new reviewed version; this phase provides a support request, not direct trust-field editing. Availability alone can be toggled by the approved practitioner through a restricted endpoint.

## Referral response and doctor update

`/practitioner` shows only assigned referrals, with awaiting/accepted/declined tabs and an empty state. `/referrals/:id` resolves the signed-in user's permitted doctor or practitioner context and opens that exact referral. Unauthorised and nonexistent referrals have the same unavailable response. Preserve the destination through passwordless login; allow only fixed internal routes, never arbitrary return URLs.

Accept means the practitioner agrees to handle the referral; it does not mean an appointment is booked. Decline requires a reason code (`capacity`, `service_not_offered`, `funding_not_supported`, `other`) and allows a 500-character note visible only to referral participants. No new patient-facing message or clinical attachment is created.

The only new referral transitions are `sent -> accepted` and `sent -> declined`. `accepted`, `declined`, `booked` and `cancelled` cannot be changed through this endpoint. Add `version` to referrals and a request ledger unique by actor/client request ID. Same request/same payload returns the stored response; same request/different payload or a competing decision returns 409.

In one database transaction: validate current actor/link/trust; lock the referral; compare expected version and status; update status/version; append one event with the actual actor and structured decline reason; enqueue one generic notification to the referring organisation's approved notification address. An empty practice address produces a visible configuration-needed state without rolling back a valid clinical response. Replace the current status trigger's event/outbox writing for this path so it cannot emit duplicate events or null actors. Browsers retain no direct UPDATE permission.

Return persisted state to the practitioner before displaying success. The doctor timeline reads `referral_events`, including the response time and decline feedback, rather than constructing a fixed timeline. Refresh on explicit action/window focus and every 30 seconds while the page is visible; clean up timers and ignore obsolete responses after workspace changes. Distinguish saved referral status from pending/delivered/failed email. Delivery does not mean read or accepted.

## HTTP interfaces

Use Edge Functions with a shared allowlisted-origin OPTIONS handler, `Cache-Control: no-store`, bounded JSON body (16 KiB), generic external errors and redacted internal codes. Authorised endpoints validate the bearer session with `auth.getUser()` and current DB role. Public endpoints are token-scoped and rate-limited; enabling OPTIONS alone is not authentication.

| Function | Operations and request contract |
| --- | --- |
| `manage-invitations` | `create {kind, organisationId, recipientName, recipientEmail, consentConfirmed, requestId}`, `resend/revoke {invitationId, expectedVersion, requestId}`, `list {organisationId, cursor}`. Actor/branding/role resolved by server. |
| `invitation-entry` | Public POST `inspect {token}`, `beginSignup {token, termsVersion, privacyVersion, consentAccepted, requestId}`, `decline {token}`. Returns minimal invitation metadata or generic accepted/error result; never auth token or full email. |
| `claim-invitation` | Authenticated POST `{invitationId, attemptId, displayName, requestId}` after email verification. Same actor/result is idempotent. |
| `workspace-access` | Authenticated read returning allowed `doctor`, `practitioner`, `onboarding`, `operator` workspaces and zero clinical content. |
| `practitioner-onboarding` | `save {applicationId, expectedVersion, profile}`, `submit {applicationId, expectedVersion, profileConfirmed, referralConsent, termsVersion}`, `availability {practitionerId, acceptingNewReferrals}`. |
| `review-practitioner` | Operator-only `list`, `detail {applicationId}`, `decide {applicationId, expectedVersion, decision, identityEvidence, registrationEvidence, applicantFeedback, requestId}`. |
| `respond-to-referral` | Authenticated `{referralId, expectedVersion, decision, reasonCode?, note?, requestId}`. Actor from verified session. |
| `dispatch-email-jobs` | Internal POST `{limit: 1..20}` authorised with a rotated worker credential, not an ordinary user session. |

Suggested pilot limits enforced atomically on server: 20 invitation creations per inviter/day; 3 explicit invitation resends per recipient/day; 60-second cooldown and 5 signup-verification requests per invitation/hour. Rate-limit public inspection/decline by a trusted gateway client-IP value and token hash; never trust an arbitrary X-Forwarded-For. If the deployment cannot provide a trusted client-IP, retain token limits and use the hosting gateway's rate limiter before public release. Return 429 with Retry-After. These are configurable product defaults.

## Email queue and failure recovery

Stage 1's server-side email queue carries invitations and verification. Stage 3 drains the existing referral outbox through the same worker using a unique source-outbox ID. No initial message is selected again just because it was sent.

Claim due jobs atomically with `FOR UPDATE SKIP LOCKED`, a two-minute lease and a random lease ID. Only the lease holder can finish the job. Allow one initial send and four transient-error retries after 1, 5, 15 and 60 minutes, within the provider deduplication window; cap at five total sends. A retryable failure releases the lease and returns the job to pending with its next due time. Never regenerate a new token or mutate a payload under the same idempotency key. Missing configuration pauses delivery without counting a send attempt. Resends are explicit new generations. Bounce/complaint/suppression are terminal and checked immediately before send. Remove encrypted invitation and auth credentials from both secret records and email payloads when they are invalidated or expire.

Persist the signed webhook event before matching provider ID, including events arriving before the provider send response is saved. Reconcile unmatched events later and deduplicate by provider event ID. Network timeouts after a possible provider acceptance are ambiguous; retain the same job/key for reconciliation. After 24 hours from first attempted send, move unresolved ambiguous jobs to operator review instead of automatically resending with an expired provider idempotency key.

For hosted operation, schedule the internal worker every minute using Supabase Cron with its secret in Vault; never place the worker key in a public table, frontend bundle or committed SQL. Test worker invocation locally without a live scheduler. The browser flag may expose delivery UI, but the server's delivery-enabled gate, configuration, recipient suppression and permissions are authoritative.

## Acceptance evidence

Use Node behaviour tests for state transitions and email output; real local Postgres/RLS tests for access and atomicity; browser tests for complete role journeys. SQL text matching alone is insufficient evidence of access control. Fixtures use isolated local auth users and fictional practices; use a fake email transport.

Required scenarios:

1. Doctor A cannot invite into practice B or spoof another inviter; referrers cannot grant elevated roles.
2. Pending applicant cannot query the directory, candidate records, another application, referrals or internal email tables through the Data API.
3. Merely loading invitation and confirmation pages performs no mutations or auth exchange.
4. Expired/revoked/rotated/reused tokens and mismatched emails fail; claim/resend/revoke races create at most one application/membership.
5. New email verification completes one signup; existing-user acceptance reuses the account; partial auth failure grants no role.
6. Missing evidence, self-approval, stale review and duplicate registration cannot activate a practitioner; successful activation publishes only approved fields.
7. A paused practitioner disappears from matching but retains existing assignments; a revoked linkage blocks reads and writes immediately despite an existing session.
8. Only the assigned active practitioner can respond; two conflicting simultaneous decisions yield exactly one status/event/job; identical retries are harmless.
9. Doctor detail shows the response without a full reload; the email link reaches the requested detail for both roles after sign-in.
10. Initial referral notification sent, followed by acceptance, sends both once; email failures do not undo a valid response; scans, retries and unmatched webhooks cannot cause duplicate sends.
11. Keyboard operation, labelled errors, focus after navigation, mobile layout and empty default states remain usable.

## Local completion and release inputs

Local completion requires successful functional tests, actual local RLS tests, browser journeys, lint, typecheck and build with fictional fixtures. A missing local DB runtime is an explicit verification gap, not a substitute pass from regex tests. Do not run broad destructive resets against a pre-existing local database; use an isolated test stack/transaction-scoped fixtures.

Release inputs supplied outside code: ReturnWell's actual domain and business/support details; reviewed privacy/terms content and versions; operator account; first practice owner and approved notification address; named approved test recipients; reviewed inviter identities; verified sender and email credentials; hosted auth confirmations/signup/redirect settings; local-vs-hosted migration reconciliation. Save these as operator configuration and document which are missing. No actual accounts, invitations or emails are created merely by approving this document.

## Documentation checked

- Supabase changelog, checked 7 September 2026: https://supabase.com/changelog.md. Relevant planning constraints: no new objects in the managed realtime schema; retain TypeScript 5+; assess local gateway compatibility when running the installed CLI. No provider upgrade is requested here.
- Admin link generation for own email transport: https://supabase.com/docs/reference/javascript/auth-admin-generatelink.
- Verification exchange: https://supabase.com/docs/reference/javascript/auth-verifyotp.
- Email scanner and tracking behaviour: https://supabase.com/docs/guides/auth/auth-email-templates. This informs the user-initiated confirmation screen.
- Sender-domain verification: https://resend.com/docs/dashboard/domains/introduction.
- Provider idempotency lifetime: https://resend.com/docs/dashboard/emails/idempotency-keys. Application retries must not assume permanent provider deduplication.
