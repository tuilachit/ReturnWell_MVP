-- Research provenance only. None of these operations create practitioners,
-- credentials, invitations or email jobs. Browser roles have no access.
create table private.candidate_import_batches (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  digest text not null unique check(digest ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null, imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  status text not null default 'completed' check(status in ('completed','withdrawn')),
  version integer not null default 0, receipt jsonb not null default '{}'
);
create table private.practitioner_candidates (
  id uuid primary key default gen_random_uuid(), source_id text not null unique,
  current_observation_id uuid,
  disposition text not null default 'unreviewed' check(disposition in ('unreviewed','needs_clarification','duplicate','unsuitable','reviewed_for_onboarding')),
  reviewed_observation_hash text, version integer not null default 0,
  created_at timestamptz not null default now()
);
create table private.candidate_observations (
  id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
  candidate_id uuid not null references private.practitioner_candidates(id),
  observation_hash text not null check(observation_hash ~ '^[a-f0-9]{64}$'),
  record jsonb not null, imported_at timestamptz not null default now(),
  unique(candidate_id,observation_hash), unique(candidate_id,id)
);
alter table private.practitioner_candidates add constraint candidate_current_observation
  foreign key(id,current_observation_id) references private.candidate_observations(candidate_id,id);
create table private.candidate_batch_items (
  batch_id uuid not null references private.candidate_import_batches(id),
  candidate_id uuid not null references private.practitioner_candidates(id),
  observation_id uuid not null,
  primary key(batch_id,candidate_id),
  foreign key(candidate_id,observation_id) references private.candidate_observations(candidate_id,id)
);
create index candidate_items_history on private.candidate_batch_items(candidate_id,batch_id);
create table private.candidate_review_events (
  id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
  candidate_id uuid references private.practitioner_candidates(id),
  batch_id uuid references private.candidate_import_batches(id),
  actor_id uuid not null references auth.users(id), action text not null,
  occurred_at timestamptz not null default now(), expected_version integer not null,
  reason text not null check(length(reason) between 1 and 500),
  evidence_reference text, application_id uuid references public.practitioner_applications(id),
  check(candidate_id is not null or batch_id is not null)
);
create index candidate_events_history on private.candidate_review_events(candidate_id,sequence desc);

alter table private.candidate_import_batches enable row level security;
alter table private.practitioner_candidates enable row level security;
alter table private.candidate_observations enable row level security;
alter table private.candidate_batch_items enable row level security;
alter table private.candidate_review_events enable row level security;
revoke all on private.candidate_import_batches,private.practitioner_candidates,private.candidate_observations,private.candidate_batch_items,private.candidate_review_events from public,anon,authenticated,service_role;
grant select,insert,update on private.candidate_import_batches,private.practitioner_candidates to service_role;
grant select,insert on private.candidate_observations,private.candidate_batch_items,private.candidate_review_events to service_role;
revoke all on sequence private.candidate_import_batches_sequence_seq,private.candidate_observations_sequence_seq,private.candidate_review_events_sequence_seq from public,anon,authenticated,service_role;
grant usage on sequence private.candidate_import_batches_sequence_seq,private.candidate_observations_sequence_seq,private.candidate_review_events_sequence_seq to service_role;

create function private.candidate_canonical(value jsonb) returns text
language plpgsql immutable strict security invoker set search_path='' as $$
declare result text;
begin
  case jsonb_typeof(value)
  when 'object' then
    select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||private.candidate_canonical(v),',' order by key collate "C"),'')||'}'
      into result from jsonb_each(value) as e(key,v);
  when 'array' then
    select '['||coalesce(string_agg(private.candidate_canonical(v),',' order by ord),'')||']'
      into result from jsonb_array_elements(value) with ordinality as e(v,ord);
  when 'number' then result:=trim_scale((value::text)::numeric)::text;
  else result:=value::text;
  end case;
  return result;
