import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareCandidateBatch} from './candidates/normalise.mjs';
export async function runCandidateImport(args,deps={}){
  const output=deps.stdout??(line=>console.log(line));
  try{
    const inputs=[];
    for(let i=0;i<args.length;i++){
      if(args[i]!=='--input'||!args[i+1])throw Error('candidate_invalid_arguments');
      const spec=args[++i],split=spec.indexOf('='),label=spec.slice(0,split),path=spec.slice(split+1);
      if(split<1||!isAbsolute(path)||!/^[a-z0-9-]{1,80}$/.test(label))throw Error('candidate_invalid_arguments');
      inputs.push({label,path});
    }
    if(!inputs.length||inputs.length>50)throw Error('candidate_invalid_inputs');
    if(new Set(inputs.map(x=>x.label)).size!==inputs.length)throw Error('candidate_duplicate_label');
    const loaded=[];
    for(const {label,path}of inputs)loaded.push({label,bytes:await(deps.readFile??readFile)(path)});
    const {manifest}=prepareCandidateBatch(loaded);
    output(JSON.stringify({mode:'dry_run',...manifest}));return 0;
  }catch(error){
    const code=error instanceof Error&&/^candidate_[a-z_]+$/.test(error.message)?error.message:'candidate_input_unavailable';
    output(JSON.stringify({ok:false,code}));return 1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await runCandidateImport(process.argv.slice(2));
