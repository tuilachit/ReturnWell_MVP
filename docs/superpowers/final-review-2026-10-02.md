# Independent review and implementation disposition

The single fresh-context whole-branch review covered `aacb47e..4a79fbe` against the two-doctor plan, detailed task contracts and every Review Focus. It was read-only; no shared test execution or hosted access. Its verdict at that head was **not ready to merge until three Important findings were fixed**. No Critical issue was identified. This is not a clinical, legal or production security certification.

## Important findings: reproduced, then corrected

1. **Ambiguous RPC failures:** unknown exceptions were HTTP400; clients could discard a committed command's ID. The handler now returns503 for unknown failure, and every mutation client uses an explicit known-rejection classifier rather than any4xx. Unit tests first reproduced400 instead of503; a browser test commits a replacement draft, loses the internal RPC response, survives a failed refresh and retries the same command to one draft.
2. **GP lifecycle recovery:** failed background reads unmounted action state; navigation could abandon a pending replacement and let its callback overwrite another form. Transient reads now preserve state, actual absent/denied access still clears it, lifecycle edits require discard confirmation, and pending/uncertain actions block navigation. Unmounted actions cannot invoke parent callbacks. Browser regressions first failed, then passed for interrupted reads, delayed response/navigation and revoked access.
3. **Invitation revocation:** direct RLS reads and known-request replay bypassed current membership. Additive `20261001165340_invitation_current_authority.sql` checks current scoped authority before reads/replay, preserving current own-invitation operator scope and practice-admin scope. The real local Auth test first obtained one row and HTTP200 for all three old commands after revocation; it now obtains zero rows and403 for create/resend/revoke replay using the same session. Fresh-database coverage also passes.

One implementation fix pass, no second reviewer. Final aggregate checks and exact corrected SHA are in [the release record](launch-release-record.md); those are implementer verification, not a new independent approval.

## Deferred minor

Member revocation safely revokes links/cancels future jobs, but does not call the shared invitation invalidation routine. Unneeded hashed invitation secrets and some encrypted/attempt material remain instead of immediate cleanup; separately expiring payloads may clear on their deadline. Current status checks prevent redemption, claim and dispatch. The reviewer found no resulting access bypass. Cleanup semantics and a focused regression remain follow-up work; no approved clinical retention policy is inferred.

## Boundaries deliberately not judged as completed

- Actual mailbox/SMTP, hosted abuse/key rotation, alert routing, hosted recovery/rollback/RPO/RTO and real-pilot operation need separately authorised execution.
- Clinical/legal/founder approvals and licensed geography require qualified human/source evidence.
- Already-dispatched generic email may complete after cancellation; stop future dispatch and reconcile receipts, never promise recall.
- Intake pause and account suspension deliberately have different historical-access semantics.
- Private-test mode never waived the three local findings above.

All execution rulings and their costs are retained in the [implementation ledger](implementation-ledger-2026-10-02.md). External launch gates remain open.
