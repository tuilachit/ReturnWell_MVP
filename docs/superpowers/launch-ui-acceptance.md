# Local UI acceptance — 2 October 2026

The charcoal/red shared UI is retained; no new icon library, visual rebrand or fictional activity metrics.

Evidence: final full local browser suite 46/46, including cross-tab sign-out, module reload, practitioner recovery, GP lifecycle interruption/navigation and external handover. Built Vercel CSP/hydration acceptance is separately 1/1. All people and clinical strings are fictional; no hosted systems or mailboxes used.

- Doctor: private drafts/reload, bounded matching, capability mismatch, invitation-linked finalisation, lost response, changed consent, cancel/refer again and explicit external-handover closure.
- Practitioner: bounded 25-item metadata inbox (50 server cap), selected-detail-only clinical fetch, current-owner denial, intake history, profile revision, preserved decline edits after a failed read, frozen version and original-command retry after a lost response/focus.
- Operator: independent review and practice administration, real local TOTP, current role checks, readable masked email diagnostics with no send control.
- Account: wrong mailbox, consumed verification recovery, returning account, revoked access and cross-tab sign-out. Clinical edits are never persisted in browser storage; sign-out clears them.
- Layout/accessibility: entry/empty screens 320/375/768/1024/1440px; long fictional referral content at 375px; keyboard dialog/focus tests; no serious/critical axe findings in tested scans. This does not certify WCAG or replace manual screen-reader/clinician acceptance.

Initial bounded-inbox and lost-response cases failed before implementation. The failed-read fixture was changed from an aborted request (SDK retries delayed the assertion) to a deterministic failed read; no access rule was weakened. An intentionally blocked local development module prevents entry without issuing a workflow write, then recovers after an explicit reload (1/1). A separate built Vercel artifact test proves normal hydration under nonce-enforced production CSP; this is not a production module-interruption acceptance check, which remains required before release.
