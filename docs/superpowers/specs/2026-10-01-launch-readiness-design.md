# ReturnWell launch-readiness design

Status: **proposed for review; planning only**. Written 1 October 2026.
No implementation, deployment, migration, send, paid integration or launch is
authorised by this document. It records the recommended scope for the user's
request to plan all fixes. The linked plans become executable after review.

## 1. Intended outcome and scope

Make ReturnWell dependable for an invitation-only NSW GP/allied-health pilot:
known people can join, prove identity/credentials, exchange a referral, respond,
arrange the external handover and understand what remains to be done. New
accounts start empty. Operators can support the service without reading clinical
records merely because they are operators.

Three approaches considered:

- Cosmetic polish alone: insufficient; unresolved workflows and operational
  gaps would still block use.
- **Complete referral coordination (recommended):** consistent UI, useful
  matching, verified directory, explicit handover/closure, reliable accounts/mail,
  access controls and an operable release process. This design selects it.
- Patient portal/EHR/calendar/clinical AI: a separate product expansion with new
  data, consent and integration boundaries; not needed to fix this MVP.

“All fixes” means all 25 work packages in the master plan, including external
launch gates. It does not mean enabling unsupported features or certifying that
no unknown defect exists. Booking stays external, but recording the outcome of
coordination is included. AI diagnosis/ranking, calendar integration, billing,
patient self-selection, attachments, bulk scraping and cold outreach are excluded.

The user's request for broader allied health is included: remove the two-value
profession assumption, catalogue the profession scope and implement separate
credential routes. A category is selectable only after its verification protocol
and an eligible cohort are ready. Never call non-AHPRA credentials AHPRA verified.

## 2. Evidence baseline and uncertainty

Source reviewed: current dirty checkout `/Users/ReturnWellMvp/prototype`.
Last recorded live acceptance: [1 October ledger](../2026-10-01-private-acceptance-progress.md).
That ledger is earlier same-day evidence, not a new hosted inspection in this
planning pass. Recheck it before execution/release.

Already implemented/tested; preserve rather than rebuild:

- Mailbox-bound invitations, independent review, RLS, response transactions,
  queue leases, stable mail keys, suppression and signed webhook deduplication.
- Server-stamped consent and ambiguous-save reconciliation are live according
  to the ledger, deployment `dpl_7oQ9NL8Hu9qwg4ZSpnHKw3Qwb4MQ`.
- Existing-account invitation → real verification → unsubmitted profile draft
  passed live. Two app emails reached Gmail Spam, not Inbox.
- Last recorded checks: 52 standard tests passed, 2 opt-in skips, 20 local
  integration tests and 27 disposable DB tests passed. Not rerun for this plan.

Confirmed source gaps:

- `types.ts` and profile validation only allow physiotherapist/psychologist.
- `matching.ts` never receives patient postcode; loader supplies null distance.
- `languageOrAccess` is used as an exact language filter despite its wider label.
- GP overview advertises booked outcomes; response endpoint only accepts/declines.
- Referral form is memory-only; no server draft, cancellation/closure or linked
  re-referral journey exists. Patient handover is merely guidance text.
- Invitation list lacks safe delivery summaries and displays signup wording
  without distinguishing new-user creation from existing-account acceptance.
- Plain profile/review forms have only limited field-specific recovery. Current
  client error handling flattens structured status and Retry-After information.
- Directory/referral reads load full authorised lists without explicit pagination.
- No `.github` CI directory or application error-boundary file was found in this
  checkout. These are source observations, not proof no external CI exists.
- Release code is not captured by a new Git SHA; unrelated dirty research/UI work
  remains. Source provenance and documentation need reconciliation.
- A fresh `npm audit --json` in this pass reports 10 findings: 8 moderate, 2 high
  (`brace-expansion`, `undici`). Runtime reachability remains unassessed.

Still external/unknown: final legal identity/notices, sender domain and mailbox,
production Auth transport, approved clinician cohort, postcode-data licence,
incident owner, retention decisions, backup/restore capability and launch scale.

