alter table public.referrals drop constraint referrals_status_check;
alter table public.referrals add constraint referrals_status_check check(status in ('awaiting_onboarding','sent','accepted','declined','booked','cancelled','closed'));
alter table public.referral_events drop constraint referral_events_event_type_check;
alter table public.referral_events add constraint referral_events_event_type_check check(event_type in ('created','sent','accepted','declined','booked','cancelled','closed','reminder_requested'));
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check(kind in ('referral_created','referral_accepted','referral_declined','referral_reminder','referral_cancelled','referral_closed'));
alter table public.notification_outbox drop constraint notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check check(status in ('pending','processing','sent','failed','blocked_configuration','cancelled'));
alter table public.referrals add column supersedes_referral_id uuid references public.referrals(id);
alter table public.referral_drafts add column supersedes_referral_id uuid references public.referrals(id);
grant select(supersedes_referral_id) on public.referrals to authenticated;

create or replace function private.draft_json(d public.referral_drafts) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('id',d.id,'organisationId',d.organisation_id,'createdBy',d.created_by,'version',d.version,
 'input',d.input,'updatedAt',d.updated_at,'finalizedReferralId',d.finalized_referral_id,'supersedesReferralId',d.supersedes_referral_id);
$$;
-- Provenance is server-owned, never accepted as a field in a browser draft.
create function private.link_replacement_referral() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select d.supersedes_referral_id into new.supersedes_referral_id from public.referral_drafts d
 where d.id=new.id and d.created_by=new.created_by and d.organisation_id=new.organisation_id;
 return new;
end $$;
create trigger referrals_link_replacement before insert on public.referrals for each row execute function private.link_replacement_referral();

create function private.referral_notice_current(referral_status text,kind text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(case kind when 'referral_created' then referral_status='sent' when 'referral_reminder' then referral_status='sent'
 when 'referral_accepted' then referral_status='accepted' when 'referral_declined' then referral_status='declined'
 when 'referral_cancelled' then referral_status='cancelled' when 'referral_closed' then referral_status='closed' else false end,false);
$$;
create function private.cancel_stale_referral_jobs(ref public.referrals) returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Import even an unclaimed legacy notice as cancelled so a later queue import
 -- cannot resurrect it. Sent records and delivery events remain untouched.
 insert into private.email_jobs(family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,state,attempts,error_code)
 select 'referral',ref.id,ref.version,o.id,o.idempotency_key,o.recipient_email,'cancelled',least(o.attempts,5),'referral_state_changed'
 from public.notification_outbox o where o.referral_id=ref.id and o.status<>'sent' and not private.referral_notice_current(ref.status,o.kind)
 on conflict(source_outbox_id) do nothing;
 update private.email_jobs j set state='cancelled',error_code='referral_state_changed',payload=null,prepared_payload=null,lease_id=null,lease_expires_at=null
 from public.notification_outbox o where j.source_outbox_id=o.id and o.referral_id=ref.id and j.state<>'sent' and not private.referral_notice_current(ref.status,o.kind);
 update public.notification_outbox set status='cancelled',last_error='referral_state_changed' where referral_id=ref.id and status<>'sent' and not private.referral_notice_current(ref.status,kind);
end $$;

alter function private.referral_workflow(uuid,text,jsonb) rename to referral_workflow_before_lifecycle;
create function private.referral_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ref public.referrals; req private.workflow_requests; draft public.referral_drafts; result jsonb; target text; reason text:=input->>'reasonCode';
 address text; delivery text:='configuration_needed'; outbox uuid; kind text;
begin
 if action not in ('referral.transition','referral.replace') then return private.referral_workflow_before_lifecycle(actor,action,input); end if;
 if actor is null then raise exception 'denied' using errcode='42501'; end if;
 -- Same lock order as accept/decline: referral, then actor request ledger.
 select * into ref from public.referrals where id=(input->>'referralId')::uuid for update;
 if ref.id is null or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active) then raise exception 'denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 if nullif(input->>'requestId','') is null then raise exception 'invalid_request'; end if;
 select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
 if found then
   if req.operation<>action or req.request_payload<>input then raise exception 'conflict' using errcode='40001'; end if;
   return req.response;
 end if;
 if ref.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001'; end if;
 if action='referral.replace' then
   if ref.status not in ('declined','cancelled') then raise exception 'conflict' using errcode='40001'; end if;
   insert into public.referral_drafts(id,organisation_id,created_by,supersedes_referral_id,input)
   values(gen_random_uuid(),ref.organisation_id,actor,ref.id,jsonb_build_object('patientReference',ref.patient_reference,'patientPostcode',ref.patient_postcode,
    'profession',ref.profession,'clinicalSummary',ref.clinical_summary,'fundingPath',ref.funding_path,'appointmentFormat',ref.appointment_format,
    'languageOrAccess',coalesce(ref.language_or_access,''),'preferredLanguage',ref.preferred_language,'accessNotes',ref.access_notes,
    'requiredServiceIds',ref.required_service_ids,'patientAgeGroupId',coalesce(ref.patient_age_group_id,''),'selectedPractitionerId',null)) returning * into draft;
   result:=private.draft_json(draft);
 else
   if input ? 'note' and (jsonb_typeof(input->'note')<>'string' or length(input->>'note')>500) then raise exception 'invalid_response'; end if;
   if input->>'action'='cancel' then
     if ref.status not in ('awaiting_onboarding','sent','accepted') then raise exception 'conflict' using errcode='40001'; end if;
     if coalesce(reason,'') not in ('entered_in_error','no_longer_required','other') then raise exception 'invalid_response'; end if;
     target:='cancelled';
   elsif input->>'action'='close' then
     if ref.status<>'accepted' then raise exception 'conflict' using errcode='40001'; end if;
     if coalesce(reason,'') not in ('handover_completed','no_longer_required','unable_to_arrange') then raise exception 'invalid_response'; end if;
     if reason='handover_completed' and input->'handoverConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required'; end if;
     target:='closed';
   else raise exception 'invalid_response'; end if;
   update public.referrals set status=target,version=version+1 where id=ref.id returning * into ref;
   insert into public.referral_events(referral_id,actor_user_id,event_type,details)
    values(ref.id,actor,target,jsonb_strip_nulls(jsonb_build_object('reasonCode',reason,'note',nullif(trim(input->>'note'),''),'handoverConfirmed',case when reason='handover_completed' then true end)));
   perform private.cancel_stale_referral_jobs(ref);
   select trim(contact_email) into address from public.practitioners where id=ref.selected_practitioner_id;
   if length(address)<=254 and address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
     kind:='referral_'||target;
     delivery:=case when exists(select 1 from private.email_suppressions s where s.email=lower(address) and s.reason<>'declined_invitation') then 'suppressed' else 'pending' end;
     insert into public.notification_outbox(referral_id,kind,recipient_email,idempotency_key) values(ref.id,kind,address,kind||'/'||ref.id) returning id into outbox;
     insert into private.email_jobs(family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,state,payload)
     values('referral',ref.id,ref.version,outbox,kind||'/'||ref.id,address,delivery,jsonb_build_object('kind',kind,'referralId',ref.id));
   end if;
   update public.referrals set response_notification_state=delivery where id=ref.id returning * into ref;
   result:=jsonb_build_object('referral',to_jsonb(ref)||jsonb_build_object('practitioners',jsonb_build_object('practice_name',(select practice_name from public.practitioners where id=ref.selected_practitioner_id))),'notification',delivery);
 end if;
 insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,action,input,result);
 return result;
