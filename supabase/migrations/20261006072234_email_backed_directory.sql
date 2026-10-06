-- Research contacts remain private and never become registered members.
create table private.directory_contact_routes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references private.practitioner_candidates(id),
  observation_id uuid not null references private.candidate_observations(id),
  observation_hash text not null,practice_key text not null,email text not null,
  evidence jsonb not null,active boolean not null default true,
  unique(candidate_id,observation_id,practice_key,email)
);
alter table private.directory_contact_routes enable row level security;
revoke all on private.directory_contact_routes from public,anon,authenticated,service_role;
grant select,insert,update on private.directory_contact_routes to service_role;
create index directory_contact_routes_active on private.directory_contact_routes(candidate_id) where active;

create function private.refresh_directory_routes(candidate uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare c private.practitioner_candidates;o private.candidate_observations;mailbox text;emails jsonb;practice text;
begin
  select * into c from private.practitioner_candidates where id=candidate;
  update private.directory_contact_routes set active=false where candidate_id=candidate and active;
  if c.current_observation_id is null or c.disposition in ('duplicate','unsuitable') then return;end if;
  select * into o from private.candidate_observations where id=c.current_observation_id;
  if not exists(select 1 from private.candidate_batch_items i join private.candidate_import_batches b on b.id=i.batch_id
    where i.observation_id=o.id and b.status='completed') then return;end if;
  -- One explicit source-record practice and mailbox; do not infer multi-practice
  -- associations from name similarity or cross-practitioner shared inboxes.
  emails:=o.record#>'{raw,business_emails}';
  if jsonb_array_length(o.record->'practiceNames')<>1 or jsonb_array_length(o.record->'sourceUrls')=0
    or jsonb_typeof(emails) is distinct from 'array' or jsonb_array_length(emails)<>1
    or jsonb_typeof(emails->0) is distinct from 'string' then return;end if;
  mailbox:=lower(btrim(emails->>0));practice:=btrim(o.record#>>'{practiceNames,0}');
  if length(mailbox)>254 or mailbox !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
    or mailbox like '.%' or mailbox like '%..%' or mailbox like '%.@%' or practice='' then return;end if;
  insert into private.directory_contact_routes(candidate_id,observation_id,observation_hash,practice_key,email,evidence)
    values(c.id,o.id,o.observation_hash,lower(regexp_replace(practice,'\s+',' ','g')),mailbox,
      jsonb_build_object('association','single_practice_single_mailbox','sourceUrls',o.record->'sourceUrls'))
    on conflict(candidate_id,observation_id,practice_key,email) do update set active=true;
end $$;
create function private.directory_routes_changed() returns trigger
language plpgsql security invoker set search_path='' as $$
begin perform private.refresh_directory_routes(new.id);return new;end $$;
-- Deferred until import batch support has been inserted; still atomic at commit.
create constraint trigger directory_routes_changed after insert or update on private.practitioner_candidates
  deferrable initially deferred for each row execute function private.directory_routes_changed();
revoke all on function private.refresh_directory_routes(uuid),private.directory_routes_changed() from public,anon,authenticated;
grant execute on function private.refresh_directory_routes(uuid),private.directory_routes_changed() to service_role;
do $$ declare c uuid;begin for c in select id from private.practitioner_candidates loop perform private.refresh_directory_routes(c);end loop;end $$;

create function private.directory_recipients(actor uuid,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare members jsonb:='[]';page jsonb;member_cursor text;result jsonb;fingerprint text;cursor jsonb;
  origin private.postcode_localities;geo_version text;needs jsonb:=nullif(input->'needs','null');
  limit_n integer:=least(50,greatest(1,coalesce((input->>'limit')::integer,25)));
  distance_group text:=coalesce(input->>'distanceGroup','unknown');
begin
  if actor is null or not exists(select 1 from public.organisation_memberships m join auth.users a on a.id=m.user_id
    where m.user_id=actor and m.active and a.email_confirmed_at is not null) then raise exception 'denied' using errcode='42501';end if;
  -- Reuse the authoritative member/geography validation and eligibility gate.
  loop
    page:=private.directory_page(actor,(input-'cursor')||jsonb_build_object('limit',50,'cursor',member_cursor));
    members:=members||page->'items';member_cursor:=page->>'nextCursor';exit when member_cursor is null;
  end loop;
  if needs is not null and (not exists(select 1 from private.profession_policies where profession_id=needs->>'professionId')
    or needs->>'appointmentFormat' not in ('either','in_person','telehealth')
    or private.normalize_term('funding',needs->>'fundingId') is null
    or (coalesce(needs->>'preferredLanguageId','')<>'' and private.normalize_term('language',needs->>'preferredLanguageId') is null)
    or exists(select 1 from jsonb_array_elements_text(needs->'requiredServiceIds') x where private.normalize_term('service',x) is null)
    or (coalesce(needs->>'patientAgeGroupId','')<>'' and private.normalize_term('ageGroup',needs->>'patientAgeGroupId') is null)) then raise exception 'invalid_request';end if;
  select source_version into geo_version from private.geography_active;
  select * into origin from private.postcode_localities where source_version=geo_version and id=input->>'localityId' and postcode=input->>'postcode';
  fingerprint:=md5(jsonb_build_object('actor',actor,'input',input-'cursor'-'limit','source',geo_version,'operation','recipients')::text);
  cursor:=private.read_page_cursor(input->>'cursor',fingerprint);
  with contacts as materialized (
    select r.id,r.candidate_id,r.observation_hash,o.record,loc.location,loc.distance,
      case when needs->>'appointmentFormat'='telehealth' or loc.location is null then 'remote'
        when loc.distance is null then 'unknown' else 'local' end as grp
    from private.directory_contact_routes r join private.practitioner_candidates c on c.id=r.candidate_id
    join private.candidate_observations o on o.id=r.observation_id
    left join lateral (
      select l as location,case when coalesce(needs->>'appointmentFormat','either')<>'telehealth' then
        private.straight_line_km(origin.latitude,origin.longitude,g.latitude,g.longitude) end as distance
      from jsonb_array_elements(o.record->'locations') l left join private.postcode_localities g
        on g.source_version=geo_version and g.id=private.locality_key(l->>'state',l->>'postcode',l->>'suburb')
      where l->>'state'='NSW' and l->>'postcode' ~ '^[0-9]{4}$' and coalesce(l->>'suburb','')<>''
      order by distance nulls last,l->>'suburb' collate "C",l->>'postcode' limit 1
    ) loc on true
    where r.active and c.current_observation_id=o.id and c.disposition not in ('duplicate','unsuitable')
      and exists(select 1 from private.candidate_batch_items i join private.candidate_import_batches b on b.id=i.batch_id where i.observation_id=o.id and b.status='completed')
      and not exists(select 1 from private.email_suppressions s where s.email=r.email)
      and not exists(select 1 from private.candidate_application_links link join public.practitioner_applications app on app.id=link.application_id where link.candidate_id=c.id and app.status='approved')
      and (coalesce(input->>'query','')='' or strpos(lower((o.record->>'displayName')||' '||(o.record->'practiceNames')::text),lower(trim(input->>'query')))>0)
      and (coalesce(input->>'professionId','')='' or o.record->'professionIds' ? (input->>'professionId'))
      and (o.record#>'{raw,accepting_new_referrals}') is distinct from 'false'::jsonb
      and (needs is null or (
        o.record->'professionIds' ? (needs->>'professionId')
        and (needs->>'appointmentFormat'<>'telehealth' or (o.record#>'{raw,telehealth}') is distinct from 'false'::jsonb)
        and (needs->>'appointmentFormat'<>'in_person' or loc.location is not null)
        and (not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(o.record#>'{raw,funding_types_raw}')='array' then o.record#>'{raw,funding_types_raw}' else '[]' end) x where private.normalize_term('funding',x) is not null)
          or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(o.record#>'{raw,funding_types_raw}')='array' then o.record#>'{raw,funding_types_raw}' else '[]' end) x where private.normalize_term('funding',x)=private.normalize_term('funding',needs->>'fundingId')))
        and (coalesce(needs->>'preferredLanguageId','')='' or not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(o.record#>'{raw,languages_raw}')='array' then o.record#>'{raw,languages_raw}' else '[]' end) x where private.normalize_term('language',x) is not null)
          or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(o.record#>'{raw,languages_raw}')='array' then o.record#>'{raw,languages_raw}' else '[]' end) x where private.normalize_term('language',x)=private.normalize_term('language',needs->>'preferredLanguageId')))
      ))
  ), options as materialized (
    select (m#>>'{practitioner,id}')::uuid as id,0 as tier,m->>'distanceKm' as distance,
      translate(m#>>'{practitioner,displayName}','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') collate "C" as name,
      jsonb_build_object('kind','member','practitionerId',m#>>'{practitioner,id}','displayName',m#>>'{practitioner,displayName}',
        'professionId',m#>>'{practitioner,profession}','practiceName',m#>>'{practitioner,practiceName}','location',m#>'{practitioner,location}',
        'distanceKm',m->'distanceKm','reasons',m->'reasons','warnings',m->'warnings','requirementStatus','confirmed') as option
      from jsonb_array_elements(members) m
    union all
    select c.id,1,c.distance::text,translate(c.record->>'displayName','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') collate "C",
      jsonb_build_object('kind','directory','selection',jsonb_build_object('candidateId',c.candidate_id,'observationHash',c.observation_hash,'routeId',c.id),
        'displayName',c.record->>'displayName','professionId',coalesce(needs->>'professionId',input->>'professionId',c.record#>>'{professionIds,0}'),
        'practiceName',c.record#>>'{practiceNames,0}','location',c.location,'distanceKm',c.distance,
        'reasons',jsonb_build_array('Public business contact available'),
        'warnings',jsonb_build_array('Not yet a ReturnWell member. Registration, funding, services, languages and availability need confirmation.',
          'A clinic inbox may be shared; signing up alone does not grant access to patient details.') ||
          case when c.location is not null and c.distance is null then jsonb_build_array('Distance unavailable; check the practice suburb.') else '[]'::jsonb end,
        'requirementStatus','needs_confirmation')
      from contacts c where c.grp=distance_group and (c.grp<>'local' or input->>'radiusKm' is null or c.distance<=(input->>'radiusKm')::double precision)
  ), keyed as materialized (
    select *,jsonb_build_array(tier,coalesce(distance::double precision,-1),name)::text as key from options
  ), page_plus as materialized (
    select * from keyed where cursor is null or
      (tier,coalesce(distance::double precision,-1),name,id)>
      (((cursor->>'key')::jsonb->>0)::integer,((cursor->>'key')::jsonb->>1)::double precision,((cursor->>'key')::jsonb->>2) collate "C",(cursor->>'id')::uuid)
    order by tier,coalesce(distance::double precision,-1),name,id limit limit_n+1
  ), visible as materialized(select * from page_plus order by tier,coalesce(distance::double precision,-1),name,id limit limit_n)
  select jsonb_build_object('items',coalesce((select jsonb_agg(option order by tier,coalesce(distance::double precision,-1),name,id) from visible),'[]'::jsonb),
    'counts',jsonb_build_object('confirmed',(select count(*) from options where tier=0),'needsConfirmation',(select count(*) from options where tier=1)),
    'geography',page->'geography','nextCursor',case when (select count(*) from page_plus)>limit_n then
      (select private.page_cursor(fingerprint,key,id) from visible order by tier desc,coalesce(distance::double precision,-1) desc,name desc,id desc limit 1) end) into result;
  return result;
end $$;
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_recipients;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_action='directory.recipients' then return private.directory_recipients(p_actor,p_input);end if;
  return public.rw_workflow_before_recipients(p_actor,p_action,p_input);
end $$;
revoke all on function private.directory_recipients(uuid,jsonb),public.rw_workflow(uuid,text,jsonb),public.rw_workflow_before_recipients(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.directory_recipients(uuid,jsonb),public.rw_workflow(uuid,text,jsonb),public.rw_workflow_before_recipients(uuid,text,jsonb) to service_role;
