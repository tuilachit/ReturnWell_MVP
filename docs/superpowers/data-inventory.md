# Data inventory — pilot review draft

Not a compliance certification or approved retention policy. A practice reference does not anonymise a clinical narrative. No patient names, DOB, direct patient contacts or attachments are part of this pilot flow.

| Record | Purpose / authorised readers | Processor and location review | Retention / request owner |
|---|---|---|---|
| Auth identity, sessions, MFA | Mailbox proof and access; account owner and authorised identity operators | Supabase Auth; project, subprocessors/logs/backup regions unverified | Founder/security owner not yet assigned; independently verified recovery |
| Private referral drafts | Prepare/recover work; creator in current practice only | Supabase database; hosted region/contracts unverified | Clinical/privacy owner must approve retention and export/correction |
| Referral requirements, clinical summary, events | Coordinate referral; current practice members and assigned authorised recipient; operator role alone gives no clinical read | Supabase database and browser memory; no clinical browser persistence | Clinical owner must review audit, correction, closure and legal holds |
| Practitioner profile/capabilities | Confirm services and eligibility; owner, independent reviewers, eligible directory readers | Supabase database | Practitioner correction/review process; no scraped record activation |
| Credential identifiers/evidence | Independent professional review; private service/review boundary | Supabase private tables; no public evidence projection | Credential-review owner and lawful retention still to approve |
| Invitation/contact basis/consent | Exact-mailbox onboarding and audit; inviter/authorised admin, recipient-owned recovery | Supabase; application mail through Resend and recipient mailbox | Acquisition/privacy review required; expiry does not delete audit |
| Token/encrypted email payload | Short-lived verification/delivery; service only | Supabase encrypted envelopes; key store ownership/backup unverified | Existing expiry/claim/revoke cleanup; no arbitrary clinical deletion |
| Outbox/provider events/suppression | Reliable delivery and stop repeated sends; service, masked operator view | Resend, Supabase, mailbox providers; country/subprocessor review open | Delivery operator must reconcile; suppression retention reviewed separately |
| Operational signals | Queue age/heartbeat/failure detection; operator only | Supabase fixed-size counters; allowlisted host logs in Vercel/Supabase | Incident owner, log retention and cost ceiling unapproved |

The Vercel Sydney execution setting is not evidence of Australia-only processing. Review Supabase/Auth, Vercel, Resend, mailbox and support/backup processing separately before real patient data.
