# ReturnWell Practitioner Referral Response Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in this session. Steps use checkbox (`- [ ]`) syntax. The product design is approved; do not repeat product-approval questions.

**Goal:** An approved practitioner can accept or decline an assigned referral, and the doctor sees an accurate timeline and notification state.

**Architecture:** A server-authenticated SQL transaction owns the response, audit event and notification intent. Both portals read the same records under RLS. The private email worker introduced in plan 01 handles every new message independently.

**Tech Stack:** Existing React/Vinext, TypeScript, Supabase Postgres/Edge Functions, Node tests and the local browser test runner from plan 01.

**Spec:** `docs/superpowers/specs/2026-09-07-invitation-onboarding-and-referral-response.md`

**Dependencies:** Plans 01 and 02 completed locally. Use their verified actor helper, approved account linkage, operator roles, private worker and fictional test fixtures.

## Global Constraints

- Work in `/Users/ReturnWellMvp/prototype`; preserve existing uncommitted files.
- Keep React 19.2.8, Vinext 1.0.0-beta.9, TypeScript 5.9.3 and supabase-js 2.114.0 unless a demonstrated compatibility problem requires a change; Node must be at least 22.13.0.
- Default workspaces are empty. Fictional fixtures require explicit demo opt-in and never write to the hosted project.
- Do not import, expose or send invitations to the private 200-practitioner candidate dataset.
- Invitations identify the actual authorised inviter and practice; never invent endorsements, testimonials, registration or business details.
- Patient and clinical details stay out of email content, invitation URLs, provider metadata and application logs.
- Account creation and email verification do not grant directory publication or referral access.
- Public tables use RLS and explicit grants; privileged credentials stay on the server.
- Build and test locally first. Hosted migrations, configuration changes and actual invitation sends are distinct release actions with explicit targets and recipients.
- AI ranking, maps, clinical attachments, booking, patient self-selection, automatic AHPRA access and practice-management integration are outside this phase.

## File responsibilities

- `app/practitioner/page.tsx`, `app/practitioner/practitioner-inbox.tsx`: assigned referral list, detail and response controls.
- `app/lib/practitioner-referrals.ts`: list/detail/response/event client APIs.
- `app/lib/referrals.ts`, `app/types.ts`: version and event types shared with doctor.
- `app/referrals/[id]/page.tsx`, `app/auth-gate.tsx`, `app/lib/workspace-access.ts`: preserve the requested referral through authentication and role selection.
- `app/doctor-portal.tsx`, `app/referrals/referral-timeline.tsx`, `app/globals.css`: real timeline and refreshed doctor state.
- `supabase/functions/_shared/referral-response.ts`: decision and payload validation.
- `supabase/functions/respond-to-referral/index.ts`: authenticated handler.
- `supabase/functions/dispatch-email-jobs/index.ts`, `supabase/functions/send-referral-notification/index.ts`, `supabase/functions/resend-webhook/index.ts`: durable dispatch, compatible user-triggered kick and webhook reconciliation.
- CLI-generated `referral_response` migration: version, response ledger, atomic write RPC, email bridge and permissions.
- `tests/referral-response.test.mjs`, `tests/integration/referral-response.test.mjs`, `tests/email-dispatch.test.mjs`, `tests/browser/referral-loop.spec.ts`: local end-to-end evidence.
- `docs/operator-onboarding.md`, `README.md`: known deployment configuration and verification results.

## Task 1: Response contract and atomic database operation

**Produces:** `validateResponse(input: ResponseInput): string[]`, `canRespond(status: Referral["status"]): boolean`, `rw_respond_to_referral(p_actor uuid, p_input jsonb)`.

```ts
type ResponseInput = {
  referralId: string; expectedVersion: number; requestId: string;
  decision: "accepted" | "declined";
  reasonCode?: "capacity" | "service_not_offered" | "funding_not_supported" | "other";
  note?: string;
};
type ReferralEvent = {
  id: number; referralId: string; actorUserId: string | null;
  eventType: "created" | "sent" | "accepted" | "declined" | "booked" | "cancelled" | "reminder_requested";
  createdAt: string;
  details: { reasonCode?: ResponseInput["reasonCode"]; note?: string };
};
type ResponseResult = {
  referralId: string; status: "accepted" | "declined"; version: number;
  updatedAt: string; event: ReferralEvent;
  notification: "pending" | "configuration_needed" | "suppressed";
};
```

