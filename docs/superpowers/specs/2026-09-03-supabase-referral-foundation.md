# ReturnWell Supabase Referral Foundation

## Objective

Replace the fictional-by-default browser prototype with a secure, empty-by-default referral foundation backed by the existing `Return Well MVP` Supabase project. The result must support invited users, practice-scoped referrals, verified-provider discovery, auditable referral events, and generic transactional email jobs without sending real email or importing real patient data during implementation.

## Product behaviour

- Unauthenticated visitors see an invitation-only sign-in screen.
- An authenticated GP sees their own practice name and an empty referral workspace when no referrals exist.
- Fictional referrals and providers are available only after the user explicitly selects demo mode.
- Referral form fields start blank.
- The shortlist contains only active practitioners whose registration and provider-supplied details have been confirmed.
- Matching is deterministic and explainable. There is no AI ranking or clinical recommendation.
- Creating a referral records the patient reference, minimum clinical need, consent timestamp, selected practitioner, current status, an initial referral event, and a generic email job.
- Notification emails contain no patient name, patient reference, condition, clinical summary, postcode, or attachments. They direct an authorised recipient to sign in.
- No real email is sent until Resend domain verification and secrets are configured.

## Architecture

- Supabase Auth provides invitation-only passwordless sign-in.
- Postgres stores profiles, organisations, memberships, verified practitioners, referral records, referral events, communication preferences, email outbox jobs, and delivery events.
- Row-level security scopes GP access to their organisation and practitioner access to explicitly assigned referrals.
- Browser code uses only the project URL and publishable key. Secret keys remain server-side.
- Supabase Edge Functions dispatch generic notification emails through Resend and receive signed Resend delivery webhooks.
- An outbox record is created with the referral so failed delivery can be retried without duplicating the referral.

## Data protection constraints

- All exposed tables have RLS enabled.
- Candidate practitioner research is not imported into the live provider directory.
- Only `active`, AHPRA-verified, provider-confirmed practitioners are queryable by application users.
- Email outbox and delivery-event tables have no direct client policies.
- Authorisation never relies on user-editable metadata.
- Service-role and Resend secrets never enter the browser bundle.
- Database identifiers use lowercase snake_case, timestamps use `timestamptz`, and foreign-key/RLS columns are indexed.

## Email events

- `referral_created`: notify the selected practitioner that a referral requires attention.
- `referral_accepted`: notify the referring practice that the referral was accepted.
- `referral_declined`: notify the referring practice that another option is required.
- `referral_reminder`: generic reminder for an authorised recipient.

Every message uses a stable idempotency key. Delivery, bounce, complaint, and suppression events are persisted from a signature-verified webhook.

## Non-goals

- No AI element or LLM call.
- No AHPRA PIE integration or automated practitioner activation.
- No import of the 200 candidate records.
- No HealthLink or practice-management-system integration.
- No production email send, DNS change, Resend account creation, or real recipient address.
- No diagnosis, treatment advice, percentage match score, or autonomous practitioner choice.

## Verification

- Database tests prove organisation isolation, verified-provider visibility, and inaccessible notification tables.
- UI tests prove clean empty state, blank referral defaults, explicit demo opt-in, and no fictional identity in the default render.
- Notification tests prove patient and clinical fields cannot enter an email payload and idempotency keys remain stable.
- Build, lint, automated tests, Supabase advisors, and a browser smoke test must pass before completion is claimed.
