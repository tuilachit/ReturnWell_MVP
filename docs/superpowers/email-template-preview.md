# Transactional email checkpoint — 2026-10-02

Application invitations, verification, referral notices and lifecycle notices now share a restrained red/neutral HTML layout with language/title, readable system typography, one large primary action, a canonical website and configured support contact. Plain text carries the same purpose and action. Strings are escaped; action URLs require same-origin HTTPS without embedded credentials. No template renders clinical fields, trackers or promotional content.

Invitations display their original exact UTC deadline, including resends. Verification uses the actual server attempt deadline (including a resumed generation lease), not a fresh fifteen-minute promise at render time. Previously prepared encrypted retry payloads remain unchanged to preserve provider idempotency.

The returning-user Auth SMTP candidate is in `supabase/templates/`, deliberately **not installed**. Founder-owned business/support markers, actual Auth expiry, provider tracking settings and MIME text alternative remain C5 approval/acceptance items. [Supabase's documented variables](https://supabase.com/docs/guides/auth/auth-email-templates) supply ConfirmationURL and SiteURL, but no exact per-message expiry variable. That candidate does not invent a duration or replace the existing Auth transport.

Validation:

- 17 focused template/security/notification/dispatch checks passed; full build/unit run: 107 passed, 4 explicitly opt-in integration skips.
- Fresh disposable database: 62/62. Deadline assertions compare the exact stored minimum expiry and database duration, avoiding a measured 39ms Docker/host clock offset.
- Real local Auth/API journeys: 22/22; confirmation recovery browser cases remain green with HTML verification enabled.
- Seven focused browser cases passed. Email web previews at 320/375/768px have no horizontal overflow or serious/critical axe findings; the 375px long-name fixture was visually inspected. Preview screenshots are local ignored artifacts in `outputs/email-preview-*.png`, not production content.
- Both builds, TypeScript and lint passed.

This is web-preview/local evidence only. Actual Gmail/other email clients, Inbox/Spam placement, monitored support and provider-side disabled tracking are **not verified**. No external mail, hosted configuration or deployment occurred.
