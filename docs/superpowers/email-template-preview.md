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

## Practice-attributed invitation update — 2026-10-02

Implemented the approved invitation copy on `codex/trustworthy-invitation-template`:

- The subject names the requesting practice. The body uses the saved inviter name without inventing a doctor title and clearly says ReturnWell sends on the practice's behalf.
- Recipients can review before signing in or creating an account. Practitioner invitations retain the separate identity/registration review and non-publication notice; doctor invitations describe joining the practice as a referrer.
- One red **Review invitation** action follows the introduction. Independent practice-contact guidance, decline-without-account instructions, original exact expiry, business identity and legal details follow it.
- The shared email shell now uses a white header, restrained red branding, explicit language/direction for email-client accessibility, and escaped optional preheader/supporting text. Verification and referral email copy are unchanged.
- No referral-waiting claim, doctor identity, practice website or contact number is fabricated. Canonical HTTPS links, support configuration, recipient restrictions and frozen retry payloads are unchanged.

Fresh local verification: build + full unit suite **143 passed, 6 opt-in integration skips**; TypeScript and ESLint passed; **5 email browser tests passed**. The browser checks cover 320/375/768px, long-name overflow, a single minimum-44px action, action-before-details ordering, language/direction, and no serious/critical axe findings. Light/dark browser preference previews do not simulate email clients' forced colour transformations. Existing Node deprecation and Playwright colour-environment warnings remain non-blocking.

Visually inspected the desktop invitation and 375px long-name rendering. Local ignored artifacts: `outputs/practice-invitation-preview.html`, `outputs/practice-invitation-preview.txt`, `outputs/practice-invitation-light.png`, `outputs/practice-invitation-dark.png`, and `outputs/email-preview-*.png`. All preview identities and links are fictional, not usable invitations.

The backend source manifest has been regenerated. **Not committed, merged, deployed or sent.** Releasing this change requires the normal backend deployment/compatibility checks and frontend release flow; only newly prepared messages adopt the template. Already frozen retry payloads must not be rewritten. Founder-owned sender domain, authentication and monitored support remain separate production setup requirements.
