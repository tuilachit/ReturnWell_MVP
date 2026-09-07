# ReturnWell Practitioner Review Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in this session. Steps use checkbox (`- [ ]`) syntax. The product design is approved; do not repeat product-approval questions.

**Goal:** A practitioner can submit a confirmed profile; only a ReturnWell operator can activate it after checking identity and registration.

**Architecture:** Extend the account-owned application introduced in plan 01. Separate applicant-editable data from immutable private review evidence. Publish approved fields and grant the practitioner link in one Postgres transaction.

**Tech Stack:** Existing React/Vinext, TypeScript, Supabase Postgres/Edge Functions and Node tests.

**Spec:** `docs/superpowers/specs/2026-09-07-invitation-onboarding-and-referral-response.md`

**Dependencies:** Complete `2026-09-07-01-invitations-and-signup.md`, especially verified actor helpers, application draft ownership, workspace routing and local test fixtures. Implement this before practitioner referral access.

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

- `app/lib/practitioner-onboarding.ts`: typed profile/client operations.
- `app/onboarding/page.tsx`, `app/onboarding/practitioner-profile-form.tsx`: account-owned form, save, submit and review feedback.
- `app/admin/practitioners/page.tsx`, `app/admin/practitioners/application-review.tsx`: operator queue and explicit decisions.
- `app/lib/workspace-access.ts`, `app/auth-gate.tsx`, `app/globals.css`: pending/approved role routing and styles.
- `supabase/functions/_shared/practitioner-profile.ts`: input schema and meaningful validation.
- `supabase/functions/practitioner-onboarding/index.ts`, `review-practitioner/index.ts`: authenticated endpoints.
- CLI-generated `practitioner_review` migration: review evidence, versioned write transactions, practitioner linkage revocation and policies.
- `tests/practitioner-profile.test.mjs`, `tests/integration/practitioner-review.test.mjs`, `tests/browser/practitioner-review.spec.ts`: validation, atomic permissions and UI journeys.
- `docs/operator-onboarding.md`, `README.md`: review procedure and verification record.

## Task 1: Confirmed profile contract and form

**Produces:** `validatePractitionerProfile(profile: PractitionerProfile): Record<string, string>` and `saveApplication(client, input): Promise<Application>`.
**Consumes:** Authenticated applicant's draft from plan 01.

```ts
type PractitionerProfile = {
  displayName: string; profession: "physiotherapist" | "psychologist";
  registrationNumber: string; practiceName: string;
  services: string[]; funding: string[]; languages: string[];
  telehealth: boolean | null; acceptingNewReferrals: boolean | null;
  locations: Array<{
    suburb: string; postcode: string; state: "NSW"; isPrimary: boolean;
  }>;
};
type Application = {
  id: string; userId: string; version: number;
  status: "draft" | "submitted" | "changes_requested" | "approved" | "rejected";
  profile: PractitionerProfile; applicantFeedback: string | null;
  practitionerId: string | null;
};
```

Nullable boolean form values represent unanswered questions. The submission contract and published record require explicit booleans. Draft save accepts incomplete fields; submit applies the spec's full field lengths, arrays, location and confirmation rules.

- [ ] Write the following test plus cases for empty name/services, malformed postcode, multiple primary locations, oversized arrays and invalid profession.

```js
import assert from "node:assert/strict";
import test from "node:test";
import { validatePractitionerProfile } from "../supabase/functions/_shared/practitioner-profile.ts";

test("unanswered availability does not become permission to receive referrals", () => {
  const errors = validatePractitionerProfile({
    displayName: "Fictional Practitioner", profession: "physiotherapist",
    registrationNumber: "TEST-REG-001", practiceName: "Example Practice",
    services: ["Physiotherapy"], funding: [], languages: ["English"],
    telehealth: true, acceptingNewReferrals: null, locations: [],
  });
  assert.ok(errors.acceptingNewReferrals);
});
```

- [ ] Run `node --test tests/practitioner-profile.test.mjs` and confirm it fails before implementing the schema.
- [ ] Implement strict profile parsing with unknown-field rejection; preserve unanswered values in drafts. Validate registration input as a string without claiming a pattern proves registration.
- [ ] Build the profile form with save/resume, labelled errors and explicit confirmation of profile and referral consent on submit. For no physical location, require telehealth=true and show that only telehealth is offered. Do not preload candidate data.
- [ ] Display `changes_requested` feedback with editable draft and a new submission version. Keep submitted/approved records read-only. For 409 retain user-entered values and show a reload/reconcile action; never overwrite the newer server version automatically.
- [ ] Run the unit tests and browser form tests for keyboard navigation and persisted draft recovery.

## Task 2: Review permissions and transactional activation

**Produces:** `rw_save_application(p_actor uuid, p_input jsonb)`, `rw_submit_application(p_actor uuid, p_input jsonb)`, `rw_review_application(p_actor uuid, p_input jsonb)`, `rw_set_availability(p_actor uuid, p_input jsonb)`. Service-only execution follows plan 01's verified actor pattern.
**Consumes:** Application ownership, private operator membership and reviewed inviter records.

