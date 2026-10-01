-- Pagination cursors only mark a sort position. They never carry authority:
-- each request repeats current actor, membership, credential and filter checks.
create function private.read_page_cursor(value text,fingerprint text) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare c jsonb;
begin
  if coalesce(value,'')='' then return null; end if;
  if length(value)>2048 then raise exception 'invalid_cursor'; end if;
  begin c:=convert_from(decode(value,'base64'),'UTF8')::jsonb; exception when others then raise exception 'invalid_cursor'; end;
  if jsonb_typeof(c)<>'object' or c->>'v' is distinct from '1' or c->>'q' is distinct from fingerprint or jsonb_typeof(c->'key') is distinct from 'string' or coalesce(c->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid_cursor'; end if;
  return c;
end $$;
create function private.page_cursor(fingerprint text,sort_key text,id uuid) returns text language sql immutable security invoker set search_path='' as $$
  select replace(encode(convert_to(jsonb_build_object('v',1,'q',fingerprint,'key',sort_key,'id',id)::text,'UTF8'),'base64'),E'\n','');
$$;
revoke all on function private.read_page_cursor(text,text),private.page_cursor(text,text,uuid) from public,anon,authenticated;
grant execute on function private.read_page_cursor(text,text),private.page_cursor(text,text,uuid) to service_role;

create function private.directory_page(actor uuid,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_needs jsonb:=nullif(input->'needs','null'); v_group text:=coalesce(input->>'distanceGroup','unknown');
  v_limit integer:=least(50,greatest(1,coalesce((input->>'limit')::integer,25))); v_query text:=lower(trim(coalesce(input->>'query','')));
  v_profession text:=nullif(input->>'professionId',''); v_cursor jsonb; v_fingerprint text; v_previous_actor text; result jsonb;
begin
  if actor is null or not (exists(select 1 from public.organisation_memberships where user_id=actor and active)
    or exists(select 1 from public.practitioner_users u where u.user_id=actor and u.active and u.revoked_at is null and private.practitioner_has_access(u.practitioner_id))) then raise exception 'denied' using errcode='42501'; end if;
  if length(v_query)>120 or v_group not in ('local','unknown','remote') then raise exception 'invalid_request'; end if;
  if nullif(input->>'radiusKm','') is not null then raise exception 'geography_unavailable'; end if;
  if v_needs is not null and (jsonb_typeof(v_needs)<>'object' or jsonb_typeof(v_needs->'requiredServiceIds') is distinct from 'array' or jsonb_array_length(v_needs->'requiredServiceIds')>30 or exists(select 1 from jsonb_array_elements(v_needs->'requiredServiceIds') s where jsonb_typeof(s)<>'string')) then raise exception 'invalid_request'; end if;
  v_fingerprint:=md5(jsonb_build_object('actor',actor,'needs',v_needs,'group',v_group,'query',v_query,'profession',v_profession,'postcode',input->>'postcode')::text);
  v_cursor:=private.read_page_cursor(input->>'cursor',v_fingerprint);
  v_previous_actor:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  with eligible as materialized (
    select p.*,lower(p.display_name) collate "C" as sort_name,
      case when v_needs->>'appointmentFormat'='telehealth' then 'remote'
        when exists(select 1 from public.practitioner_locations where practitioner_id=p.id) then 'unknown' else 'remote' end as distance_group,
      (select jsonb_build_object('suburb',l.suburb,'postcode',l.postcode) from public.practitioner_locations l where l.practitioner_id=p.id order by l.is_primary desc,l.id limit 1) as location
    from public.practitioners p
    where private.practitioner_is_eligible(p.id,p.profession,now())
      and (p.telehealth or exists(select 1 from public.practitioner_locations where practitioner_id=p.id))
      and (v_profession is null or p.profession=v_profession)
      and (v_query='' or strpos(lower(p.display_name||' '||p.practice_name),v_query)>0 or exists(select 1 from public.practitioner_locations l where l.practitioner_id=p.id and strpos(lower(l.suburb||' '||l.postcode),v_query)>0))
      and (v_needs is null or private.practitioner_meets_requirements(p.id,v_needs->>'professionId',v_needs->>'fundingId',v_needs->>'appointmentFormat',v_needs->>'preferredLanguageId',array(select jsonb_array_elements_text(v_needs->'requiredServiceIds')),v_needs->>'patientAgeGroupId'))
  ), page_plus_one as materialized (
    select * from eligible where distance_group=v_group and (v_cursor is null or (sort_name,id)>((v_cursor->>'key') collate "C",(v_cursor->>'id')::uuid)) order by sort_name,id limit v_limit+1
  ), visible as materialized(select * from page_plus_one order by sort_name,id limit v_limit)
  select jsonb_build_object('totalEligible',(select count(*) from eligible where distance_group=v_group),
    'groupCounts',jsonb_build_object('local',0,'unknown',(select count(*) from eligible where distance_group='unknown'),'remote',(select count(*) from eligible where distance_group='remote')),
    'nextCursor',case when (select count(*) from page_plus_one)>v_limit then (select private.page_cursor(v_fingerprint,sort_name,id) from visible order by sort_name desc,id desc limit 1) end,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'practitioner',jsonb_build_object('id',v.id,'displayName',v.display_name,'practiceName',v.practice_name,'profession',v.profession,'lifecycleStatus',v.lifecycle_status,'providerConfirmationStatus',v.provider_confirmation_status,'acceptingNewReferrals',v.accepting_new_referrals,'telehealth',v.telehealth,'funding',v.funding,'languages',v.languages,'services',v.services,'serviceIds',v.service_ids,'ageGroupIds',v.age_group_ids,'location',v.location,'distanceKm',null,'credentials',private.credential_summary(v.id)),
      'reasons',to_jsonb(array['Registration verified','Provider details confirmed','Accepting new referrals']
        || case when v_needs is not null then array['Funding pathway reported: '||(select label from private.controlled_terms where kind='funding' and id=private.normalize_term('funding',v_needs->>'fundingId'))] else array[]::text[] end
        || case when coalesce(v_needs->>'preferredLanguageId','')<>'' then array['Speaks '||(select label from private.controlled_terms where kind='language' and id=private.normalize_term('language',v_needs->>'preferredLanguageId'))] else array[]::text[] end
        || array(select 'Service: '||label from private.controlled_terms where kind='service' and id in (select private.normalize_term('service',x) from jsonb_array_elements_text(v_needs->'requiredServiceIds') x))
        || case when coalesce(v_needs->>'patientAgeGroupId','')<>'' then array['Age group: '||(select label from private.controlled_terms where kind='ageGroup' and id=private.normalize_term('ageGroup',v_needs->>'patientAgeGroupId'))] else array[]::text[] end),
      'warnings',jsonb_build_array('Confirm fees and rebate eligibility with the practitioner.','Distance is unavailable; use the reviewed suburb/postcode.'),'distanceKm',null,'locationPrecision',null) order by v.sort_name,v.id) from visible v),'[]'::jsonb)) into result;
  perform set_config('request.jwt.claim.sub',coalesce(v_previous_actor,''),true);
  return result;
