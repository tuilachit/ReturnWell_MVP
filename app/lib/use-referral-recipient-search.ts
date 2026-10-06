"use client";
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {searchReferralRecipients,type RecipientPage} from './referral-recipients';
import type {DistanceGroup,searchPractitioners} from './directory';
import {WorkflowError} from './workflow-error';
const empty:RecipientPage={items:[],nextCursor:null,counts:{confirmed:0,needsConfirmation:0},geography:undefined};
export function useReferralRecipientSearch(client:SupabaseClient|null,
  filters:Omit<Parameters<typeof searchPractitioners>[1],'distanceGroup'> & {distanceGroup:DistanceGroup|null;refresh?:number}) {
  const key=JSON.stringify(filters);
  const [state,setState]=useState({key:'',page:empty,group:'unknown' as DistanceGroup,loading:false,error:'',errorCode:''});
  useEffect(()=>{
    if(!client)return;
    let active=true;
    const request=JSON.parse(key) as typeof filters;
    const timer=setTimeout(()=>{
      let group:DistanceGroup=request.needs?.appointmentFormat==='telehealth'?'remote':request.distanceGroup??(request.localityId?'local':'unknown');
      setState({key,page:empty,group,loading:true,error:'',errorCode:''});
      void (async()=>{
        let page=await searchReferralRecipients(client,{...request,distanceGroup:group});
        if(request.distanceGroup===null&&group==='unknown'&&page.counts.confirmed+page.counts.needsConfirmation===0&&!request.cursor){
          group='remote';page=await searchReferralRecipients(client,{...request,distanceGroup:group});
        }
        if(active)setState({key,page,group,loading:false,error:'',errorCode:''});
      })().catch((error:unknown)=>{if(active)setState({key,page:empty,group,loading:false,error:error instanceof Error?error.message:'Could not load recipients. Try again.',errorCode:error instanceof WorkflowError?error.code:'request_failed'});});
    },180);
    return()=>{active=false;clearTimeout(timer);};
  },[client,key]);
  return client&&state.key===key?state:{key,page:empty,group:'unknown' as DistanceGroup,loading:Boolean(client),error:'',errorCode:''};
}
