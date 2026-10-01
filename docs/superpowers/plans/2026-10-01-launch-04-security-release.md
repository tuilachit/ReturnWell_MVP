# ReturnWell Security, Operations and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the code reproducible, the access boundaries demonstrable and the pilot supportable before any launch claim.

**Architecture:** Preserve the existing production architecture and add narrow test, security and operational controls. Release through reviewed additive migrations, compatible function/frontend versions and a recorded candidate; no wholesale dirty-workspace deployment or automatic clinical rollout.

**Tech Stack:** Existing Node/React/Vinext/Vercel and Supabase, Node tests plus a pinned local Playwright/accessibility test toolchain, existing provider observability before adding paid vendors.

**Spec:** [Launch-readiness design](../specs/2026-10-01-launch-readiness-design.md), sections 2, 3 and 4.7. Proposed; operational approvals remain explicit.

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

- Dirty source does not reproduce the live release: D1 records/selects exact inputs before changes.
- Development dependency bundled into runtime: D2 checks deployment traces, not only npm omit=dev.
- Forged roles, expired sessions or direct-origin abuse bypass: D3 tests the real server boundary.
- Clinical content in crash/mail/analytics logs: D4/D5 allowlist fields and test malicious/long inputs.
- Restore or frontend rollback replays notifications against an incompatible DB: D6/D7 rehearse recovery with sends disabled and reconcile before resuming.

### D1. Reproducible source baseline, browser fixtures and CI

**Starts first. Files:** Create `.github/workflows/quality.yml`,
`playwright.config.ts`, `tests/helpers/browser-fixtures.ts`,
`tests/browser/smoke.spec.ts`, `scripts/verify-release-inputs.mjs`,
`docs/superpowers/release-input-manifest.md`; modify `package.json`, lockfile,
ESLint ignores, test helpers and existing deployment-input tests.

**Interfaces:** New scripts `test:browser` (local-only Playwright),
`test:catalogues` (B1), `check:release-inputs`. Fixture entry returns local
`{baseURL,stackDir,roles}`; secrets/magic links remain in private fixture files,
not test reports. Default E2E origin `http://127.0.0.1:3101`; reject non-loopback
hosts. Existing dev origin/hosted `.env.local` are not changed.

- [ ] Inspect attached worktrees and current dirty scope read-only. Reuse an appropriate isolated checkout or create one with managed tools when execution needs it. Compare live export `/tmp/returnwell-safety-release-ZgQukk` (if still present), current sources and Git baseline; select only reviewed production-compatible files. Preserve unrelated work without reset/stash/discard. If the export is missing, reconstruct from evidence and verify rather than guess.
- [ ] Write `release_input_excludes_private_research_and_secrets`, `release_manifest_matches_files`, `browser_harness_rejects_hosted_targets`, `fixture_sender_is_disabled`. Run existing deployment-input tests plus the new smoke and verify intended new failures.
- [ ] Record source hashes and migration/function/build identities; capture reviewed scope in a baseline commit before editing features. Pin compatible `@playwright/test` and `@axe-core/playwright` versions after compatibility checks, with lockfile. Set the helper's test port explicitly. Make lint ignore generated `.vercel/.output/dist` but not application source.
- [ ] Add CI: `npm ci`, typecheck, lint, standard tests, Vercel build, disposable DB and local Auth/PostgREST/browser jobs. Use reviewed immutable action SHAs and least permissions; no production secrets in PR jobs. Use isolated local mail fixtures, never real Resend. CI must not quietly count opt-in skips as integration acceptance.
- [ ] Run the CI-equivalent commands from clean inputs and record results. Commit D1 tooling as `build: make ReturnWell release inputs and checks reproducible`; do not push/deploy as a side effect.

### D2. Dependency and runtime exposure remediation

**Dependency:** D1. **Files:** Modify only necessary pins/lockfile and affected
build configuration; create `docs/superpowers/dependency-risk-register.md`,
`scripts/check-dependency-exposure.mjs`, `tests/dependency-policy.test.mjs`.

