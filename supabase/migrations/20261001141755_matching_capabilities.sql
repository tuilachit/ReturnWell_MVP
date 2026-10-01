-- Generated reference data is checked against shared/terminology.json.
create table private.controlled_terms (
  kind text not null, id text not null, label text not null, aliases text[] not null, version integer not null,
  primary key(kind,id)
);
alter table private.controlled_terms enable row level security;
revoke all on private.controlled_terms from public,anon,authenticated;
grant select on private.controlled_terms to service_role;
insert into private.controlled_terms(kind,id,label,aliases,version) values
-- BEGIN GENERATED TERMS
('funding','medicare','Medicare',array['medicare'],1),
('funding','ndis','NDIS',array['ndis'],1),
('funding','private_health','Private health',array['private_health','private health','private health insurance'],1),
('funding','self_funded','Self funded',array['self_funded','self funded','self-funded'],1),
('language','english','English',array['english'],1),
('language','mandarin','Mandarin',array['mandarin'],1),
('language','cantonese','Cantonese',array['cantonese'],1),
('language','vietnamese','Vietnamese',array['vietnamese'],1),
('language','arabic','Arabic',array['arabic'],1),
('language','hindi','Hindi',array['hindi'],1),
('language','spanish','Spanish',array['spanish'],1),
('language','italian','Italian',array['italian'],1),
('language','greek','Greek',array['greek'],1),
('language','korean','Korean',array['korean'],1),
('language','punjabi','Punjabi',array['punjabi'],1),
('language','auslan','Auslan',array['auslan'],1),
('service','persistent_pain','Persistent pain',array['persistent_pain','persistent pain'],1),
('ageGroup','child','Child',array['child'],1),
('ageGroup','adolescent','Adolescent',array['adolescent'],1),
('ageGroup','adult','Adult',array['adult'],1),
('ageGroup','older_adult','Older adult',array['older_adult','older adult'],1);
-- END GENERATED TERMS
create function private.normalize_term(term_kind text,value text) returns text language sql stable security definer set search_path='' as $$
  select case when count(*)=1 then min(id) end from private.controlled_terms where kind=term_kind and lower(trim(value))=any(aliases);
$$;
revoke all on function private.normalize_term(text,text) from public,anon,authenticated;
grant execute on function private.normalize_term(text,text) to service_role;
alter table public.practitioners add column service_ids text[] not null default '{}',add column age_group_ids text[] not null default '{}';
alter table public.referrals add column required_service_ids text[] not null default '{}',add column patient_age_group_id text;
grant select(service_ids,age_group_ids) on public.practitioners to authenticated;
grant select(required_service_ids,patient_age_group_id),insert(required_service_ids,patient_age_group_id,preferred_language,access_notes) on public.referrals to authenticated;