- [ ] Add tests with fixed input IDs and all existing statuses. Accepted decisions reject decline reason fields; declined decisions require a supported reason and at most a 500-character note; unknown clinical payload fields reject.

```js
import assert from "node:assert/strict";
import test from "node:test";
import { canRespond, validateResponse } from "../supabase/functions/_shared/referral-response.ts";

test("acceptance is a one-way decision from an awaiting referral", () => {
  assert.equal(canRespond("sent"), true);
  for (const status of ["accepted", "declined", "booked", "cancelled"]) {
    assert.equal(canRespond(status), false);
  }
  const errors = validateResponse({
    referralId: "00000000-0000-4000-8000-000000000010",
    requestId: "00000000-0000-4000-8000-000000000011",
    expectedVersion: 0, decision: "declined",
  });
  assert.ok(errors.length > 0);
});
```

- [ ] Run `node --test tests/referral-response.test.mjs`, confirm the missing implementation failure, and implement the pure rules.
- [ ] Create the migration with the installed CLI's `migration new referral_response`. Add referrals.version default 0 and a private response request ledger unique by actor/requestId. Keep authenticated clients without direct UPDATE.
- [ ] Implement the RPC: recheck active approved practitioner/link for the locked referral; replay exact prior request; reject key/payload mismatch; require matching expected version and sent status; persist status/version, structured event and generic outbox row; save the request result atomically. If organisation.notification_email is absent, store configuration-needed notification intent and return a truthful state.
- [ ] Remove the existing status-trigger event/outbox effect for this response path and transfer responsibility to the RPC. Preserve the existing create-referral trigger. The RPC must write the verified p_actor as the event actor; never rely on service-role auth.uid(). Test no duplicate events or messages.
- [ ] Implement the handler using the shared auth/CORS helpers. Reject unknown fields and malformed UUIDs. Return 404 for unassigned/missing records, 409 for stale or conflicting decisions, 422 for invalid response fields, and 401 for absent/invalid session. Do not leak a clinical error body.
- [ ] Add local SQL/API tests: unrelated practitioner and doctor cannot decide; a revoked link blocks the same previously authenticated user; both conflicting concurrent requests yield only one committed decision; identical retries return the original result.

Use real concurrency rather than running the two decisions serially:

```js
// createLocalReferralFixture builds on plan 01/02 fixtures and returns this
// assigned-practitioner HTTP helper plus admin test counts and scoped cleanup.
const outcomes = await Promise.allSettled([
  fixture.respond({ ...base, decision: "accepted", requestId: firstRequest }),
  fixture.respond({ ...base, decision: "declined", reasonCode: "capacity", requestId: secondRequest }),
]);
assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
assert.deepEqual(await fixture.responseCounts(base.referralId), {
  decisions: 1, events: 1, notifications: 1,
});
```

Define `createLocalReferralFixture()` in `tests/integration/fixtures.mjs`: it provisions one approved linked practitioner, one unrelated practitioner and one sent fictional referral; `respond(input)` calls the local handler with the assigned user's bearer; `responseCounts(id)` uses the local admin client to count only response ledger/events/outbox rows; `close()` deletes only its run's fixture IDs. Declare base and request UUIDs in the test with `crypto.randomUUID()`.

## Task 2: Practitioner inbox, exact links and shared timeline

**Produces:** `listAssignedReferrals(client, practitionerId)`, `getReferral(client, referralId)`, `listReferralEvents(client, referralId)`, `respondToReferral(client, input)`.
**Consumes:** Existing Referral type extended with `version: number`, ResponseResult and RLS from plans 01/02.