**Interfaces:** Risk register item `{package,installedVersion,advisoryUrl,
path,reachableIn:'browser'|'server'|'build'|'local_dev'|'unknown',remediation,
owner,reviewDate}`. `check-dependency-exposure` compares lockfile, applicable
advisory inventory and built server traces; unknown exposure cannot be marked safe.

- [ ] Reproduce `npm audit --json` and `npm audit --omit=dev --json`; baseline in the planning pass is 8 moderate/2 high, not proof of runtime exploitability. Trace `brace-expansion`, `undici`, Wrangler/Miniflare and Drizzle/esbuild into actual build outputs and tool entry points. Recheck official advisory/patched-version information at implementation.
- [ ] Add tests `unknown_high_exposure_blocks_release`, `accepted_dev_exception_requires_owner_and_date`, `runtime_trace_is_checked`. Run `node --test tests/dependency-policy.test.mjs` and confirm RED.
- [ ] Apply narrow compatible updates/overrides only with evidence; do not run `npm audit fix --force` or accept its proposed old Drizzle downgrade. If the pinned beta deployment stack cannot be secured, document a separate migration decision instead of silently replacing the framework.
- [ ] Run `npm ci`, both builds, typecheck/lint, all local journeys and exposure checks. No unexplained reachable high/critical finding may remain. Isolated tool-only exceptions require explicit review, compensating controls and revisit date; they are not an automatic exemption.
- [ ] Commit D2 as `fix: remediate verified dependency exposure` with the updated risk record.

### D3. Auth, privilege, abuse and response-header hardening

**Dependencies:** B2/A3/A6/C2. **Files:** Create `app/security/page.tsx`,
`app/security-panel.tsx`, `supabase/functions/_shared/authorization.ts`,
`tests/authorization-matrix.test.mjs`, `tests/browser/security.spec.ts`,
`tests/security-headers.test.mjs`; modify shared runtime/handlers, config,
auth navigation and Vercel response configuration. Generate additive SQL only
for required audit/policy changes; do not edit deployed migration history.

**Interfaces:** `requireOperatorStepUp(verifiedIdentity): Promise<void>` uses
provider-verified identity and signed assurance claims, not decoded-unverified
JWT/user_metadata/body fields. Require AAL2 for credential approval, practice
identity/contact review, membership/access revocation and privileged configuration.
`SecurityEvent={code,routeTemplate,requestId,status,at}` permits no body/query/token.

- [ ] Write a permission matrix covering anon, pending applicant, doctor in own/other practice, assigned/unassigned practitioner, paused/suspended practitioner, operator-only and revoked user. Assert no self-approval, role spoofing, cross-tenant drafts/referrals, wrong mailbox claim, direct browser UPDATE, privileged RPC or clinical data from an operator-only account.
- [ ] Run matrix/local integration tests to expose gaps; test server AAL1 rejection for privileged actions and legitimate AAL2 success. Require these before adding convenient admin controls to a release.
- [ ] Implement MFA enrollment/recovery UX and server-enforced step-up using current Supabase docs. Inspect session/JWT revocation, redirect/CORS allowlists and secret exposure; verify any historically exposed active key is rotated through an approved secret-store action. Resolve the password-protection advisor finding or record why no password-auth surface is enabled; do not describe it as fixed without evidence.
- [ ] Add trusted rate limiting/challenge verification on actual public signup/auth endpoints. Controls must cover direct Supabase-origin access, not only the frontend; never trust client-supplied IP headers. Add no-store for sensitive responses, no-referrer for credentials, nosniff, anti-framing and an app-compatible CSP tested before enforcement. Do not enable HSTS preload casually or block required script/auth flows.
- [ ] Run direct REST/RPC, stale-role, forged challenge, replay, oversized body, external redirect and header tests plus browser auth. No secrets/patient content may appear in bundles/network logs. Commit D3 as `security: enforce launch access and abuse controls` with a redacted threat-model result.

### D4. Privacy, support and fail-closed release configuration

**Dependencies:** Founder/qualified legal and clinical input; code can be prepared
before final documents. **Files:** Create `app/lib/release-mode.ts`,
`app/support/page.tsx`, `tests/release-mode.test.mjs`,
`docs/superpowers/data-inventory.md`, `docs/superpowers/privacy-operations.md`;
modify policy/footer/sign-in/guide pages and server trust validation.

