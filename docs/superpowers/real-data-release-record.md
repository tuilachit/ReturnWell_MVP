# Real-data integration release record — 6 October 2026

Status: reviewed technical release deployed; private candidates imported. Not a clinical go/no-go.

## Scope

Private candidate storage/review plus the user's approved two-role self-entry: doctors create their own new isolated practice, receiving practitioners create their own private profile application. Neither signup nor source import fabricates registration, provider confirmation, operator rights or existing-practice membership. No AI or booking subsystem.

## Target and rollback

- Supabase: `ivutegjvttkrmxctegub`, Sydney, ReturnWellMVP.
- Vercel: ReturnWell / `fitment` / `return-well-mvp`; canonical `https://return-well-mvp.vercel.app`.
- Previous production source: `521f179d5c8f6f431ab6535a80457815f0bb42cb`.
- Previous deployment: `dpl_5Zpy1sfT2zr9BngsCmdYtppkXjSR`. Reviewed implementation commit: `c4207355b8f119d111f710383c00feb8cd4c0977`.
- Fresh pre-change schema/data dumps for public/private/migration history saved in the private local cache, both mode 0600, outside Git. Schema 283,512 bytes; data 960,276 bytes. No hosted restore performed. The data dump warns that circular referral foreign keys require the approved constrained recovery procedure, not blind replay.
- Additive candidate/account schema is compatible with the previous frontend. Prefer forward repair; never reset production or restore sent jobs without reconciling provider receipts. An incorrect candidate batch can be withdrawn without changing clinical profiles or erasing evidence.

## Local evidence

- Independent whole-branch review: no Critical; three Important recovery/concurrency defects fixed with reproduced regressions, plus safe withdrawal cancel.
- Disposable actual Postgres: 92 passed, no failures/skips.
- `npm test`: build succeeded; 164 passed, 7 explicitly separate opt-in skips.
- Typecheck and ESLint passed.
- Final full authenticated browser suite: 89/89 passed with no skips, including both self-entry roles, same-request replay after a rejected retry, real MFA in a separate tab, withdrawal cancellation, existing referral journeys and mobile accessibility.
- Offline Vercel build passed; production-preview CSP/nonce/hydration check 1/1 passed.
- Refreshed authenticated local journey 24/24 passed with no skips; local public/private SQL lint returned no errors. Earlier obsolete invitation-only expectations and a fixture-routing regression were corrected without weakening access checks; final full browser result above supersedes targeted runs.

## Hosted preflight

Before release, production had 35 migrations. Normal linked CLI dry run selected exactly the four audited candidate/account migrations (no seeds or roles). All four were applied through normal history; actual hosted count is now 39. Fresh manifest: 14 functions / 39 migrations, source hash `264108bb9a7f1e596281d18adb144253f2e3b7a5c9a9580ff1aab0ec7190a7d5`.

Before import: 0 practitioner profiles, 0 locations, 0 professional credentials, 6 email jobs, 0 candidate tables. One existing confirmed active operator. No new outbound message, practitioner approval or candidate publication is part of this release.

## Hosted evidence

- Branch CI run `37324609509` passed every step, including fresh local Auth/PostgREST and authenticated browser acceptance. This is not a hosted participant journey.
- All 14 hosted Edge Functions are ACTIVE. Every returned deployment source file was compared byte-for-byte to the reviewed local source and matched; this includes all shared dependencies and the manifest.
- Implementation fast-forwarded to `main` without force. Vercel automatically built production; build log at `2026-10-05T14:36:50.051Z` confirmed `Hosted backend compatible: { functions: 14, migrations: 39 }` before building the frontend.
- Canonical alias resolves to READY production deployment `dpl_2YfQmqf7kQqkNj3mVhzZJVCytmYn`, `return-well-qcxcw7903-fitment.vercel.app`, Git source `c4207355b8f119d111f710383c00feb8cd4c0977` on `main`.
- Fresh canonical browser loads and hydrates with enabled Google/email controls and new-account guidance, without console errors. Anonymous `/account/setup` and `/admin/candidates` show sign-in, not records. These checks did not accept anybody's terms or create a clinical identity.
- Hosted anonymous requests to workspace access, candidate review, referral management and search all returned 401 `unauthorized`. Six new private tables have RLS enabled and no anon/authenticated SELECT grant; workflow/import/health RPCs have no anon/authenticated EXECUTE grant.
- Existing operator's hosted database read returned total 609, two disjoint 50-item pages and a continuation cursor. This is database read acceptance, not an authenticated operator browser journey.
- Security advisors retain the same two categories: intentional service-only RLS/no-policy information and existing leaked-password-protection warning. No new browser grants or permissive policies were added. Password protection remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Import receipt and replay

Fresh dry run matched the approved counts/digest immediately before apply. Batch `8e452d7f-65e5-4986-89ae-0bd9017d5a04` completed with 609 inserted candidates, 609 observations and 203 flagged records. One exact replay returned the same batch ID and `replayed: true`; the replay returns the original receipt's insertion counts, not new inserts.

Actual totals after replay: one batch, 609 candidates, 609 observations, 609 batch items, zero review events. Clinical totals remain zero practitioner profiles/locations/credentials, and email jobs remain six. No candidate was approved, published, linked or emailed by the import.

## Data baseline and remaining rollout gates

Approved three private inputs: 609 source IDs, 203 flagged; digest `334d6105a56b366ee67be3d976017313a31136a6ca869541ecf220dc0d13c3d9`. Candidate research remains private, distinct from the independently confirmed referral directory. There are still zero eligible hosted practitioner profiles and zero enabled professional policies; signup/import does not establish credential evidence.

Sender DNS/mailbox delivery, actual Google-provider/new-user email acceptance, authenticated hosted two-role/recipient journey, approved credential evidence and receiving practitioner confirmation, clinical/privacy/retention ownership, monitored incident ownership and hosted recovery remain separate factual launch gates. Existing private-test/email protections are not silently converted into approvals. The deploy is technically live, but real-patient referrals must not be described as launch-ready from these results.