## 3. Global constraints

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

These exact constraints apply to all four implementation plans.

## 4. Product behaviour

### 4.1 Shared interface and accessibility

Keep the established charcoal/red design system. Build a small shared layer for
page headings, fields, buttons, loading/empty/error states, status text, confirmation
dialogs and support links. Do not build a new component framework or rearrange
everything for appearance. GP, practitioner, invitation, review, account and
policy screens use that layer.

Target WCAG 2.2 AA, measured rather than claimed from a theme: visible keyboard
focus, errors connected to controls, logical headings, status announcements,
non-colour status labels, reduced-motion/transparency support and usable zoom.
Use 44px touch controls as a product preference. Check 320/375/768/1024/1440px,
200% zoom, long names, large text, empty and populated views. Glass/blur stays
decorative; important text has opaque readable surfaces.

### 4.2 GP draft and submission

Explicit **Save draft** to a creator-scoped server record; never persist clinical
content in localStorage/sessionStorage. Drafts need no patient consent assertion
and produce no email. Warn before discarding unsaved work. Keep legacy
`language_or_access` readable; new inputs separate preferred language from access
notes so “wheelchair access” cannot be treated as a language.

Finalisation rechecks eligibility and explicit current consent transactionally.
Use the draft UUID as the eventual referral UUID, retain one finalisation request
ID and reconcile uncertain outcomes. A retry cannot change the payload of an
earlier uncertain save. A server draft permits recovery after reload without
retaining patient content in browser storage. Creator/organisation switches must
not restore another person's draft. Existing direct-create clients continue to
work during a backwards-compatible transition.

Field limits for new work: patient reference 120, clinical summary 4000, access
notes 500 characters; postcode remains a four-digit string. Confirm existing DB
limits before migration; do not truncate historical records. Unknown geography
does not mean an invalid postal address. Show field errors before review.

### 4.3 Referral lifecycle and handover

Canonical states for new records: `sent`, `accepted`, `declined`, `cancelled`,
`closed`. Retain legacy `booked` rows as “Previously recorded as booked”; no new
booking automation or manufactured appointment statistics.

- Assigned practitioner: `sent -> accepted|declined` (existing contract).
- Active referring-practice member: `sent|accepted -> cancelled`, with reason.
- Active referring-practice member: `accepted -> closed`, with outcome
  `handover_completed|no_longer_required|unable_to_arrange` and optional 500-char note.
- `declined|cancelled` may start a **new linked draft**. The old record is immutable;
  new practitioner selection and fresh consent are required. No automatic rerouting.
- Other transitions return a conflict. Racing acceptance/cancellation produces
  exactly one winning event/state and does not silently overwrite the other.

Cancellation invalidates unsent inappropriate initial notifications; queued
messages are checked against current state before provider send. If the original
email already went out, retain it in history and enqueue one generic update.

Keep patient contact/booking outside the application for this launch. Add an
independently reviewed practice contact (work telephone and/or secure handover
instructions) accessible only to referral participants. After acceptance both
roles see who arranges the handover and the next action. No patient identifiers
or clinical summaries go in mailto links, email templates or analytics. This
choice requires pilot-clinician validation; it is not a complete e-referral/EHR claim.

### 4.4 Onboarding, review and practice administration

Onboarding becomes a guided form with explicit Save draft, completeness checks,
profession-appropriate credentials and useful field errors. Preserve edits on
version/notice conflicts; fetch the saved version for comparison rather than
overwriting. An unsubmitted draft is never presented as approved.

Use independent identity and credential review; forbid self-approval. Reviewed
profile updates use a new application/version, not direct edits of trusted data.
Pause intake when a material eligibility change is under review. Existing
assignments stay readable when intake is merely paused or routine review is due;
explicit access suspension is a distinct audited operator action. Expired/failed
credentials block new assignment and acceptance, while necessary historical reads
remain available unless access is suspended. Safety/access suspension policy must
be approved before pilot; these separate gates need explicit tests.

