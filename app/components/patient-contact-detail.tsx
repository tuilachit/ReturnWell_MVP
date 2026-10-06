"use client";
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readPatientContact,type PatientContact} from '../lib/patient-contact';
export default function PatientContactDetail({client,referralId,version}:{client:SupabaseClient;referralId:string;version?:number}) {
  const [state,setState]=useState<{id:string;contact:PatientContact|null;error:boolean}>({id:'',contact:null,error:false});
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let active=true,sequence=0;
    const load=()=>{const turn=++sequence;void readPatientContact(client,referralId).then(contact=>{if(active&&turn===sequence)setState({id:referralId,contact,error:false});}).catch(()=>{if(active&&turn===sequence)setState({id:referralId,contact:null,error:true});});};
    load();window.addEventListener('focus',load);
    return()=>{active=false;window.removeEventListener('focus',load);};
  },[client,referralId,version,refresh]);
  const current=state.id===referralId?state:null;
  return <section className="workflow-card"><h2>Patient contact</h2>{!current?<p role="status">Loading private contact details…</p>:current.error?<><p role="alert">Patient contact is unavailable. Access may have changed; no previous contact is shown.</p><button className="button secondary" onClick={()=>setRefresh(n=>n+1)}>Retry contact details</button></>:current.contact?<dl><div><dt>Initials</dt><dd>{current.contact.initials}</dd></div><div><dt>{current.contact.preferredMethod==='phone'?'Phone':'Email'}</dt><dd>{current.contact.preferredMethod==='phone'?current.contact.phone:current.contact.email}</dd></div></dl>:<p>No patient contact was recorded for this referral.</p>}</section>;
}
