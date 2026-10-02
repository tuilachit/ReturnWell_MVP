# ReturnWell Real-Data Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native, sequential execution is recommended here to control cost and preserve cross-layer context; the user must select the execution method after reviewing this plan.

**Goal:** Import the existing research into a private, auditable candidate-review workflow that connects to verified practitioner onboarding without publishing or activating scraped profiles.

**Architecture:** Add private Postgres candidate/provenance tables and a service-only transactional import RPC. Extend the existing `review-practitioner` Edge Function and `rw_workflow` dispatcher for operator-only reads and reviewed mutations; retain the existing verified-directory and onboarding authority. The local CLI never places real records in the frontend, Git or deployment artifacts.

**Tech Stack:** Existing Node.js 24 release runtime, React/Vinext, TypeScript, Supabase/Postgres, Node test runner and Playwright. Reuse pinned dependencies; no AI, scraping, new SDK or paid service.

**Spec:** [Approved real-data rollout design](../specs/2026-10-02-real-data-rollout-design.md).

## Global Constraints

- “real research candidates are admin-only; doctors see only independently verified, provider-confirmed profiles eligible for their referral.”
- “Imported records start `unreviewed`, never `active`.”
- “Return at most 50 rows per request.”
- “Imports and candidate dispositions enqueue no email.”
- “Only the existing approval transaction can create/update the live practitioner profile and current credentials.”
- “Raw datasets, credentials, generated SQL containing real records, and import artifacts stay outside Git, Vercel uploads and public assets.”
- “No paid subscription, public release, bulk outreach or broad recipient-allowlist removal is included.”
- “The existing release gate stays authoritative.”
- Preserve charcoal/red UI, native typography and existing components. Do not rebuild matching, referrals, mail delivery or the account system.
- Use `/Users/ReturnWellMvp/.worktrees/pilot-readiness`, branch `codex/real-data-rollout`; leave the unrelated dirty `prototype` checkout alone. `0619da5` records the design; `680f761` is the preceding tested production code baseline.
- Dates 5–11 October 2026 are conditional pilot targets, not automatic activation or background-work instructions. Real-patient rollout and external owner approvals are separate from technical import completion.

## Review Focus

1. A new source observation after a review must flag the review as stale, not overwrite the decision or confirmed profile (Tasks 1–2, 5).
2. Withdrawing one batch must not hide a candidate still supported by another active batch or select withdrawn evidence as current (Task 2).
3. The same request ID with another payload/actor must not return an unrelated result or duplicate an event; revocation must beat replay (Tasks 3–4).
4. A delayed response arriving after logout, role change or selection change must not render old private candidate details (Task 5).
5. Correcting a mistaken application link must be reversible and audited, without transferring ownership, changing approval or exposing clinical data (Tasks 4–5).

## Scope and file map

This is one cohesive candidate-data subsystem. Email-domain setup, clinical/privacy decisions, incident ownership and hosted recovery are release checkpoints in Task 7, not new subsystems silently added to this build.

| Area | Files / responsibility |
|---|---|
| Shared contracts | `shared/candidates.ts`: statuses, bounded DTOs and import format; no real data |
| Offline normalisation | `scripts/candidates/normalise.mjs`: three research formats, validation, canonical hashes |
| CLI | `scripts/import-candidates.mjs`: default dry run, explicit apply, target checks, count-only output |
| SQL | Three CLI-generated additive migrations named `private_candidate_import`, `candidate_review_workflow`, `candidate_application_links`; do not invent timestamp filenames or edit applied migrations |
| API | Existing `supabase/functions/_shared/workflow-http.ts` and `authorization.ts`; keep the same 14 deployed endpoints |
| UI | `app/lib/candidates.ts`, `app/candidate-review-panel.tsx`, `app/candidate-detail-panel.tsx`, `app/admin/candidates/page.tsx`; extend `app/auth-gate.tsx` navigation |
| Tests | `tests/candidate-import.test.mjs`, `tests/candidate-http.test.mjs`, `tests/candidate-local.test.mjs`, `tests/helpers/candidate-db.mjs`, `tests/fixtures/candidate-records.mjs`, `tests/browser/candidate-review.spec.ts`; wire into existing suites |
| Release | `supabase/functions/_shared/backend-manifest.json`, input guards and `docs/superpowers/real-data-import-runbook.md` |

