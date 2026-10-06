# Email-backed directory referrals

Date: 6 October 2026, Australia/Melbourne
Status: Written design awaiting user review; not implemented or deployed.

## Intended outcome

Doctors should be able to select an existing directory contact with a recorded
public business email, prepare a referral and notify that contact before the
practitioner has a ReturnWell account. The notification leads to signup and
profile claiming. Patient information becomes accessible only to the authorised
recipient. Customer-facing workspace choices remain Doctor and Practitioner;
administration stays behind a separate authorised staff entry point.

The user clarified the exact journey: existing referral form → Find practitioners
→ algorithm returns a selectable list → choose a practitioner → one Send referral
button → email notification → recipient signs up through the link → authorised
recipient sees referral information, patient initials and contact details.
There must be no separate invitation form, manual email entry or administrative
screen in this journey. This document makes the data and identity boundaries
explicit before implementation. The revised written design awaits user approval.

## Existing foundation and selected approach

Reuse the existing referral-linked invitation workflow, not a second mail or
patient-access system. `InviteReferralPanel` already saves a private draft and
queues an invitation through `draft.invite`. The existing workflow supports
mailbox proof, recipient onboarding, independent review, consent expiry,
cancellation, retry recovery and eventual referral release.

The missing connection is a doctor-facing directory projection and a
server-validated selection integrated into the existing referral form, results
and send action. Reuse the invitation backend without exposing its separate form.
Activating imported contacts as verified practitioners would incorrectly merge
directory evidence with professional verification. Building an independent
invitation/claim system would duplicate the current controls. Neither is selected.

## Directory eligibility and projection

- Keep original candidate records and observations private. Do not delete records
  without email, mass-create active practitioners or alter credential status.
- Expose a minimal, paginated directory-contact projection to active doctors:
  contact ID, name, profession, practice, location, usable contact choices and
  source-observation identity. Do not expose raw imports, operator histories or
  application data. No public/anonymous directory endpoint.
- Only use the current supported observation from a non-withdrawn source batch.
  Exclude withdrawn, duplicate and unsuitable candidates, malformed/blank emails,
  suppressed addresses and records with unresolved identity/contact attribution.
- A syntactically valid stored address is necessary but not proof of ownership,
  deliverability, permission to send, or association with every listed practice.
  Require source-backed practice/address association; ambiguous associations are
  not made selectable until resolved.
- Distinguish directory contacts awaiting signup from confirmed member profiles.
  Unknown funding, language, services, intake and appointment formats remain
  unknown. Directory contacts must not be labelled eligible clinical matches.
- Filter known profession and practice location. Use supported locality
  coordinates for approximate distance; otherwise explicitly show distance
  unavailable. Never infer a coordinate from a nearby postcode or widen a radius
  silently. Keep one results page, with clear grouping of confirmed requirement
  matches and directory contacts whose additional capabilities need confirmation.
  Do not hide all directory contacts solely because their capabilities are unknown,
  and do not represent unknown requirements as satisfied. Doctor-selected referral
  intent remains distinct from verified algorithm eligibility.

## Doctor selection and referral creation

Keep the existing referral form and Find practitioners action. Run deterministic
matching on recorded profession and supported location, with existing capability
checks where values are confirmed. Display contactable results for the doctor to
choose. Each selectable result identifies one practitioner/practice/contact route;
multiple supported locations/mailboxes are distinct explicit choices, not an
automatic broadcast. Shared inboxes are labelled as practice contacts.

The doctor confirms consent and the contact basis inline in the existing referral
flow, then presses one Send referral button. The app resolves the chosen contact
server-side and creates the private referral and notification without another
invitation screen, email field, role chooser or operator approval action for the
doctor. Prevent repeated clicks and retain the same request ID when retrying an
uncertain result. The completion screen reports referral creation and sending
status, not a guarantee that the recipient has read the message.

Add a server-side directory selection command within the existing authenticated
workflow. It accepts the contact ID, observation identity and selected contact
choice, checks active practice membership and inviter authority, and resolves the
recipient from current stored evidence rather than trusting browser-supplied
name/email. A changed observation or removed/suppressed email requires reselection.
Persist the source selection alongside the referral invitation for an audit trail.