- [ ] Create the migration with `npx --no-install supabase migration new practitioner_review` after confirming help/version and the isolated local test target.
- [ ] Extend local fixtures with a submitted application, a second applicant, an operator and an approved unrelated practitioner. Add helpers `submitApplication(actor, profile)` and `reviewApplication(actor, applicationId, expectedVersion, decision, evidence)` that call the actual local Edge handlers, not a mock permission layer.
- [ ] Add integration tests proving: applicant cannot approve itself or write trust fields; non-operator cannot review; operator cannot approve own application; doctor cannot read review evidence; stale application version cannot activate; duplicate normalised registration requires manual resolution; revoked operator cannot approve with an existing session.
- [ ] Implement review evidence and approval transaction. Approval locks the submitted application, validates consent and evidence fields, detects conflicting registration, creates practitioner/locations/link, records review and marks application approved. Apply a unique normalised registration index only after checking existing rows for conflicts; do not auto-merge or overwrite a claimed practitioner.
- [ ] Add active/revoked fields to `practitioner_users`, and update all referral SELECT and event policies to check them and approved lifecycle. Paused availability does not revoke existing assignments. No browser grant allows updating trust flags or editing reviews.
- [ ] Keep applicant-visible feedback in the application response. Internal identity evidence, reviewer notes and contact checks never enter the public directory or doctor invitation list. Validate feedback length and reject clinical attachment fields.
- [ ] Test rollback by inducing a location/link constraint failure after approval starts. Assert application remains submitted and no practitioner/link/review partially commits. Test two simultaneous approvals leave exactly one practitioner and one approval review.

Add `createLocalReviewFixture()` to `tests/integration/fixtures.mjs`. It returns `{applicationId, submittedVersion, operator, reviewApplication, publishedCount, close}` for a unique submitted application. `reviewApplication` invokes the local review handler; `publishedCount` counts practitioners linked to that fixture application using the local admin client. `operator` is `{client, userId}`. This concrete stale-review test must fail before version enforcement:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalReviewFixture } from "./fixtures.mjs";

test("a stale review cannot publish an application", async () => {
  const f = await createLocalReviewFixture();
  try {
    await assert.rejects(() => f.reviewApplication(f.operator, {
      applicationId: f.applicationId,
      expectedVersion: f.submittedVersion - 1,
      decision: "approved",
      identityEvidence: { method: "independent_practice_contact", matched: true,
        reference: "fixture-contact-check", checkedAt: new Date().toISOString() },
      registrationEvidence: { method: "manual_register", registrationNumber: "TEST-REG-001",
        matched: true, reference: "fixture-register-check", checkedAt: new Date().toISOString() },
      applicantFeedback: "", requestId: crypto.randomUUID(),
    }), { status: 409 });
    assert.equal(await f.publishedCount(), 0);
  } finally { await f.close(); }
});
```

The HTTP test helper throws an Error with a numeric `status` property for non-2xx responses. Use the same evidence field names in handler validation and in the review JSON stored by the transaction. These are fictional test references, never evidence of a real registration.

## Task 3: Operator review screen and availability

**Consumes:** Operator permission and application transaction APIs.
**Produces:** Real review queue/details; approved practitioner routing; availability control.

- [ ] Add browser tests that a pending practitioner sees review status and no doctor/practitioner inbox, that direct admin navigation rejects a non-operator, and that an operator can request corrections and then approve the resubmitted version.
- [ ] Implement the operator list with submitted applications and status filters; detail shows submitted version, confirmation timestamps and separate identity/registration evidence fields. Require checked identity comparison, recorded evidence reference and check time for approval. A failed check cannot be marked approved.
- [ ] Implement `decide` using the submitted expectedVersion and a client operation UUID. Disable duplicate submissions while pending; recover network errors using the same operation UUID. Render persisted decision and actor/time after success.
- [ ] Add approved applicant route to `/practitioner`, initially a truthful empty inbox until plan 03. The operator route must not grant access to clinical records. Multi-role users keep the chooser from plan 01.
- [ ] Implement availability via the narrow endpoint. Only the linked approved practitioner can change the boolean. Do not overload pause with lifecycle revocation or reset review timestamps.
- [ ] Verify direct Data API access: pending users cannot read directory/locations; approved paused users can read their own profile and assigned referrals; revoked links cannot. Existing doctors see approved, accepting practitioners only.
- [ ] Update operator documentation with the manual identity/contact and register check procedure, immutable evidence requirement, duplicate-registration escalation and availability/withdrawal distinction.

## Stage completion

Run unit, actual local RLS/transaction and browser tests, then lint/typecheck/build. Deliver a confirmed profile submission and operator activation flow. Record any missing runtime evidence. Continue plan 03 with fictional approved fixtures. Real registrations and recipient identities require actual operator checks and are never inferred from test fixtures or public names.
