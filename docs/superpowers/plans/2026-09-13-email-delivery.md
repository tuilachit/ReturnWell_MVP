# ReturnWell Email Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the existing encrypted Supabase email queue to a protected production scheduler and document the remaining provider activation steps.

**Architecture:** Vercel Cron invokes a server-only API route every minute. The route authenticates the Vercel cron request, then calls the already-deployed Supabase `dispatch-email-jobs` Edge Function with its separate worker secret. Resend remains behind that Edge Function; webhook reconciliation stays in Supabase.

**Tech Stack:** Vinext/Next-style route handler, Vercel Cron, Supabase Edge Functions, Resend API, Node test runner.

**Spec:** `docs/superpowers/launch-runbook.md`

## Global Constraints

- Never expose `RESEND_API_KEY`, `EMAIL_WORKER_SECRET`, service-role keys, or invitation encryption keys to the browser.
- Keep `EMAIL_DELIVERY_ENABLED=false` until a verified ReturnWell sender domain and an approved pilot recipient are configured.
- Email templates must remain generic and contain no patient, clinical, postcode, referral-reason, or attachment data.
- Scheduler requests must require `CRON_SECRET`; the Supabase worker must require `EMAIL_WORKER_SECRET`.

### Task 1: Protected scheduler route

**Files:**
- Create: `app/api/cron/dispatch-email-jobs/route.ts`
- Test: `tests/email-cron.test.mjs`

**Interfaces:**
- Produces `GET /api/cron/dispatch-email-jobs` returning `{ ok: true, result }` on a successful worker call.
- Calls `POST ${SUPABASE_URL}/functions/v1/dispatch-email-jobs` with `Bearer ${EMAIL_WORKER_SECRET}` and `{ "limit": 20 }`.

- [ ] Write failing tests for unauthorized, missing configuration, worker failure, and successful dispatch.
- [ ] Implement the minimal route handler with bounded timeout and sanitized errors.
- [ ] Run the focused tests, then the full test suite.

### Task 2: Production schedule wiring

**Files:**
- Modify: `vercel.json`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Vercel Cron invokes `/api/cron/dispatch-email-jobs` every minute on production deployments.
- Required Vercel variables are `CRON_SECRET`, `SUPABASE_URL`, and `EMAIL_WORKER_SECRET`.

- [ ] Add the cron declaration and environment documentation.
- [ ] Run build, lint, and typecheck.

### Task 3: Activation handoff

**Files:**
- Modify: `docs/superpowers/launch-runbook.md`

- [ ] Record the exact hosted steps for verified sender DNS, Resend webhook signing secret, Supabase secrets, Vercel secrets, allowlisted pilot recipients, and a controlled end-to-end test.
- [ ] Keep production delivery disabled until those external prerequisites are complete.