Retain explicit doctor confirmation of patient consent and the existing recorded
permission-to-contact basis. Public availability alone does not satisfy that
confirmation. One transaction finalises the private referral, invitation linkage
and queued notification. Stable request IDs recover retries without duplication.
Imports, directory browsing and signup never trigger bulk outreach.

## Patient initials and contact details

The current referral input contains a patient reference, not dedicated patient
contact fields, and its notes instruct users not to include contact details.
Add structured patient initials, preferred contact method and relevant phone/email
fields to the existing form with validation and clear consent copy. Collect only
the contact details needed for the chosen method; do not make a full patient name
or extra demographic information a prerequisite for this workflow.

Persist these fields as private referral data through the authenticated backend,
with the same organisation/recipient authorization as the clinical summary. They
must survive draft recovery and be bound into the consent/release snapshot.
Initials are still sensitive in combination with referral and contact data: do not
include them in emails, URLs, analytics, logs, directory queries or preview fixtures
that could be mistaken for real patient data. The authorised practitioner referral
page displays the details needed to contact the patient; other users cannot query
them. Referrals predating the new fields show unavailable rather than invented
contact information. Patient contact management is not a booking system.

## Notification, signup and profile claiming

Reuse the branded invitation template and email queue. Include the verified
referring practice identity, intended practitioner/practice, purpose, support
contact and secure ReturnWell link. Exclude patient references, names, summaries,
diagnoses, postcodes and attachments from notification content.

The Send referral operation commits a durable notification before attempting
immediate server-side dispatch of that specific job. Transport failure must not
lose the referral or queue another copy; existing bounded retries/webhooks handle
recovery. A background worker remains necessary for retry processing. Show queued,
sending, sent-to-provider, delivered or failed from evidence, and show a clear
configuration error if the sender is not operational. Never claim immediate
mailbox delivery merely because a database job was created.

An invitation link alone grants no clinical access. The recipient verifies the
intended mailbox, signs in using Google or email, and confirms the professional
profile. Reuse an existing account rather than duplicating it. A shared clinic
inbox must not confer ownership of every practitioner using that address. Bind the
invitation to its intended directory contact, with independent profile/ownership
review before release; another staff member can request correction without seeing
the patient referral. Existing candidate/application linkage may record the
claim, but a claim itself must not activate or verify the practitioner.

Preserve the existing seven-day consent window and authoritative release checks:
current referrer access, intended recipient identity, ownership, credential policy,
requirements and intake. Forwarded links, wrong mailboxes and unresolved shared
mailboxes do not release the referral. Cancellation and release remain atomic.

## Doctor and practitioner status

Show notification queued, sent, delivery failed, awaiting recipient signup,
awaiting professional review, doctor reconfirmation needed and released distinctly.
Provider API acceptance is not reported as mailbox delivery. A recipient can
decline or report the wrong recipient without gaining clinical access. Preserve
suppression and bounded retry handling for complaints, bounces and failures.

The customer workspace chooser and navigation exclude administration even when a
staff account also has a doctor/practitioner role. Existing explicit admin routes
retain server-side role checks; hiding a button is not access control.

## Acceptance and rollout

Test empty/malformed/missing emails, withdrawn sources, ambiguous practice mapping,
shared inboxes, multiple contact choices, stale selections, changed observations,
suppression, pagination and honest unknown capability/distance presentation.
Test cross-practice access denial, browser-tampered recipient values, idempotent
lost-response retries, cancelled/expired referrals and exactly one queued event.
Test the existing form-to-results-to-one-click-send journey without a separate
invitation form. Test patient contact validation, draft persistence, consent
snapshot changes, authorised viewing and denial for other practices/recipients.
Test immediate dispatch success/failure, recovery without duplicate notifications,
and absence of patient initials/contact details from outbound payloads and logs.
Test new/existing signup, forwarded links, wrong mailbox, same inbox/different
practitioners, claim conflicts, failed verification and release after authorised
review. Test that no email or unauthorised response contains patient information.

Run the full unit, disposable Postgres, Auth/HTTP and browser journeys, then build
and lint/type checks. Only after those pass should database/functions and frontend
be deployed with matching backend manifest. Verify the served build and perform a
controlled, explicitly authorised mailbox journey. No automatic messages to the
imported contact list during implementation or testing.

This feature does not by itself complete sender-domain/SMTP configuration,
professional review, published notices or real clinical launch acceptance. Those
external requirements must be reported separately rather than bypassed.
