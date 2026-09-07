# ReturnWell Invitations and Signup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in this session. Steps use checkbox (`- [ ]`) syntax. The product design is approved; do not repeat product-approval questions.

**Goal:** An authorised inviter can prepare a credible invitation, and the intended recipient can create or reuse an account without premature clinical privileges.

**Architecture:** Supabase Auth proves mailbox control. Edge Functions validate actors and token-scoped public requests; service-role-only Postgres transactions own invitation and membership transitions. A private queue sends through an injected local transport or configured Resend adapter.

**Tech Stack:** Existing React/Vinext, TypeScript, Supabase Auth/Postgres 17/Edge Functions, Resend, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-invitation-onboarding-and-referral-response.md`

**Dependencies:** Existing September 3 foundation. This stage creates the application draft consumed by plan 02. Keep submission/approval UI unavailable until plan 02 is implemented.

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

- `app/lib/invitations.ts`: client calls, input types and input validation.
- `app/lib/workspace-access.ts`: actor's permitted workspace list and destination resolution.
- `app/invitations/page.tsx`, `app/invitations/invitation-manager.tsx`: scoped invite form, preview and progress.
- `app/join/page.tsx`, `app/join/invitation-entry.tsx`: public invitation presentation and intentional signup/decline.
- `app/auth/confirm/page.tsx`, `app/auth/confirm/confirm-account.tsx`: explicit verification, claim and recovery.
- `app/auth-gate.tsx`, `app/types.ts`, `app/globals.css`: workspace routing and shared visual styles.
- `supabase/functions/_shared/invitation-policy.ts`: token/status/email rules, no environment access.
- `supabase/functions/_shared/invitation-email.ts`: escaped text/HTML from a strict allowed-field payload.
- `supabase/functions/_shared/http.ts`: no-store responses, method/body validation and allowlisted CORS.
- `supabase/functions/_shared/actor.ts`: verified auth user and current permissions.
- `supabase/functions/_shared/email-transport.ts`: fake/test and Resend transport boundary.
- `supabase/functions/_shared/credential-envelope.ts`: AES-GCM encryption of queued token payloads, versioned server key.
- `supabase/functions/manage-invitations/index.ts`, `invitation-entry/index.ts`, `claim-invitation/index.ts`, `workspace-access/index.ts`, `dispatch-email-jobs/index.ts`: HTTP entrypoints under `supabase/functions/`.
- CLI-generated `invitation_signup` migration: records, grants, policies and transaction functions defined below.
- `tests/invitation-policy.test.mjs`, `tests/invitation-email.test.mjs`, `tests/invitation-handlers.test.mjs`: executable behaviour tests.
- `tests/integration/invitations.test.mjs`, `tests/integration/fixtures.mjs`: local database/auth enforcement.
- `tests/browser/invitations.spec.ts`, `playwright.config.ts`: new browser journey suite, pin its dependency if the runtime does not already provide a runner.
- `docs/operator-onboarding.md`, `README.md`: test setup, role bootstrap and release inputs.

## Task 1: Token policy and account contracts

**Produces:** `normalizeEmail(value: string): string`, `invitationAvailability(invitation, now): "pending" | "claimed" | "declined" | "revoked" | "expired"`, `canClaim(invitation, actor, now): boolean`, `createToken(): Promise<{token: string; hash: string}>`.

**Input types:**

```ts
type Invitation = {
  id: string; recipientEmailNormalized: string;
  status: "pending" | "claimed" | "declined" | "revoked";
  expiresAt: string; generation: number; version: number;
  claimedBy: string | null;
};
type VerifiedActor = { id: string; email: string; emailConfirmed: boolean };
type WorkspaceAccess = {
  doctors: Array<{ organisationId: string; organisationName: string; role: string }>;
  practitioners: Array<{ practitionerId: string; displayName: string }>;
  applicationId: string | null; operator: boolean;
};
```

- [ ] Add the policy tests with fixed timestamps, including the following complete case and a table of claimed/revoked/expired/unconfirmed actors.

```js
import assert from "node:assert/strict";
import test from "node:test";
import { canClaim, normalizeEmail } from "../supabase/functions/_shared/invitation-policy.ts";

