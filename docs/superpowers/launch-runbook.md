# Invitation and referral workflow: release runbook

The backend was deployed on 7 September 2026 with public signup disabled and email delivery explicitly off. See the [deployment evidence and remaining configuration](2026-09-07-backend-deployment.md). The frontend is not publicly released, no accounts were provisioned, and the private practitioner dataset was not imported. The application keeps its existing clean first-use state.

## What is implemented

- Reviewed inviter identity and practice branding; individual consent-confirmed invitations, previews, resend rotation, revocation and signup tracking.
- Passive invitation/confirmation pages, mailbox-bound verification, account claim, private practitioner drafts and optimistic edit versions.
- Explicit profile/referral consent, operator-only independent identity and manual registration review, atomic activation and intake pausing.
- Assigned-only practitioner inbox, atomic accept/decline, participant-visible decline feedback, persisted doctor timeline and 30-second visible-page refresh.
- Generic emails, encrypted credential payloads, exclusive dispatch leases, bounded retries, provider idempotency, signed webhook deduplication and terminal suppression.

No automatic AHPRA scraping, clinical AI ranking, patient self-selection flow, clinical attachments, booking integration or bulk outreach is included.

## Configure before a pilot

1. Confirm the intended Supabase project is `ivutegjvttkrmxctegub`. The three September 7 migrations are now applied and local baseline filenames match the preserved hosted history. Do not replay the baseline or reset the project. Its local `rls_auto_enable` existence guard remains for clean installs; see the audit for the historical source difference. Recheck migration status before any future deployment.
2. Provide the real ReturnWell business name, canonical HTTPS domain, support address, approved privacy/terms pages and version IDs. No production identity is invented by the app. In this implementation all public trust URLs must share the canonical app origin.
3. Fill server secrets from `supabase/functions/.env.example`. Generate separate random worker and encryption secrets in a secure store. The AES key is 32 random bytes encoded as base64. Keep old encryption keys in the server-only rotation map until all seven-day invitations and outstanding prepared jobs are expired or reconciled. Never expose service, worker or encryption keys to the browser.
4. All ten function folders are deployed. Their `verify_jwt=false` gateway setting is intentional: authenticated handlers call `auth.getUser()` themselves; public invitation actions require the opaque token; dispatch requires its separate worker secret; webhooks require a valid signature. Configure a trusted gateway/IP limiter for public invitation endpoints. The database additionally enforces per-token, per-inviter and per-recipient limits.
5. Configure Auth: public self-signup disabled; email confirmation required; verification OTP expiry 900 seconds; explicit allowed redirect origins. Disable email click/open tracking. The custom confirmation screen consumes credentials only after a button click. Use the same production domain for application links and the actual frontend deployment.
6. Verify the sending domain and its SPF/DKIM/DMARC settings with the email provider, use a recognisable ReturnWell sender, and configure the signed webhook URL ending in `/functions/v1/resend-webhook`. Keep `EMAIL_DELIVERY_ENABLED=false` until named recipients and a pilot send are explicitly approved. Set `EMAIL_TEST_ALLOWLIST` to only those approved addresses during the pilot.
7. Provision the operator and first practice using reviewed, mailbox-verified account IDs. See the guarded operator SQL template below. Operator status does not grant clinical records. Review each doctor/practice inviter identity separately; the user's editable profile name is never invitation branding.
8. Run the authenticated pilot for a known doctor and practitioner. Confirm signup, review, referral, response, timeline and actual delivery. A queued email is not proof of delivery, and delivery is not proof of reading. Local tests do not replace this hosted pilot.

## Explicit operator bootstrap (database-owner action)

Use verified IDs from Auth and actual reviewed names. These are operator actions, not browser endpoints. Do not run placeholder values or use a service key in a public client. A registration number plus a verified mailbox is insufficient to approve a practitioner's identity.

```sql
begin;
-- Replace each placeholder with an explicitly approved actual value.
insert into private.platform_operators(user_id)
select id from auth.users where id = '<verified-operator-uuid>'::uuid
  and email_confirmed_at is not null;

insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by)
values ('<verified-operator-uuid>', null, '<actual-operator-name>',
  'ReturnWell', '<verified-operator-uuid>');

insert into public.organisations(id,name,notification_email,created_by)
values ('<new-practice-uuid>', '<reviewed-practice-name>',
  '<approved-notification-email>', '<verified-operator-uuid>');

-- Give the operator reviewed branding for this practice without giving them
-- clinical membership. This makes the practice selectable for invitations.
insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by)
values ('<verified-operator-uuid>', '<new-practice-uuid>',
  '<actual-operator-name>', '<reviewed-practice-name>', '<verified-operator-uuid>');

-- Existing verified owner; otherwise invite a doctor first and review/promote
-- their membership explicitly after the mailbox-bound claim succeeds.
insert into public.organisation_memberships(organisation_id,user_id,role)
select '<new-practice-uuid>',id,'owner' from auth.users
where id='<verified-owner-uuid>' and email_confirmed_at is not null;

insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by)
values ('<verified-owner-uuid>', '<new-practice-uuid>',
  '<reviewed-doctor-name>', '<reviewed-practice-name>', '<verified-operator-uuid>');
commit;
```

