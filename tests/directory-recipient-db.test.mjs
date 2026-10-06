import test from 'node:test';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,readdirSync} from 'node:fs';
import {directoryRecipientChecks} from './helpers/directory-recipient-db.mjs';
import {patientContactChecks} from './helpers/patient-contact-db.mjs';
import {directoryReferralChecks} from './helpers/directory-referral-db.mjs';
// Focused disposable real-Postgres suite, with no hosted URL or credentials.
test('directory recipients on real Postgres',{skip:process.env.RW_DATABASE_TEST!=='1'},async t=>{
  const container=`returnwell-recipient-test-${process.pid}`;
  const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'}).trim();
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const rpc=(actor,action,input)=>JSON.parse(sql(`set role service_role;select public.rw_workflow(${actor?`'${actor}'`:'null'},'${action}','${JSON.stringify(input).replaceAll("'","''")}'::jsonb)`));
  execFileSync('docker',['run','--rm','-d','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
  try {
    for(let n=0;n<60;n++){try{sql('select 1');break;}catch{await new Promise(r=>setTimeout(r,250));}}
    sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      create function public.rls_auto_enable() returns void language sql as $$select$$;`);
    for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort()){
      if(process.env.RW_RECIPIENT_RED==='1'&&file.endsWith('_email_backed_directory.sql'))continue;
      sql(readFileSync(`supabase/migrations/${file}`,'utf8'));
    }
    sql(`insert into auth.users(id,email,email_confirmed_at) values('${id(2)}','doctor@example.test',now()),('${id(800001)}','reviewer@example.test',now()),('${id(800002)}','outsider@example.test',now());
      insert into private.platform_operators(user_id) values('${id(800001)}');
      insert into public.organisations(id,name,created_by) values('${id(1)}','Fictional Practice','${id(2)}');
      insert into public.organisation_memberships(organisation_id,user_id,role) values('${id(1)}','${id(2)}','owner');`);
    await directoryRecipientChecks(t,{sql,rpc,id});
    if(process.env.RW_CONTACT_TEST==='1')await patientContactChecks(t,{sql,rpc,id});
    if(process.env.RW_DIRECTORY_FLOW_TEST==='1')await directoryReferralChecks(t,{sql,rpc,id,sqlAsync:async query=>(await promisify(execFile)('docker',['exec','-i',container,'psql','-U','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query])).stdout.trim()});
  }finally{execFileSync('docker',['stop',container],{stdio:'pipe'});}
});
