-- No live reference data is bundled. Import an approved immutable edition separately.
create table private.geography_sources (
  version text primary key check(length(version) between 1 and 1000),
  metadata jsonb not null,
  row_count integer not null check(row_count between 1 and 50000),
  imported_at timestamptz not null default now()
);
create table private.postcode_localities (
  source_version text not null references private.geography_sources(version),
  id text not null,
  postcode text not null check(postcode ~ '^[0-9]{4}$'),
  state text not null check(state='NSW'),
  suburb text not null check(length(trim(suburb)) between 1 and 160),
  latitude double precision,
  longitude double precision,
  primary key(source_version,id),
  unique(source_version,state,postcode,suburb),
  check((latitude is null and longitude is null) or
    (latitude is not null and longitude is not null and latitude between -45 and -9 and longitude between 110 and 155))
);
create index postcode_localities_lookup on private.postcode_localities(source_version,postcode);
create table private.geography_active (
  singleton boolean primary key default true check(singleton),
  source_version text not null references private.geography_sources(version)
);
alter table private.geography_sources enable row level security;
alter table private.postcode_localities enable row level security;
alter table private.geography_active enable row level security;
revoke all on private.geography_sources,private.postcode_localities,private.geography_active from public,anon,authenticated,service_role;
grant select on private.geography_sources,private.postcode_localities,private.geography_active to service_role;

create function private.locality_key(state text,postcode text,suburb text) returns text
language sql immutable security invoker set search_path='' as $$
  select state||':'||postcode||':'||lower(regexp_replace(trim(suburb),'\s+',' ','g'));
$$;

-- Operator-only activation also provides atomic rollback to an older, complete edition.
create function private.activate_geography(version text) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(832901);
  if not exists(select 1 from private.geography_sources s where s.version=activate_geography.version
    and s.row_count=(select count(*) from private.postcode_localities l where l.source_version=s.version)) then
    raise exception 'incomplete_geography';
  end if;
  insert into private.geography_active(singleton,source_version) values(true,version)
    on conflict(singleton) do update set source_version=excluded.source_version;
end $$;

create function private.install_geography(source jsonb,rows jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare field text; n integer;
begin
  perform pg_advisory_xact_lock(832901);
  foreach field in array array['version','url','license','attribution','sha256','publishedAt','contentSha256'] loop
    if jsonb_typeof(source->field) is distinct from 'string' or length(trim(source->>field)) not between 1 and 1000 then raise exception 'invalid_geography_source'; end if;
  end loop;
  if source->>'url' !~ '^https://' or source->>'sha256' !~ '^[a-f0-9]{64}$' or source->>'contentSha256' !~ '^[a-f0-9]{64}$'
    or source->>'publishedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_geography_source'; end if;
  perform (source->>'publishedAt')::date;
  if jsonb_typeof(rows) is distinct from 'array' then raise exception 'invalid_geography_rows'; end if;
  n:=jsonb_array_length(rows);
  if n not between 1 and 50000 then raise exception 'invalid_geography_rows'; end if;
  if exists(select 1 from private.geography_sources where version=source->>'version') then
    if not exists(select 1 from private.geography_sources where version=source->>'version' and metadata=source and row_count=n)
      or exists((select id,postcode,state,suburb,latitude,longitude from private.postcode_localities where source_version=source->>'version')
        except (select x.id,x.postcode,x.state,x.suburb,x.latitude,x.longitude from jsonb_to_recordset(rows) x(id text,postcode text,state text,suburb text,latitude double precision,longitude double precision)))
      then raise exception 'geography_edition_conflict'; end if;
    perform private.activate_geography(source->>'version'); return;
  end if;
  if exists(select 1 from jsonb_array_elements(rows) r where jsonb_typeof(r)<>'object'
    or coalesce(r->>'id','')<>private.locality_key(r->>'state',r->>'postcode',r->>'suburb')
    or r->>'suburb' ~ '[[:cntrl:]]') then raise exception 'invalid_geography_rows'; end if;
  insert into private.geography_sources(version,metadata,row_count) values(source->>'version',source,n);
  insert into private.postcode_localities(source_version,id,postcode,state,suburb,latitude,longitude)
    select source->>'version',x.id,x.postcode,x.state,x.suburb,x.latitude,x.longitude
    from jsonb_to_recordset(rows) x(id text,postcode text,state text,suburb text,latitude double precision,longitude double precision);
  perform private.activate_geography(source->>'version');
end $$;
revoke all on function private.activate_geography(text),private.install_geography(jsonb,jsonb) from public,anon,authenticated,service_role;

create function private.straight_line_km(a_lat double precision,a_lon double precision,b_lat double precision,b_lon double precision)
returns double precision language sql immutable strict security invoker set search_path='' as $$
  select case when a_lat between -90 and 90 and b_lat between -90 and 90 and a_lon between -180 and 180 and b_lon between -180 and 180 then
    12742.0176 * asin(sqrt(least(1::double precision,greatest(0::double precision,
      power(sin(radians(b_lat-a_lat)/2),2)+cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(b_lon-a_lon)/2),2))))) end;