**Interfaces:** `ReleaseMode='private_test'|'pilot'`;
`validateReleaseConfig(config): {mode,ready:boolean,blockers:string[]}` lives
server-side for operations. Browser receives only approved mode/public branding,
never secret inventory. The build/deploy gate rejects pilot activation without
reviewed notice versions, real identity/support and explicit signed-off checklist.

- [ ] Produce a data map for clinical/draft/profile/credential/invitation/audit/mail/telemetry records: purpose, readers, processor, region, retention owner and deletion/access process. No assumption that practice reference makes a clinical narrative anonymous, or that Sydney functions imply all processing is Australian.
- [ ] Write `private_test_cannot_look_like_public_release`, `pilot_requires_reviewed_identity_notices_support`, `support_message_has_no_automatic_clinical_dump`, `unknown_release_mode_fails_closed`. Run `node --test tests/release-mode.test.mjs`; confirm RED.
- [ ] Implement clear mode labels, real support path, urgent-use limitation and approved consent version links. Keep existing drafts visibly draft until approved. Do not generate fictitious legal details, endorsements, response times or blanket compliance claims. Qualified review determines Australian/NSW obligations and processor contracts.
- [ ] Obtain owner-reviewed final notices, contact/deletion/correction procedure, clinician handover process and incident route. Validate every public/support link. If approval is absent, leave pilot gate blocked rather than hiding the warning.
- [ ] Commit D4 code/docs as `feat: gate pilot mode on reviewed operational readiness`; record the human approvals separately from automated checks.

### D5. Redacted health monitoring and incident ownership

**Dependencies:** C4/D3. **Files:** Create
`supabase/functions/_shared/observability.ts`, `tests/observability.test.mjs`,
`docs/superpowers/incident-runbook.md`; extend email operator view and existing
cron status instrumentation. Configure alerts only under an approved operator
destination; prefer current Vercel/Supabase/Resend capabilities before a new vendor.

**Interfaces:** `recordOperationalEvent({event,routeTemplate,status,durationMs,
requestId,releaseId}):void`; allowlist known event/route values. No free-text
exception/request body, user email, referral reference, full URL/query/fragment
or token. `QueueHealth={pendingCount,oldestPendingSeconds,authOverdueCount,
needsReviewCount,failedCount,lastDispatchAt}` available only to authorised operators.

- [ ] Write `redactor_rejects_sensitive_fields`, `queue_age_not_just_count`, `cron_heartbeat_detects_stall`, `read_status_cannot_send`, `alert_deduplicates_unchanged_failures`. Include synthetic secrets/clinical strings in thrown errors and verify none reach outputs.
- [ ] Run `node --test tests/observability.test.mjs` and cron/HTTP tests; confirm RED.
- [ ] Implement structured redacted signals and operational views. Proposed internal alert thresholds: no dispatcher heartbeat for 5 minutes, pending auth over 2 minutes, other ready jobs over 5 minutes, any new needs_review, or repeated webhook persistence errors. These are operational alarms, not promised delivery SLAs. Choose named owner, escalation route and cost/retention limit with founder.
- [ ] In isolated staging/local, inject queue stall, function failure, invalid provider configuration and callback persistence failure; verify the approved alert reaches the owner with only redacted context. Test acknowledgement/deduplication and manual recovery instructions. Do not expose a public health endpoint containing customer counts.
- [ ] Commit D5 as `feat: add privacy-safe operational health signals`. Document what was actually configured versus still awaiting account capability/approval.

### D6. Retention, credential cleanup, restore and rollback

**Dependencies:** D1/D4 and approved recovery objectives. **Files:** Create
`docs/superpowers/recovery-runbook.md`, `docs/superpowers/retention-policy.md`,
`tests/retention.test.mjs`, `scripts/check-recovery-readiness.mjs`; change the
existing cleanup/worker path only if tests expose a gap. New retention SQL uses
a generated additive migration and explicit approved durations, never guesses.

