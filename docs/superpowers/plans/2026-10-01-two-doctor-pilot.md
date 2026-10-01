# ReturnWell: Two-Doctor Pilot and Referral-Led Growth

## 1. Goal and confirmed scope

Make ReturnWell ready for **two doctors to refer patients and invite receiving practitioners**, then grow through those invitations.

The core journey:

**Doctor prepares referral → practitioner receives invitation → signs in/signs up → passes professional review → referral summary unlocks → accepts or declines → external handover → closure.**

Confirmed boundaries:

- Refine the charcoal/red theme, rounded surfaces and native-style typography across every screen.
- Show patient reference, clinical summary and referral requirements—not patient names, DOB or contact details.
- Booking and consultation payments stay outside ReturnWell.
- Support broader allied health, enabling each profession only when its verification process is ready.
- No AI matching, payment integration, public signup or bulk outreach in this release.

This refines the [existing detailed fix plan](/Users/ReturnWellMvp/prototype/docs/superpowers/plans/2026-10-01-launch-readiness.md), adding the referral-linked invitation journey.

## 2. Implementation sequence

### Phase 1 — Establish a safe release baseline

- Preserve existing work and isolate the exact application changes intended for release.
- Make builds reproducible; add CI, local database tests and browser tests.
- Investigate dependency vulnerabilities and fix confirmed exposure.
- Preserve existing invitation, consent, access-control and email safeguards.

**Completion:** a reproducible, tested baseline without production changes or real email sends.

### Phase 2 — Complete practitioner identity and matching

- Replace the two-profession restriction with a shared profession catalogue.
- Support AHPRA and relevant professional-body verification separately.
- Add reviewed profile updates, credential freshness, intake pause and explicit access suspension.
- Match deterministically on verified profession, funding, appointment format and requested capabilities.
- Separate preferred language from accessibility notes.
- Add licensed postcode-based approximate distance; unknown distance remains visibly unknown.
- Paginate directory and referral lists; test with 5,000 synthetic practitioners.

**Completion:** only eligible, independently reviewed practitioners can receive referrals; every match has understandable reasons.

### Phase 3 — Build the referral-to-signup growth journey

- Add server-saved drafts and an **“Invite a practitioner”** option when the intended recipient is not onboarded.
- Require patient consent and a recorded basis for contacting that practitioner.
- Save the referral privately and queue its invitation atomically.
- Show the doctor whether signup, review or action is outstanding.
- Let existing users sign in without creating duplicate accounts.
- Automatically release the referral only after recipient identity, professional approval and current eligibility pass.
- Add cancellation, acceptance, decline, handover, closure and linked re-referral.
- Notify the doctor when onboarding fails, expires or cannot meet the referral requirements; never silently reroute.

**Completion:** a newly invited practitioner can become a verified user and receive the correct referral without exposing it prematurely.

### Phase 4 — Make every screen and email consistent

- Use shared fields, buttons, statuses, dialogs and loading/empty/error states.
- Prioritise the doctor’s referral worklist and the practitioner’s incoming referrals.
- Make signup, verification, onboarding, review and support pages match the main app.
- Preserve edits after validation errors, session interruptions and conflicting updates.
- Make emails identify the referring doctor/practice, explain the invitation and provide one clear action.
- Include no patient content or income promises in emails.
- Show queued, sent, delivered, signup completed and referral accepted as different events.
- Harden retries, expired-link recovery, suppression and webhook persistence.
- Configure and test both application email and returning-user Auth email. Supabase’s default Auth mail service is not intended for production. [Supabase documentation](https://supabase.com/docs/guides/auth/auth-smtp)

**Completion:** the complete journey is usable on desktop/mobile, by keyboard, and from an actual received email.

### Phase 5 — Finish operational readiness

- Add safe practice/member administration and server-enforced privileged MFA.
- Test cross-practice isolation, revoked access, direct API bypass and invitation replay.
- Finalise real business identity, privacy notices, support and data-handling procedures.
- Add redacted operational monitoring, queue-failure alerts and a named incident owner.
- Rehearse backup restoration and deployment rollback with sending disabled.
- Keep acquisition consent and opt-out handling explicit; calling a message an invitation does not automatically settle its legal classification. [ACMA guidance](https://www.acma.gov.au/avoid-sending-spam)

**Completion:** failures can be detected, supported and recovered from without exposing patient information.

## 3. Important backend and interface changes

- **Referral drafts:** creator-scoped server records with versions and stable submission IDs; no clinical browser storage.
- **Referral-linked invitations:** bind the intended recipient, invitation and referral through a private association. A link alone never grants clinical access.
- **Lifecycle:** add `awaiting_onboarding` and `closed`; retain existing states and historical booking records without implying appointment functionality.
- **Automatic release:** an idempotent server transaction assigns the approved practitioner, changes the referral to `sent`, records an audit event and queues one notification.
- **Release validity default:** seven days from the doctor’s original confirmation. Resending an invitation does not extend this. After expiry, changed requirements or failed eligibility, the doctor must review and reconfirm.
- **Access:** pending recipients see onboarding progress only. Clinical details become readable solely by authorised referral participants after release; reviewer/operator status alone grants no clinical access.
- **Compatibility:** use additive migrations and explicit grants/RLS. Preserve existing direct referrals and standalone invitations during rollout.

## 4. Acceptance tests

Required scenarios include:

- New practitioner: real invitation → signup → review → automatic release → acceptance → handover → closure.
- Existing practitioner: correct account reused; no duplicate signup or referral.
- Forwarded link, wrong account, unrelated practice and unapproved practitioner: no clinical access.
- Cancelled or expired referral: cannot unlock after later approval.
- Review/release/cancellation races and lost responses: no duplicate referral, assignment or notification.
- Decline, re-referral, intake pause, credential expiry and account revocation.
- Delivery failure, duplicate/out-of-order callbacks, suppression and expired verification links.
- Mobile layouts, keyboard navigation, readable contrast, long content, empty states and network recovery.
- Correct pagination and matching against synthetic large datasets.
- Restore and rollback without replaying old emails.

## 5. Rollout and launch gates

Implement sequentially to control credit usage: focused tests per package, full regression tests at integration points.

Start with fictional local data, then approved hosted acceptance, then the **two-doctor pilot**. Public rollout is separate.

Before real referrals:

- Verified sending domain and monitored support address.
- Reviewed privacy, consent, retention and recovery procedures.
- Independently verified receiving practitioners.
- Successful real-mailbox journeys for new and existing users.
- No unresolved critical access, data-loss or duplicate-send defects.
- Exact source revision, migrations, deployment and rollback target recorded.

Missing founder details or approvals remain explicit launch blockers; they do not prevent completing the local implementation.
