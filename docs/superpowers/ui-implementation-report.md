# UI implementation report — 7 September 2026

Implemented API-connected invitation/signup, practitioner application/review and referral response screens. Defaults remain empty; the existing doctor preview retains explicit fictional-demo loading. No hosted mutations, accounts, emails or production configuration were performed by this worker.

## Files

- `app/auth-gate.tsx`: workspace-access resolution, explicit role/practice chooser, safe login destination, stale async result protection, state clearing on sign-out, same-user auth refresh preserving unsaved forms.
- `app/lib/supabase.ts`: disable automatic URL credential exchange on explicit `/auth/confirm` route.
- `app/lib/workflow.ts`: typed endpoint contracts, public invitation transport, structured errors and safe internal destinations.
- `app/workflow-shell.tsx`, `app/globals.css`: shared responsive forms, readable states, keyboard focus and navigation.
- `app/join/page.tsx`, `app/auth/confirm/page.tsx`: token inspection without mutation; explicit consent/signup, decline, verification and claim; explicit sign-out when an account is already active; credential fragment cleared after successful claim.
- `app/invitations/page.tsx`, `app/invitations-panel.tsx`: known-recipient consent, server-authored exact preview, create/resend/revoke and signup progress. Preview uses `[secure invitation link]` for the unique credential. Missing preview configuration retains the form and disables creation.
- `app/onboarding/page.tsx`, `app/onboarding-panel.tsx`: private draft, explicit unknown/yes/no answers, editable locations, draft save, current legal consent and submission, locked submitted state, feedback and saved-version comparison retaining local edits.
- `app/admin/practitioners/page.tsx`, `app/review-panel.tsx`: operator list/detail/history, independent-contact and current-register evidence, review decisions and applicant-visible feedback.
- `app/practitioner/page.tsx`, `app/practitioner-panel.tsx`, `app/practitioner-profile.tsx`: assigned-only inbox, approved profile, availability toggle, accept/decline and participant-only decline note. Uncertain responses retain operation IDs for retries; persisted response status is shown separately from email state.
- `app/referral-activity.tsx`, `app/doctor-portal.tsx`: actual event timeline, manual refresh, focus refresh and visible-page 30-second polling with cleanup and stale-result guards. Existing doctor deep link and preview retained.
- `tests/ui-workflow.test.mjs`, `tests/ui-routes.test.mjs`: five API/helper behavior tests and a six-route SSR smoke test.

## Verification

- `npm run typecheck`: passed.
- `npx eslint app tests/ui-workflow.test.mjs tests/ui-routes.test.mjs --no-warn-ignored`: passed without warnings.
- `npm run build`: passed, all six new routes included plus `/referrals/:id`.
- `node --test tests/ui-workflow.test.mjs tests/ui-routes.test.mjs tests/rendered-html.test.mjs`: 11/11 passed.
- Initial regression found by existing SSR tests: checking state replaced the signed-out landing content. Corrected to server-render the signin form disabled until auth resolution.
- Cross-layer read found SQL uses `locations[].isPrimary`; UI was corrected to that exact key. Evidence method and decision names confirmed with root.

## Integration notes and remaining verification

Application load must return `current_terms_version`, `current_privacy_version`, `current_terms_url`, `current_privacy_url`. Submission is disabled if legal links are missing. The current versions and links are retained across draft saves. Invitation exact preview expects `manage-invitations` operation `preview` -> `{subject,text}`; root agreed this extension.

These initial checks established local compilation, server rendering and helper behavior only. Subsequent real Auth/RLS and authenticated browser evidence is recorded below and supersedes this initial verification limitation.

## Follow-up UI/runtime review

Compared UI against `_shared/workflow-http.ts` and `runtime.ts`. Invitation inspect metadata and legal link field names match. Corrected these frontend issues:

- Doctor success and participant timeline now read the structured notification list, not a client delivery flag or a generic success response. Both timelines distinguish pending, sent, delivered, configuration, suppressed, failed and review-needed states. A visible Check delivery action is read-only.
- Verify action validates complete fragment context before consuming an OTP, rechecks existing session at click time and binds an in-page claim retry to the user verified in that attempt.
- Current legal version changes reset consent during saved-version reconciliation; terms-changed responses explicitly instruct the applicant to reread and reconfirm.
- Services/funding/language edits are controlled text fields, so pressing Enter submits the latest text without relying on blur.
- Operator invitations gain an explicit known-practice chooser using `workspace-access.invitationOrganisations`. Doctor invitations remain unavailable until a reviewed practice is selected.
- A paused/hidden assigned profile is labelled unavailable rather than falsely unassigned. Root was informed that SQL directory visibility can hide the joined name from doctors.
- Activity components remount per referral to prevent showing the previous referral's events while a new detail loads.

