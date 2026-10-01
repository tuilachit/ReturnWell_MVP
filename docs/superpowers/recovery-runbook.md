# Recovery and rollback — isolated rehearsal, hosted gate open

Hosted backup/PITR entitlement, restore target, costs, encryption-key custody, RPO/RTO, named owner and recovery approval are **unverified**. No upgrade, hosted backup, restoration or deployment has been performed. `node scripts/check-recovery-readiness.mjs` intentionally fails until actual approved evidence is recorded.

## Isolated rehearsal

`npm run test:database` starts a disposable, unexposed Postgres container, applies every repository migration in sorted order, builds fictional fixtures and dumps/restores them to a second database in that container. It compares referral/event/job counts, enables the restored database's quarantine latch, inserts a fictional pending job, then proves even a configured service worker cannot claim/start it or increment attempts. A browser role cannot disable the latch. The original integration stack, production and user data are not restored/reset. Test output records elapsed time; that is a local measurement, not an approved recovery objective or hosted guarantee.

## Approved hosted procedure (not executed)

1. Record incident/owner/approval, exact source SHA, migration set, backup time and required keys. Confirm the specific isolated restore destination and absence of live traffic/workers; never restore over production speculatively.
2. Disable both application sending and Auth SMTP/provider automation for that isolated environment before restoring. Set `EMAIL_DELIVERY_ENABLED=false`, `RESTORE_QUARANTINE=true`, and leave allowed recipients empty. No copied secret/worker environment is assumed safe.
3. Restore using the provider's approved capability. Before attaching any application worker, set the restored `private.delivery_quarantine` singleton active with `reason_code='restore_reconciliation'`. This service-read-only database latch blocks both claim and start even if worker flags are copied incorrectly. Already-started transport remains uncertain; receipts/callbacks can still reconcile.
4. Compare migration head, row/event totals, policies/grants, role matrix, ownership, consent snapshots and encrypted-payload/key recovery. Invalid/missing keys pause delivery; never invent replacement keys or recreate messages to bypass uncertainty.
5. Reconcile restored outbox jobs against actual provider receipts and callbacks outside the backup window. Preserve idempotency keys and suppression. Mark unresolved deliveries for review rather than replaying. Do not delete audit or clinical rows.
6. Run the exact candidate's local/staging acceptance with no real sends. Agree which records, if any, can resume. Obtain separate approval for recipients, worker/provider secrets, SMTP and lifting both environment/database quarantine. Database latch changes are privileged operator/database operations, not a browser button or public RPC.
7. Record actual backup/restore times and achieved loss/downtime against approved RPO/RTO. An unapproved or failed recovery blocks pilot activation.

## Application rollback

Prefer a forward fix with additive migrations. Do not reset or roll back a live database. Stop sending first; select an explicitly tested, compatible frontend/function revision and keep newer safety migrations. Current local tests retain legacy direct-referral and invitation request contracts against the newest schema. This is compatibility evidence, **not a deployment rollback rehearsal of an old hosted artifact**. Exact hosted rollback target, configuration/function compatibility and served-identity check require deployment approval before D6/D7 can close.
