# Location matching implementation — 2026-10-02

Branch: `codex/location-matching`, based on main `0d07ef4`.
Scope: local implementation and fictional-data verification. **No hosted migration,
Vercel deployment, push, merge, paid map call or real email send.**

## Delivered behavior

- The doctor enters the patient postcode and explicitly confirms its NSW suburb.
  Multiple suburbs are not collapsed into a guessed location.
- The server applies the existing profession, verified credential, confirmed
  profile, intake, funding, format, language, service and age-group requirements.
- It compares every approved practice location, selecting the closest known
  reference point rather than always selecting the primary location.
- Known distances sort by distance, then normalised name and ID. Genuine zero
  remains zero; missing coordinates remain null. No clinical score is invented.
- Radius filtering affects the nearby group only. Distance-unavailable and
  telehealth-only options remain separate. Telehealth searches ignore distance.
  Empty nearby results never cause an automatic radius expansion.
- Changing postcode/suburb/radius resets pagination and a selected practitioner.
  Suburb and radius preferences survive private draft save/reload. Coordinates
  are not stored with the patient or sent to a third-party mapping service.
- Source edition/attribution and the straight-line approximation are displayed.
  This is not driving distance, travel time or exact-address geocoding.
- A validating offline importer compiles one operator transaction; editions are
  immutable and atomically activated/rolled back. Source data is private and is
  not included in a public browser bundle.

## Activation gate

No real reference source has been approved/imported. Hosted distance matching is
not active. See [source manifest and runbook](superpowers/geography-source-manifest.md).
GeoNames was proposed as a free attributed reference; Australia Post validation
is not claimed. Dataset approval, edition/checksum/coverage review and an update
owner are still needed, followed by an explicitly approved hosted release.

## Verification before final review

- `npm test`: build plus 137 tests, **131 passed, 6 explicitly skipped** integration
  tests. Integration suites were executed separately below.
- `RW_DATABASE_TEST=1 node --test tests/workflow-db.test.mjs`: **72 passed**, real
  disposable PostgreSQL 17. Includes permissions, malformed origin/radius,
  multiple practice locations, exact radius boundary, zero, unknown/remote groups,
  cursor invalidation, immutable import rollback and 5,000 synthetic profiles.
- Geographic query benchmark: 30 local runs / 5,000 synthetic profiles,
  p50 **136.435 ms**, p95 **158.123 ms**. Not a production latency claim.
- Five local browser tests passed: geography journey, 5,000-profile bounded
  directory, capability selection, draft reload and uncertain finalisation retry.
  Uses actual local Auth/PostgREST with the real HTTP workflow handler; browser
  harness routing is not hosted Edge deployment acceptance.
- Three local journey suites: **23 passed**, actual Auth, HTTP and RLS flows.
- Typecheck, ESLint and Vercel build passed. Vercel output emitted existing
  optional-module tracing warnings; no deployment was made.
- Local database lint reported existing workflow cast/volatility warnings, no
  errors in the new geography functions. These are not a clean global lint claim.
- In-app browser: fresh local entry, empty workspace and referral form rendered.
  Authenticated geography acceptance comes from the browser integration test.

## Decisions and limitations

1. Continue geography B5/B6 only; preserve completed credential/eligibility work.
   Wider launch readiness is outside this change.
2. Dependency-free spherical Haversine instead of PostGIS: adequate measured
   pilot latency, but larger-scale workloads may require spatial indexing.
3. `suburb_reference`, not an asserted exact centroid: reference quality varies;
   nearby ordering is approximate, not an exact practice-address comparison.
4. Fictional data only while source approval is pending: real distance activation
   remains a release gate, rather than silently choosing a dataset.
5. Client contract work overlapped a running database suite because draft/search
   inputs are shared. Combined database/browser regression checks were required.
6. Regraded two review copy findings from Minor to Important: incorrect radius
   guarantees and contradictory ranking text can mislead a doctor's selection.
   Cost: additional regressions and copy changes in the final correction pass.
7. Real-data accuracy/licensing and hosted acceptance were outside the review's
   evidence. Kept both as explicit release gates; local tests cannot establish
   geographic coverage or production readiness.

## Test-driven corrections

The new lookup and draft contract tests failed before their implementation.
The browser journey also exposed a false unsaved-changes warning after changing
to telehealth. The regression failed, the format change now clears irrelevant
location preferences, and the full five-journey set passed afterward.

## Final independent review and corrections

One fresh read-only reviewer examined the branch against the plan and spec.
All four findings were addressed in one RED/GREEN correction pass:

- **Draft snapshot loss:** a real browser submission saved the draft, failed
  finalisation when practitioner intake changed, and exposed missing suburb and
  radius. Submission now retains the complete immutable draft snapshot, including
  geographic preferences, across attempts. Reload preserves those values, and
  the recovered draft successfully finalises after intake eligibility is restored.
- **Stale source recovery:** tests switched the active local reference edition
  while the directory was open, removing either the suburb or its coordinates.
  Before the fix, retry kept the stale selection. Known geography errors now
  retain safe client codes; retry refreshes the lookup and clears origin/radius,
  pagination and selected practitioner/consent. Generic network retry does not
  unnecessarily discard geographic preferences. A separate doctor-shortlist
  browser check verifies that an old practitioner selection cannot survive.
- **Contradictory shortlist text:** the browser regression found “Distance ranking
  is not available yet” beside working distance results. Replaced with honest
  approximation wording; source/configuration state remains in location controls.
- **False radius guarantee:** a rendered component regression showed unknown and
  telehealth groups claiming “within 10 km.” Only nearby results now make that
  claim; the other groups explicitly say they are not limited by the radius.

No deferred minor findings. No second review was requested; correction evidence
is the failing-then-passing tests and the complete post-fix verification.

## Post-fix verification

- `npm test`: **139 total, 133 passed, 6 explicit integration skips**; build passed.
- Disposable PostgreSQL suite: **72/72 passed**. Latest geographic 5,000-profile
  benchmark over 30 runs: p50 **174.968 ms**, p95 **264.966 ms**, below the 500 ms
  local test budget. This is not production latency or a concurrency guarantee.
- Local Auth/HTTP/RLS journey suites: **23/23 passed**.
- Final consolidated browser run: **9/9 passed in 57.8 seconds**, including mobile
  overflow, successful location-based referral completion, rejection/reload,
  stale-reference recovery in both directory and shortlist, and lost-response retry.
- Typecheck, ESLint and Vercel build passed. Existing optional tracing warnings
  remain; no hosted build was deployed.

RED evidence: `/tmp/returnwell-geography-review-unit-red.log` and
`/tmp/returnwell-geography-review-browser-red.log`. GREEN evidence:
`/tmp/returnwell-geography-review-all.log`,
`/tmp/returnwell-geography-review-db.log`,
`/tmp/returnwell-geography-review-journeys.log`,
`/tmp/returnwell-geography-review-browser-green.log`, and
`/tmp/returnwell-geography-browser-final.log`. These are local temporary
logs; repeatable test code and this report are retained in Git.