## Contracts fixed by this plan

`CandidateDisposition = 'unreviewed' | 'needs_clarification' | 'duplicate' | 'unsuitable' | 'reviewed_for_onboarding'`. A disposition is never a credential status. Unsupported taxonomy values produce review flags, not an enabled profession.

`CandidateLocation = {suburb: string|null, postcode: string|null, state: string|null}`. `CandidateImportRecord` fields: `sourceId: string`, `displayName: string`, `professionIds: string[]`, `practiceNames: string[]`, `locations: CandidateLocation[]`, `sourceUrls: string[]`, `observedAt: string|null` (ISO timestamp when valid), `locationScope: string|null`, `reviewFlags: string[]`, `raw: Record<string, unknown>`, `observationHash: string`. These are observations, including null/unknown funding, language and availability; none populate confirmed live-profile fields.

`CandidateImportManifest` fields: `format: 'returnwell-private-candidates-v1'`, `digest: string`, `inputs: {label: string, sha256: string, count: number}[]`, `recordCount: number`, `flaggedCount: number`. Input counts are pre-deduplication; record/flagged counts are unique source IDs. Reject duplicate input labels. Hash canonical content with sorted object keys, source IDs and input labels; preserve raw array order. Observation hashes exclude their own hash field; the manifest digest covers the manifest without `digest` plus all normalised records. Input SHA-256 hashes cover original bytes. No generated time, local absolute path, service key or random ID participates in the digest; source collection times do participate.

`CandidateSummary` fields: `id: string`, `displayName: string`, `professionIds: string[]`, `practiceNames: string[]`, `locations: CandidateLocation[]`, `disposition: CandidateDisposition`, `version: number`, `reviewRequired: boolean`, `linkedApplicationId: string|null`. `CandidatePage = {items: CandidateSummary[], total: number, nextCursor: string|null}`. `CandidateMutationResult = {ok: true, candidateId: string, version: number}`.

`CandidateObservation = {id: string, record: CandidateImportRecord, importedAt: string, active: boolean}`; `CandidateReviewEvent = {id: string, actorId: string, action: string, occurredAt: string, expectedVersion: number, reason: string, evidenceReference: string|null, applicationId: string|null}`. `CandidateDetail` extends summary with `currentObservation: CandidateObservation|null`, `observations: CandidateObservation[]`, `events: CandidateReviewEvent[]`, `nextObservationCursor: string|null`, `nextEventCursor: string|null`, `withdrawn: boolean`. History is newest first using server sequence/UUID, never untrusted source dates; each history cursor is bound to candidate ID and stream. Raw contact/credential observations appear only in bounded operator detail, never list responses or logs.

`CandidateBatchSummary = {batchId: string, digest: string, status: 'completed'|'withdrawn', version: number, importedAt: string, recordCount: number, flaggedCount: number, unsupportedOnWithdrawal: number}`. `CandidateBatchPage = {items: CandidateBatchSummary[], nextCursor: string|null}`. Withdrawal returns `{ok: true, batchId: string, version: number, hiddenCandidates: number}`. Preview counts are informational; withdrawal recomputes counts transactionally. Import receipt: `{batchId: string, digest: string, inserted: number, newObservations: number, unchanged: number, flagged: number, replayed: boolean, status: 'completed'|'withdrawn'}`. Replayed counts describe the original commit, not additional writes; status reflects the current batch.