test("a forwarded invitation cannot bind another verified email", () => {
  const invitation = {
    id: "00000000-0000-4000-8000-000000000001",
    recipientEmailNormalized: "physio@example.test",
    status: "pending", expiresAt: "2026-09-14T00:00:00Z",
    generation: 1, version: 0, claimedBy: null,
  };
  const now = new Date("2026-09-07T00:00:00Z");
  assert.equal(canClaim(invitation, {
    id: "user-b", email: "someone-else@example.test", emailConfirmed: true,
  }, now), false);
  assert.equal(canClaim(invitation, {
    id: "user-a", email: "Physio@example.test", emailConfirmed: true,
  }, now), true);
  assert.equal(normalizeEmail("Physio+work@example.test"), "physio+work@example.test");
});
```

- [ ] Run `node --test tests/invitation-policy.test.mjs`; confirm missing-module failure before implementation.
- [ ] Implement pending-state/time/email checks and random token generation with `crypto.getRandomValues(new Uint8Array(32))`, base64url and SHA-256. Keep claim enforcement in SQL as well as this pure helper.
- [ ] Add a collision sanity test and hash-not-equal-to-token assertion; run the policy suite. Tests never depend on a real email provider.

## Task 2: Local persistence, atomic claim and doctor bootstrap

**Produces:** The invitation, secret, auth-attempt, event, email-job/suppression, reviewed inviter and operator tables from the spec, plus `practitioner_applications` with its complete columns. Adds no candidate import.

**Service-only RPCs:** `rw_create_invitation(p_actor uuid, p_input jsonb)`, `rw_manage_invitation(p_actor uuid, p_operation text, p_input jsonb)`, `rw_claim_invitation(p_actor uuid, p_input jsonb)`. Each returns JSON matching the HTTP contract. `p_actor` is set only by verified Edge handlers. Public and authenticated roles cannot execute them.

- [ ] Discover installed CLI commands via `npx --no-install supabase --help` and `npx --no-install supabase migration new --help`. Inspect local stack status before starting an isolated test stack. Create `invitation_signup` using the CLI; use its actual filename, not a guessed timestamp. Check source baseline replays including `public.rls_auto_enable()` existence; make any compatibility adjustment a guarded migration, not an invented hosted object.
- [ ] Implement fixture helpers in `tests/integration/fixtures.mjs`: `createLocalFixture()` returns `{admin, doctorA, doctorB, pendingApplicant, organisationA, organisationB, close}`. `admin` and `pendingApplicant` are SupabaseClient instances; doctorA/doctorB are `{client: SupabaseClient, userId: string}`; organisationA/B are UUID strings. Require an explicit test URL/key with hostname `127.0.0.1` or `localhost`; reject any hosted URL before writing. Seed unique fictional users/practices under that test run ID. `close()` removes only those recorded fixture IDs. Never use the current browser environment as the test destination.
- [ ] Write the access test below, plus duplicate claim, claim/revoke concurrency and elevated-role injection tests. Run against the local stack and record actual access failures before implementation.

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalFixture } from "./fixtures.mjs";

test("pending account cannot enumerate directory or execute privileged claim", async () => {
  const f = await createLocalFixture();
  try {
    const { data, error } = await f.pendingApplicant
      .from("verified_practitioners").select("id");
    assert.equal(error, null);
    assert.deepEqual(data, []);
    const forged = await f.pendingApplicant.rpc("rw_claim_invitation", {
      p_actor: f.doctorA.userId, p_input: {},
    });
    assert.ok(forged.error);
  } finally { await f.close(); }
});
```

- [ ] Implement the spec's fields/constraints and explicit grants. Add request deduplication unique by actor/requestId in a private mutation ledger; retain operation type and payload hash. Use row locking for claim/resend/revoke. The claim transaction verifies the stored attempt, generation, auth.users email confirmation and recipient match, rechecks inviter/practice status, then writes either a referrer membership or a draft application. Reuse that user's existing unfinished application or owned approved workspace for a second practice invitation; never claim somebody else's practitioner by email. Retry with the same actor/request returns the original IDs.
- [ ] Restrict directory and location policies to active approved workspaces, preserving own-profile reads for approved practitioners. Implement lookup helpers without RLS recursion; if a policy needs privileged membership lookup, put its narrow `SECURITY DEFINER` function in private, fix search_path and revoke default EXECUTE. Service transaction functions themselves are `SECURITY INVOKER`, with EXECUTE granted only to service_role.
- [ ] Write `docs/operator-onboarding.md` with parameterised bootstrap SQL for a pre-existing confirmed operator auth UUID, reviewed practice, notification email and owner membership. Require independent confirmation of supplied identity before marking reviewed. No auth account or email is created by a migration or seed run.
- [ ] Execute the local DB tests, including simultaneous claims and cross-practice reads. Compare application, membership and audit counts, not merely success responses.

## Task 3: Credible email and intentional signup endpoints

**Consumes:** The records/RPCs from task 2 and token helper from task 1.
**Produces:** HTTP endpoints from the spec; `buildInvitationEmail(context)`; `sendEmail(message, transport)`. The transport returns `{providerMessageId: string}` and accepts a stable idempotency key.

