# ReturnWell real-data integration and pilot rollout

Date: 2 October 2026, Australia/Sydney.
Status: **proposed design for owner review; not an implementation or launch approval**.
Target: an invitation-only two-doctor pilot during 5–11 October 2026, conditional on the go/no-go gates below. This is a planning target, not a promise of readiness.

## 1. Intended outcome

The user wants the real practitioner research data connected to ReturnWell and a production-quality app ready for users next week. Preserve the previously agreed two-doctor referral-led pilot. Do not widen this to public signup, bulk outreach, a patient portal, payments or clinical AI.

Selected design assumption: real research candidates are admin-only; doctors see only independently verified, provider-confirmed profiles eligible for their referral. The alternative, a doctor-visible unverified research tab, is deferred because it changes the access/product boundary and risks confusion with the referral directory. Loading research files into the browser bundle is rejected.

Success has two separate levels:

1. **Real-data integration:** authorised operators can search and review imported candidates with evidence and provenance; ordinary doctors and anonymous visitors cannot retrieve them.
2. **Real-user pilot:** the approved doctors can refer to a genuinely onboarded, verified receiving cohort, with working mailbox journeys, explicit handover, support and recovery. Importing candidates alone cannot satisfy this level.

## 2. Evidence baseline

- Source baseline: `680f761262665f8270d8493d8c54bf2a2616c9e9`. Previous release verification recorded successful CI, 70 local browser tests, 73 database tests and 23 local authenticated journeys. These are previous release results, not tests of this proposed integration.
- Current read-only hosted checks: 0 practitioner profiles, 0 active profiles, 1 practitioner application, 0 candidate tables, 0 enabled profession policies, 0 verified credentials. The existence of an application is not evidence of approval.
- The preceding local audit found 315 Sydney master candidates, 225 additional NSW candidates and 69 additional broader-allied-health candidates: 609 distinct source IDs and normalised names. Name uniqueness is not verified identity. Exact counts and hashes must be rechecked in the import dry run.
- The broader expansion's full 240-row output overlaps earlier research; do not append it to the 609-record input set. Use its 69-row `new-candidates` output. Separate `needs-review` files are not auto-imported into the accepted candidate set.
- The app already has invitation/claim, practitioner application, independent review, credential freshness, provider confirmation, referral release, location lookup and lifecycle flows. Reuse them.
- The current admin review screen operates on applications, not raw research candidates. The older generator writes browser/public export files and does not match the current database schema; do not run it for this feature.
- Existing source-controlled pilot evidence is unfilled. `validateReleaseConfig({RELEASE_MODE: 'pilot'})` reports 11 missing evidence categories. Do not bypass this check.

## 3. Private import architecture

Add an additive private-schema candidate store, separate from `public.practitioners`, with RLS enabled and no direct anon/authenticated table privileges. Reuse the existing authenticated service boundary and operator checks; do not grant a browser general service access.

Logical records:

- **Import batch:** input digest, format/version, bounded source labels, counts, timestamps and completed/failed status. No raw workstation paths or contact details in ordinary logs.
- **Candidate:** internal UUID, original source ID, observed name, one or more observed profession IDs, observed practice details, provenance and versioned review disposition. Imported records start `unreviewed`, never `active`.
- **Source observations:** original candidate fields, source URLs, collection time when present, practice-level location scope and explicit unknowns. Store structured text/JSON, not executable HTML. Preserve observed claims separately from confirmed fields.
- **Review events:** actor, action, time, expected version, reason and evidence reference. Disposition changes and source-to-application links are auditable; they do not issue credentials or approve applications.

Importer behaviour:

- Explicit local file arguments; no scraping, paid API calls or remote URL fetching during import.
- Validate all inputs and produce a count-only dry-run report before any hosted write. Restrict input size, supported format, field lengths and URL schemes. Treat source text as data, never instructions.
- Recognise the existing single-profession and multi-profession formats. Retain broad allied-health categories without making them selectable for referrals. Unknown taxonomy values are quarantined for review, not coerced to physiotherapy/psychology.
- Match repeat imports by source identity and batch digest. Do not merge two people merely because their name, practice mailbox or postcode matches. Ambiguous identities go to review.
- Re-importing the same batch is a no-op. A changed observation creates a new version; it never overwrites provider-confirmed profile data or an operator decision silently.
- Commit candidate rows, observations and batch counts transactionally. Failed validation writes nothing. Failed database execution cannot leave a batch labelled complete with partial rows.
- After import, verify expected counts, sample provenance and access denial for non-operators. Any unexpected publication, email queue growth or trust-state change fails acceptance.
- Reversal marks a batch withdrawn and hides its candidates from the active review queue; it preserves evidence and audit. Never delete linked applications, credentials or referrals as an import rollback.

Raw datasets, credentials, generated SQL containing real records, and import artifacts stay outside Git, Vercel uploads and public assets. Remove or fail-close the obsolete public-data generator's runnable entry point as part of implementation.

## 4. Operator experience

Add **Candidate review** to the existing administration navigation, with paginated search and filters for observed profession, NSW suburb/postcode and review disposition. Return at most 50 rows per request; counts and pagination must describe the authorised result set, not only the current page.

Each detail view shows source provenance, collection date or “not recorded,” observed practice locations, missing facts and “Unverified research record — not available for referral.” Never show practice addresses as confirmed individual consulting locations, scraped funding as provider-confirmed acceptance, or scraped contact details as proof of account ownership.

Operators can mark a candidate as needing clarification, duplicate, unsuitable, or reviewed for onboarding. Privileged changes require current operator authority, the existing MFA/step-up contract, optimistic version checks, a reason and an idempotent request ID. A review disposition is not professional verification.

