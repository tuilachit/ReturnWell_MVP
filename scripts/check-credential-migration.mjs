import { localRuntime } from '../tests/helpers/local-runtime.mjs';
// Read-only reconciliation for the explicitly isolated stack. No people,
// identifiers, evidence or mailboxes are returned to logs.
const local = localRuntime();
const counts = local.sql(`select json_build_object(
  'activeProfiles',(select count(*) from public.practitioners where lifecycle_status='active'),
  'reviewedCredentials',(select count(*) from private.professional_credentials),
  'eligibleForNewReferrals',(select count(*) from public.practitioners p where private.practitioner_is_eligible(p.id,p.profession,now())),
  'requiresReconciliation',(select count(*) from private.credential_migration_exceptions),
  'enabledPolicies',(select count(*) from private.profession_policies where enabled)
);`);
console.log(JSON.stringify(JSON.parse(counts),null,2));