alter function private.validate_practitioner_profile(jsonb,boolean) rename to validate_practitioner_profile_before_capabilities;
create function private.validate_practitioner_profile(p jsonb,complete boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; key text; kind text; v jsonb; ids jsonb; canonical text;
begin
  result:=private.validate_practitioner_profile_before_capabilities(p-'serviceIds'-'ageGroupIds',complete);
  foreach key in array array['serviceIds','ageGroupIds'] loop
    kind:=case key when 'serviceIds' then 'service' else 'ageGroup' end;
    ids:='[]';
    if p ? key then
      if jsonb_typeof(p->key)<>'array' or jsonb_array_length(p->key)>30 then raise exception 'invalid_profile'; end if;
      for v in select value from jsonb_array_elements(p->key) loop
        canonical:=private.normalize_term(kind,v#>>'{}');
        if jsonb_typeof(v)<>'string' or canonical is null then raise exception 'invalid_profile'; end if;
        if not ids @> jsonb_build_array(canonical) then ids:=ids||jsonb_build_array(canonical); end if;
      end loop;
    end if;
    result:=jsonb_set(result,array[key],ids);
  end loop;
  if complete then
    foreach key in array array['funding','languages'] loop
      kind:=case key when 'funding' then 'funding' else 'language' end;
      ids:='[]';
      for v in select value from jsonb_array_elements(coalesce(p->key,'[]')) loop
        canonical:=private.normalize_term(kind,v#>>'{}');
        if canonical is null then raise exception 'invalid_profile'; end if;
        if not ids @> jsonb_build_array(canonical) then ids:=ids||jsonb_build_array(canonical); end if;
      end loop;
      result:=jsonb_set(result,array[key],ids);
    end loop;
  end if;
  return result;
end $$;
alter function private.validate_referral_draft(jsonb,boolean) rename to validate_referral_draft_before_capabilities;
create function private.validate_referral_draft(p jsonb,complete boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; v jsonb; ids jsonb:='[]'; canonical text;
begin
  result:=private.validate_referral_draft_before_capabilities(p-'requiredServiceIds'-'patientAgeGroupId',complete);
  if p ? 'requiredServiceIds' then
    if jsonb_typeof(p->'requiredServiceIds')<>'array' or jsonb_array_length(p->'requiredServiceIds')>30 then raise exception 'invalid_draft'; end if;
    for v in select value from jsonb_array_elements(p->'requiredServiceIds') loop
      canonical:=private.normalize_term('service',v#>>'{}');
      if jsonb_typeof(v)<>'string' or canonical is null then raise exception 'invalid_draft'; end if;
      if not ids @> jsonb_build_array(canonical) then ids:=ids||jsonb_build_array(canonical); end if;
    end loop;
  end if;
  result:=result||jsonb_build_object('requiredServiceIds',ids);
  if p ? 'patientAgeGroupId' then
    if jsonb_typeof(p->'patientAgeGroupId')<>'string' then raise exception 'invalid_draft'; end if;
    canonical:=private.normalize_term('ageGroup',p->>'patientAgeGroupId');
    if trim(p->>'patientAgeGroupId')<>'' and canonical is null then raise exception 'invalid_draft'; end if;
    result:=result||jsonb_build_object('patientAgeGroupId',coalesce(canonical,''));
  end if;
  if complete then
    canonical:=private.normalize_term('funding',p->>'fundingPath');
    if canonical is null then raise exception 'invalid_draft'; end if;
    result:=jsonb_set(result,'{fundingPath}',to_jsonb(canonical));
    if coalesce(trim(p->>'preferredLanguage'),'')<>'' then
      canonical:=private.normalize_term('language',p->>'preferredLanguage');
      if canonical is null then raise exception 'invalid_draft'; end if;
      result:=jsonb_set(result,'{preferredLanguage}',to_jsonb(canonical));
    end if;
  end if;
  return result;
end $$;
revoke all on function private.validate_practitioner_profile(jsonb,boolean),private.validate_referral_draft(jsonb,boolean) from public,anon,authenticated;
grant execute on function private.validate_practitioner_profile(jsonb,boolean),private.validate_referral_draft(jsonb,boolean) to service_role;

-- Existing free-text services/age assumptions are not backfilled as capabilities.
-- Only a newly submitted, independently approved profile fills these fields.
alter function private.application_workflow(uuid,text,jsonb) rename to application_workflow_before_capabilities;
create function private.application_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare app public.practitioner_applications; result jsonb; fresh boolean:=false;
begin
  if action='review.decide' and input->>'decision'='approved' then
    if not private.is_operator(actor) then raise exception 'denied' using errcode='42501'; end if;
    select * into app from public.practitioner_applications where id=(input->>'applicationId')::uuid for update;
    fresh:=not exists(select 1 from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid);
  end if;
  result:=private.application_workflow_before_capabilities(actor,action,input);
  if fresh then
    update public.practitioners set service_ids=array(select jsonb_array_elements_text(coalesce(app.profile->'serviceIds','[]'))),
      age_group_ids=array(select jsonb_array_elements_text(coalesce(app.profile->'ageGroupIds','[]'))) where id=(result->>'practitioner_id')::uuid;
  end if;
  return result;
end $$;
revoke all on function private.application_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.application_workflow(uuid,text,jsonb) to service_role;

create function private.practitioner_meets_requirements(p_practitioner uuid,p_profession text,p_funding text,p_format text,p_language text,p_services text[],p_age_group text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.practitioners p where p.id=p_practitioner and p.profession=p_profession
   and p_format in ('in_person','telehealth','either')
   and (p_format<>'telehealth' or p.telehealth)
   and (p_format<>'in_person' or exists(select 1 from public.practitioner_locations where practitioner_id=p.id))
   and (p_format<>'either' or p.telehealth or exists(select 1 from public.practitioner_locations where practitioner_id=p.id))
   and private.normalize_term('funding',p_funding) is not null
   and exists(select 1 from unnest(p.funding) f where private.normalize_term('funding',f)=private.normalize_term('funding',p_funding))
   and (coalesce(trim(p_language),'')='' or exists(select 1 from unnest(p.languages) l where private.normalize_term('language',l)=private.normalize_term('language',p_language)))
   and not exists(select 1 from unnest(p_services) s where private.normalize_term('service',s) is null or not private.normalize_term('service',s)=any(p.service_ids))
   and (coalesce(trim(p_age_group),'')='' or private.normalize_term('ageGroup',p_age_group)=any(p.age_group_ids)));
$$;
revoke all on function private.practitioner_meets_requirements(uuid,text,text,text,text,text[],text) from public,anon,authenticated;
grant execute on function private.practitioner_meets_requirements(uuid,text,text,text,text,text[],text) to service_role;

create function private.guard_referral_capabilities() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' or new.selected_practitioner_id is distinct from old.selected_practitioner_id
   or (new.status in ('sent','accepted') and new.status is distinct from old.status)
   or (new.profession,new.funding_path,new.appointment_format,new.preferred_language,new.required_service_ids,new.patient_age_group_id) is distinct from (old.profession,old.funding_path,old.appointment_format,old.preferred_language,old.required_service_ids,old.patient_age_group_id) then
   if cardinality(new.required_service_ids)>30 or private.normalize_term('funding',new.funding_path) is null
     or (coalesce(trim(new.preferred_language),'')<>'' and private.normalize_term('language',new.preferred_language) is null)
     or (coalesce(trim(new.patient_age_group_id),'')<>'' and private.normalize_term('ageGroup',new.patient_age_group_id) is null)
     or exists(select 1 from unnest(new.required_service_ids) s where private.normalize_term('service',s) is null) then
     raise exception 'invalid_requirements' using errcode='23514';
   end if;
   if new.selected_practitioner_id is not null then
     perform 1 from public.practitioners where id=new.selected_practitioner_id for share;
     if not private.practitioner_meets_requirements(new.selected_practitioner_id,new.profession,new.funding_path,new.appointment_format,new.preferred_language,new.required_service_ids,new.patient_age_group_id) then
       raise exception 'recipient_ineligible' using errcode='23514';
     end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_referral_capabilities() from public,anon,authenticated;
create trigger referrals_guard_capabilities before insert or update on public.referrals for each row execute function private.guard_referral_capabilities();

create or replace view public.verified_practitioners with(security_invoker=true) as
  select id,display_name,profession,practice_name,telehealth,services,funding,languages,ahpra_verified_at,provider_confirmed_at,updated_at,private.credential_summary(id) as credentials,service_ids,age_group_ids
  from public.practitioners where private.directory_visible(id);

create or replace function private.referral_draft_workflow(actor uuid,action text,p_input jsonb) returns jsonb
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
    if recipient.id is null or not private.practitioner_is_eligible(recipient.id,p->>'profession',now())
      or not private.practitioner_meets_requirements(recipient.id,p->>'profession',p->>'fundingPath',p->>'appointmentFormat',p->>'preferredLanguage',array(select jsonb_array_elements_text(p->'requiredServiceIds')),p->>'patientAgeGroupId')
      then raise exception 'recipient_ineligible'; end if;
    previous_actor:=current_setting('request.jwt.claim.sub',true);
    perform set_config('request.jwt.claim.sub',actor::text,true);
    insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,
      funding_path,appointment_format,language_or_access,preferred_language,access_notes,required_service_ids,patient_age_group_id,selection_mode,selected_practitioner_id,consent_confirmed_at)
    values(d.id,'RW-'||d.id::text,d.organisation_id,actor,trim(p->>'patientReference'),p->>'patientPostcode',p->>'profession',trim(p->>'clinicalSummary'),
      p->>'fundingPath',p->>'appointmentFormat',coalesce(p->>'languageOrAccess',''),coalesce(p->>'preferredLanguage',''),coalesce(p->>'accessNotes',''),array(select jsonb_array_elements_text(p->'requiredServiceIds')),nullif(p->>'patientAgeGroupId',''),'doctor',recipient.id,now()) returning * into ref;
    perform set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true);
    update public.referral_drafts set finalized_referral_id=ref.id,version=version+1,updated_at=now() where id=d.id;
    result:=to_jsonb(ref);
  else raise exception 'unsupported_operation'; end if;
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response)
    values(actor,(p_input->>'requestId')::uuid,action,p_input,result);
  return result;
end $$;
