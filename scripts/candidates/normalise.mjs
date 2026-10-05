import {createHash} from 'node:crypto';
import catalogue from '../../shared/professions.json' with {type:'json'};
const known=new Set(catalogue.professions.map(x=>x.id));
const fail=code=>{throw Error(`candidate_${code}`);};
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const byteLength=v=>Buffer.byteLength(JSON.stringify(v),'utf8');
export const canonicalJSON=v=>JSON.stringify(canonical(v));
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(isObject(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  return v;
}
const hash=v=>createHash('sha256').update(v).digest('hex');
function inspect(v,depth=0){
  if(depth>12)fail('depth');
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='string'){if(v.includes('\0'))fail('invalid_text');return;}
  if(typeof v==='number'){if(!Number.isFinite(v))fail('invalid_number');return;}
  if(Array.isArray(v)){for(const item of v)inspect(item,depth+1);return;}
  if(isObject(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))){
    for(const [key,item]of Object.entries(v)){if(key.includes('\0'))fail('invalid_text');inspect(item,depth+1);}return;
  }
  fail('invalid_structure');
}
function text(v,max,required=false){
  if(v===undefined||v===null){if(required)fail('missing_text');return null;}
  if(typeof v!=='string'||v.includes('\0'))fail('invalid_text');
  const s=v.trim();if(s.length>max)fail('text_too_long');if(!s&&required)fail('missing_text');return s||null;
}
function list(v,max=50){if(v==null)return [];if(!Array.isArray(v)||v.length>max)fail('invalid_array');return v;}
const unique=a=>[...new Set(a)].sort();
function texts(v,maxLength,maxItems=50){return unique(list(v,maxItems).map(x=>text(x,maxLength,true)));}
function url(v){const s=text(v,2048,true);let u;try{u=new URL(s);}catch{fail('invalid_url');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)fail('invalid_url');return s;}
export function normaliseCandidate(raw){
  if(!isObject(raw))fail('invalid_record');inspect(raw);
  if(byteLength(raw)>65536)fail('raw_too_large');
  const flags=[];
  const professionIds=texts(raw.professions??(raw.profession==null?[]:[raw.profession]),160,20);
  if(professionIds.some(p=>!known.has(p)))flags.push('unknown_profession');
  if(!professionIds.length)flags.push('missing_profession');
  const practiceNames=texts(raw.practice_names??(raw.practice_name==null?[]:[raw.practice_name]),200);
  const locations=list(raw.locations).map(l=>{
    if(!isObject(l))fail('invalid_location');
    const value={suburb:text(l.suburb,160),postcode:text(l.postcode,160),state:text(l.state,160)};
    if(value.postcode&&!/^\d{4}$/.test(value.postcode))flags.push('invalid_postcode');
    if(value.state&&value.state!=='NSW')flags.push('outside_nsw');
    if(!value.suburb||!value.postcode)flags.push('incomplete_location');
    return value;
  });
  if(!locations.length)flags.push('missing_location');
  // Source URLs are observations only: never fetch a URL from research data.
  const sourceUrls=unique([...list(raw.source_urls),...(raw.source_url?[raw.source_url]:[])].map(url));
  if(sourceUrls.length>50)fail('invalid_array');
  if(!sourceUrls.length)flags.push('missing_source');
  let observedAt=null;
  const timestamp=raw.scraped_at??raw.observed_at??null;
  if(timestamp!==null){
    const t=text(timestamp,100);
    if(t&&/^\d{4}-\d{2}-\d{2}T/.test(t)&&Number.isFinite(Date.parse(t)))observedAt=new Date(t).toISOString();
    else flags.push('invalid_observed_at');
  }
  const record={sourceId:text(raw.candidate_id,160,true),displayName:text(raw.display_name,160,true),professionIds,practiceNames,
    locations,sourceUrls,observedAt,locationScope:text(raw.location_scope,160),reviewFlags:unique(flags),raw:structuredClone(raw)};
  const result={...record,observationHash:hash(canonicalJSON(record))};
  if(byteLength(result)>98304)fail('record_too_large');
  return result;
}
export function prepareCandidateBatch(inputs){
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>50)fail('invalid_inputs');
  const labels=new Set(),records=new Map(),sources=[];let totalBytes=0;
  for(const input of inputs){
    if(!input||typeof input.label!=='string'||!/^[a-z0-9-]{1,80}$/.test(input.label))fail('invalid_label');
    if(labels.has(input.label))fail('duplicate_label');labels.add(input.label);
    if(!(input.bytes instanceof Uint8Array))fail('invalid_bytes');
    if(input.bytes.byteLength>20*1024*1024)fail('input_too_large');totalBytes+=input.bytes.byteLength;
    if(totalBytes>40*1024*1024)fail('inputs_too_large');
    let rows;try{rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.bytes));}catch{fail('invalid_json');}
    if(!Array.isArray(rows))fail('invalid_array');
    sources.push({label:input.label,sha256:hash(input.bytes),count:rows.length});
    for(const raw of rows){
      const record=normaliseCandidate(raw),old=records.get(record.sourceId);
      if(old&&old.observationHash!==record.observationHash)fail('conflicting_source');
      records.set(record.sourceId,record);
      if(records.size>1000)fail('batch_too_large');
    }
  }
  if(!records.size)fail('empty_batch');
  const sorted=[...records.values()].sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);
  const manifest={format:'returnwell-private-candidates-v1',inputs:sources.sort((a,b)=>a.label<b.label?-1:1),recordCount:sorted.length,flaggedCount:sorted.filter(x=>x.reviewFlags.length).length};
  const payload={manifest,records:sorted};
  if(Buffer.byteLength(canonicalJSON(payload))>8*1024*1024)fail('batch_too_large');
  return {manifest:{...manifest,digest:hash(canonicalJSON(payload))},records:sorted};
}