end $$;

alter function private.email_workflow(text,jsonb) rename to email_workflow_before_lifecycle;
create function private.email_workflow(action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ref public.referrals; job private.email_jobs; kind text;
begin
 if action='email.claim' then
   for ref in select r.* from public.referrals r where exists(select 1 from public.notification_outbox o where o.referral_id=r.id and o.status not in ('sent','cancelled') and not private.referral_notice_current(r.status,o.kind)) order by r.id for update skip locked loop
     perform private.cancel_stale_referral_jobs(ref);
   end loop;
 elsif action='email.start' then
   select * into job from private.email_jobs where id=(input->>'jobId')::uuid;
   if job.family='referral' then
     -- Match transition lock order, then recheck immediately before transport.
     select * into ref from public.referrals where id=job.related_id for share;
     select o.kind into kind from public.notification_outbox o where id=job.source_outbox_id;
     if ref.id is null or not private.referral_notice_current(ref.status,coalesce(kind,job.payload->>'kind')) then
       if ref.id is not null then perform private.cancel_stale_referral_jobs(ref); end if;
       return jsonb_build_object('sendAllowed',false);
     end if;
   end if;
 end if;
 return private.email_workflow_before_lifecycle(action,input);
end $$;
revoke all on function private.link_replacement_referral(),private.referral_notice_current(text,text),private.cancel_stale_referral_jobs(public.referrals),private.referral_workflow(uuid,text,jsonb),private.email_workflow(text,jsonb) from public,anon,authenticated;
grant execute on function private.referral_notice_current(text,text),private.cancel_stale_referral_jobs(public.referrals),private.referral_workflow(uuid,text,jsonb),private.email_workflow(text,jsonb) to service_role;
