import {validateReleaseConfig} from '../supabase/functions/_shared/release-mode.ts';
const result=validateReleaseConfig(process.env);
if(!result.ready){console.error('Release blocked: '+result.blockers.join(', '));process.exitCode=1;}
else console.log('Release mode: '+result.mode+' (build check, not deployment approval)');