Limits: 20 MiB per input file, 40 MiB aggregate input, 1,000 records and 8 MiB canonical payload per atomic batch; 64 KiB raw JSON and 96 KiB complete normalised JSON per record. Byte limits use UTF-8 encoding. Name 1–160 chars, source ID 1–160, practice name 1–200, source label 1–80 (`[a-z0-9-]`), URL max 2,048; max 50 entries per normalised array, 20 profession IDs, JSON depth 12. Oversize/structurally malformed input fails the whole batch; never truncate silently. Unknown valid text/taxonomy/locations are retained with review flags. URLs must be HTTP(S), without userinfo; no URL is fetched. Collection time absent remains null, never import time. The existing three files total about 1.72 MB; remeasure during dry run.

## Task 1: Validated private import format and dry-run CLI

**Files:** Create `shared/candidates.ts`, `scripts/candidates/normalise.mjs`, `scripts/import-candidates.mjs`, `tests/fixtures/candidate-records.mjs`, `tests/candidate-import.test.mjs`; modify `package.json`, `scripts/generate-prototype-data.mjs`, `README.md`, `.vercelignore`, `scripts/check-deployment-inputs.mjs`, `scripts/verify-release-inputs.mjs`, `tests/deployment-inputs.test.mjs`, `tests/release-inputs.test.mjs`.

**Interfaces:** Export `normaliseCandidate(raw: unknown): CandidateImportRecord`, `prepareCandidateBatch(inputs: {label: string, bytes: Uint8Array}[]): CandidatePreparedBatch`, where `CandidatePreparedBatch = {manifest: CandidateImportManifest, records: CandidateImportRecord[]}`, and `runCandidateImport(args: string[], deps?: CandidateImportDeps): Promise<number>`. Optional dependency overrides: `readFile(path: string): Promise<Uint8Array>`, `apply(batch: CandidatePreparedBatch, actor: string, projectRef: string): Promise<CandidateImportReceipt>`, `stdout(line: string): void`; `CandidateImportReceipt` is the receipt above. Test fixture exports `legacyCandidate(overrides={})`, `pilotCandidate(overrides={})`, `expandedCandidate(overrides={})`, each fictional and matching one observed source format. CLI: repeated `--input label=/absolute/file.json`; dry run is default; `--apply` is implemented in Task 2.

- [ ] Write failing tests with these exact assertions:

```js
assert.equal(batch.manifest.recordCount, 3);
assert.deepEqual(batch.records.find(x => x.sourceId === 'fictional-multi').professionIds, ['occupational_therapist', 'physiotherapist']);
assert.equal(batch.records[0].observedAt, null);
assert.equal(batch.records[0].raw.telehealth, null);
assert.equal(reordered.manifest.digest, batch.manifest.digest);
assert.notEqual(changed.manifest.digest, batch.manifest.digest);
assert.equal(networkCalls, 0); // default dry run
```

Also test empty names/duplicate conflicting source IDs, malformed JSON, the exact size/length limits, single-vs-array profession inputs, unknown profession flags, hostile text and unsafe URL rejection. Same source ID with identical input collapses once and is counted; conflicting input fails before I/O. Preserve no registration/provider claims as trusted fields.
- [ ] Run `node --test tests/candidate-import.test.mjs` and observe the expected missing-module/test failures before implementation.
- [ ] Implement the contracts and adapters for Sydney master, NSW pilot and broader expansion. Default CLI stdout contains only digests, counts and bounded error codes/input labels/row indexes—never names, contacts, raw errors or file contents. Remove the `data:generate` script and make direct invocation of the obsolete generator exit nonzero without reading/writing files; test this in a temporary fixture directory.
- [ ] Add `data:candidates` pointing to the new CLI. Exclude offline importer code from Vercel upload; extend release guards for `*.candidate-import.json`/`*.candidate-import.sql` artifacts under any path, including ignored public files. Keep existing private-data exclusions. Update README's candidate workflow only; do not rewrite historical launch claims as current evidence.
- [ ] Run the importer, deployment-input and release-input unit tests; expect zero failures. Run the real three-file dry run with no network; save count-only output under ignored `outputs/`, never raw generated bundles. Confirm expected 609 source records or stop to reconcile a changed source.
- [ ] Commit only Task 1 code/tests/docs: `feat: add private candidate import validation`.