Verification after the main fixes: typecheck and app/UI-test lint passed; build and 14 UI/helper/SSR tests passed. Subsequent small operator-chooser/Check-delivery additions are included in root's final validation.

Initial browser skill verification used `http://localhost:4187` with both public backend environment variables explicitly empty, so no hosted/provider calls were possible. Verified signed-out entry, empty workspace, explicit fictional demo loading, clearing that demo back to zero, passive confirmation with disabled verification when backend is absent, and missing invitation's unavailable message. Mobile invitation viewport was 390px with 390px document width (no horizontal overflow). Chrome extension-added DOM attributes caused hydration warnings; no application exception was observed. Authenticated browser verification was subsequently completed as described below.

## Isolated real Auth / HTTP / RLS journey

Added `tests/local-journey.test.mjs` and `tests/helpers/local-runtime.mjs`. The opt-in harness rejects any API origin except the explicitly identified local stack, invokes production `workflowHandler` with a real local Supabase adapter, and never calls an email provider. Real Auth admin-generated signup/magic links and real `verifyOtp` establish sessions; browser-role PostgREST requests enforce actual RLS.

Run against `returnwell-integration` at API 55321: 13/13 tests passed (12 subcases and parent). Evidence covers existing doctor and new practitioner invitations, mailbox verification, wrong-user rejection, idempotent claims, draft access isolation, stale version/legal consent, submission/review evidence/approval, doctor referral creation, assigned-only practitioner access, accept/decline/retry/concurrency, actual doctor timeline, participant-only notes and clinical email exclusion, and paused/revoked access. The first run exposed missing service-role column access to `auth.users`; root repaired the migration and the rerun passed without fixture grants.

Added `tests/helpers/local-browser-fixtures.mjs` and `tests/helpers/local-browser-server.mjs` for reproducible fictional browser smoke. Sign-in links are written only to the private isolated stack artifact, never the repository or console. The existing application runs at `http://127.0.0.1:3000` with explicitly local public configuration. Vinext requires `--hostname` (not `--host`) for IPv4 binding.

The first authenticated browser attempt established successful real doctor magic-link sign-in, preservation of the `/referrals/:id` deep link, safe workspace-error presentation and working sign-out, but hit local Edge HTTP 503 `BOOT_ERROR`. Root resolved the Colima filesystem-sharing issue by staging the local function runtime in a shared cache. This historical boot blocker is resolved; the final browser evidence below supersedes it. No session injection or hosted/provider calls were used. Lint passed for all four local harness/helper files. Fictional fixture rows remain only in the disposable isolated stack.

## Final authenticated browser verification

Using the browser skill and genuine local Auth magic links against the existing application at `http://127.0.0.1:3000` with actual locally served Edge entrypoints:

- Doctor sign-in preserved the exact referral deep link and opened the real fictional referral detail: practice identity, patient reference, clinical summary, assigned practice, created timeline event, Email pending and read-only Check delivery.
- Practitioner sign-in opened the assigned inbox; selecting the referral showed its detail and response controls. Clicking Accept referral persisted the response, removed accept/decline controls, displayed accepted status/event and a separate pending-notification state. The UI explicitly said acceptance does not mean an appointment is booked.
- Operator sign-in opened the submitted application queue. Application detail displayed the saved profile, independent-contact/register evidence inputs, decision controls and review history. No review decision was submitted in this browser smoke (approval is covered by the real HTTP/RLS journey).
- Operator Manage invitations opened the known-practice selector. Doctor invitations were absent in the default operator context and became available after selecting the reviewed Fictional Browser Practice. No invitation was created or sent in this smoke.
- A fresh doctor sign-in to the same deep link showed Accepted and the practitioner’s accepted timeline event, while both notification records remained Email pending. Manual Refresh worked. The test ended signed out.

This establishes the locally authenticated doctor/practitioner/operator screens and an actual browser closed loop through acceptance. It does not claim hosted deployment, external email delivery, an exhaustive browser suite or browser coverage of every onboarding/decline path. Those state transitions have separate local integration-test coverage.