Use the current charcoal/red components, native typography, keyboard focus and loading/error/empty states. Render text safely; external source links use allowed HTTPS/HTTP URLs with safe target handling. No new dashboard framework or visual redesign.

No bulk-send button or automatic invitations. Imports and candidate dispositions enqueue no email. Existing individual GP-led invitations still require an independently established contact basis and the existing exact-recipient controls.

## 5. Connection to the verified directory

An operator may link a candidate to an existing practitioner application after checking identity evidence. The link records provenance only: it cannot assign an account, expose referral content, approve a credential, or bypass provider confirmation. Shared practice email addresses are never enough to establish an individual identity.

The practitioner completes the existing application and confirms services, funding, language, age groups, telehealth, intake status and actual consulting locations. The current independent reviewer checks the appropriate authority and approved profession protocol. No researcher/agent-generated flag substitutes for those steps.

Only the existing approval transaction can create/update the live practitioner profile and current credentials. Candidate linkage must not broaden that transaction's authority. Missing/disabled policy, unknown required capability, expired credentials, unconfirmed locations or unavailable intake keep the relevant referral blocked.

Once eligible, existing database-backed directory and matching queries read the real profile without a new hard-coded frontend list. Location uses the already installed NSW reference dataset and explicit patient locality. Display approximate straight-line distance; separate unknown-distance and telehealth-only options. Never infer nearest consulting location from an unconfirmed practice affiliation.

For next week's cohort, activate only professions with an approved protocol and real eligible receiving practitioners. Broader candidate collection remains retained privately; it does not justify enabling all professions at once.

## 6. Verification and failure handling

Required automated acceptance:

- Valid and malformed imports; duplicate batch replay; changed evidence; ambiguous identities; unknown professions; null funding/language/availability; multi-profession records; unsafe URLs and hostile text.
- Transaction failure leaves no completed partial batch; retry does not duplicate candidates or audit events.
- Anonymous, GP, practitioner and revoked-operator sessions cannot retrieve private candidates through direct REST, RPC or Edge Function requests. Operator status never grants clinical reads.
- Stale versions and lost responses reconcile safely; no repeated disposition/link action or notification.
- Linking a candidate to an application does not publish it. Approved credentials plus provider confirmation and all current eligibility checks are still required to appear in matching.
- Source import never changes existing practitioner facts, disables an eligibility check, exposes secrets or queues emails.
- Fresh migration application, baseline referral/invitation regression, synthetic large-dataset pagination, mobile/keyboard UI checks, production build and backend-manifest compatibility.

Hosted acceptance uses the exact deployed revision, an approved test account and a count-only import report. Run access-denial checks and verify source-backed candidate rows in the authenticated operator UI. Do not use real patient content for acceptance fixtures.

## 7. Rollout sequence and dates

Proposed sequence, dependent on design approval and founder inputs:

- **2–4 October:** implementation and local verification of the private importer, admin review and safe application linkage; no activation or outreach.
- **5–6 October:** additive backend release, gated frontend deployment, validated private import, operator acceptance; complete sender/Auth transport and operational configuration with approved inputs.
- **6–8 October:** onboard a small receiving cohort selected with the two doctors; independently approve profession protocols and practitioners; run new/returning mailbox and referral lifecycle acceptance.
- **9 October target:** evidence-based go/no-go for the invitation-only pilot. If critical gates are open, retain private-test mode and reschedule real referral use. Weekend 10–11 October is contingency, not an automatic launch date.

These are planning targets, not a background schedule, work guarantee or permission to send messages. No paid subscription, public release, bulk outreach or broad recipient-allowlist removal is included.

## 8. Real-user go/no-go gates

Before switching from private test to the bounded pilot, require actual reviewed evidence for:

1. Founder-approved business identity, monitored support address, notices, terms and privacy versions.
2. Verified sending domain, approved pilot recipient list and working application email **and** Supabase Auth email. Test sender delivery to the owner's mailbox alone does not establish multi-user readiness.
3. Named independent credential reviewer; approved profession policies; real provider confirmations and eligible profiles covering the doctors' intended referral needs. A large imported candidate count is not this evidence.
4. Qualified clinical/privacy/retention approval and a documented external handover process. Existing patient references and clinical summaries must not be described as anonymous data.
5. Named support/incident owner, monitored failures and a successful alert acknowledgement test.
6. Approved backup/recovery objectives and a safe hosted recovery/rollback rehearsal with email quarantine. Do not restore over production or buy a paid capability without explicit approval.
7. Direct Auth abuse review and complete new-user/returning-user/wrong-account/forwarded-link acceptance. Provider delivery receipts do not prove inbox placement or that the practitioner completed the journey.
8. Exact source SHA, backend/migration compatibility, no unresolved critical access/data-loss/duplicate-send issue, and explicit owner/clinician pilot sign-off.

The existing release gate stays authoritative. Populate evidence references only after the underlying work is completed and approved. Public rollout remains a separate decision.

## 9. Owner inputs required now

- Confirm the pilot date and two doctor practices, plus a small receiving-practitioner cohort and independent reviewer. Do not post patient details or secrets in chat.
- Provide/confirm the ReturnWell legal business name, sending domain, monitored support address and person with DNS access. Credentials belong in the relevant secret manager, not this document.
- Identify who will approve clinical/privacy/retention decisions and own incidents/recovery.

Missing owner inputs do not prevent local implementation after design/plan approval; they do prevent claiming launch readiness or enabling real patient use.

## 10. Review and handoff

This document proposes the production design, including admin-only visibility. It does not claim code has been written, candidates imported, practitioners approved, mail sent or launch gates closed.

After written-design approval, create the executable implementation plan with exact files, migrations, tests, import dry-run acceptance and release checkpoints. Execute sequentially to control cost. Do not rebuild the referral system or reopen the UI theme as part of this integration.