## Task 2: Transactional candidate storage, replay and batch withdrawal

**Files:** Create the CLI-generated `private_candidate_import` migration and `tests/helpers/candidate-db.mjs`; modify `tests/workflow-db.test.mjs`, `scripts/import-candidates.mjs`, `tests/candidate-import.test.mjs`.

**Interfaces:** `public.rw_import_candidate_batch(p_actor uuid, p_manifest jsonb, p_records jsonb) returns jsonb` is SECURITY INVOKER, service-role execute only, and rechecks confirmed current operator status. Returns `CandidateImportReceipt`. The import CLI is an explicitly trusted service-credential operation, not a browser MFA bypass or user-callable RPC. `private.withdraw_candidate_batch(actor uuid, batch_id uuid, expected_version integer, reason text, request_id uuid) returns jsonb` is service-only and returns the withdrawal result above; Task 3 exposes it through step-up-protected administration, not anonymous HTTP. Export `candidateImportChecks(t, {sql, rpc, id})` from the new DB helper and invoke it from the existing disposable suite with dedicated fixture identities.

- [ ] Write failing actual-Postgres tests: first import inserts the expected fictional rows; identical replay adds zero rows; changed evidence adds one immutable observation and flags stale review; invalid second record rolls back the entire batch; concurrent equal digests create one batch; no grants to anon/authenticated; practitioner, credential, location and email-job counts do not change.
- [ ] Run `npm run test:database`; confirm failures are missing candidate tables/functions, not harness setup errors.
- [ ] Discover current Supabase migration commands with `npx --no-install supabase migration --help` / `new --help`; generate the migration timestamp with the CLI. Implement five private tables: `candidate_import_batches`, `practitioner_candidates`, `candidate_observations`, `candidate_batch_items`, `candidate_review_events`. RLS on all; revoke PUBLIC/anon/authenticated table/function/sequence access. Batch digest unique; source ID unique; observations immutable keyed by candidate and observation hash; batch membership unique per batch/candidate. Grant only required service privileges; audit observations/events cannot be updated/deleted by workflow callers.
- [ ] Implement validation in SQL too, advisory serialization for imports/withdrawals and row locks in stable candidate-ID order. Store source and content hashes, version, explicit disposition and reviewed observation hash separately. Current evidence is the observation referenced by the latest server-sequenced, non-withdrawn import batch for that candidate, or null when none remain. A change in selected evidence increments version; `reviewRequired` is true when no evidence was reviewed or its hash differs from current evidence. Preserve previous decisions/linkage. Batch and all memberships commit atomically; failures return safe errors and create no completed partial batch. Record failed attempts only as count-only CLI diagnostics.
- [ ] Test withdrawal twice, withdrawal of one of two supporting batches, withdrawal of the newest observation, withdrawal after an application link, and re-importing a withdrawn digest. Expected: only unsupported candidates leave the active queue; withdrawn evidence cannot become current; reviewed links, applications and referrals are untouched; versions invalidate stale edits; replay adds one withdrawal event only. Import replay of a withdrawn digest reports `status: 'withdrawn'` and never reactivates it.
- [ ] Implement CLI `--apply --confirm-project ivutegjvttkrmxctegub --actor <operator-uuid> --expect-digest <dry-run-digest>` using existing `@supabase/supabase-js`. Read `RW_CANDIDATE_IMPORT_URL` and `RW_CANDIDATE_IMPORT_SERVICE_KEY` from the calling environment, never browser config or command arguments. Require exact HTTPS `<confirmed-ref>.supabase.co` origin with no path/userinfo/query/custom port, no redirects, and matching digest before sending one RPC. Disable SDK auth persistence/refresh. Do not retry uncertain results with a different digest; identical retry must return the original batch receipt. Local tests inject a local-only client using the existing harness; the hosted CLI does not infer a localhost exception.
- [ ] Run database/import tests and typecheck. Confirm same-payload replay and privacy failures pass, then commit: `feat: store research candidates transactionally`.

