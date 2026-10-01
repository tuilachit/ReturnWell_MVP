# Account recovery — local checkpoint

No hosted writes, real emails, deployment or candidate activation.

- Workflow failures use known safe codes, nullable HTTP status and parsed Retry-After. Raw server messages/field values are never shown. Network ambiguity retains the original command; it is not treated as a rejected mutation.
- Invitation tables and the public invitation page freeze uncertain commands and offer an explicit same-command retry. Resend/revoke still require confirmation. Server cooldowns remain authoritative.
- A verified, currently authenticated mailbox owner can read at most ten own live claim attempts (or own recently completed attempts for lost-response recovery). The service checks actor, mailbox, generation, expiry and ownership. No credential or email override is returned or accepted.
- The confirmation page scrubs the URL fragment on opening and keeps unused credentials only in component memory. It never auto-verifies or auto-claims. Reload recovery uses the authenticated server projection; no browser token stash or new account is created.
- Same-account refresh keeps the form. Current access is checked on focus; authorization failures remove stale clinical controls. Changing account resets the workspace. Full multi-tab account-switch/assistive-technology acceptance remains A7.
- Returning-user login keeps allowlisted referral destinations, disables automatic public signup, uses generic non-enumerating copy and a visible cooldown. Early typing before hydration is now disabled, preventing a reproduced lost-input race.

Evidence: fresh disposable PostgreSQL 62/62; full browser 32/32; real local Auth/API journeys 22/22; build/unit 100 pass and 4 explicitly opt-in skips; both build targets pass; TypeScript and lint pass; focused error/HTTP suite 19/19 after two additional boundary assertions. The browser recovery case performs a real local OTP exchange, loses the claim response, reloads without the fragment and completes with one application/claim event and no second OTP exchange. This is not hosted SMTP/inbox acceptance.

Ruling: after revocation, either a fresh empty access result or a denied clinical refresh may arrive first. Both intentionally remove the clinical view; the test asserts the safe workspace-unavailable state and absence of the clinical form, not a race-specific heading.
