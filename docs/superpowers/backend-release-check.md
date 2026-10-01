# Backend-first deployment check

Production Vercel builds now verify all backend functions and all required
migration versions before building the frontend. Local CI builds stay offline
but must have a current source manifest. This is compatibility evidence, not
clinical or public-launch approval.

## Operator sequence

1. Run tests, typecheck and lint. Review migration changes and keep a backup.
2. Run `npm run backend:prepare` after the last backend change. Commit the
   generated manifest with code. It hashes function entrypoints, all shared
   dependencies, migration SQL and Supabase configuration, excluding itself.
3. Apply reviewed migrations using normal migration history, then deploy all
   14 Edge Functions. Do not repair history to bypass this check.
4. Run `npm run check:backend` with the hosted `SUPABASE_URL` and server-only
   `BACKEND_RELEASE_CHECK_SECRET`. This secret must match Supabase and Vercel;
   it is read-only, separate from dispatch, and never `NEXT_PUBLIC_*`.
5. Deploy the frontend. `build:vercel` always runs the hosted check when
   `VERCEL_ENV` or `VERCEL_TARGET_ENV` is `production`. Missing credentials,
   mismatched server/browser project URLs, missing/old functions, unreadable migration history, timeouts and malformed
   responses fail closed. No production bypass flag exists.
6. Verify the canonical authenticated UI after deployment. Promotion or rollback
   of an old Vercel artifact does not rebuild; manually run the compatibility
   check from that artifact's source first. Do not treat an offline build as live
   acceptance. Backend migrations are forward-only unless separately reviewed.

Each function's credential-protected `GET ?release-health=1` returns a baked
source fingerprint and endpoint identity, not an environment-provided version.
`workspace-access` additionally reads actual `supabase_migrations` history via
the service-only, fixed-query `rw_backend_migrations()` RPC. Browser roles cannot
invoke that RPC. Health requests do not dispatch email or application actions.

This detects missing migration versions and stale deployment bundles. It does
not prove an operator has never manually altered schema or migration history;
functional/security acceptance and a controlled migration process remain needed.
All functions must be redeployed after any backend change because the fingerprint
deliberately covers the complete backend release.
