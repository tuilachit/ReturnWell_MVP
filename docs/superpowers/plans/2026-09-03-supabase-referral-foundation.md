# ReturnWell Supabase Referral Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an empty-by-default, Supabase-backed referral foundation with tenant isolation, deterministic verified-provider matching, and safely disabled transactional email automation.

**Architecture:** The browser authenticates with Supabase using a publishable key and accesses RLS-protected application tables. Postgres is the source of truth for organisations, verified practitioners, referrals, events and a private-to-clients notification outbox; Edge Functions send generic Resend notifications and process signed delivery webhooks when secrets are configured.

**Tech Stack:** React 19, Vinext, TypeScript 5.9, Supabase Auth/Postgres/Edge Functions, `@supabase/supabase-js`, SQL migrations, Node test runner, Resend HTTP API.

**Spec:** `docs/superpowers/specs/2026-09-03-supabase-referral-foundation.md`

## Global Constraints

- Default UI is empty and contains no fictional practice, doctor, patient, referral or provider identity.
- Demo fixtures require an explicit `Load demo workspace` action.
- Real candidate data is not imported or activated.
- AI, AHPRA PIE, HealthLink and practice-management integrations are excluded.
- No clinical or patient data may enter email subjects, bodies, URLs, logs or webhook metadata.
- All public tables use RLS and explicit least-privilege grants.
- No production email is sent without verified domain and Resend secrets.

---

### Task 1: Supabase schema and tenant security

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/<timestamp>_referral_foundation.sql`
- Test: `tests/referral-foundation.test.mjs`

**Interfaces:**
- Produces: public tables `profiles`, `organisations`, `organisation_memberships`, `practitioners`, `practitioner_locations`, `practitioner_users`, `referrals`, `referral_events`, `communication_preferences`, `notification_outbox`, and `email_delivery_events`.
- Produces: `public.verified_practitioners` security-invoker view and RLS policies scoped by `auth.uid()`.

- [x] Add migration-contract tests that parse the real migration and assert RLS, explicit grants, indexed foreign keys, verified-provider filtering, and zero client policies for notification tables.
- [x] Run `node --test tests/referral-foundation.test.mjs` and confirm it fails because the migration does not exist.
- [x] Generate a migration with the Supabase CLI and implement the constrained schema, indexes, view, trigger and policies.
- [x] Re-run the migration-contract tests and confirm they pass.
- [x] Apply the reviewed migration once to project `ivutegjvttkrmxctegub`, list the created tables, and run Supabase security and performance advisors.

### Task 2: Browser client, invitation-only auth, and clean new-user UI

**Files:**
- Create: `.env.example`
- Create: `app/lib/supabase.ts`
- Create: `app/auth-gate.tsx`
- Create: `app/types.ts`
- Modify: `app/page.tsx`
- Modify: `app/doctor-portal.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `getSupabaseBrowserClient()` returning a singleton browser client or `null` when public configuration is absent.
- Produces: `AuthGate` that uses passwordless sign-in with `shouldCreateUser: false`, session listening and sign-out.
- Consumes: authenticated session and organisation/referral rows from Task 1.

- [x] Replace rendered-page expectations with a clean `0 referrals` empty state, blank form defaults, no fictional identity, and explicit demo opt-in.
- [x] Run the UI tests and confirm failure against the fictional-by-default portal.
- [x] Pin and install `@supabase/supabase-js`, add public configuration documentation, and implement the browser client.
- [x] Implement the invitation-only auth gate and loading/error states.
- [x] Refactor the portal to receive an authenticated user, load the user organisation/referrals, render a clean empty state, and keep fixtures only behind explicit demo mode.
- [x] Re-run UI tests and lint until they pass.

### Task 3: Deterministic shortlist and referral persistence

**Files:**
- Create: `app/lib/matching.ts`
- Create: `app/lib/referrals.ts`
- Create: `tests/matching.test.mjs`
- Create: `tests/notification.test.mjs`
- Modify: `app/doctor-portal.tsx`

**Interfaces:**
- Produces: `matchPractitioners(practitioners, needs)` returning ordered `MatchedPractitioner` records with literal reason strings and no percentage score.
- Produces: `createReferral(client, input)` which inserts the referral and returns the persisted row.
- Consumes: `verified_practitioners`, `referrals`, and the database trigger from Task 1.

- [x] Write table-driven tests for profession, format, funding, language, active verification and stable reason ordering.
- [x] Run matching tests and confirm they fail because the module is absent.
- [x] Implement the pure matcher and confirm matching tests pass.
- [x] Add referral input validation tests for blank references, invalid Australian postcodes, missing consent and missing practitioner selection.
- [x] Implement validated Supabase reads/inserts and replace the local-only submit path.
- [x] Re-run matching, notification and rendered UI tests.

### Task 4: Transactional email outbox and Edge Functions

**Files:**
- Create: `supabase/functions/send-referral-notification/index.ts`
- Create: `supabase/functions/resend-webhook/index.ts`
- Create: `supabase/functions/_shared/email.ts`
- Create: `supabase/functions/.env.example`
- Modify: `tests/notification.test.mjs`

**Interfaces:**
- Produces: `buildNotification(job, appUrl)` returning a generic subject/body/link with no patient or clinical fields.
- Produces: authenticated `send-referral-notification` Edge Function that sends one pending job with a stable `Idempotency-Key` and updates its status.
- Produces: public `resend-webhook` endpoint that rejects invalid signatures and records delivery state.

- [x] Write notification tests proving generic content, safe URLs, stable idempotency and rejection of forbidden patient/clinical payload keys.
- [x] Run notification tests and confirm they fail because the shared email module is absent.
- [x] Implement the pure email payload builder and signature verifier, then confirm unit tests pass.
- [x] Implement the authenticated dispatcher with missing-secret failure, bounded retries, and outbox status updates.
- [x] Implement the webhook receiver with timestamp tolerance, constant-time signature comparison and replay-safe provider-event IDs.
- [x] Deploy functions only after local tests pass; leave sending disabled when `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, or `APP_URL` is absent.

### Task 5: Documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Documents: local configuration, invitation-only accounts, migration workflow, email-secret gate, demo mode, and prohibited real-data usage.

- [x] Update the README with exact setup and safety boundaries.
- [x] Run the full test suite, lint and production build.
- [x] Re-index the repository with `ccc index`.
- [x] Verify the local page in a browser: meaningful content, no error overlay, no console error, clean empty state and explicit demo action.
- [x] Re-list Supabase tables/functions and re-run both advisor categories.
- [x] Report completed behaviour separately from blocked production configuration.