## Task 3: Operator-only API for candidate search, detail and disposition

**Files:** Create CLI-generated `candidate_review_workflow` migration and `tests/candidate-http.test.mjs`; modify `supabase/functions/_shared/workflow-http.ts`, `supabase/functions/_shared/authorization.ts`, `tests/helpers/candidate-db.mjs`, `tests/authorization-matrix.test.mjs`, `tests/workflow-http.test.mjs`.

**Interfaces:** `private.candidate_workflow(actor uuid, action text, input jsonb) returns jsonb`. Add these mappings to existing endpoint `review-practitioner`: `candidate_list → candidate.list`, `candidate_detail → candidate.detail`, `candidate_dispose → candidate.dispose`, `candidate_batches → candidate.batches`, `candidate_withdraw_batch → candidate.withdrawBatch`. Bulk import has **no** Edge mapping. `list` input `{search?, professionId?, suburb?, postcode?, disposition?, cursor?, limit?}`; `detail` `{candidateId, observationCursor?, eventCursor?}`; `dispose` `{candidateId, expectedVersion, disposition, reason, evidenceReference, requestId}`; `batches` `{cursor?}`; withdrawal `{batchId, expectedVersion, reason, requestId}`. Detail returns at most 20 observations/events per request; batch pages max 25. Mutations require step-up plus current DB operator status.

- [ ] Write failing HTTP tests: absent auth → 401; AAL1 mutations → `step_up_required`; actor supplied in body ignored; unrecognised operation/bulk import denied; no raw SQL or source strings in errors; response cache remains `no-store`. DB tests deny non-operator and revoked-operator reads/mutations, including replay of a formerly authorised request.
- [ ] Run `node --test tests/candidate-http.test.mjs tests/authorization-matrix.test.mjs` and the focused DB helper through `npm run test:database`; confirm the new mappings/SQL are missing.
- [ ] Implement a new additive wrapper around `rw_workflow` following the existing private delegate pattern. Only `candidate.*` routes to the new handler; all prior actions retain their existing delegate. Use current `private.is_operator(actor)` and confirmed Auth user checks before reads or idempotency lookup. Reuse `private.workflow_requests` with exact actor/action/input binding; another actor can never borrow a cached response. Apply version check and append one audit event in the same transaction. Reason 1–500 chars; evidence null or 1–500 chars; `reviewed_for_onboarding` requires evidence. No status grants eligibility.
- [ ] Implement bounded queries with total independent of page size and stable `(lower(display_name), id)` ordering. Cursor contains format version, filters fingerprint, last sort name and UUID; reject mismatched/oversize/malformed cursors with `invalid_cursor`, and always reapply authorisation/filters. Search is literal bounded text (max 160), never regex/SQL fragments; postcode is null or four digits. Limit default 25, capped at 50; invalid zero/negative/non-integer limits fail. Candidate list excludes raw contact/credential fields. Detail is capped at 256 KiB: include the current observation, then fit at most 20 records per history stream within the byte budget and return advancing cursors, never silently drop history. Enforce a 96 KiB complete normalised-record limit in addition to the 64 KiB raw limit so a single observation always fits. Operator direct-ID reads retain withdrawn details for audit; active search excludes unsupported candidates.
- [ ] Add 5,000 **synthetic** candidate fixtures in bounded batches; assert no page >50, exact totals, stable no-duplicate traversal, filter reset, no `raw` list fields, revoked-role denial, and literal `%`/`_` search behavior. Verify overlapping withdrawal/filter operations do not leak withdrawn evidence.
- [ ] Run all Task 3 tests, typecheck and lint; commit: `feat: add protected candidate review workflows`.

## Task 4: Audited candidate/application provenance link, without approval bypass