$$;
revoke all on function private.locality_key(text,text,text),private.straight_line_km(double precision,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function private.locality_key(text,text,text),private.straight_line_km(double precision,double precision,double precision,double precision) to service_role;
-- Match the current policy deadline, including policies shortened after review.
create or replace function private.directory_page(actor uuid,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_needs jsonb:=nullif(input->'needs','null'); v_group text:=coalesce(input->>'distanceGroup','unknown');
  v_limit integer:=least(50,greatest(1,coalesce((input->>'limit')::integer,25))); v_query text:=lower(trim(coalesce(input->>'query','')));
  v_profession text:=nullif(input->>'professionId',''); v_funding text[]; v_language text[]; v_services text[]; v_age text; v_cursor jsonb; v_fingerprint text; v_previous_actor text; result jsonb;
  v_source jsonb; v_version text; v_origin private.postcode_localities;
  v_locality text:=nullif(input->>'localityId',''); v_postcode text:=nullif(input->>'postcode','');
  v_radius double precision; v_cursor_distance double precision; v_cursor_name text;
begin
  if actor is null or not (exists(select 1 from public.organisation_memberships where user_id=actor and active)
    or exists(select 1 from public.practitioner_users u where u.user_id=actor and u.active and u.revoked_at is null and private.practitioner_has_access(u.practitioner_id))) then raise exception 'denied' using errcode='42501'; end if;
  if length(v_query)>120 or v_group not in ('local','unknown','remote') then raise exception 'invalid_request'; end if;
  select s.version,s.metadata-'contentSha256' into v_version,v_source from private.geography_active a join private.geography_sources s on s.version=a.source_version;
  if v_postcode is not null and v_postcode !~ '^[0-9]{4}$' then raise exception 'invalid_location'; end if;
  if input->'lookup'='true'::jsonb then
    if v_postcode is null then raise exception 'invalid_location'; end if;
    return jsonb_build_object('source',v_source,'localities',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'postcode',postcode,'state',state,'suburb',suburb,'hasCoordinates',latitude is not null) order by suburb collate "C",id)
      from private.postcode_localities where source_version=v_version and postcode=v_postcode),'[]'::jsonb));
  end if;
  if v_locality is not null then
    if v_version is null then raise exception 'geography_unavailable'; end if;
    select * into v_origin from private.postcode_localities where source_version=v_version and id=v_locality and postcode=v_postcode;
    if not found then raise exception 'invalid_location'; end if;
  end if;
  if nullif(input->>'radiusKm','') is not null then
    if jsonb_typeof(input->'radiusKm')<>'number' then raise exception 'invalid_radius'; end if;
    v_radius:=(input->>'radiusKm')::double precision;
    if not (v_radius>0 and v_radius<=500) then raise exception 'invalid_radius'; end if;
    if v_version is null then raise exception 'geography_unavailable'; end if;
    if v_origin.latitude is null then raise exception 'location_required'; end if;
  end if;
  if v_needs is not null and (jsonb_typeof(v_needs)<>'object' or jsonb_typeof(v_needs->'requiredServiceIds') is distinct from 'array' or jsonb_array_length(v_needs->'requiredServiceIds')>30 or exists(select 1 from jsonb_array_elements(v_needs->'requiredServiceIds') s where jsonb_typeof(s)<>'string')) then raise exception 'invalid_request'; end if;
  select aliases into v_funding from private.controlled_terms where kind='funding' and id=private.normalize_term('funding',v_needs->>'fundingId');
  select aliases into v_language from private.controlled_terms where kind='language' and id=private.normalize_term('language',v_needs->>'preferredLanguageId');
  v_services:=array(select distinct private.normalize_term('service',x) from jsonb_array_elements_text(v_needs->'requiredServiceIds') x);
  v_age:=private.normalize_term('ageGroup',v_needs->>'patientAgeGroupId');
  v_fingerprint:=md5(jsonb_build_object('actor',actor,'needs',v_needs,'group',v_group,'query',v_query,'profession',v_profession,'postcode',v_postcode,'locality',v_locality,'radius',v_radius,'source',v_version)::text);
  v_cursor:=private.read_page_cursor(input->>'cursor',v_fingerprint);
  if v_cursor is not null then
    begin
      v_cursor_distance:=((v_cursor->>'key')::jsonb->>'distance')::double precision;
      v_cursor_name:=(v_cursor->>'key')::jsonb->>'name';
      if v_cursor_distance is null or not (v_cursor_distance between -1 and 20100) or v_cursor_name is null then raise exception 'invalid_cursor'; end if;
    exception when others then raise exception 'invalid_cursor'; end;
  end if;
  v_previous_actor:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  with eligible as materialized (
    select p.*,translate(p.display_name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') collate "C" as sort_name
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
  ), located as materialized (
    select e.*,nearest.location,nearest.location_id,nearest.distance_km,
      case when v_needs->>'appointmentFormat'='telehealth' or nearest.location_id is null then 'remote'
        when nearest.distance_km is not null then 'local' else 'unknown' end as distance_group
    from eligible e left join lateral (
      select l.id as location_id,jsonb_build_object('id',l.id,'suburb',l.suburb,'postcode',l.postcode,'state',l.state) as location,
        case when coalesce(v_needs->>'appointmentFormat','either')<>'telehealth' then
          private.straight_line_km(v_origin.latitude,v_origin.longitude,r.latitude,r.longitude) end as distance_km
      from public.practitioner_locations l left join private.postcode_localities r
        on r.source_version=v_version and r.id=private.locality_key(l.state,l.postcode,l.suburb)
      where l.practitioner_id=e.id
      order by distance_km nulls last,l.is_primary desc,l.id limit 1
    ) nearest on true
  ), filtered as materialized (
    select * from located where distance_group<>'local' or v_radius is null or distance_km<=v_radius
  ), page_plus_one as materialized (
    select * from filtered where distance_group=v_group and (v_cursor is null or
      (coalesce(distance_km,-1),sort_name,id)>(v_cursor_distance,v_cursor_name collate "C",(v_cursor->>'id')::uuid))
      order by distance_km nulls last,sort_name,id limit v_limit+1
  ), visible as materialized(select * from page_plus_one order by distance_km nulls last,sort_name,id limit v_limit)
  select jsonb_build_object('geography',jsonb_build_object('source',v_source,'origin',case when v_origin.id is not null then jsonb_build_object('id',v_origin.id,'suburb',v_origin.suburb,'postcode',v_origin.postcode,'hasCoordinates',v_origin.latitude is not null) end,'radiusKm',v_radius),
    'totalEligible',(select count(*) from filtered where distance_group=v_group),
    'groupCounts',jsonb_build_object('local',(select count(*) from filtered where distance_group='local'),'unknown',(select count(*) from filtered where distance_group='unknown'),'remote',(select count(*) from filtered where distance_group='remote')),
    'nextCursor',case when (select count(*) from page_plus_one)>v_limit then (select private.page_cursor(v_fingerprint,jsonb_build_object('distance',coalesce(distance_km,-1),'name',sort_name)::text,id) from visible order by distance_km desc nulls first,sort_name desc,id desc limit 1) end,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'practitioner',jsonb_build_object('id',v.id,'displayName',v.display_name,'practiceName',v.practice_name,'profession',v.profession,'lifecycleStatus',v.lifecycle_status,'providerConfirmationStatus',v.provider_confirmation_status,'acceptingNewReferrals',v.accepting_new_referrals,'telehealth',v.telehealth,'funding',v.funding,'languages',v.languages,'services',v.services,'serviceIds',v.service_ids,'ageGroupIds',v.age_group_ids,'location',v.location,'distanceKm',v.distance_km,'locationPrecision',case when v.distance_km is not null then 'suburb_reference' end,'credentials',private.credential_summary(v.id)),
      'reasons',to_jsonb(case when v.distance_km is not null then array['Approx. '||round(v.distance_km::numeric,1)::text||' km between suburb reference points'] else array[]::text[] end || array['Registration verified','Provider details confirmed','Accepting new referrals']
        || case when v_needs->>'appointmentFormat'='telehealth' then array['Offers telehealth'] else array[]::text[] end
        || case when v_needs is not null then array['Funding pathway reported: '||(select label from private.controlled_terms where kind='funding' and id=private.normalize_term('funding',v_needs->>'fundingId'))] else array[]::text[] end
        || case when coalesce(v_needs->>'preferredLanguageId','')<>'' then array['Speaks '||(select label from private.controlled_terms where kind='language' and id=private.normalize_term('language',v_needs->>'preferredLanguageId'))] else array[]::text[] end
        || array(select 'Service: '||label from private.controlled_terms where kind='service' and id=any(v_services) order by id collate "C")
        || case when coalesce(v_needs->>'patientAgeGroupId','')<>'' then array['Age group: '||(select label from private.controlled_terms where kind='ageGroup' and id=private.normalize_term('ageGroup',v_needs->>'patientAgeGroupId'))] else array[]::text[] end),
      'warnings',to_jsonb(array['Confirm fees and rebate eligibility with the practitioner.'] || case when coalesce(v_needs->>'appointmentFormat','either')<>'telehealth' and v.location is not null and v.distance_km is null then array['Distance unavailable; browse by suburb.'] else array[]::text[] end),'distanceKm',v.distance_km,'locationPrecision',case when v.distance_km is not null then 'suburb_reference' end) order by v.distance_km nulls last,v.sort_name,v.id) from visible v),'[]'::jsonb)) into result;
  perform set_config('request.jwt.claim.sub',coalesce(v_previous_actor,''),true);
  return result;