Provide operator-facing practice setup, reviewed contact/inviter identity,
membership invitations and explicit revocation. No self-service elevation to
operator/owner. Operator role alone must still not grant clinical reads.

### 4.5 Professions, credentials, matching and geography

Create one versioned profession catalogue, reused by frontend and backend. Start
with an inventory of all existing research taxonomy IDs, reconcile with official
AHPA/AHPRA sources, and mark each `supported`, `review_required` or `out_of_scope`.
Research classification is evidence to review, never the activation rule.

Generic credential records carry profession, authority, route
`ahpra|professional_body`, identifier, status, checked time, expiry when supplied,
review-due time, reviewer and private evidence reference. Provider confirmation
is separate. Migrate existing AHPRA fields additively; never translate an unknown
credential into verified. Review intervals are operator-approved policy data,
not a hard-coded legal rule. Missing protocol/review date blocks new activation.

Hard matching requirements: supported requested profession, current verified
credential for that profession, confirmed provider profile, intake enabled,
requested delivery format and provider-confirmed funding; selected service,
age group and language must match when the GP requires them. Clinical free text
is not interpreted or scored. Unknown required capability is not a match.
Funding badges mean provider-confirmed acceptance, not patient rebate eligibility.

Use explicit IDs/labels/aliases for profession, funding, language and service.
Do not silently auto-map ambiguous free text. Render reasons and unknowns; never
“AI best match” or a fabricated match percentage. Stable ordering: known geographic
distance, then normalised display name, then ID; pure telehealth uses name/ID.
For “either”, keep local/in-person and remote-only options visibly distinct.

Geography: licensed/versioned postcode/suburb reference data; straight-line
postcode-centre approximation, not driving time or exact patient location.
Record source/version/precision. Compute against all approved practice locations,
not only the first. Unknown coordinates are null, never 0km. With a radius
filter, separate “distance unavailable” from in-radius matches. If source rights
are unresolved, ship truthful suburb/postcode browsing with distance disabled;
that is a blocked distance feature, not a completed distance fix.

Server-side paginated queries return at most 50 authorised projections per page;
cursor sort uses an ID tie-breaker. Clinical list counts must come from authorised
server aggregates, not the size of the currently fetched page. No 5,000-row
public bundle or client download; use 5,000 synthetic rows for scalability testing.

### 4.6 Accounts and email

Keep invitation claim separate from account creation. Label new and returning
recipients correctly, show expiry and progress, and never claim opening an email
proves delivery/read/acceptance. Invite rows show the actual latest generation's
safe delivery summary; do not expose the private jobs table.

Preserve passive email landing pages and explicit verification. Expired/revoked/
already-claimed links have useful recovery, but cannot resend to a substituted
email. A consumed verification token plus failed claim must recover using the
same authenticated claimant/attempt without a second account. Preserve only
allowlisted internal destinations; session changes clear sensitive UI.

Keep existing one-minute worker, leases, encryption and stable keys. Add typed
errors with Retry-After handling; do not retry arbitrary mutations automatically.
Provider timeout after acceptance remains uncertain. Persist signed callbacks
durably before 2xx; do not adopt examples that acknowledge before persistence or
log raw email/webhook payloads. Operator tools may inspect redacted status, not
force-send uncertain jobs under a new key.

Use consistent, accessible HTML plus text mail, restrained red branding, one
action, real support and no promotional/clinical content in verification emails.
Configure both **application Resend delivery** and **Supabase Auth SMTP** with
the founder's verified sender; they are different transports. No second provider
or AI service is required for this plan. Use the provider's actual DNS values.
Domain authentication helps but is not proof of inbox placement.

### 4.7 Security, operations and release

- Reconcile the tested release with source control before larger changes. Commit
  only reviewed scope; exclude private exports/secrets. Pin build inputs and
  record actual deployment identity. Review rollback compatibility first.
- Assess dependency advisories against runtime traces and build-tool exposure;
  update narrowly and test. No force-fix downgrade of Drizzle or blind framework rewrite.