**Files:** Create CLI-generated `candidate_application_links` migration; modify `supabase/functions/_shared/workflow-http.ts`, `supabase/functions/_shared/authorization.ts`, `tests/candidate-http.test.mjs`, `tests/helpers/candidate-db.mjs`.

**Interfaces:** `candidate_link_application → candidate.linkApplication` and `candidate_unlink_application → candidate.unlinkApplication`, input `{candidateId, applicationId, expectedVersion, evidenceReference, reason, requestId}`. One current application link per candidate, one candidate per linked application; links/events are private. Return the standard mutation result. Unlink requires the exact currently linked application ID. Relinking uses explicit unlink then link; no silent replacement.

- [ ] Write failing tests: link a fictional candidate to a submitted application and assert `public.practitioners` count unchanged, application status/version/profile unchanged and no notification. Wrong/missing application, linking the operator's own application, stale version, conflicting link and revoked actor must fail without side effects. Same name or shared mailbox must never auto-link.
- [ ] Run relevant HTTP/DB tests and observe the missing-operation failures.
- [ ] Implement the link/unlink transaction behind AAL2/current-operator checks. Require an existing submitted or approved application, independent actor (`application.user_id <> actor`), nonempty identity evidence and reason, and record immutable application ID/owner/version/observation-hash evidence in the audit. Do not copy candidate profile data, call `review.decide`, invoke `growth.sweep` or change account ownership. Linking requires a non-withdrawn source and disposition `reviewed_for_onboarding`; unknown/changed evidence remains flagged and cannot be linked until re-reviewed.
- [ ] Add Review Focus 3/5 tests: same request ID/different input conflicts, cross-actor replay cannot borrow response, unlink/relink correction creates distinct audit events and no ownership/approval change. An already linked candidate becoming withdrawn/flagged remains auditable but never alters the live practitioner.
- [ ] Add one synthetic end-to-end DB test proving link alone stays absent from directory; existing independent application approval plus confirmed capabilities/current policy admits only the correct practitioner; disabled/expired credential or intake pause still blocks matches. Commit after green: `feat: link candidate evidence without granting referral access`.

## Task 5: Candidate review screens and recovery UX

**Files:** Create `app/lib/candidates.ts`, `app/candidate-review-panel.tsx`, `app/candidate-detail-panel.tsx`, `app/admin/candidates/page.tsx`, `tests/browser/candidate-review.spec.ts`; modify `app/auth-gate.tsx`, `app/lib/workflow.ts` (safe destination allowlist), `tests/ui-routes.test.mjs`, `tests/ui-workflow.test.mjs` and shared CSS only where required by the existing design system.

**Interfaces:** Client functions `listCandidates(client, filters): Promise<CandidatePage>`, `loadCandidate(client, id, cursors?): Promise<CandidateDetail>`, `disposeCandidate(client,input)`, `linkCandidateApplication(client,input)`, `unlinkCandidateApplication(client,input)`, `listCandidateBatches(client,cursor?)`, `withdrawCandidateBatch(client,input)`; all invoke the mappings from Tasks 3–4. `CandidateReviewPanel({client})`; `CandidateDetailPanel({client,candidateId,onChanged,onClose})`. No direct private-table client queries.

