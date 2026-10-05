# Real-data integration release record — 6 October 2026

Status: reviewed local release; hosted acceptance in progress, not a clinical go/no-go.

## Scope

Private candidate storage/review plus the user's approved two-role self-entry: doctors create their own new isolated practice, receiving practitioners create their own private profile application. Neither signup nor source import fabricates registration, provider confirmation, operator rights or existing-practice membership. No AI or booking subsystem.

## Target and rollback

- Supabase: `ivutegjvttkrmxctegub`, Sydney, ReturnWellMVP.
- Vercel: ReturnWell / `fitment` / `return-well-mvp`; canonical `https://return-well-mvp.vercel.app`.
- Previous production source: `521f179d5c8f6f431ab6535a80457815f0bb42cb`.
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

Production currently has 35 migrations. Normal linked CLI dry run selects exactly the four audited candidate/account migrations (no seeds or roles). Fresh manifest: 14 functions / 39 migrations, source hash `264108bb9a7f1e596281d18adb144253f2e3b7a5c9a9580ff1aab0ec7190a7d5`.

Before import: 0 practitioner profiles, 0 locations, 0 professional credentials, 6 email jobs, 0 candidate tables. One existing confirmed active operator. No new outbound message, practitioner approval or candidate publication is part of this release.

Hosted migration/function/frontend deployment, served source identity, import receipt/replay, advisors and authenticated acceptance: pending.

## Data baseline and remaining rollout gates

Approved three private inputs: 609 source IDs, 203 flagged; digest `334d6105a56b366ee67be3d976017313a31136a6ca869541ecf220dc0d13c3d9`. Revalidate before apply and retain count-only receipts. Candidate research remains private, distinct from the independently confirmed referral directory.

Sender DNS/mailbox delivery, actual Google-provider/new-user email acceptance, approved credential evidence and receiving practitioner confirmation, clinical/privacy/retention ownership, monitored incident ownership and hosted recovery remain separate factual launch gates. Existing private-test/email protections are not silently converted into approvals.
