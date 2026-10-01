# Retention — review required, no clinical purge enabled

No clinical, credential-evidence, audit, suppression, processor-log or backup retention duration has been approved. No new scheduled destructive purge is implemented. `canPurgeRecord` is a fail-closed decision guard only; absent approval, malformed dates/durations or a legal hold prohibit purging. It is not wired to a delete job.

Existing short-lived credential lifecycle is separate from clinical-record retention: invitation expiry/claim/revoke invalidates invitation secrets and clears the encrypted queued/prepared credential payload. Terms/consent, request replay, delivery and clinical audit records remain. Auth attempts retain identity/timestamp metadata, not the consumed OTP plaintext. Resend/retry does not extend the doctor's release consent.

Before enabling any record purge, obtain a class-by-class schedule and lawful purpose/hold rules from the responsible owner, document processor/backups and suppression implications, test narrowly scoped candidates/holds, independently approve the exact deletion and retain a recoverable audit of the approved operation. Do not use a seven-day invitation expiry as a clinical retention policy.
