import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,cpSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';

// Generates an isolated test stack; never loads the app's .env or hosted project.
// Colima shares the user's home, not arbitrary /Users or /private/var paths.
const cache=join(homedir(),'.cache','returnwell-local');
mkdirSync(cache,{recursive:true});
const directory=process.argv[2]??mkdtempSync(join(cache,'returnwell-integration-'));
if(![tmpdir(),cache].some(base=>resolve(directory).startsWith(join(base,'returnwell-integration-'))))throw Error('Only a generated isolated test directory is allowed');
mkdirSync(join(directory,'supabase','migrations'),{recursive:true});
let config=readFileSync(new URL('../../supabase/config.toml',import.meta.url),'utf8');
config=config.replace('project_id = "prototype"','project_id = "returnwell-integration"').replaceAll(/5432([0-9])/g,'5532$1').replace('inspector_port = 8083','inspector_port = 8183').replaceAll('enable_confirmations = false','enable_confirmations = true').replace('otp_expiry = 3600','otp_expiry = 900');
writeFileSync(join(directory,'supabase','config.toml'),config,{mode:0o600});
for(const file of readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')))writeFileSync(join(directory,'supabase','migrations',file),readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url)));
cpSync(new URL('../../supabase/functions/',import.meta.url),join(directory,'supabase','functions'),{recursive:true,filter:source=>!basename(source).startsWith('.env')});
console.log(`Isolated local stack directory: ${directory}`);
execFileSync('npx',['--no-install','supabase','start','--workdir',directory,'--exclude','realtime,storage-api,imgproxy,postgres-meta,studio,logflare,vector,supavisor'],{stdio:['ignore','pipe','inherit']});
const status=execFileSync('npx',['--no-install','supabase','status','--workdir',directory,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
writeFileSync(join(directory,'local-credentials.json'),status,{mode:0o600});
console.log(`Local test stack ready. Credentials kept in ${directory}/local-credentials.json; do not print or commit them.`);
