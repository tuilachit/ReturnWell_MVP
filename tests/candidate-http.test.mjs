import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowHandler} from '../supabase/functions/_shared/workflow-http.ts';
const request=(operation,fields={},auth=true)=>new Request('https://api.example.test',{method:'POST',headers:auth?{authorization:'Bearer token'}:{},body:JSON.stringify({operation,...fields})});
const mapping={candidate_list:'candidate.list',candidate_detail:'candidate.detail',candidate_dispose:'candidate.dispose',candidate_batches:'candidate.batches',candidate_withdraw_batch:'candidate.withdrawBatch'};
test('candidate API uses verified actor, narrow mappings and uncached responses',async()=>{
  for(const [operation,action] of Object.entries(mapping)){
    const calls=[];
    const handle=workflowHandler('review-practitioner',{env:{},getUser:async()=>({id:'trusted',aal:'aal2'}),rpc:async(...args)=>{calls.push(args);return {ok:true};}});
    const response=await handle(request(operation,{actor:'forged',role:'operator',raw:{secret:'do not pass'},candidateId:'candidate',batchId:'batch'}));
    assert.equal(response.status,200,operation);assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal(calls.length,1);assert.equal(calls[0][0],'trusted');assert.equal(calls[0][1],action);
    assert.equal('actor' in calls[0][2],false);assert.equal('raw' in calls[0][2],false);
    assert.equal((await handle(request(operation,{},false))).status,401);
  }
});
test('candidate mutations require step-up before the transaction and bulk import is not exposed',async()=>{
  let calls=0;
  const handle=workflowHandler('review-practitioner',{env:{},getUser:async()=>({id:'trusted',aal:'aal1'}),rpc:async()=>{calls++;return {};}});
  for(const operation of ['candidate_dispose','candidate_withdraw_batch']){
    const response=await handle(request(operation,{aal:'aal2'}));assert.equal(response.status,403);assert.equal((await response.json()).code,'step_up_required');
  }
  for(const operation of ['candidate_import','rw_import_candidate_batch','candidate.unknown'])assert.equal((await handle(request(operation))).status,400);
  assert.equal(calls,0);
});
test('candidate failures expose only stable codes, never raw SQL or research',async()=>{
  for(const code of ['denied','invalid_cursor','conflict','invalid_request']){
    const handle=workflowHandler('review-practitioner',{env:{},getUser:async()=>({id:'trusted',aal:'aal2'}),rpc:async()=>{throw Error(`${code}: SQL candidate PRIVATE NAME secret@example.test`);}});
    const response=await handle(request('candidate_detail'));
    const body=await response.json();assert.equal(body.code,code);assert.doesNotMatch(JSON.stringify(body),/PRIVATE NAME|SQL|secret@example/);
  }
});
