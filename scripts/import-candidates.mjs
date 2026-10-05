import {open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareCandidateBatch} from './candidates/normalise.mjs';
async function boundedRead(path){
  const file=await open(path,'r');
  try{const size=(await file.stat()).size;if(size>20*1024*1024)throw Error('candidate_input_too_large');return await file.readFile();}
  finally{await file.close();}
}
export async function applyCandidateBatch(batch,actor,projectRef,env=process.env){
  const expected=`https://${projectRef}.supabase.co`;
  if(env.RW_CANDIDATE_IMPORT_URL!==expected||!env.RW_CANDIDATE_IMPORT_SERVICE_KEY)throw Error('candidate_target_configuration');
  const {createClient}=await import('@supabase/supabase-js');
  const client=createClient(expected,env.RW_CANDIDATE_IMPORT_SERVICE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input,init)=>fetch(input,{...init,redirect:'error'})},
  });
  const {data,error}=await client.rpc('rw_import_candidate_batch',{p_actor:actor,p_manifest:batch.manifest,p_records:batch.records});
  if(error||!data||data.digest!==batch.manifest.digest)throw Error('candidate_import_unconfirmed');
  // Print only explicit receipt fields, never an arbitrary server payload.
  return Object.fromEntries(['batchId','digest','inserted','newObservations','unchanged','flagged','replayed','status'].map(k=>[k,data[k]]));
}
export async function runCandidateImport(args,deps={}){
  const output=deps.stdout??(line=>console.log(line));
  try{
    const inputs=[],options={};let apply=false;
    for(let i=0;i<args.length;i++){
      if(args[i]==='--apply'){if(apply)throw Error('candidate_invalid_arguments');apply=true;continue;}
      if(['--confirm-project','--actor','--expect-digest'].includes(args[i])){
        const key=args[i];if(options[key]||!args[i+1])throw Error('candidate_invalid_arguments');options[key]=args[++i];continue;
      }
      if(args[i]!=='--input'||!args[i+1])throw Error('candidate_invalid_arguments');
      const spec=args[++i],split=spec.indexOf('='),label=spec.slice(0,split),path=spec.slice(split+1);
      if(split<1||!isAbsolute(path)||!/^[a-z0-9-]{1,80}$/.test(label))throw Error('candidate_invalid_arguments');
      inputs.push({label,path});
    }
    if(!inputs.length||inputs.length>50)throw Error('candidate_invalid_inputs');
    if(new Set(inputs.map(x=>x.label)).size!==inputs.length)throw Error('candidate_duplicate_label');
    if(apply&&(!/^[a-z]{20}$/.test(options['--confirm-project']??'')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(options['--actor']??'')||!/^[a-f0-9]{64}$/.test(options['--expect-digest']??'')))throw Error('candidate_apply_confirmation_required');
    if(!apply&&Object.keys(options).length)throw Error('candidate_invalid_arguments');
    const loaded=[];let total=0;
    for(const {label,path}of inputs){const bytes=await(deps.readFile??boundedRead)(path);total+=bytes.byteLength;if(total>40*1024*1024)throw Error('candidate_inputs_too_large');loaded.push({label,bytes});}
    const batch=prepareCandidateBatch(loaded),{manifest}=batch;
    if(apply){
      if(manifest.digest!==options['--expect-digest'])throw Error('candidate_digest_mismatch');
      const receipt=await(deps.apply??applyCandidateBatch)(batch,options['--actor'],options['--confirm-project']);
      output(JSON.stringify({mode:'applied',...receipt}));
    }else output(JSON.stringify({mode:'dry_run',...manifest}));return 0;
  }catch(error){
    const code=error instanceof Error&&/^candidate_[a-z_]+$/.test(error.message)?error.message:'candidate_input_unavailable';
    output(JSON.stringify({ok:false,code}));return 1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await runCandidateImport(process.argv.slice(2));
