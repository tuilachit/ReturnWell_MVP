# Referral-linked invitations — local implementation checkpoint

The doctor can prepare a referral, choose **Invite a practitioner**, identify one
recipient, record permission to contact and explicitly confirm patient consent.
A creator-scoped draft is saved first. Finalisation creates the private referral,
its invitation association and its invitation queue entry in one transaction.
An existing pending invitation to the same practice/mailbox is reused. Stable
request IDs recover a lost response without a second referral or invitation.

## Release boundary

- Pending referrals have no assigned practitioner. Neither an invitation link,
  pending account nor operator role grants access to the clinical summary.
- Mailbox proof binds the invitation to a verified Auth user. Existing accounts
  are reused; a new account receives a private application.
- Approval and claims wake a bounded service release check **after** their own
  transaction commits. The existing email-worker claim also runs maintenance,
  including when transport is disabled. This wiring is not evidence of a hosted
  scheduled worker being operational.
- Each release transaction rechecks the confirming doctor's active membership,
  exact claimed mailbox, one independently reviewed owning practitioner, current
  credential policy, intake and every referral requirement. It atomically assigns
  that practitioner, records one sent event and queues one generic notification.
- Consent lasts seven days from server confirmation. Resending an invitation does
  not extend it. A private SHA-256 snapshot binds consent to referral content and
  requirements. Changed content, expired consent or failed eligibility requires
  doctor review/reconfirmation. Nothing silently reroutes to another practitioner.
- Cancellation and release take the same referral lock. Reconfirmation retries
  retain the entire original command, including its expected version.

Credential snapshots stay immutable. Release does not add Auth UPDATE grants or
restore revoked credential UPDATE grants; it reads mailbox identity, locks the
practitioner/policy/linkage and uses the existing authoritative eligibility guard.

## Progress and next action

The doctor sees signup, professional review, release, cancellation or required
reconfirmation separately. An unavailable/declined/expired invitation stays
private. Generic coordination notices contain no clinical content and use their
own queue family rather than pretending to be pending-invitation mail. Renewed
consent invalidates obsolete action-needed notices before a new send can start.

## Evidence and limitations

Fresh disposable Postgres tests: 60 passed, including new/existing accounts,
forwarded/wrong mailbox denial, consent expiry/resend, changed clinical content,
intake pause, credential expiry, revoked ownership, cancellation/release races and
single-event/single-notification replay.

The isolated real Supabase Auth/HTTP/PostgREST journey verified a new account,
independent AAL2 review, automatic release, response, handover and closure; a
second invitation reused the existing account without duplicate application.
Browser tests exercised a lost invitation response and a lost reconfirmation
response after the progress version changed. Full regression results are recorded
in the execution ledger.

This is local fictional-data evidence, not a real received-email journey, hosted
Deno-runtime acceptance, deployment or clinical sign-off. Broader C1–C5/A7/D3–D7
work, approved geography and founder/clinical launch gates remain open.
