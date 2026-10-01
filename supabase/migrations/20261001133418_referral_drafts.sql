-- Private, creator-scoped working copies. No clinical content in browser storage.
create table public.referral_drafts (
  id uuid primary key,
  organisation_id uuid not null references public.organisations(id),
  created_by uuid not null references auth.users(id),
  version integer not null default 0 check(version >= 0),
  input jsonb not null default '{}' check(jsonb_typeof(input)='object'),
  finalized_referral_id uuid unique references public.referrals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index referral_drafts_creator_updated on public.referral_drafts(created_by,organisation_id,updated_at desc,id);
alter table public.referral_drafts enable row level security;
revoke all on public.referral_drafts from public,anon,authenticated;
grant select on public.referral_drafts to authenticated;
grant all on public.referral_drafts to service_role;
create policy referral_drafts_creator_read on public.referral_drafts for select to authenticated using (
  created_by=(select auth.uid()) and exists(select 1 from public.organisation_memberships m
    where m.organisation_id=referral_drafts.organisation_id and m.user_id=(select auth.uid()) and m.active)
);

alter table public.referrals drop constraint referrals_patient_reference_check;
alter table public.referrals add constraint referrals_patient_reference_check check(length(patient_reference) between 1 and 120);
alter table public.referrals add column preferred_language text not null default '',
  add column access_notes text not null default '' check(length(access_notes)<=500);
grant select(preferred_language,access_notes) on public.referrals to authenticated;

create function private.validate_referral_draft(p jsonb,complete boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare k text; max_len integer;
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>12000 then raise exception 'invalid_draft'; end if;
  for k in select jsonb_object_keys(p) loop
    if not k=any(array['patientReference','patientPostcode','profession','clinicalSummary','fundingPath',
      'appointmentFormat','languageOrAccess','preferredLanguage','accessNotes','selectedPractitionerId'])
      then raise exception 'invalid_draft'; end if;
    if k='selectedPractitionerId' and p->k='null'::jsonb then continue; end if;
    if jsonb_typeof(p->k)<>'string' then raise exception 'invalid_draft'; end if;
    max_len:=case k when 'clinicalSummary' then 4000 when 'accessNotes' then 500 when 'languageOrAccess' then 240 when 'patientPostcode' then 4 when 'selectedPractitionerId' then 36 else 120 end;
    if length(p->>k)>max_len then raise exception 'invalid_draft'; end if;
  end loop;
  if coalesce(p->>'patientPostcode','')<>'' and p->>'patientPostcode' !~ '^[0-9]{4}$' then raise exception 'invalid_draft'; end if;
  if coalesce(p->>'profession','')<>'' and p->>'profession' not in ('physiotherapist','psychologist') then raise exception 'invalid_draft'; end if;
  if coalesce(p->>'appointmentFormat','')<>'' and p->>'appointmentFormat' not in ('either','in_person','telehealth') then raise exception 'invalid_draft'; end if;
  if coalesce(p->>'selectedPractitionerId','')<>'' and p->>'selectedPractitionerId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'invalid_draft'; end if;
  if complete then
    foreach k in array array['patientReference','patientPostcode','profession','clinicalSummary','fundingPath','appointmentFormat','selectedPractitionerId'] loop
      if coalesce(length(trim(p->>k)),0)=0 then raise exception 'invalid_draft'; end if;
    end loop;
  end if;
  return p;
end $$;

create function private.draft_json(d public.referral_drafts) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('id',d.id,'organisationId',d.organisation_id,'createdBy',d.created_by,'version',d.version,
    'input',d.input,'updatedAt',d.updated_at,'finalizedReferralId',d.finalized_referral_id);
$$;

create function private.referral_draft_workflow(actor uuid,action text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.referral_drafts; req private.workflow_requests; result jsonb; p jsonb;
  ref public.referrals; recipient public.practitioners; previous_actor text;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  if action='draft.list' then
    if not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=(p_input->>'organisationId')::uuid and active)
      then raise exception 'denied' using errcode='42501'; end if;
    return jsonb_build_object('drafts',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'patientReference',q.input->>'patientReference','version',q.version,'updatedAt',q.updated_at) order by q.updated_at desc,q.id)
      from (select * from public.referral_drafts where created_by=actor and organisation_id=(p_input->>'organisationId')::uuid and finalized_referral_id is null order by updated_at desc,id limit 50) q),'[]'::jsonb));
  end if;
  -- Actor lock gives replay checks and concurrent creation one consistent order.
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into d from public.referral_drafts where id=(p_input->>'id')::uuid for update;
  if d.id is not null then
    if d.created_by<>actor or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=d.organisation_id and active)
      then raise exception 'denied' using errcode='42501'; end if;
  elsif action<>'draft.save' or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=(p_input->>'organisationId')::uuid and active) then
    raise exception 'denied' using errcode='42501';
  end if;
  if action='draft.load' then return private.draft_json(d); end if;
  if nullif(p_input->>'requestId','') is null then raise exception 'invalid_draft'; end if;
  select * into req from private.workflow_requests where actor_id=actor and request_id=(p_input->>'requestId')::uuid;
  if found then
    if req.operation<>action or req.request_payload<>p_input then raise exception 'conflict' using errcode='40001'; end if;
    return req.response;
  end if;
  if d.finalized_referral_id is not null then raise exception 'conflict' using errcode='40001'; end if;
  if coalesce(d.version,-1) is distinct from (p_input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001'; end if;
  if action='draft.save' then
    p:=private.validate_referral_draft(p_input->'input',false);
    if d.id is null then
      insert into public.referral_drafts(id,organisation_id,created_by,input) values((p_input->>'id')::uuid,(p_input->>'organisationId')::uuid,actor,p) returning * into d;
    else
      if d.organisation_id is distinct from (p_input->>'organisationId')::uuid then raise exception 'denied' using errcode='42501'; end if;
      update public.referral_drafts set input=p,version=version+1,updated_at=now() where id=d.id returning * into d;
    end if;
    result:=private.draft_json(d);
  elsif action='draft.finalize' then
    if p_input->'consentConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required'; end if;
    p:=private.validate_referral_draft(d.input,true);
    select * into recipient from public.practitioners where id=(p->>'selectedPractitionerId')::uuid for share;
    if recipient.id is null or recipient.lifecycle_status<>'active' or recipient.ahpra_verification_status<>'verified'
      or recipient.provider_confirmation_status<>'confirmed' or recipient.accepting_new_referrals is distinct from true or recipient.contact_email is null
      or recipient.profession<>p->>'profession'
      or not exists(select 1 from unnest(recipient.funding) f where lower(trim(f))=lower(trim(p->>'fundingPath')))
      or (p->>'appointmentFormat'='telehealth' and recipient.telehealth is distinct from true)
      or (p->>'appointmentFormat'='in_person' and not exists(select 1 from public.practitioner_locations where practitioner_id=recipient.id))
      or (coalesce(p->>'preferredLanguage','')<>'' and not exists(select 1 from unnest(recipient.languages) l where lower(trim(l))=lower(trim(p->>'preferredLanguage'))))
      then raise exception 'recipient_ineligible'; end if;
    previous_actor:=current_setting('request.jwt.claim.sub',true);
    perform set_config('request.jwt.claim.sub',actor::text,true);
    insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,
      funding_path,appointment_format,language_or_access,preferred_language,access_notes,selection_mode,selected_practitioner_id,consent_confirmed_at)
    values(d.id,'RW-'||d.id::text,d.organisation_id,actor,trim(p->>'patientReference'),p->>'patientPostcode',p->>'profession',trim(p->>'clinicalSummary'),
      p->>'fundingPath',p->>'appointmentFormat',coalesce(p->>'languageOrAccess',''),coalesce(p->>'preferredLanguage',''),coalesce(p->>'accessNotes',''),'doctor',recipient.id,now()) returning * into ref;
    perform set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true);
    update public.referral_drafts set finalized_referral_id=ref.id,version=version+1,updated_at=now() where id=d.id;
    result:=to_jsonb(ref);
  else raise exception 'unsupported_operation'; end if;
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response)
    values(actor,(p_input->>'requestId')::uuid,action,p_input,result);
  return result;
end $$;

create or replace function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_action like 'draft.%' then return private.referral_draft_workflow(p_actor,p_action,p_input); end if;
  if p_action like 'email.%' then return private.email_workflow(p_action,p_input); end if;
  if p_action like 'referral.%' then return private.referral_workflow(p_actor,p_action,p_input); end if;
  if p_action in ('workspace.access','invitation.claim') or p_action like 'application.%' or p_action like 'review.%' then return private.application_workflow(p_actor,p_action,p_input); end if;
  return private.invitation_workflow(p_actor,p_action,p_input);
end $$;
revoke all on function private.validate_referral_draft(jsonb,boolean),private.draft_json(public.referral_drafts),private.referral_draft_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.validate_referral_draft(jsonb,boolean),private.draft_json(public.referral_drafts),private.referral_draft_workflow(uuid,text,jsonb) to service_role;
