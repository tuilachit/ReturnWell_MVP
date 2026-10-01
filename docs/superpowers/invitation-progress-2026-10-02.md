# Invitation progress — local checkpoint

No hosted migration, external mail, push or deployment.

Current-generation invitation delivery is projected only after the existing inviter/practice authorization check. Private jobs, events, credentials and provider identifiers remain inaccessible to browser roles. Bounce/complaint/suppression dominates earlier delivery regardless of callback order; old-generation events cannot label a replacement link delivered.

Account confirmation distinguishes a new account from reuse of an existing account. Email delivery never means read, credential approval or referral acceptance. Expired invitations no longer offer resend; link rotation/revocation requires confirmation and resend respects the minimum cooldown. C2 still owns typed Retry-After recovery and stable ambiguous mutations.

Validation: fresh disposable PostgreSQL 62/62; focused browser 1/1 (real local Auth and API/DB, no mail provider); focused unit/HTTP 7/7; TypeScript and ESLint passed. A test token collided with an older fictional fixture; it now uses this helper's unique sequence. No production behavior was weakened.

Email skill ruling: retain the application's durable event persistence before acknowledging callbacks. Do not adopt the reference examples' raw event logging or acknowledge-before-persist approach; the approved privacy/reliability requirements take precedence. No retention policy is inferred from example legal guidance.
