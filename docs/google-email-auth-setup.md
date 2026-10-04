# Google and email sign-in

Scope: referral-only ReturnWell MVP. Passwordless email remains supported. Google
is an additional sign-in method, not a workspace invitation or a registration
verification. No phone/SMS provider is needed.

## Current setup checkpoint — 4 October 2026

The initial hosted Supabase public Auth settings returned email enabled, Google
disabled, phone disabled and public signup disabled. After the owner saved the
Google credentials, a second live check confirmed Google and email enabled,
phone disabled and public signup still disabled. These are settings checks, not
evidence of a completed Google login. The owner also reported saving the app's
return URL. Hosted browser acceptance remains a separate release check.

## Configure Google (required before enabling the button)

1. In Google Cloud, create/configure an OAuth project for ReturnWell. Set the
   consent screen name, support contact, homepage and the actual published privacy
   policy and terms URLs. Use only `openid`, `email` and `profile` scopes. Add pilot
   accounts as test users if Google's audience remains in testing.
2. Create a **Web application** OAuth client. Add the ReturnWell origin to
   authorised JavaScript origins: `https://return-well-mvp.vercel.app`. Add any
   intended custom production domain separately after it is configured.
3. Add this exact **Google authorised redirect URI**:
   `https://ivutegjvttkrmxctegub.supabase.co/auth/v1/callback`.
4. In the ReturnWell Supabase project, Authentication → Sign In / Providers →
   Google, enter the Google client ID and secret and enable Google. Keep the
   secret in Supabase only: never in chat, Git or a `NEXT_PUBLIC_*` variable.
   Leave nonce verification enabled; do not enable Gmail, Calendar or offline
   access.
5. In Supabase Authentication → URL Configuration, retain the current email and
   invitation redirects. Set the production Site URL to the production origin and
   add `https://return-well-mvp.vercel.app/auth/google` to allowed redirect URLs.
   The app adds an allowlisted relative `next` query; confirm the URL is accepted
   during the browser test below. Do not add broad arbitrary-domain wildcards.
   For local development only, also allow `http://127.0.0.1:3101/auth/google`
   (or the actual local port), and use that same origin consistently.
6. **Keep public signups disabled.** Google should not grant access to new users.
   Existing invited users should choose the same verified email they used in
   their invitation. Supabase manages verified-email identity linking; the app
   must not merge users, accept user-supplied roles or auto-create memberships.
7. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in the intended frontend environment
   and rebuild/deploy. This is a public UI switch, not an authorization control.
   Leave it `false` until the provider is ready. Email continues to work while it
   is false. Roll back the flag and rebuild if Google acceptance fails.

Official setup reference:
[Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Application behavior

- Email: existing Supabase magic-link login, `shouldCreateUser: false`, same
  invited-mailbox wording and rate-limit cooldown. Existing cross-device links
  and explicit invitation confirmation are unchanged.
- First-time invitations: complete the invitation email, consent and mailbox
  confirmation first. This change does not replace that process with Google.
- Google: the sign-in button performs a **full document navigation** to
  `/auth/google?start=1&next=...`. The one Supabase client in that document uses
  PKCE. Google returns to `/auth/google`, which explicitly exchanges the code,
  strips credentials/errors from the URL, and fully navigates to the approved
  destination. All other documents retain the existing email Auth flow. Do not
  convert these navigations to SPA transitions or create competing Auth clients.
- Destination paths are strictly allowlisted. Invitation fragments, arbitrary
  query strings, and external URLs never pass through Google.
- Cancellation, missing/expired codes, missing PKCE proof and exchange failures
  show static recovery instructions without raw provider errors. A pre-existing
  session is not used as proof that a failed exchange succeeded.
- Google login still passes through `workspace-access` and existing database/RLS
  authorization. Memberships, clinician approval and credentials are unchanged.
- A signed-in account without access sees an explanation and a sign-out option.

## Acceptance before calling Google operational

With the deployed build and provider enabled, test in a normal browser:

1. Existing invited doctor → Google → same Auth user and intended practice.
2. Existing practitioner → Google → only their own authorised inbox/application.
3. Uninvited Google mailbox → no workspace and no account/membership provisioning.
   With public signup disabled, Supabase should reject creation entirely.
4. Start on a referral-detail URL; sign-in returns there, still subject to access.
5. Cancel Google; retry and email fallback both work. Test expired/replayed codes
   and an incorrect Google mailbox without exposing private data.
6. Sign out, refresh and open another tab; private controls stay inaccessible.
7. Existing email sign-in and a first-time invitation still complete, including
   inbox delivery using the configured Supabase Auth SMTP/email service. The
   referral-notification Resend configuration is a separate concern.

Local automated tests simulate Google's external redirect/token response where
necessary and use real isolated Supabase Auth sessions and database permissions.
They do **not** prove Google consent, hosted identity linking, hosted redirect
allowlists or email inbox delivery. Record those checks separately after setup.
