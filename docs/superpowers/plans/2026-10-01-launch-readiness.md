# ReturnWell Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete every identified product, reliability and operational gap required for an invited NSW referral-coordination MVP.

**Architecture:** Keep the current stack and verified safety boundaries. Implement four reviewable workstreams, starting with reproducible release inputs; expand trusted data and transactional workflows before enabling their UI. Code completion and launch approval are separate gates.

**Tech Stack:** Existing pinned React 19.2.8, Vinext 1.0.0-beta.9, TypeScript 5.9.3, supabase-js 2.114.0, Postgres/Edge Functions, Resend and Vercel. Versions are a baseline, not an instruction to retain a vulnerable dependency.

**Spec:** [Launch-readiness design](../specs/2026-10-01-launch-readiness-design.md).

Status: **local implementation verified; external launch gates open**, under the approved [two-doctor pilot plan](2026-10-01-two-doctor-pilot.md). Work is isolated on `codex/pilot-readiness`; it is not deployed or approved for real referrals. D1/D2, A1–A7, B1–B4/B6 and C1–C4 now have fictional local evidence. D3–D6 code includes privileged MFA, response headers/CSP, source-controlled pilot gates, privacy-safe queue health and restore quarantine. Fresh canonical database restore, current-role/account recovery and cross-tab/module interruption are locally tested. Three Important independent-review findings are corrected and covered by regression tests; one minor cleanup item is documented. B5, C5, hosted Auth abuse/secret checks, qualified notices/retention/RPO/RTO, alert owner/destination, hosted rollback and D7 human/served-release acceptance remain open. [Current evidence and gates](../launch-acceptance-matrix.md) distinguishes automated local checks from pending founder/hosted work. No hosted changes or real email sends.

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

- Lost mutation response after a commit: A2/A3/C4 must recover without duplicate referrals or emails.
- Revoked/cross-role accounts and delayed old responses: A5/A6/B2/D3 must neither leak records nor retain usable stale controls.
- Missing credentials/geography/capability: B1–B5 must show unknowns or exclude ineligible records, never manufacture suitability.
- Expired/consumed/forwarded links: C2 must recover the legitimate claimant without bypassing mailbox proof.
- Small screens, keyboard, offline and stale builds: A1/A7/D7 must provide an accessible recovery route without data loss or disclosure.

## Read this first

This is a plan for **all known fixes**, not a promise that every possible feature
is necessary. The existing referral product remains the scope. Patient booking,
patient identifiers/contact management, attachments and AI are not silently added.
Broader allied health **is included**, but each credential route must be validated
before a profession is activated. No new scraping/import is needed for these fixes.

Prior same-day acceptance is recorded in
[the evidence ledger](../2026-10-01-private-acceptance-progress.md).
Those passing results are regression baselines, not new test runs in this pass.
Fresh planning checks: source audit, missing checkout CI directory, and npm audit
with 8 moderate/2 high findings. Dependency exposure is not yet determined.

## Work packages — recommended order

| ID | Fix / deliverable | Dependency | Priority | Completion evidence |
| --- | --- | --- | --- | --- |
| D1 | Reproducible source, isolated fixtures and CI | User plan approval | P0 | Clean build from reviewed Git input; local browser tests run in CI |
| A1 | Shared red UI, fields, states, mobile/accessibility | D1 | P1 | Same components across roles; keyboard/viewport checks |
| B1 | Full profession catalogue and controlled terminology | D1 | P0 | Every research profession classified; no two-profession fallbacks |
| B2 | Generic credential verification and eligibility/RLS | B1 | P0 | Authority-aware approval; cross-role/expired credential tests |
| B3 | Profile revisions, freshness and suspension | B2 | P0 | No direct trust edits; reviewed updates and expiry handling |
| B4 | Explainable matching with separate access notes | B1/B2 | P1 | Hard-filter cases and stable ordering proven |
| B5 | Licensed postcode reference and honest distance | B4, source licence | P1 | Known/unknown/multiple-location/remote cases pass |
| B6 | Paginated directory/referrals and scale | B4/B5 | P1 | 5,000 synthetic profiles; bounded queries and correct counts |
| A2 | Server drafts, validation and safe finalisation | A1/B1 | P0 | Reload, conflict, double click and lost-response tests |
| A3 | Cancel, close and linked re-referral | A2/B2 | P0 | Valid transition matrix, atomic audit and race tests |
| A4 | Reviewed practice contact and external handover | A3/A6 | P0 | Both participants know next action; unrelated users denied |
| A5 | Guided onboarding/review with useful recovery | A1/B2/B3 | P1 | Save, compare, submit, feedback and approval gates |
| A6 | Operator practice/member administration | A1/B2 | P0 | Reviewed identities; no self-elevation or clinical access leak |
| C1 | Actual invitation/signup/delivery progress | A1 | P1 | New vs existing claim and every delivery state shown accurately |
| C2 | Account/link/session recovery | C1 | P0 | Expired, consumed, replayed and wrong-account tests |
| C3 | Consistent accessible email templates | A1/C2 | P1 | HTML/text parity, escaping, mobile/inbox rendering |
| C4 | Queue hardening and safe operator diagnostics | C1/A3 | P0 | Timeouts, Retry-After, lease loss, event reordering and suppression |
| C5 | Domain + production Auth SMTP + inbox acceptance | C2/C3/C4, founder | P0 external | Both transports tested with approved new and existing recipients |
| A7 | Complete cross-role UX/error recovery testing | A1–A6/B6/C1/C2 | P0 | Browser happy/negative journeys; mobile and keyboard evidence |
| D2 | Dependency/runtime exposure remediation | D1 | P0 | Advisory inventory, targeted fixes, both builds and runtime traces |
| D3 | Auth/RLS/abuse/headers/secrets hardening | B2/A3/A6/C2 | P0 | Permission matrix, server MFA and bypass/replay checks |
| D4 | Real identity, privacy, support and release configuration | Founder/legal review | P0 external | Signed-off notices/data map; unsafe mode cannot be enabled |
| D5 | Redacted monitoring and incident ownership | C4/D3 | P0 | Forced failure reaches a named owner without sensitive logs |
| D6 | Retention, backup/restore and rollback rehearsal | D1/D4 | P0 external | Recorded restore/recovery result within approved objectives |
| D7 | Final candidate, real pilot and launch sign-off | All packages | P0 | End-to-end evidence on exact promoted artifact; explicit go/no-go |

