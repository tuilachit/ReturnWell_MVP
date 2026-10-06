# Two-doctor pilot acceptance matrix — 2 October 2026

This is an evidence map, not approval for clinical use. Current default: private_test, fictional referrals only.

7 October local implementation: [email-backed referral acceptance](email-backed-referral-acceptance-2026-10-07.md)
covers the existing form → directory/member selection → one Send referral → secure
signup/review → authorised patient contact journey. This feature is **not deployed**.
Earlier hosted evidence below does not establish acceptance of its new schema or UI.

6 October technical release update: [real-data release record](real-data-release-record.md) supersedes older technical states below where explicitly verified. Two-role self-entry and private 609-candidate storage/review are deployed; normal clinical supply, sender-domain and hosted participant acceptance remain distinct.

| Gate | Evidence layer | Current state |
|---|---|---|
| Reproducible source, pinned dependencies, both builds | Local + GitHub CI | CI run 37324609509 passed; implementation c420735 is live with matching 14-function/39-migration backend |
| Doctor/practitioner self-entry | Local Auth/DB/browser + hosted source/read checks | Both fictional role journeys pass; doctor gets one new isolated practice and practitioner a private draft; hosted real participant acceptance open |
| Private research supply | Hosted DB/import + local operator browser | 609 candidates/203 flagged, duplicate-safe replay verified; no active profiles or outbound jobs created; hosted operator UI acceptance open |
| Draft/create/invite/claim/review/release/respond/cancel/close | Real local Auth/PostgREST + fresh DB + browser | Implemented; fictional scenarios pass; human clinical journey unperformed |
| Authority-aware credential freshness, policies and capabilities | Fresh DB/local browser | Implemented, fail closed; actual protocols/practitioner evidence require independent approval |
| Bounded directory/inbox and matching | Fresh DB/browser | 5,000 fictional profiles tested, metadata pagination; no AI clinical scoring |
| Distance | Hosted reference data + local DB/browser | One active GeoNames NSW edition, 5,592 localities / 4,525 with coordinates verified on 6 October; unknown coordinates remain unknown, no fabricated distance |
| Wrong account, cross-practice, current role, revoked access, MFA | Local API/DB/browser | Tested; hosted Auth endpoints/configuration and exposed-key rotation still require review |
| Email timeout, frozen retries, exact expiry, suppression, durable callbacks | Local core handlers/DB/browser preview | Implemented; no real provider send in this run |
| App email domain + Auth SMTP + new/returning mailbox | Hosted + human | Blocked on approved sender/support, SMTP and explicit acceptance sends |
| UI mobile/keyboard/recovery | Local browser | Shared controls, long text, 320–1440px, lost reads/responses, multi-tab and module reload; manual screen reader/clinician checks open |
| Production nonce CSP and hydration | Local built Vercel artifact + canonical browser | Local preview passed; fresh hosted welcome hydrates with enabled Google/email controls and no console errors; authenticated hosted navigation still open |
| Notices, identity, consent, handover, retention | Founder + qualified legal/clinical | Draft/blocked; source-controlled evidence references are null |
| Queue health, redacted signals and incident runbook | Local code/DB | Implemented; no approved external alert sink/owner/acknowledgement drill |
| Expired credential cleanup, legal hold guard | Local DB/unit | Existing cleanup preserved; no unapproved clinical purge |
| Restore | Disposable canonical Postgres | Counts preserved; quarantine prevents queued job replay; final 1.189 seconds locally, not hosted RTO |
| Hosted backup/key recovery/rollback/RPO/RTO | Hosted + owner | Unverified; no paid capability purchased or hosted restore performed |
| Exact deployment/pilot recipients/clinical sign-off | Hosted + human | Technical deployment authorised and canonical served identity verified; recipient identities and clinical sign-off remain unperformed |

No P0 is waived by a screenshot, passing build, provider acceptance or dashboard Save. Missing approvals remain visible in the release gate. Final counts and the three corrected Important review findings are in the release record; one minor member-revocation secret-cleanup item remains deferred.
