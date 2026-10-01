import {pilotEvidence} from '../supabase/functions/_shared/release-evidence.ts';
const blockers=[];
if(!pilotEvidence.recoveryRehearsal)blockers.push('approved hosted recovery evidence and RPO/RTO missing');
if(!pilotEvidence.retentionReview)blockers.push('approved retention and legal-hold handling missing');
if(!pilotEvidence.monitoringOwner)blockers.push('named recovery and incident owner missing');
if(blockers.length){console.error('Recovery launch gate BLOCKED: '+blockers.join('; '));process.exitCode=1;}
else console.log('Recorded recovery evidence present; verify exact environment and release before resuming delivery.');