```ts
type InvitationEmailContext = {
  inviterName: string; practiceName: string; recipientName: string;
  invitationUrl: string; websiteUrl: string; supportEmail: string;
  businessName: string; privacyUrl: string; expiresAt: string;
};
type EmailMessage = {
  to: string; subject: string; text: string; html: string; idempotencyKey: string;
};
type EmailTransport = { send(message: EmailMessage): Promise<{providerMessageId: string}> };
```

- [ ] Add test fixtures with a named fictional inviter, `https://returnwell.example.test` and no patient fields. Assert HTML escaping for names, exact canonical origin, expiry/support/decline copy, and rejection of extra clinical keys, CRLF headers and non-HTTPS production links.
- [ ] Implement `buildInvitationEmail` using an explicit allowed-field schema. Use ReturnWell as sender identity and actual inviter/practice in the body. Do not accept a free-text medical message. Store token-bearing queue payloads encrypted using Web Crypto AES-GCM with unique nonce and invitation/generation as associated data.
- [ ] Implement all shared HTTP/auth helpers and management/entry handlers. All business writes are POST. Valid OPTIONS performs no write. `inspect` may return a masked email, inviter snapshot, expiry and purpose only. Add atomic rate counters and uniform public responses; the create form has to send explicit consent acknowledgement.
- [ ] Implement `beginSignup` by reserving a generation-bound auth attempt, generating an `invite` link through the server SDK for new users, and falling back to the existing-user magiclink path only for a verified existing-user condition. Mail only the stored invite address. Persist resulting user ID and send the auth credential to that mailbox, never the browser. Provider/Auth failures leave a resumable invitation and no membership.
- [ ] Use the issued credential type during verification. The confirmation component calls the SDK only after a button press:

```ts
const { data, error } = await client.auth.verifyOtp({
  token_hash: credential.tokenHash,
  type: credential.type, // validated "invite" or "magiclink" from issued attempt
});
if (error || !data.session) {
  setError("This verification link is unavailable. Request a new one.");
  return;
}
await client.functions.invoke("claim-invitation", {
  body: { invitationId, attemptId, displayName, requestId },
});
```

- [ ] Implement `claim-invitation` with `auth.getUser()`, current DB checks and the transactional claim RPC. If a different user is already signed in, require intentional sign-out before verification; do not silently overwrite their session.
- [ ] Implement queue claiming/leases/retry using the spec's worker contract with fake transport. Test no configuration, timeout after provider acceptance, invalid token encryption key, explicit resend and terminal suppression. Actual Resend credentials and recipients stay absent from local tests.

## Task 4: Browser journey and workspace routing

**Consumes:** `WorkspaceAccess` and invitation endpoints.
**Produces:** Invite manager, join/confirmation pages, doctor workspace selection and practitioner onboarding entry.

- [ ] Add browser tests for authorised invite preview, expired link, declined link, new-user signup, existing-user reuse and wrong signed-in account. Intercept email transport locally so no real messages leave the machine. Assert page load never calls verifyOtp/claim and forwarded-token signup mails only the bound address.
- [ ] Build pages as small components and preserve the approved restrained visual style. Mark local previews as fictional. The doctor sees invitation progress separately from practitioner matching; no unverified clinical profile appears in search.
- [ ] Refactor AuthGate to load `workspace-access`, ignore stale async results on auth changes, and show explicit choices for multiple workspaces. A draft practitioner gets an onboarding entry screen; use a real account-linked draft, not a doctor workspace fallback. Existing doctors still open the correct `/referrals/:id`.
- [ ] Keep invitation/auth secrets out of path/query access logs by reading fragments. Remove credentials with `history.replaceState` after confirmation/claim. Use `Referrer-Policy: no-referrer`, no third-party resources on these routes, no persisted clinical state and only a non-secret attempt ID for recovery.
- [ ] Configure the local Auth test stack with email confirmation enabled, public signup disabled and fixed callback allowlists. Do not treat the current local `enable_confirmations = false` as an acceptable proof-of-email test.
- [ ] Run invitation unit/handler/local-DB/browser suites, `npm run lint`, `npm run typecheck` and `npm test`. Record any unavailable DB or browser runtime as unverified, not passed.

## Stage completion

Deliver: an empty-by-default invitation manager, authentic inviter context, confirmed-account signup and a draft application or doctor membership. Update README with local setup and actual verification results. Stop production email activation at its named domain/business/recipient inputs, while continuing plan 02 locally. Keep existing unrelated files uncommitted; if committing, stage only reviewed task files and inspect the staged diff first.