All subsequent doctor invitations grant only `referrer`. Revoke a practice membership by setting `active=false`; revoke a practitioner linkage by setting `active=false, revoked_at=now()`. Intake pause is different: it preserves existing assignments. Changing an approved practitioner's identity or registration requires a new reviewed version; the current UI directs them to support instead of editing trust fields.

## Scheduling the email worker

The deployed application now includes a protected Vercel Cron route at
`/api/cron/dispatch-email-jobs`, scheduled once per minute in `vercel.json`.
For the current Vercel deployment, set `CRON_SECRET` and the same
`EMAIL_WORKER_SECRET` in Vercel, and set `EMAIL_WORKER_SECRET` in Supabase.
The route forwards a bounded request to the deployed Edge Function and returns
only aggregate counts. It is production-only; preview deployments do not run
Vercel Cron jobs. Do not enable this schedule until the sender, webhook and
pilot allowlist checks below are complete.

If Supabase Cron is preferred instead, use the SQL below as an alternative and
do not run both schedulers at once. It requires `pg_cron`, `pg_net` and Vault
to be enabled in the project.

After an approved deployment, enable Supabase Cron and pg_net. Store two secrets in Vault: `returnwell_functions_url` (the deployed `/functions/v1` base URL) and `returnwell_email_worker_secret` (matching the Edge secret). The scheduled SQL reads them at runtime, rather than embedding credentials in the schedule text. Inspect for an existing named job before creating one; update it rather than duplicating schedules.

```sql
select cron.schedule('returnwell-email-dispatch', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='returnwell_functions_url') || '/dispatch-email-jobs',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='returnwell_email_worker_secret')),
    body := '{"limit":20}'::jsonb
  );
$job$);
```

Dispatch uses a two-minute exclusive lease. There is one initial provider attempt and up to four retries after 1, 5, 15 and 60 minutes. Configuration pauses do not consume an attempt. A crashed final attempt or a 24-hour unresolved ambiguity goes to `needs_review`; never assign it a new idempotency key to force a resend. Authenticated participant endpoints only read delivery status; they cannot trigger provider calls.

## Recovery and operator checks

- Inspect `private.email_jobs` for `paused_configuration`, `suppressed`, `exhausted`, `needs_review`. Do not show its recipients or encrypted payloads in public dashboards/logs.
- Check provider records before resolving ambiguous attempts. Authentic unmatched webhooks are retained and reconciled when the provider message ID becomes known.
- Bounces, complaints and provider suppression block future delivery. Declining an invitation blocks further invitations without disabling unrelated transactional messages. Remove an invitation-only suppression only after recording a new request from that recipient.
- Review `private.practitioner_reviews` as the immutable review history; applicant-facing feedback is separate. No application can approve itself.
- A missing practice notification address does not undo acceptance/decline. Its configuration-needed status remains visible; correct the practice address through an authorised operator procedure before scheduling any new message.
- Keep the private schema out of the Data API. Public application/invitation tables have explicit read-only grants as well as RLS; no client role may call `rw_workflow` or truncate those tables.

## Local verification

`npm run test:workflow` covers HTTP boundaries, credentials, generic message output and disabled-delivery defaults. `npm run test:database` starts and removes a uniquely named isolated Postgres container; it never reads hosted credentials. `npm test` builds and checks the rest of the application. Run lint and typecheck separately.

`npm run test:local-stack` creates a disposable configuration under the current user's `.cache/returnwell-local` directory, with API/DB ports 55321/55322 and project ID `returnwell-integration`. This location is shared with Colima; macOS temporary directories and checkouts outside the user's home may not be shared. Generated credentials are private files, not printed or committed. Do not run it if an unrelated project has that test name or ports.

Set `RW_LOCAL_STACK_DIR` to the exact generated directory. Run `npm run test:local-journey` for actual Supabase Auth and REST tests with fictional accounts. The journey invokes the production HTTP handler with a local-only transport, not a deployed Edge process. For actual Edge/browser checks, run `node tests/helpers/local-edge-server.mjs` and `node tests/helpers/local-browser-server.mjs` in separate terminals with the same environment variable. The Edge helper stages a current function snapshot into a Docker-shared cache, uses fictional trust configuration, allows only local browser origins and disables email delivery. Restart it after server code changes. It does not modify the application's `.env.local`.

`node tests/helpers/local-browser-fixtures.mjs` creates explicitly fictional role fixtures and stores local-only magic links in a private file in the stack directory. Do not copy those links into logs or shared reports. These are testing helpers, not account-provisioning tools for production. Stop only the named `returnwell-integration` stack when finished; do not reset unrelated local stacks.

## References used for this implementation

- [Supabase admin link generation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)
- [Supabase email verification](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [Resend idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