- [ ] Write failing browser tests using `adminBrowser(page)` and fictional imports: admin sees **Candidate review**, doctor cannot read the route, 51 results paginate without exposing raw list details, detail sources render as text, and unsafe HTML does not execute. Exact warning: **Unverified research record — not available for referral.** Assert no **Send bulk invitations**, **Activate practitioner** or **Refer** action exists.
- [ ] Run `RW_LOCAL_STACK_DIR=<validated-isolated-stack> npm run test:browser -- tests/browser/candidate-review.spec.ts`; confirm missing route/controls rather than skipped tests. Never use hosted credentials for this suite.
- [ ] Implement authenticated operator routing and existing navigation patterns. Search/filter changes clear cursors; use shared field/state/dialog components. Candidate evidence labels distinguish observations, unknown values, collection date and practice-level locations. Link form accepts an explicitly reviewed application UUID with evidence/reason and offers the existing application-review route; it is not an email or person search shortcut. A separate batch panel displays digests/counts and an explicit withdrawal confirmation with affected count, reason and version.
- [ ] Preserve edits on validation/MFA/network failures and retain the same request ID/payload after an ambiguous save. Lock inputs while resolving a possibly committed action; a definitive version conflict reloads state before a fresh request. Provide explicit cancel/back and current-version reconciliation. Add request-generation checks and clear sensitive state on logout/access invalidation/unmount; stale detail/history responses cannot replace the current selection.
- [ ] Test lost mutation response, conflict, MFA recovery, batch withdrawal, reversible link correction and delayed reads after logout/role change. Test 375px/1440px, keyboard-only controls, axe serious/critical violations, long names/source URLs and no horizontal overflow. Assert clinical records remain inaccessible to operator-only sessions.
- [ ] Run focused browser/UI/typecheck/lint checks; commit: `feat: add private candidate review interface`.

## Task 6: Full local acceptance, importer runbook and release packaging

**Files:** Create `tests/candidate-local.test.mjs`, `docs/superpowers/real-data-import-runbook.md`; modify `package.json` to include the new local journey, `tests/helpers/local-browser-fixtures.mjs` only if needed for isolated candidate fixtures, and regenerate `supabase/functions/_shared/backend-manifest.json` via `npm run backend:prepare`.

**Interfaces:** Local candidate journey consumes Tasks 1–4 contracts through `localRuntime()`, real local Auth/PostgREST and the existing workflow handler; no hosted URL/provider calls. Runbook consumes a completed batch receipt and the exact SHA/migration/function manifest, not a screenshot alone.

- [ ] Write the authenticated journey: import via local service RPC → operator AAL2 review/link → ordinary GP/recipient denied raw candidates → legitimate independent onboarding/approval → eligible practitioner visible with provider-confirmed locations → intake pause removes new matches. Add duplicate import and no-email-count-change assertions using dedicated fixtures; register it in `test:local-journey`.
- [ ] Run the journey and reproduce failures before fixing any integration mismatch; do not weaken eligibility or isolation assertions to turn tests green.
- [ ] Document exact dry-run/apply/replay/withdrawal/target checks, safe secret placement, source digest comparison, count-only reporting and handling of changed/flagged records. The three approved input paths are `/Users/ReturnWellMvp/private-data/sydney-master/master-candidates.json`, `/Users/ReturnWellMvp/private-data/nsw-runs/nsw-pilot-2026-09-30/additional-candidates.json`, `/Users/ReturnWellMvp/private-data/nsw-runs/direct-expansion-2026-10-01/new-candidates.json`; do not add the overlapping 240-row full expansion or separate rejected/review exports.
- [ ] Run `npm run backend:prepare`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:database`, isolated `npm run test:local-journey`, full isolated `npm run test:browser`, `npm run build:vercel`, `RW_PRODUCTION_BROWSER=1 node --test tests/production-preview.test.mjs`, and `npm run check:release-inputs`. Expected: zero failures; explicitly run opt-in suites rather than counting skips as coverage. Refresh affected backend tests if they incorrectly hardcode old migrations; never skip the compatibility guard.
- [ ] Review the diff for candidate payloads/secrets/public assets. Discover `supabase db lint --help` and run supported lint against the isolated stack, plus the actual-Postgres role/grant regressions; hosted advisors are a separate Task 7 check, not claimed as a local CLI capability. Fix new findings, retain evidence for intentionally inaccessible private tables. Run one independent whole-branch review using the user-selected execution method, resolve significant findings with regressions, and record remaining limitations. Commit: `test: verify private candidate pipeline and release inputs`.

## Task 7: Controlled hosted import and pilot acceptance checkpoint

**Files:** Create `docs/superpowers/real-data-release-record.md`; update factual rows in `docs/superpowers/launch-acceptance-matrix.md` only after evidence exists. Any approved `release-evidence.ts` change is a separate reviewed release, never part of candidate import.

**Interfaces:** Target Supabase `ivutegjvttkrmxctegub`; Vercel ReturnWell / `fitment` / `return-well-mvp`; canonical `https://return-well-mvp.vercel.app`. Read current project/branch state before changes. Exact import digest, approved operator UUID, backend manifest and eligible-profile counts are recorded without names/contact details or secrets in Git.

