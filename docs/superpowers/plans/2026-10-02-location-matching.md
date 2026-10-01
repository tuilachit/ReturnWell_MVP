# Location matching implementation

Spec: `docs/superpowers/specs/2026-10-01-launch-readiness-design.md` section 4.5.
Continues B5/B6 of the directory matching plan; already completed eligibility,
credential and pagination work must remain intact.

## Global constraints

- Work locally on `codex/location-matching`. No hosted migration, deploy, email,
  push or merge. Preserve the unrelated original checkout.
- Reference data needs an approved licence, version, checksum and attribution.
  Until approved and imported, distances remain disabled in real environments.
- Approximate straight-line suburb reference distance, never driving distance or
  exact patient/practice address. No paid maps calls or patient data sent to maps.
- Confirm a locality within the entered postcode; never guess among suburbs.
- Match all approved practice locations. Unknown is null, genuine zero is zero.
- Existing eligibility/capability gates precede grouping, counts and pagination.
- Local, unknown-distance and remote-only results stay distinct. Radius filters
  local results only; telehealth ordering stays name/ID. Stable distance/name/ID.

### Task 1: Geography contract and validating offline import

Implement `app/lib/geography.ts`, `scripts/import-geography.mjs` and unit tests.
Reference input is versioned JSON with source URL/licence/attribution/SHA256 and
rows carrying postcode, state, suburb, latitude and longitude (both nullable).
Generate transactional SQL for private tables; never execute a remote import.
Reject conflicting/duplicate locality keys, invalid coordinates or metadata;
activate a fully validated edition atomically and permit previous-edition rollback.

Write and observe failing tests for known/zero/unknown distance, multiple practice
locations, malformed import and unchanged prior output on failure. Implement and
run `node --test tests/geography.test.mjs` (expected all pass). Commit task files.

### Task 2: Authoritative server lookup, ranking and pagination

Create a CLI-generated additive migration. Private versioned reference tables,
RLS and service-only helpers. Extend `directory.search` with lookup operation and
locality ID; validate postcode/locality pairing, active source, radius and cursor.
Compute nearest known approved location, then distance/name/ID sort. Keep unknown
and telehealth separate. Include safe source metadata and selected location ID.
Add real PostgreSQL integration assertions before implementation; run them RED,
then GREEN with `RW_DATABASE_TEST=1 node --test tests/workflow-db.test.mjs`.
Test authorization, no source, ambiguous postcode, forged locality, multiple
locations, zero, radius boundary, unknown/remote groups, stale cursors and parity.
Commit task files.

### Task 3: Doctor and directory search controls

Add authenticated postcode lookup and explicit suburb selection, optional radius,
reset of stale selection/cursor when inputs change and unknown fallback text.
Reuse controls in doctor shortlist and directory; preserve location preference
in saved drafts without storing patient coordinates. Show source attribution and
approximation; do not reuse preview placeholder distances as real matching.
Write client/state tests RED, implement, then run `npm test` (expected no failures)
and type/lint checks. Commit task files.

### Task 4: Full verification and handoff

Run real database and local browser/HTTP checks, standard and Vercel builds;
verify no hosted side effects. Request one fresh whole-branch review. Fix all
important findings with a failing regression test first. Record exact results,
source activation gate and rollback/runbook in the manifest and implementation
report. Commit docs and fixes. Leave branch available, no merge or deployment.