P0 = blocks a real-user pilot if unresolved. P1 = required product quality in this
plan; a narrower launch would require an explicit scope change, not silently
checking the item complete. External means code alone cannot close the gate.

## Detailed plans

- [01 — App workflows and consistent UX](2026-10-01-launch-01-app-workflows.md): A1–A7.
- [02 — Directory, verification and matching](2026-10-01-launch-02-directory-matching.md): B1–B6.
- [03 — Email and account journeys](2026-10-01-launch-03-email-accounts.md): C1–C5.
- [04 — Security, operations and release](2026-10-01-launch-04-security-release.md): D1–D7.

Dependencies, rather than file order, determine execution. D1 starts first; D2
can follow it while external domain/legal work is pending. No hosted deployment
is needed to complete most local tasks.

## Founder / operator decisions needed, with recommended defaults

| Decision | Recommended plan assumption | When it blocks |
| --- | --- | --- |
| Pilot scope | Invitation-only NSW referral coordination; booking external | Approve design before execution |
| Allied-health scope | Catalogue every research category; enable only reviewed protocols/cohorts | B1/B2 activation; no blanket AHPRA claim |
| Patient handover | Reviewed practice contact; no patient name/DOB/contact stored in this release | A4 acceptance and clinical pilot |
| Sending identity | Owned domain, monitored support/reply address, Resend for app and Auth SMTP | C5 |
| Postcode data | Lawfully usable versioned reference; no paid Google integration by default | B5; no invented distance fallback |
| Credential freshness | Review protocol/interval per authority; fail closed when missing/expired | B2/B3 activation |
| Data governance | Qualified approval of notices, retention, processors/regions and incident procedure | D4/D6 |
| Pilot participants/scale | Named consenting GP, independently reviewed practitioner and one new account | D7; actual target load set before release |
| Recovery targets/budget | Founder approves RPO/RTO and any paid backup/monitoring capability | D5/D6 |
| Launch authority | Explicit approval of exact artifact, migration set, recipients and rollback | D7 |

No artificial date estimate: time depends on these external decisions and the
defects found in the new tests. The sequence and acceptance criteria are fixed;
calendar commitments come after the first baseline/security pass.

## Definition of done

- [ ] All 25 task deliverables have passed their named tests or have an explicit user-approved scope change.
- [ ] Every active profession has a reviewed credential protocol and genuinely eligible practitioners.
- [ ] A new and an existing recipient finish the actual received-email journey.
- [ ] GP/practitioner complete referral, response, handover and closure; decline/cancel/re-referral work.
- [ ] Spam observations are resolved/retested for the pilot; provider delivery alone is not acceptance.
- [ ] No open P0, reachable high/critical vulnerability, unexplained permission failure or sensitive logging.
- [ ] Accessibility, mobile, offline, concurrent edits and ambiguous-save paths pass on the release candidate.
- [ ] Notices, support, retention, backup/restore, incident owner and rollback are ready.
- [ ] Source SHA, migration history, function versions and served deployment are recorded and reproducible.
- [ ] Founder/clinical pilot sign-off is recorded before real clinical use; public rollout is separately authorised.

## Execution and cost control

Recommended execution: **native, one package at a time**, reuse the existing local
Supabase fixtures, run focused tests per task and full suites at integration
gates. A fresh independent review before release should cover permission,
credential and referral transactions. Do not start parallel paid crawls, LLM
matching or new hosted projects. Commit reviewed task scopes rather than the
dirty workspace wholesale. Subagent-driven execution is an alternative if the
user prefers per-task independent reviews and the additional context cost.

## Plan review outcome

Self-review completed: each design section maps to an owner task; all five review
focus areas have named negative tests; cross-plan interfaces and dependencies
are defined; completed safeguards are retained; outside authority is explicit.
The new design choices remain proposals until the user reviews this pack.