- [ ] Obtain owner approval of this implementation plan/execution method before Tasks 1–6; confirm explicit release scope before hosted writes. Founder credentials/clinical approvals are not implied by the code-plan approval. Do not create paid branches, change DNS, email recipients or send acceptance emails without those exact inputs/authority.
- [ ] On the finished reviewed commit, verify GitHub CI and clean tracked inputs. Confirm recoverable pre-change backup capability/approved rollback procedure and additive migration compatibility; stop if unavailable. Discover current CLI/MCP deployment commands and apply only the new audited migrations, then deploy **all** endpoints named by the newly generated manifest before the frontend. Verify every hosted fingerprint and migration; an older 14/35 result does not satisfy the changed release.
- [ ] Deploy the reviewed frontend after the hosted backend check passes; verify canonical served SHA, authenticated candidate route, empty initial candidate counts and non-operator denial. Preserve private-test mode, recipient restriction and existing unsaved user tabs. Do not import until the new schema/API is confirmed live.
- [ ] Rerun the offline dry run on the exact three inputs; compare digest/counts to the reviewed receipt. Apply the explicit project/digest-bound import once, retain count-only receipt, replay once to prove no additional rows/events, and verify admin UI detail/provenance and GP/anonymous denial through real hosted requests. Compare before/after profile/credential/notification totals: they must remain unchanged. If the initial 609 count has drifted, reconcile instead of forcing it.
- [ ] Record exact counts (including flags), SHA, migration versions, function fingerprint, deployment ID, zero-or-observed error scan, screenshot and test layers. Run current hosted Supabase security advisors through a supported authenticated interface and triage any new findings; report unavailable checks as unverified. If input/storage errors occur, stop; do not publish candidates or relax permissions to make the list load. Batch withdrawal is the reversible import response; never reset the live database.
- [ ] Stop with **technical integration complete, clinical rollout blocked** until the owner supplies verified business/domain/support, the approved doctor/recipient cohort, independent credential reviewer/protocols, clinical/privacy/retention decisions, monitored incident owner and safe recovery evidence. Collect actual mailbox, Auth-abuse, alert/recovery and participant acceptance using the existing approved runbooks and explicit test-recipient authority. Never invent a review interval or mark credentials/consent as confirmed yourself.
- [ ] Only after all existing `pilotEvidence` categories are backed by real approvals and tests: record explicit owner/clinician go/no-go, then use a separately reviewed pilot-mode release. Missing gates on 9 October mean remain private-test and revise the date—not remove the checks. Public signup/public launch remains out of scope.

## Plan self-review and execution handoff

Coverage: spec §3 → Tasks 1–2; §4 → Tasks 3/5; §5 → Task 4 plus existing eligibility; §6 → Tasks 1–6; §7–9 → Task 7. All five Review Focus cases have owning tests. Candidate DTOs and operation names above are the sole cross-task contract. Migration filenames are assigned by CLI during execution, never predated in this plan.

This plan adds one candidate subsystem and reuses the existing referral system. It does not certify the whole product or implement unrelated email/monitoring services without owner choices. Missing external inputs must be logged as open gates, not silent implementation shortcuts.

Recommended execution: **Native**, sequential in this session with focused test/commit cycles and one final independent review. The alternative is **Subagent-driven**, with fresh implementer/reviewer contexts per task (higher cost). Await the user's plan review and execution-method selection; no product code or hosted data is changed by this planning document.