end $$;
revoke all on function private.directory_page(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.directory_page(uuid,jsonb) to service_role;

-- Search preferences live in the private draft, never patient coordinates.
alter function private.validate_referral_draft(jsonb,boolean) rename to validate_referral_draft_before_geography;
create function private.validate_referral_draft(p jsonb,complete boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; locality text:=p->>'patientLocalityId'; radius double precision;
begin
  result:=private.validate_referral_draft_before_geography(p-'patientLocalityId'-'searchRadiusKm',complete);
  if p ? 'patientLocalityId' then
    if jsonb_typeof(p->'patientLocalityId') is distinct from 'string' or length(locality)>200
      or locality not like 'NSW:'||coalesce(p->>'patientPostcode','')||':_%' then raise exception 'invalid_draft'; end if;
    if complete and not exists(select 1 from private.postcode_localities l join private.geography_active a on a.source_version=l.source_version where l.id=locality and l.postcode=p->>'patientPostcode') then raise exception 'invalid_draft'; end if;
    result:=result||jsonb_build_object('patientLocalityId',locality);
  end if;
  if p ? 'searchRadiusKm' then
    if jsonb_typeof(p->'searchRadiusKm') is distinct from 'number' or locality is null then raise exception 'invalid_draft'; end if;
    radius:=(p->>'searchRadiusKm')::double precision;
    if not (radius>0 and radius<=500) then raise exception 'invalid_draft'; end if;
    result:=result||jsonb_build_object('searchRadiusKm',radius);
  end if;
  return result;
end $$;
revoke all on function private.validate_referral_draft(jsonb,boolean) from public,anon,authenticated;
grant execute on function private.validate_referral_draft(jsonb,boolean) to service_role;