end $$;
revoke all on function private.directory_page(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.directory_page(uuid,jsonb) to service_role;

create function private.referral_page(actor uuid,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid:=(input->>'organisationId')::uuid; v_status text:=coalesce(nullif(input->>'status',''),'all');
 v_query text:=lower(trim(coalesce(input->>'search',''))); v_limit integer:=least(50,greatest(1,coalesce((input->>'limit')::integer,25)));
 v_fingerprint text; v_cursor jsonb; result jsonb;
begin
 if actor is null or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=v_org and active) then raise exception 'denied' using errcode='42501'; end if;
 if length(v_query)>120 or v_status not in ('all','sent','accepted','declined','booked','cancelled','closed','awaiting_onboarding') then raise exception 'invalid_request'; end if;
 v_fingerprint:=md5(jsonb_build_object('actor',actor,'organisation',v_org,'status',v_status,'query',v_query)::text);
 v_cursor:=private.read_page_cursor(input->>'cursor',v_fingerprint);
 if v_cursor is not null then begin perform (v_cursor->>'key')::timestamptz; exception when others then raise exception 'invalid_cursor'; end; end if;
 with authorised as materialized (
   select r.id,r.reference,r.patient_reference,r.patient_postcode,r.profession,r.funding_path,r.appointment_format,r.selection_mode,r.selected_practitioner_id,r.status,r.created_at,r.updated_at,p.practice_name
   from public.referrals r left join public.practitioners p on p.id=r.selected_practitioner_id
   where r.organisation_id=v_org and (v_query='' or strpos(lower(r.reference||' '||r.patient_reference||' '||coalesce(p.practice_name,'')),v_query)>0)
 ), page_plus_one as materialized (
   select * from authorised where (v_status='all' or status=v_status) and (v_cursor is null or (created_at,id)<((v_cursor->>'key')::timestamptz,(v_cursor->>'id')::uuid)) order by created_at desc,id desc limit v_limit+1
 ), visible as materialized(select * from page_plus_one order by created_at desc,id desc limit v_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg((to_jsonb(v)-'practice_name')||jsonb_build_object('practitioners',jsonb_build_object('practice_name',v.practice_name)) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
  'nextCursor',case when (select count(*) from page_plus_one)>v_limit then (select private.page_cursor(v_fingerprint,created_at::text,id) from visible order by created_at,id limit 1) end,
  'counts',coalesce((select jsonb_object_agg(s.status,s.total) from (select status,count(*) total from authorised group by status) s),'{}'::jsonb)||jsonb_build_object('all',(select count(*) from authorised))) into result;
 return result;
end $$;
revoke all on function private.referral_page(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.referral_page(uuid,jsonb) to service_role;

create or replace function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action='directory.search' then return private.directory_page(p_actor,p_input); end if;
  if p_action='referral.list' then return private.referral_page(p_actor,p_input); end if;
  if p_action in ('application.revision_start','review.suspend','review.restore','review.access_detail') then return private.profile_revision_workflow(p_actor,p_action,p_input); end if;
  if p_action='application.credentials' then return private.own_credential_summary(p_actor,(p_input->>'practitionerId')::uuid); end if;
  if p_action like 'draft.%' then return private.referral_draft_workflow(p_actor,p_action,p_input); end if;
  if p_action like 'email.%' then return private.email_workflow(p_action,p_input); end if;
  if p_action like 'referral.%' then return private.referral_workflow(p_actor,p_action,p_input); end if;
  if p_action in ('workspace.access','invitation.claim') or p_action like 'application.%' or p_action like 'review.%' then return private.application_workflow(p_actor,p_action,p_input); end if;
  return private.invitation_workflow(p_actor,p_action,p_input);
end $$;