- [ ] Add browser tests for empty inbox, assigned-only list, accept, decline with validation, expired session and stale version. Set up fixture state through the isolated local test helper.
- [ ] Build the practitioner inbox with awaiting, accepted and declined filters. Keep the full clinical detail inside the authenticated detail screen. No patient data in route/title/analytics or console logging. Keep decline notes in portal requests only.
- [ ] Add confirmation before final response, pending state, recoverable errors and repeat-request IDs across retries. Show acceptance wording as agreement to handle the referral; do not mark booked.
- [ ] Preserve exact referralId across AuthGate/workspace choice and passwordless login. Use only allowlisted internal paths. Both a referring doctor and assigned practitioner opening the same link must reach its detail; another user gets the unavailable state.
- [ ] Extract a shared timeline component reading real events and persisted actor/time/decline feedback. Replace the doctor detail's hard-coded stages. Add focus refresh and a visible-tab 30-second refresh with cleanup; retain the current workspace guard against late async results.
- [ ] Distinguish clinical response from delivery: show persisted accepted/declined even if email is pending or failed. Mask operator-only delivery diagnostics from practitioner/doctor UI. Provide safe delivery summaries through an authorised function rather than granting clients email-job table reads.
- [ ] Verify sign-out clears clinical state; role switch cannot momentarily show another workspace's data. Verify keyboard focus, mobile form layout and direct-link recovery.

## Task 3: Reliable notification dispatch and webhook processing

**Consumes:** Private email_jobs from plan 01 and referral notification_outbox.
**Produces:** Exactly one private worker job per source referral-outbox row; each clinical event keeps its own stable key.

- [ ] Add tests with a fake transport for a previously sent referral-created message followed by a newly queued accepted message. The second job must still be dispatched; sent jobs must never win the next-job selection.
- [ ] Bridge notification_outbox to email_jobs with unique source_outbox_id. Copy only safe notification identifiers, recipient and generic template kind. Stage the bridge for existing rows: historical sent rows remain sent, unsent rows get exactly one job, already suppressed recipients remain suppressed.
- [ ] Implement transactional worker leasing with SKIP LOCKED, now >= due_at, a two-minute lease, capped batch 20 and lease-matching completion. Recover abandoned processing jobs. Use the spec's five-attempt schedule and same payload/idempotency key on retry.
- [ ] Replace send-referral-notification's earliest-row query with an authorised queue kick for pending jobs belonging to that referral. Validate the caller's current referral access before any service query. It must not resend sent jobs or claim global worker authority. Worker credentials never leave the server.
- [ ] Check server delivery-enabled configuration, recipient suppression, current source event and invite generation before send. A revoked invite or suppressed recipient terminates its job; transient network errors retain it. Missing config pauses attempts.
- [ ] Change the webhook to persist a signature-verified event once before provider-ID association. Reconcile events arriving before the provider response is committed. Bounce/complaint/provider suppression set terminal state and prevent future sends to that scope; do not set them to generic retryable failed.
- [ ] Cover timeout-after-send plus retry, two workers competing, stale lease completion, duplicate and out-of-order webhooks, a webhook before send acknowledgement, configuration pause, and the 24-hour ambiguous-send cutoff. Display operator review for unresolved ambiguous jobs beyond that window.
- [ ] Write the hosted scheduler setup as a separate operator step using Supabase Cron/Vault: every-minute internal worker, fixed HTTPS project endpoint, server-held secret and bounded payload. Read current Cron/Vault/pg_net docs and verify command shapes when implementing; do not activate scheduling or generate live emails during local tests.

## Task 4: Whole-loop verification and handoff

- [ ] Run a local browser journey: doctor invites known fictional practitioner → mailbox verification → signup → profile submission → operator verifies fixture evidence → practitioner published → doctor creates fictional referral → practitioner accepts → doctor sees the response and timeline.
- [ ] Run a separate decline journey with an assigned second referral. Assert the doctor receives the decline reason in the portal and the fake email receives no patient/clinical fields.
- [ ] Attempt the complete journey with an unrelated account, revoked link, direct service-RPC call, stale response and duplicate request. Prove database row/event/job counts as well as HTTP errors.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, the local integration suite and browser suite. Report their actual results, including any unavailable environment.
- [ ] Update README and operator guide with the complete workflow, explicit release inputs, migration-history reconciliation and the distinction between local tested work and deployed live behaviour. No real sends or production-ready claims based only on local tests.
- [ ] Review only task-owned changes and remove unused scaffolding. If committing, stage explicit files after reviewing the staged diff; never stage the whole initially uncommitted repository.

## Definition of done

The fictional local workflow completes for both accept and decline; permission tests use an actual database; the same referral link works for both authorised roles; email failures do not affect clinical state; response history is durable and correctly attributed. Production activation remains a separate operation once the domain, identities, recipients and deployment configuration are known.
