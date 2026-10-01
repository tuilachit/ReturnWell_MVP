-- Match the current policy deadline, including policies shortened after review.
create or replace function private.directory_page(actor uuid,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_needs jsonb:=nullif(input->'needs','null'); v_group text:=coalesce(input->>'distanceGroup','unknown');
  v_limit integer:=least(50,greatest(1,coalesce((input->>'limit')::integer,25))); v_query text:=lower(trim(coalesce(input->>'query','')));
  v_profession text:=nullif(input->>'professionId',''); v_funding text[]; v_language text[]; v_services text[]; v_age text; v_cursor jsonb; v_fingerprint text; v_previous_actor text; result jsonb;
begin
  if actor is null or not (exists(select 1 from public.organisation_memberships where user_id=actor and active)
    or exists(select 1 from public.practitioner_users u where u.user_id=actor and u.active and u.revoked_at is null and private.practitioner_has_access(u.practitioner_id))) then raise exception 'denied' using errcode='42501'; end if;
  if length(v_query)>120 or v_group not in ('local','unknown','remote') then raise exception 'invalid_request'; end if;
  if nullif(input->>'radiusKm','') is not null then raise exception 'geography_unavailable'; end if;
  if v_needs is not null and (jsonb_typeof(v_needs)<>'object' or jsonb_typeof(v_needs->'requiredServiceIds') is distinct from 'array' or jsonb_array_length(v_needs->'requiredServiceIds')>30 or exists(select 1 from jsonb_array_elements(v_needs->'requiredServiceIds') s where jsonb_typeof(s)<>'string')) then raise exception 'invalid_request'; end if;
  select aliases into v_funding from private.controlled_terms where kind='funding' and id=private.normalize_term('funding',v_needs->>'fundingId');
  select aliases into v_language from private.controlled_terms where kind='language' and id=private.normalize_term('language',v_needs->>'preferredLanguageId');
  v_services:=array(select distinct private.normalize_term('service',x) from jsonb_array_elements_text(v_needs->'requiredServiceIds') x);
  v_age:=private.normalize_term('ageGroup',v_needs->>'patientAgeGroupId');
  v_fingerprint:=md5(jsonb_build_object('actor',actor,'needs',v_needs,'group',v_group,'query',v_query,'profession',v_profession,'postcode',input->>'postcode')::text);
  v_cursor:=private.read_page_cursor(input->>'cursor',v_fingerprint);
  v_previous_actor:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  with eligible as materialized (
    select p.*,translate(p.display_name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') collate "C" as sort_name,
      case when v_needs->>'appointmentFormat'='telehealth' then 'remote'
        when exists(select 1 from public.practitioner_locations where practitioner_id=p.id) then 'unknown' else 'remote' end as distance_group,
      (select jsonb_build_object('suburb',l.suburb,'postcode',l.postcode) from public.practitioner_locations l where l.practitioner_id=p.id order by l.is_primary desc,l.id limit 1) as location
    from public.practitioners p
    -- Set-based equivalent of practitioner_is_eligible; golden/security tests
    -- compare it to the single-recipient gate. Do not evaluate nested security
    -- functions once per candidate before every page and count.
    join private.practitioner_professions pp on pp.practitioner_id=p.id and pp.profession_id=p.profession
    join private.professional_credentials c on c.id=pp.credential_id and c.practitioner_id=p.id
    join private.profession_policies policy on policy.profession_id=pp.profession_id
    join public.practitioner_users owner on owner.practitioner_id=p.id and owner.user_id=c.owner_user_id
    join auth.users account on account.id=owner.user_id
    where p.lifecycle_status='active' and p.provider_confirmation_status='confirmed'
      and p.access_suspended_at is null and not p.profile_revision_pending
      and p.accepting_new_referrals and nullif(trim(p.contact_email),'') is not null
      and policy.enabled and policy.approved_at<=now()
      and policy.authority_id=c.authority_id and policy.route=c.route
      and c.status='verified' and c.checked_at<=now() and c.review_due_at is not null
      and least(c.review_due_at,c.checked_at+make_interval(days=>policy.review_interval_days))>now()
      and (c.expires_at is null or c.expires_at>now())
      and owner.active and owner.revoked_at is null and account.email_confirmed_at is not null
      and (p.telehealth or exists(select 1 from public.practitioner_locations where practitioner_id=p.id))
      and (v_profession is null or p.profession=v_profession)
      and (v_query='' or strpos(lower(p.display_name||' '||p.practice_name),v_query)>0 or exists(select 1 from public.practitioner_locations l where l.practitioner_id=p.id and strpos(lower(l.suburb||' '||l.postcode),v_query)>0))
      and (v_needs is null or (
        p.profession=v_needs->>'professionId' and v_needs->>'appointmentFormat' in ('either','in_person','telehealth')
        and (v_needs->>'appointmentFormat'<>'telehealth' or p.telehealth)
        and (v_needs->>'appointmentFormat'<>'in_person' or exists(select 1 from public.practitioner_locations where practitioner_id=p.id))
        and exists(select 1 from unnest(p.funding) f where lower(trim(f))=any(v_funding))
        and (coalesce(trim(v_needs->>'preferredLanguageId'),'')='' or exists(select 1 from unnest(p.languages) l where lower(trim(l))=any(v_language)))
        and p.service_ids @> v_services
        and (coalesce(trim(v_needs->>'patientAgeGroupId'),'')='' or v_age=any(p.age_group_ids))
      ))
  ), page_plus_one as materialized (
    select * from eligible where distance_group=v_group and (v_cursor is null or (sort_name,id)>((v_cursor->>'key') collate "C",(v_cursor->>'id')::uuid)) order by sort_name,id limit v_limit+1
  ), visible as materialized(select * from page_plus_one order by sort_name,id limit v_limit)
  select jsonb_build_object('totalEligible',(select count(*) from eligible where distance_group=v_group),
    'groupCounts',jsonb_build_object('local',0,'unknown',(select count(*) from eligible where distance_group='unknown'),'remote',(select count(*) from eligible where distance_group='remote')),
    'nextCursor',case when (select count(*) from page_plus_one)>v_limit then (select private.page_cursor(v_fingerprint,sort_name,id) from visible order by sort_name desc,id desc limit 1) end,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'practitioner',jsonb_build_object('id',v.id,'displayName',v.display_name,'practiceName',v.practice_name,'profession',v.profession,'lifecycleStatus',v.lifecycle_status,'providerConfirmationStatus',v.provider_confirmation_status,'acceptingNewReferrals',v.accepting_new_referrals,'telehealth',v.telehealth,'funding',v.funding,'languages',v.languages,'services',v.services,'serviceIds',v.service_ids,'ageGroupIds',v.age_group_ids,'location',v.location,'distanceKm',null,'credentials',private.credential_summary(v.id)),
      'reasons',to_jsonb(array['Registration verified','Provider details confirmed','Accepting new referrals']
        || case when v_needs->>'appointmentFormat'='telehealth' then array['Offers telehealth'] else array[]::text[] end
        || case when v_needs is not null then array['Funding pathway reported: '||(select label from private.controlled_terms where kind='funding' and id=private.normalize_term('funding',v_needs->>'fundingId'))] else array[]::text[] end
        || case when coalesce(v_needs->>'preferredLanguageId','')<>'' then array['Speaks '||(select label from private.controlled_terms where kind='language' and id=private.normalize_term('language',v_needs->>'preferredLanguageId'))] else array[]::text[] end
        || array(select 'Service: '||label from private.controlled_terms where kind='service' and id=any(v_services) order by id collate "C")
        || case when coalesce(v_needs->>'patientAgeGroupId','')<>'' then array['Age group: '||(select label from private.controlled_terms where kind='ageGroup' and id=private.normalize_term('ageGroup',v_needs->>'patientAgeGroupId'))] else array[]::text[] end),
      'warnings',to_jsonb(array['Confirm fees and rebate eligibility with the practitioner.'] || case when coalesce(v_needs->>'appointmentFormat','either')<>'telehealth' and v.location is not null then array['Distance unavailable; browse by suburb.'] else array[]::text[] end),'distanceKm',null,'locationPrecision',null) order by v.sort_name,v.id) from visible v),'[]'::jsonb)) into result;
  perform set_config('request.jwt.claim.sub',coalesce(v_previous_actor,''),true);
  return result;
end $$;
revoke all on function private.directory_page(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.directory_page(uuid,jsonb) to service_role;
