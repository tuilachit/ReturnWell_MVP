# Credential eligibility implementation

Local implementation only; no production migration or activation has occurred.

The shared profession catalogue is copied into private database policy rows.
All policies start **disabled**, including the two existing product professions.
A named reviewer must approve a review interval, authority/route, identifier
validation rule and evidence reference before a policy is enabled. The seven-day
interval in tests is fictional test configuration, not a clinical recommendation.

Credentials belong to an independently reviewed account and practitioner.
Authority/normalised identifier uniqueness and composite links prevent moving
one person's credential to another profile. Credential identifiers, evidence
and reviewer identity are not directory fields. Server database time gates new
assignments and acceptance, including old REST clients. Intake pause preserves
existing assignments; explicit access suspension removes clinical reads.

Only independently evidenced legacy application approvals can acquire a generic
credential during reconciliation. They receive **no invented review deadline**:
historical access can be retained, but new referrals remain blocked until review.
Rows with no independent review, malformed evidence or duplicate identifiers stay
in the private reconciliation queue. Existing AHPRA columns remain for migration
compatibility; their boolean flags are no longer an eligibility authority.

Run the read-only count report only against the isolated test stack:

```sh
RW_LOCAL_STACK_DIR=/absolute/isolated/returnwell-integration-directory node scripts/check-credential-migration.mjs
```

The script logs counts only, not identifiers, mailboxes, evidence or patients.
Review the exception queue through an approved private administration process
before any hosted rollout. No batch promotion or scraped-record activation.

Reviewed profile revisions remain private proposals until an independent reviewer
approves them. New matching pauses while a proposal is outstanding. Approval
updates the existing practitioner, preserves earlier application snapshots and
inserts a new credential review row. Identifier ownership is stored separately;
service workflows cannot update/delete old credential reviews. The active
profession link selects the current review. A shortened policy interval can
shorten eligibility but cannot extend an earlier recorded deadline.

Operators have an outstanding credential-review list and versioned, audited
suspend/restore actions with evidence. These privileged actions still require
D3's server-enforced MFA before release. Existing assignments remain available
during intake pause or routine renewal; explicit suspension denies access.

Remaining: broader approved clinical protocols, full cross-role UX acceptance,
privileged MFA and hosted migration rehearsal. Existing profiles must not be
published just to make the directory full.
