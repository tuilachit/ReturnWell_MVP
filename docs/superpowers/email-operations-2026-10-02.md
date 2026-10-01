# C4 — Local delivery reliability evidence

Local implementation only, 2026-10-02. No hosted changes, provider sends or deployment.

- Provider timeout is 15 seconds including response-body consumption; response size is bounded. A timeout/malformed success retains the frozen payload and original idempotency key.
- Provider Retry-After is clamped to 0–3600 seconds and never shortens existing backoff. A retry crossing invitation expiry or the 24-hour deduplication boundary requires review.
- Expiring verification jobs get earlier virtual deadlines; all other due jobs age into priority. Existing leases, suppression and attempt ceilings remain authoritative. Queue-priority regression failed before the additive migration and passed afterward.
- A durable job/lease transport-start record permits a late provider receipt to reconcile after cancellation or lease loss. Cancellation after transport started is uncertainty, not proof no message was sent. Neither late receipts nor callbacks reopen revoked links or clinical referrals.
- Signed webhook data is allowlisted and persisted before 2xx. Persistence failure returns 503. Duplicate/out-of-order callback and unmatched receipt tests remain in the database suite.
- `/admin/email` is an operator-only, bounded, masked-recipient read model. Reads cannot send. No force-resend/new-key control is provided; use existing authorised invitation/referral cancellation workflows.
- Fresh database: 66/66. Unit/build: 111 pass, 4 explicitly opt-in integration skips. Focused browser: 2/2 (375px, serious/critical axe checks and non-operator denial). Both build targets and typecheck/lint passed. Real Auth/API local suite is recorded in the task ledger after completion.

These are core-handler/local Auth/database checks, not deployed Deno, real SMTP, mailbox placement, human clinical acceptance or operational alert delivery. C5, D5 and D7 remain separate gates.