- Test tenant isolation, revoked membership, privilege escalation, unauthorised
  direct RPC/REST, stale role state, replay and cross-tab leakage with real local
  Auth/PostgREST, not mocks alone. Add operator MFA/step-up and enforce it server-side.
- Add route-level crash recovery, trusted public-endpoint abuse controls, safe
  headers/cache policy and redacted observability. Do not place a rate limit only
  on Vercel if direct Supabase calls bypass it. Password-protection warnings must
  be resolved or explicitly justified for the configured passwordless surface.
- Establish owner-reviewed legal identity, notices, data inventory, retention,
  access/correction/deletion, processor/region review and incident response.
  Patient references plus clinical summaries are not anonymous just because names
  are omitted. Keep the private-test label until actual release gates pass.
- Named owner, queue alerting, support process, backup/restore rehearsal and a
  deployment rollback rehearsal. Recovery objectives require founder approval;
  do not invent an SLA or claim Sydney compute means all processing stays there.
- Gate release on real new-user and returning-user journeys, independent approved
  clinician participation, email receipt and callbacks, desktop/mobile recovery,
  and tested cancellation/re-referral/closure. Then a bounded monitored pilot;
  public rollout is a separate decision.

## 5. Architecture and task boundaries

Retain React/Vinext, Supabase Auth/Postgres/Edge Functions and Resend. Add focused
shared contracts rather than another state-management framework. SQL mutations
remain transactional behind authenticated Edge handlers and service-only RPCs;
pure presentation/matching helpers remain testable without external services.

Four independently reviewable plans implement this design:

1. `launch-01-app-workflows`: shared UX, drafts, lifecycle, handover and role tools.
2. `launch-02-directory-matching`: taxonomy, trust, profile changes, filters, geo and scale.
3. `launch-03-email-accounts`: safe status, recovery, templates, dispatch hardening and SMTP.
4. `launch-04-security-release`: reproducible inputs, security, operations and acceptance.

Start with release/test baseline D1. Shared UI A1 and taxonomy B1 can be prepared
independently; implement cross-layer trust B2 before enabling wider professions.
Complete code locally before any separately approved migration/deployment.

## 6. Sources and design influence

Checked 1 October 2026; recheck provider APIs during execution.

- [Supabase Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp): its default
  mail service is not a production transport. Configure returning-user Auth separately.
- [Resend with Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp):
  use the existing provider for that transport rather than adding another service.
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys):
  retry within the provider's 24-hour key window; ambiguous older attempts need review.
- [Resend test-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain):
  the default domain is not the multi-recipient pilot sender.
- [AHPA regulation](https://www.ahpa.com.au/allied-health-regulation) and
  [AHPRA professions](https://www.ahpra.gov.au/Registration/Registers-of-Practitioners/Professions-and-Divisions.aspx):
  credential routes cannot be one AHPRA boolean for all allied health.
- [ABS Postal Areas, Edition 3](https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/non-abs-structures/postal-areas):
  postal areas are approximations; choose a current licensed release at execution,
  not this older edition by default or a scraped geocoder.
- [WCAG 2.2 reference](https://www.w3.org/WAI/WCAG22/quickref/): measurable keyboard,
  contrast, reflow, form and authentication checks rather than a compliance claim.
- [OAIC health-service guidance](https://www.oaic.gov.au/privacy/your-privacy-rights/health-information/what-is-a-health-service-provider):
  qualified privacy review is a launch gate, not replaced by this technical plan.
- [Supabase PostgreSQL upgrade notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes):
  inspect actual database/extensions before any upgrade; do not assume applicability.

The UI/UX skill informed accessibility/recovery checks; its generic cyan/waitlist
suggestion was rejected because it conflicts with the user's red working-app
direction. Supabase guidance informs RLS/privilege and migration checks. Email
guidance informs transport separation, idempotency and receipt verification, but
ReturnWell's stricter no-clinical-logs and durable-webhook rules take precedence.
