# Private candidate import and two-role signup

Candidate research is not an active practitioner directory. It carries source observations, unknown values and review flags; only existing independent professional approval can activate a receiving profile. Self-entered doctors create a new isolated practice, not membership in an existing practice. Their declared registration is not marked verified, and practitioner invitations still require an independently reviewed inviter.

## Approved input set

- `sydney=/Users/ReturnWellMvp/private-data/sydney-master/master-candidates.json`
- `nsw=/Users/ReturnWellMvp/private-data/nsw-runs/nsw-pilot-2026-09-30/additional-candidates.json`
- `expansion=/Users/ReturnWellMvp/private-data/nsw-runs/direct-expansion-2026-10-01/new-candidates.json`

Do not append the overlapping 240-row expansion or rejected/review exports. Baseline: 609 source IDs, 203 flagged, digest `334d6105a56b366ee67be3d976017313a31136a6ca869541ecf220dc0d13c3d9`. Repeat the dry run before applying; changed counts/digest require reconciliation.

## Dry run

Run `node scripts/import-candidates.mjs` with each input above as a separate `--input label=/absolute/path`. This defaults to offline validation and prints counts and hashes only. Never export raw records into the repository, frontend, public assets, logs or a deployment upload.

## Hosted apply

Use only the reviewed backend/frontend release and verify every endpoint fingerprint and migration against `supabase/functions/_shared/backend-manifest.json`. Confirm before counts for clinical profiles, locations, credentials and email jobs. Target project is `ivutegjvttkrmxctegub`.

Set `RW_CANDIDATE_IMPORT_URL` to the exact project HTTPS origin (no path, trailing slash, query or alternate project). Set `RW_CANDIDATE_IMPORT_SERVICE_KEY` through a secure environment mechanism, never a shell literal, source file or chat. An existing confirmed active operator UUID is required; do not fabricate an operator for an import.

Use the same inputs plus `--apply --confirm-project ivutegjvttkrmxctegub --actor <approved-operator-uuid> --expect-digest <fresh-dry-run-digest>`. The transaction validates independently, writes the batch atomically and returns a count-only receipt. Replay exactly once and verify the same batch ID with zero additional evidence/audit rows. Compare clinical and email totals: import must not change them.

## Review and corrections

An operator opens `/admin/candidates`; normal doctor and receiving accounts must be denied. Filters reset cursors. Detail sources remain observations, not confirmed attributes. MFA is required for disposition, link/unlink and withdrawal. Record a reason and evidence reference for reviewed-for-onboarding disposition. Changed source hashes require a fresh review before linkage. Linking requires an existing independently owned submitted/approved application UUID and grants no clinical access.

An ambiguous save freezes its payload and request ID; use **Retry same action**, not a new request. After a definite conflict load the current saved version and retain/reconcile the edits. If access is revoked, sign out/recheck rather than bypassing it.

Withdraw a batch from **Import batches**, review the unsupported count and current version, enter a reason and explicitly confirm. This hides unsupported research records or restores the latest still-supported observation. It preserves source history, review audit and application links; it never changes clinical profiles or sends emails. There is no production database reset workflow.

## Release and rollback

Apply additive audited migrations before deploying all manifest endpoints and then the frontend. Keep the previous commit/deployment ID and provider backup/restore procedure in the release record. Candidate data remains private regardless of frontend version. Do not roll the backend back to a dispatcher lacking an already-served frontend's operations. Withdrawing an incorrect import is the normal reversible response.

Fictional local Auth/database/browser acceptance is separate from hosted participant acceptance, mailbox delivery, DNS ownership and the clinician/founder go/no-go. Do not mark those complete from a local green suite or a dashboard Save.