**Interfaces:** `RetentionPolicy={recordClass,keepForDays,legalHoldBehaviour,
approvedBy,approvedAt}`; no automatic destructive cleanup without approved policy.
`RecoveryEvidence={backupAt,restoreStartedAt,restoreCompletedAt,sourceRelease,
restoredMigrationHead,sendGateDisabled:boolean,checksPassed:string[]}`; store no credentials.

- [ ] Inventory actual backup/PITR/retention capability and costs, encryption-key recovery/rotation, provider secret ownership and runbook access. Agree RPO/RTO with founder; do not claim unsupported plan features or purchase upgrades unasked.
- [ ] Add tests `expired_credentials_removed`, `claimed_or_revoked_invitation_payload_cleared`, `legal_hold_prevents_record_purge`, `no_unapproved_retention_delete`, `restored_queue_cannot_send_automatically`. Run retention/DB tests; preserve existing passing cleanup.
- [ ] Implement only approved cleanup rules and restore gates. Keep clinical audit history according to reviewed policy, not arbitrary seven-day deletion. Establish reviewed access/correction/export/redaction handling; do not simply delete auth.users and assume tokens/history vanish. Integrate cleanup into an approved existing operational path, not a duplicate mail scheduler.
- [ ] Rehearse restore into an isolated target with delivery explicitly off, permitted recipients empty/restricted, and no public clinical access. Reconcile email/provider state before any resumption so restored pending jobs do not resend old messages. Test compatible frontend rollback and forward-fix migration approach; never roll back by resetting live DB.
- [ ] Record achieved recovery timing against approved RPO/RTO and commit D6 as `ops: document and verify ReturnWell recovery`. If no approved backup target/capability exists, keep D6 blocked.

### D7. Exact release candidate and real multi-role pilot acceptance

**Dependencies:** All A/B/C/D packages and external gates. **Files:** Create
`docs/superpowers/launch-acceptance-matrix.md`,
`docs/superpowers/launch-release-record.md`; update README, current handoff and
launch runbook with one clearly marked current state. Never overwrite historical
evidence to imply tests happened earlier.

**Interfaces:** Release record `{gitSha,inputManifest,migrations,edgeVersions,
deploymentId,canonicalOrigin,approvedRecipients,rollbackTarget,approval,evidence}`.
Recipients and sensitive approval records remain private; public repo notes use
redacted role labels. Each check has `local|staging|hosted|human` evidence layer.

- [ ] Freeze reviewed source and migration set; run `npm ci`, typecheck/lint, `npm test`, `npm run test:database`, `npm run test:local-journey`, `npm run test:browser`, `npm run build:vercel`, catalogue/exposure/release-input checks. All new tests and retained baselines pass; unexplained opt-in skips are failures of acceptance, not passes.
- [ ] Review migration compatibility, database/extensions and current provider docs. Dry-run only the intended migrations against the verified project. Obtain explicit approval for exact deployment, hosted changes, pilot recipients and rollback; no new code approval is treated as launch approval.
- [ ] Deploy an isolated candidate; verify real app HTML/assets/authenticated routes, not Vercel protection/login pages. Run desktop/mobile/keyboard/no-network recovery and permission checks with isolated fixtures. Promote only after candidate passes; verify served identity after promotion and direct links from actual emails.
- [ ] Run actual new-user and returning-user mailbox journeys with approved participants; independently review a legitimate practitioner. Complete GP referral → provider accept → practice sees response → external handover → closure. Also decline/re-refer/cancel, intake pause and revoked access. Confirm mail provider response, signed persisted callback, inbox placement and recipient action separately. Test notification outage while retaining saved referral; do not lose or duplicate clinical work.
- [ ] Record founder/clinical sign-off, support readiness, named incident owner, monitor/restore evidence and no-open-P0 verdict. Start only the bounded approved pilot; agree observation window and feedback collection with participants. Public rollout remains a separate explicit go/no-go. Commit D7 evidence as `docs: record ReturnWell pilot release acceptance` without claiming unperformed checks.

## Stop conditions

Stop release, not safe local investigation, on unresolved cross-tenant access,
incorrect credential activation, duplicate clinical submissions, uncertain
message replay, raw sensitive logs, missing legal/contact authority or a failed
restore. Record owner/next action. A passing build, screenshots or provider Save
button cannot overrule these gates.