end $$;
create function private.candidate_hash(value jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
  select encode(sha256(convert_to(private.candidate_canonical(value),'UTF8')),'hex')
$$;
create function private.candidate_json_depth(value jsonb, depth integer default 0) returns boolean
language plpgsql immutable strict security invoker set search_path='' as $$
declare child jsonb;
begin
  if depth>12 then return false; end if;
  if jsonb_typeof(value)='object' then
    for child in select v from jsonb_each(value) as e(k,v) loop
      if not private.candidate_json_depth(child,depth+1) then return false; end if;
    end loop;
  elsif jsonb_typeof(value)='array' then
    for child in select v from jsonb_array_elements(value) as e(v) loop
      if not private.candidate_json_depth(child,depth+1) then return false; end if;
    end loop;
  end if;
  return true;
end $$;
create function private.candidate_operator(actor uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  -- Lock the operator row: revocation and mutation cannot race one another.
  perform 1 from private.platform_operators where user_id=actor and active for share;
  if not found or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception 'denied' using errcode='42501';
  end if;
end $$;
create function private.validate_candidate_batch(manifest jsonb, records jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare r jsonb; item jsonb; k text; bound integer; flags integer:=0; seen text[]:='{}'; labels text[]:='{}'; total integer:=0;
begin
  if manifest is null or records is null or jsonb_typeof(manifest)<>'object' or jsonb_typeof(records)<>'array' then raise exception 'candidate_invalid'; end if;
  if jsonb_array_length(records) not between 1 and 1000 or octet_length(private.candidate_canonical(jsonb_build_object('manifest',manifest-'digest','records',records)))>8388608 then raise exception 'candidate_invalid'; end if;
  if not (manifest ?& array['format','digest','inputs','recordCount','flaggedCount']) or (select count(*) from jsonb_object_keys(manifest))<>5
    or manifest->>'format'<>'returnwell-private-candidates-v1' or (manifest->>'digest') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(manifest->'inputs')<>'array' or jsonb_typeof(manifest->'recordCount')<>'number' or jsonb_typeof(manifest->'flaggedCount')<>'number'
    then raise exception 'candidate_invalid'; end if;
  if jsonb_array_length(manifest->'inputs') not between 1 and 50 then raise exception 'candidate_invalid'; end if;
  for item in select v from jsonb_array_elements(manifest->'inputs') as e(v) loop
    if jsonb_typeof(item)<>'object' or not(item ?& array['label','sha256','count']) or (select count(*) from jsonb_object_keys(item))<>3
      or jsonb_typeof(item->'label')<>'string' or (item->>'label') !~ '^[a-z0-9-]{1,80}$'
      or jsonb_typeof(item->'sha256')<>'string' or (item->>'sha256') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(item->'count')<>'number' or (item->>'count') !~ '^[0-9]{1,9}$'
      or item->>'label'=any(labels) then raise exception 'candidate_invalid'; end if;
    labels:=array_append(labels,item->>'label'); total:=total+(item->>'count')::integer;
  end loop;
  if total<jsonb_array_length(records) or labels<>(select array_agg(x order by x collate "C") from unnest(labels) as e(x)) then raise exception 'candidate_invalid'; end if;
  for r in select v from jsonb_array_elements(records) as e(v) loop
    if jsonb_typeof(r)<>'object' or not(r ?& array['sourceId','displayName','professionIds','practiceNames','locations','sourceUrls','observedAt','locationScope','reviewFlags','raw','observationHash'])
      or (select count(*) from jsonb_object_keys(r))<>11 then raise exception 'candidate_invalid'; end if;
    if octet_length(private.candidate_canonical(r))>98304 or jsonb_typeof(r->'raw')<>'object'
      or octet_length(private.candidate_canonical(r->'raw'))>65536 or not private.candidate_json_depth(r->'raw') then raise exception 'candidate_invalid'; end if;
    foreach k in array array['sourceId','displayName'] loop
      if jsonb_typeof(r->k)<>'string' or length(r->>k) not between 1 and 160 or btrim(r->>k)<>r->>k then raise exception 'candidate_invalid'; end if;
    end loop;
    if r->>'sourceId'=any(seen) then raise exception 'candidate_invalid'; end if;
    seen:=array_append(seen,r->>'sourceId');
    foreach k in array array['professionIds','practiceNames','sourceUrls','reviewFlags','locations'] loop
      bound:=case when k='professionIds' then 20 else 50 end;
      if jsonb_typeof(r->k)<>'array' or jsonb_array_length(r->k)>bound then raise exception 'candidate_invalid'; end if;
      for item in select v from jsonb_array_elements(r->k) as e(v) loop
        if k='locations' then
          if jsonb_typeof(item)<>'object' or not(item ?& array['suburb','postcode','state']) or (select count(*) from jsonb_object_keys(item))<>3 then raise exception 'candidate_invalid'; end if;
          if exists(select 1 from jsonb_each(item) as loc(key,v) where jsonb_typeof(v) not in ('null','string') or (jsonb_typeof(v)='string' and length(v#>>'{}') not between 1 and 160)) then raise exception 'candidate_invalid'; end if;
        else
          bound:=case when k='practiceNames' then 200 when k='sourceUrls' then 2048 else 160 end;
          if jsonb_typeof(item)<>'string' or length(item#>>'{}') not between 1 and bound then raise exception 'candidate_invalid'; end if;
          if k='sourceUrls' and ((item#>>'{}') !~ '^https?://[^/[:space:]?#@]+([/?#][^[:space:]]*)?$') then raise exception 'candidate_invalid'; end if;
        end if;
      end loop;
    end loop;
    if jsonb_typeof(r->'locationScope') not in ('null','string') or (jsonb_typeof(r->'locationScope')='string' and length(r->>'locationScope') not between 1 and 160) then raise exception 'candidate_invalid'; end if;
    if jsonb_typeof(r->'observedAt') not in ('null','string') or (jsonb_typeof(r->'observedAt')='string' and (r->>'observedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$') then raise exception 'candidate_invalid'; end if;
    if jsonb_typeof(r->'observedAt')='string' then perform (r->>'observedAt')::timestamptz; end if;
    if jsonb_typeof(r->'observationHash')<>'string' or r->>'observationHash'<>private.candidate_hash(r-'observationHash') then raise exception 'candidate_invalid'; end if;
    if jsonb_array_length(r->'reviewFlags')>0 then flags:=flags+1; end if;
  end loop;
  if (manifest->>'recordCount')::numeric<>jsonb_array_length(records) or (manifest->>'flaggedCount')::numeric<>flags
    or manifest->>'digest'<>private.candidate_hash(jsonb_build_object('manifest',manifest-'digest','records',records)) then raise exception 'candidate_invalid'; end if;
exception when others then
  -- Never leak a bad source value, cast error or row contents to the CLI.
  raise exception 'candidate_invalid' using errcode='22023';
end $$;

create function public.rw_import_candidate_batch(p_actor uuid,p_manifest jsonb,p_records jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b private.candidate_import_batches; r jsonb; candidate uuid; observation uuid; fresh uuid;
  inserted integer:=0; observations integer:=0; answer jsonb;
begin
  perform private.candidate_operator(p_actor);
  perform private.validate_candidate_batch(p_manifest,p_records);
  -- Shared with withdrawal and review mutations; bounded batches keep it short.
  perform pg_advisory_xact_lock(71423811);
  select * into b from private.candidate_import_batches where digest=p_manifest->>'digest';
  if found then return b.receipt||jsonb_build_object('replayed',true,'status',b.status); end if;
  insert into private.candidate_import_batches(digest,manifest,imported_by) values(p_manifest->>'digest',p_manifest,p_actor) returning * into b;
  -- Deterministic locking also protects future independently scoped mutations.
  perform 1 from private.practitioner_candidates c where c.source_id in (select x->>'sourceId' from jsonb_array_elements(p_records) as e(x)) order by c.id for update;
  for r in select x from jsonb_array_elements(p_records) as e(x) order by x->>'sourceId' collate "C" loop
    fresh:=null;
    insert into private.practitioner_candidates(source_id) values(r->>'sourceId') on conflict(source_id) do nothing returning id into fresh;
    if fresh is not null then inserted:=inserted+1; end if;
    select id into candidate from private.practitioner_candidates where source_id=r->>'sourceId';
    observation:=null;
    insert into private.candidate_observations(candidate_id,observation_hash,record) values(candidate,r->>'observationHash',r)
      on conflict(candidate_id,observation_hash) do nothing returning id into observation;
    if observation is not null then observations:=observations+1;
    else select id into observation from private.candidate_observations where candidate_id=candidate and observation_hash=r->>'observationHash'; end if;
    insert into private.candidate_batch_items(batch_id,candidate_id,observation_id) values(b.id,candidate,observation);
    update private.practitioner_candidates set current_observation_id=observation,version=version+1
      where id=candidate and current_observation_id is distinct from observation;
  end loop;
  answer:=jsonb_build_object('batchId',b.id,'digest',b.digest,'inserted',inserted,'newObservations',observations,
    'unchanged',jsonb_array_length(p_records)-observations,'flagged',(p_manifest->>'flaggedCount')::integer,'replayed',false,'status',b.status);
  update private.candidate_import_batches set receipt=answer where id=b.id;
  return answer;
end $$;

create function private.withdraw_candidate_batch(actor uuid,batch_id uuid,expected_version integer,reason text,request_id uuid,expected_unsupported integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b private.candidate_import_batches; c private.practitioner_candidates; selected uuid; hidden integer:=0;
  payload jsonb; prior private.workflow_requests; answer jsonb; impact integer;
begin
  perform private.candidate_operator(actor);
  if batch_id is null or request_id is null or expected_version is null or expected_version<0 or expected_unsupported is null or expected_unsupported not between 0 and 1000 or reason is null or length(btrim(reason)) not between 1 and 500 then raise exception 'candidate_invalid' using errcode='22023'; end if;
  payload:=jsonb_build_object('batchId',batch_id,'expectedVersion',expected_version,'reason',reason,'expectedUnsupported',expected_unsupported);
  perform pg_advisory_xact_lock(71423811);
  select * into prior from private.workflow_requests w where w.actor_id=actor and w.request_id=withdraw_candidate_batch.request_id;
  if found then
    if prior.operation<>'candidate.withdrawBatch' or prior.request_payload<>payload then raise exception 'request_conflict'; end if;
    return prior.response;
  end if;
  select * into b from private.candidate_import_batches where id=batch_id for update;
  if not found then raise exception 'candidate_not_found'; end if;
  if b.version<>expected_version or b.status<>'completed' then raise exception 'version_conflict'; end if;
  select count(*) into impact from private.candidate_batch_items i where i.batch_id=b.id and not exists(
    select 1 from private.candidate_batch_items other join private.candidate_import_batches supporting on supporting.id=other.batch_id
      where other.candidate_id=i.candidate_id and supporting.id<>b.id and supporting.status='completed');
  if impact<>expected_unsupported then raise exception 'version_conflict'; end if;
  update private.candidate_import_batches set status='withdrawn',version=version+1 where id=b.id;
  for c in select x.* from private.practitioner_candidates x join private.candidate_batch_items i on i.candidate_id=x.id
    where i.batch_id=b.id order by x.id for update of x loop
    selected:=null;
    select i.observation_id into selected from private.candidate_batch_items i join private.candidate_import_batches active on active.id=i.batch_id
      where i.candidate_id=c.id and active.status='completed' order by active.sequence desc limit 1;
    if selected is distinct from c.current_observation_id then
      update private.practitioner_candidates set current_observation_id=selected,version=version+1 where id=c.id;
      if selected is null then hidden:=hidden+1; end if;
    end if;
  end loop;
  insert into private.candidate_review_events(batch_id,actor_id,action,expected_version,reason)
    values(b.id,actor,'withdraw_batch',expected_version,reason);
  answer:=jsonb_build_object('ok',true,'batchId',b.id,'version',b.version+1,'hiddenCandidates',hidden);
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response)
    values(actor,request_id,'candidate.withdrawBatch',payload,answer);
  return answer;
end $$;

revoke all on function private.candidate_canonical(jsonb),private.candidate_hash(jsonb),private.candidate_json_depth(jsonb,integer),private.candidate_operator(uuid),private.validate_candidate_batch(jsonb,jsonb),public.rw_import_candidate_batch(uuid,jsonb,jsonb),private.withdraw_candidate_batch(uuid,uuid,integer,text,uuid,integer) from public,anon,authenticated;
grant execute on function private.candidate_canonical(jsonb),private.candidate_hash(jsonb),private.candidate_json_depth(jsonb,integer),private.candidate_operator(uuid),private.validate_candidate_batch(jsonb,jsonb),public.rw_import_candidate_batch(uuid,jsonb,jsonb),private.withdraw_candidate_batch(uuid,uuid,integer,text,uuid,integer) to service_role;
