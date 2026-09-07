# ReturnWell GP Referrals

ReturnWell is an early GP referral workflow for finding an eligible allied health practitioner, recording a referral and tracking its outcome. The current implementation is an MVP foundation, not a production clinical system.

## What is implemented

- invitation-only passwordless sign-in in the browser;
- an empty first-use workspace with no fictional records loaded by default;
- an explicit, local-only demo workspace for product review;
- Supabase Postgres tables for practices, memberships, practitioners, referrals, events and email delivery state;
- row-level security that limits referral access to the referring practice or assigned practitioner;
- a directory view that exposes only active, AHPRA-verified and provider-confirmed practitioners accepting referrals;
- deterministic matching by profession, format, funding, language and known distance;
- generic transactional email jobs that exclude patient and clinical details;
- deployed Supabase Edge Functions for authenticated sending and signature-verified Resend webhooks.

No AI model is used. The first MVP does not need one: the matching rules are easier for doctors to understand, test and defend when each reason is visible.

## Current safety boundary

- The live database starts empty. The private 200-practitioner candidate dataset has not been imported or activated.
- The demo button uses fictional browser-only records; those records are never written to Supabase.
- Email delivery is disabled. The deployed functions fail closed until a verified sender domain and server-only Resend configuration are present.
- The public browser configuration contains only the Supabase project URL and publishable key. Never put a service-role key or Resend key in a `NEXT_PUBLIC_` variable.
- The app is not yet integrated with AHPRA PIE, secure clinical messaging, a practice-management system, or a production identity/provisioning workflow.

## Local setup

The application, Supabase migrations/functions, tests and configuration are at
the repository root. Earlier source-only candidate research tools are preserved
under `research/`; they are not part of the running app. Secrets, real practitioner
datasets and generated candidate exports are deliberately excluded from Git.

Use Node.js 22 or later.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Set these safe browser variables in `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
NEXT_PUBLIC_EMAIL_DELIVERY_ENABLED=false
```

Open `http://localhost:3000`. Without an invited and practice-assigned account, choose **Preview empty workspace**. Demo records appear only after **Load demo workspace** is selected.

## Account provisioning

The UI requests a passwordless link with account creation disabled. Before inviting a real tester:

1. Disable public email sign-ups in the hosted Supabase Auth settings.
2. Invite the user through the administrative Auth flow.
3. Create their `profiles` record.
4. Create the practice `organisations` record.
5. Add an active `organisation_memberships` record linking the user and practice.
6. Confirm the deployed site URL and redirect URLs in Supabase Auth.

Until all six are complete, a signed-in account will see an honest “workspace not assigned” screen rather than data.

## Database

The source-of-truth migrations are in `supabase/migrations/`. They have been applied to the `Return Well MVP` project.

```sh
npx supabase db reset
npx supabase migration list
```

Every application table has RLS enabled. `notification_outbox` and `email_delivery_events` deliberately have no client policies: only trusted database code and Edge Functions can access them.

## Email activation checklist

Do not enable email delivery until all of the following are ready:

1. Verify a ReturnWell-owned sender domain in Resend.
2. Add `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET` and the HTTPS `APP_URL` as Supabase Edge Function secrets.
3. Point the Resend webhook at `/functions/v1/resend-webhook` and subscribe to sent, delivered, delayed, bounced, complained, suppressed and failed events.
4. Send only to approved test recipients and verify delivery, duplicate suppression, bounce handling and the no-clinical-data rule.
5. Set `NEXT_PUBLIC_EMAIL_DELIVERY_ENABLED=true` only after the server-side checks pass.

The notification body contains only a generic instruction and an opaque referral UUID link. Patient reference, postcode, clinical summary and attachments are prohibited from the email template payload.

## Verification

```sh
npm test
npm run lint
npm run typecheck
```

The tests cover the migration security contract, empty default UI, rule-based matching, referral validation, generic email content and signed webhook verification.

## Still required before a doctor pilot

- disable hosted public sign-ups and provision the first test practice;
- verify a small set of practitioner registrations and obtain provider confirmation;
- complete privacy, consent, retention and incident-response review;
- choose and integrate an approved clinical document transport path rather than ordinary email attachments;
- configure the production site, monitoring, backups and an end-to-end test environment;
- run a supervised pilot with fictional data before any real patient information.
