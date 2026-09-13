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

Use Node.js 24 LTS (the Vercel runtime). Local development also supports Node.js 22.13 or later.

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
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Open `http://localhost:3000`. Without an invited and practice-assigned account, choose **Preview empty workspace**. Demo records appear only after **Load demo workspace** is selected.

## Vercel deployment

The deployment target is the **ReturnWell** Pro organization (its internal slug is
still `fitment`), project `return-well-mvp`, linked to this repository's `main`
branch. The production domain is `https://return-well-mvp.vercel.app`.

`vercel.json` runs `npm run build:vercel`. This uses `vite.vercel.config.ts` and the
Nitro Vercel adapter to produce `.vercel/output` with a Node.js 24 function in
Sydney (`syd1`). The existing local Cloudflare/Sites preview configuration is
unchanged. Nitro and vinext are beta dependencies; verify both the build and the
deployed browser flow after upgrades.

Deploy from a clean Git checkout, never the research working directory. The
build preflight rejects known private candidate files, and `.vercelignore`
excludes research, credentials and generated candidate exports from CLI uploads.
Do not run `data:generate` for deployment. Build on Vercel so native dependencies
match its Linux runtime; do not upload macOS-built function output.

Configure the four browser variables above in Vercel, with `NEXT_PUBLIC_APP_URL`
set to the production domain and email delivery kept `false`. Supabase Auth's
site URL and exact redirect allow-list must include the production sign-in
destination. Edge Functions need `APP_URL` and an `ALLOWED_ORIGINS` list containing
the production origin. Keep public sign-ups disabled and provision accounts
separately; deploying the website does not activate practitioner onboarding or
email delivery.

For an explicitly authorized manual production deployment from a clean checkout:

```sh
vercel deploy --prod --yes --scope fitment --project return-well-mvp
```

Do not disable deployment protection to test a deployment. Use `vercel curl` for
protected URLs, and confirm the production page loads before reporting success.

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

The production queue is dispatched by the Vercel Cron route
`/api/cron/dispatch-email-jobs` once per minute. Configure the same randomly
generated `EMAIL_WORKER_SECRET` in both Vercel and the Supabase Edge Function
secrets, and set a separate random `CRON_SECRET` in Vercel. The route accepts
only Vercel's bearer secret and forwards a bounded `{ "limit": 20 }` request to
the protected `dispatch-email-jobs` function; it never sends through the
browser and never exposes provider credentials.

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
