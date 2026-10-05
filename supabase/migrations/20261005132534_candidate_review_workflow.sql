-- Operator-only research review. No clinical privileges or approval changes.
create function private.candidate_summary(candidate uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',c.id,'displayName',o.record->'displayName','professionIds',o.record->'professionIds',
    'practiceNames',o.record->'practiceNames','locations',o.record->'locations','disposition',c.disposition,'version',c.version,
    'reviewRequired',c.current_observation_id is null or c.reviewed_observation_hash is distinct from o.observation_hash,'linkedApplicationId',null)
  from private.practitioner_candidates c
  left join lateral (select r.record,r.observation_hash from private.candidate_observations r where r.candidate_id=c.id
    order by (r.id=c.current_observation_id) desc nulls last,r.sequence desc limit 1) o on true where c.id=candidate
$$;
create function private.candidate_observation(observation uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',o.id,'record',o.record,'importedAt',o.imported_at,'active',exists(
    select 1 from private.candidate_batch_items i join private.candidate_import_batches b on b.id=i.batch_id
    where i.observation_id=o.id and b.status='completed')) from private.candidate_observations o where o.id=observation
$$;
create function private.candidate_cursor(value jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
  select replace(encode(convert_to(value::text,'UTF8'),'base64'),E'\n','')
$$;
create function private.read_candidate_cursor(token text, scope text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare value jsonb;
begin
  if token is null then return null; end if;
  if length(token) not between 1 and 2048 then raise exception 'invalid_cursor'; end if;
  value:=convert_from(decode(token,'base64'),'UTF8')::jsonb;
  if jsonb_typeof(value)<>'object' or value->'v'<>'1'::jsonb or not(value ?& array['v','scope']) or value->>'scope' is distinct from scope then raise exception 'invalid_cursor'; end if;
  return value;
exception when others then raise exception 'invalid_cursor';
end $$;
create function private.candidate_sequence_cursor(token text, scope text) returns bigint
language plpgsql immutable security invoker set search_path='' as $$
declare value jsonb; seq bigint;
begin
  value:=private.read_candidate_cursor(token,scope);
  if value is null then return 9223372036854775807; end if;
  if (select count(*) from jsonb_object_keys(value))<>3 or jsonb_typeof(value->'seq') is distinct from 'number' or (value->>'seq') !~ '^[0-9]{1,19}$' then raise exception 'invalid_cursor'; end if;
  seq:=(value->>'seq')::bigint;
  if seq<=0 then raise exception 'invalid_cursor'; end if;
  return seq;
exception when others then raise exception 'invalid_cursor';
end $$;
create function private.candidate_matches(record jsonb, disposition text, filters jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
  select (coalesce(filters->>'search','')='' or position(lower(filters->>'search') in lower(record->>'displayName'))>0
    or exists(select 1 from jsonb_array_elements_text(record->'practiceNames') as p(name) where position(lower(filters->>'search') in lower(name))>0))
  and (filters->>'professionId' is null or (record->'professionIds') ? (filters->>'professionId'))
  and (filters->>'disposition' is null or disposition=filters->>'disposition')
  and ((filters->>'suburb' is null and filters->>'postcode' is null) or exists(select 1 from jsonb_array_elements(record->'locations') as l(value)
    where (filters->>'suburb' is null or lower(value->>'suburb')=lower(filters->>'suburb')) and (filters->>'postcode' is null or value->>'postcode'=filters->>'postcode')))
$$;
create function private.candidate_workflow(actor uuid, action text, input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare filters jsonb; scope text; cursor jsonb; last_name text; last_id uuid; page_limit integer:=25; key text;
  result jsonb; rows jsonb; total integer; next_cursor text; c private.practitioner_candidates; candidate uuid;
  obs_before bigint; event_before bigint; obs_last bigint; event_last bigint; batch_before bigint; batch_last bigint;
  history record; item jsonb; proposed jsonb; count_items integer; prior private.workflow_requests;
  request uuid; expected integer; reason text; evidence text; new_disposition text; batch uuid;
begin
  perform private.candidate_operator(actor);
  if input is null or jsonb_typeof(input)<>'object' then raise exception 'invalid_request'; end if;
  if action='candidate.list' then
    foreach key in array array['search','professionId','suburb','postcode','disposition'] loop
      if input ? key and input->key<>'null'::jsonb and (jsonb_typeof(input->key)<>'string' or length(input->>key)>160) then raise exception 'invalid_request'; end if;
    end loop;
    filters:=jsonb_build_object('search',nullif(btrim(input->>'search'),''),'professionId',nullif(input->>'professionId',''),
      'suburb',nullif(btrim(input->>'suburb'),''),'postcode',nullif(input->>'postcode',''),'disposition',nullif(input->>'disposition',''));
    if filters->>'postcode' is not null and (filters->>'postcode') !~ '^[0-9]{4}$' then raise exception 'invalid_request'; end if;
    if filters->>'disposition' is not null and filters->>'disposition' not in ('unreviewed','needs_clarification','duplicate','unsuitable','reviewed_for_onboarding') then raise exception 'invalid_request'; end if;
    if input ? 'limit' then
      if jsonb_typeof(input->'limit')<>'number' or (input->>'limit') !~ '^[1-9][0-9]{0,8}$' then raise exception 'invalid_request'; end if;
      page_limit:=least((input->>'limit')::integer,50);
    end if;
    scope:=private.candidate_hash(jsonb_build_object('actor',actor,'filters',filters));
    cursor:=private.read_candidate_cursor(input->>'cursor',scope);
    if cursor is not null then
      begin
        if not(cursor ?& array['name','id']) or (select count(*) from jsonb_object_keys(cursor))<>4
          or jsonb_typeof(cursor->'name')<>'string' or length(cursor->>'name')>160 or jsonb_typeof(cursor->'id')<>'string' then raise exception 'invalid_cursor'; end if;
        last_name:=cursor->>'name';last_id:=(cursor->>'id')::uuid;
      exception when others then raise exception 'invalid_cursor'; end;
    end if;
    with matching as materialized (
      select x.id,lower(o.record->>'displayName') collate "C" as sort_name from private.practitioner_candidates x
        join private.candidate_observations o on o.id=x.current_observation_id where private.candidate_matches(o.record,x.disposition,filters)
    ), page as (select * from matching where last_id is null or (sort_name,id)>(last_name collate "C",last_id) order by sort_name,id limit page_limit+1),
    shown as (select * from page order by sort_name,id limit page_limit)
    select coalesce((select jsonb_agg(private.candidate_summary(id) order by sort_name,id) from shown),'[]'::jsonb),
      (select count(*) from matching),case when (select count(*) from page)>page_limit then
        (select private.candidate_cursor(jsonb_build_object('v',1,'scope',scope,'name',sort_name,'id',id)) from shown order by sort_name desc,id desc limit 1) else null end
      into rows,total,next_cursor;
    return jsonb_build_object('items',rows,'total',total,'nextCursor',next_cursor);
  elsif action='candidate.detail' then
    candidate:=(input->>'candidateId')::uuid;
    select * into c from private.practitioner_candidates where id=candidate;
    if not found then raise exception 'invalid_request'; end if;
    scope:=actor::text||':'||candidate::text;
    obs_before:=private.candidate_sequence_cursor(input->>'observationCursor',scope||':observations');
    event_before:=private.candidate_sequence_cursor(input->>'eventCursor',scope||':events');
    obs_last:=obs_before;event_last:=event_before;
    result:=private.candidate_summary(candidate)||jsonb_build_object('currentObservation',private.candidate_observation(c.current_observation_id),
      'observations','[]'::jsonb,'events','[]'::jsonb,'nextObservationCursor',null,'nextEventCursor',null,'withdrawn',c.current_observation_id is null);
    for history in select id,sequence from private.candidate_observations where candidate_id=candidate and sequence<obs_before order by sequence desc limit 20 loop
      item:=private.candidate_observation(history.id);
      proposed:=jsonb_set(result,'{observations}',(result->'observations')||jsonb_build_array(item));
      -- Reserve cursor space and one full review event to guarantee progress.
      exit when octet_length(private.candidate_canonical(proposed))>258000;
      result:=proposed;obs_last:=history.sequence;
    end loop;
    if exists(select 1 from private.candidate_observations where candidate_id=candidate and sequence<obs_last) then
      result:=jsonb_set(result,'{nextObservationCursor}',to_jsonb(private.candidate_cursor(jsonb_build_object('v',1,'scope',scope||':observations','seq',obs_last))));
    end if;
    for history in select * from private.candidate_review_events where candidate_id=candidate and sequence<event_before order by sequence desc limit 20 loop
      item:=jsonb_build_object('id',history.id,'actorId',history.actor_id,'action',history.action,'occurredAt',history.occurred_at,
        'expectedVersion',history.expected_version,'reason',history.reason,'evidenceReference',history.evidence_reference,'applicationId',history.application_id);
      proposed:=jsonb_set(result,'{events}',(result->'events')||jsonb_build_array(item));
      exit when octet_length(private.candidate_canonical(proposed))>261000;
      result:=proposed;event_last:=history.sequence;
    end loop;
    if exists(select 1 from private.candidate_review_events where candidate_id=candidate and sequence<event_last) then
      result:=jsonb_set(result,'{nextEventCursor}',to_jsonb(private.candidate_cursor(jsonb_build_object('v',1,'scope',scope||':events','seq',event_last))));
    end if;
    return result;
  elsif action='candidate.batches' then
    scope:=actor::text||':batches';batch_before:=private.candidate_sequence_cursor(input->>'cursor',scope);
    rows:='[]'::jsonb;count_items:=0;batch_last:=batch_before;
    for history in select * from private.candidate_import_batches where sequence<batch_before order by sequence desc limit 25 loop
      item:=jsonb_build_object('batchId',history.id,'digest',history.digest,'status',history.status,'version',history.version,
        'importedAt',history.imported_at,'recordCount',history.manifest->'recordCount','flaggedCount',history.manifest->'flaggedCount',
        'unsupportedOnWithdrawal',case when history.status='withdrawn' then 0 else (
          select count(*) from private.candidate_batch_items i where i.batch_id=history.id and not exists(
            select 1 from private.candidate_batch_items other join private.candidate_import_batches b on b.id=other.batch_id
              where other.candidate_id=i.candidate_id and b.id<>history.id and b.status='completed')) end);
      rows:=rows||jsonb_build_array(item);batch_last:=history.sequence;count_items:=count_items+1;
    end loop;
    if exists(select 1 from private.candidate_import_batches where sequence<batch_last) then
      next_cursor:=private.candidate_cursor(jsonb_build_object('v',1,'scope',scope,'seq',batch_last));
    end if;
    return jsonb_build_object('items',rows,'nextCursor',next_cursor);
  elsif action in ('candidate.dispose','candidate.withdrawBatch') then
    if jsonb_typeof(input->'requestId') is distinct from 'string' or jsonb_typeof(input->'expectedVersion') is distinct from 'number'
      or (input->>'expectedVersion') !~ '^[0-9]{1,9}$' or jsonb_typeof(input->'reason') is distinct from 'string'
      or length(btrim(input->>'reason')) not between 1 and 500 then raise exception 'invalid_request'; end if;
    request:=(input->>'requestId')::uuid;expected:=(input->>'expectedVersion')::integer;reason:=input->>'reason';
    if action='candidate.withdrawBatch' then
      batch:=(input->>'batchId')::uuid;
      begin
        return private.withdraw_candidate_batch(actor,batch,expected,reason,request);
      exception when raise_exception then
        if sqlerrm in ('version_conflict','request_conflict') then raise exception 'conflict'; end if;
        raise exception 'invalid_request';
      end;
    end if;
    candidate:=(input->>'candidateId')::uuid;new_disposition:=input->>'disposition';evidence:=input->>'evidenceReference';
    if candidate is null or new_disposition is null or new_disposition not in ('unreviewed','needs_clarification','duplicate','unsuitable','reviewed_for_onboarding') then raise exception 'invalid_request'; end if;
    if input ? 'evidenceReference' and input->'evidenceReference'<>'null'::jsonb and (jsonb_typeof(input->'evidenceReference')<>'string' or length(btrim(evidence)) not between 1 and 500) then raise exception 'invalid_request'; end if;
    if new_disposition='reviewed_for_onboarding' and evidence is null then raise exception 'evidence_required'; end if;
    perform pg_advisory_xact_lock(71423811);
    select * into prior from private.workflow_requests where actor_id=actor and request_id=request;
    if found then
      if prior.operation<>action or prior.request_payload<>input then raise exception 'conflict'; end if;
      return prior.response;
    end if;
    select * into c from private.practitioner_candidates where id=candidate for update;
    if not found or c.current_observation_id is null then raise exception 'invalid_request'; end if;
    if c.version<>expected then raise exception 'conflict'; end if;
    update private.practitioner_candidates x set disposition=new_disposition,version=x.version+1,
      reviewed_observation_hash=case when new_disposition='reviewed_for_onboarding' then
        (select observation_hash from private.candidate_observations where id=c.current_observation_id) else null end where x.id=c.id;
    insert into private.candidate_review_events(candidate_id,actor_id,action,expected_version,reason,evidence_reference)
      values(c.id,actor,'disposition:'||new_disposition,expected,reason,evidence);
    result:=jsonb_build_object('ok',true,'candidateId',c.id,'version',c.version+1);
    insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,request,action,input,result);
    return result;
  end if;
  raise exception 'invalid_request';
exception when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then raise exception 'invalid_request';
end $$;

revoke all on function private.candidate_summary(uuid),private.candidate_observation(uuid),private.candidate_cursor(jsonb),private.read_candidate_cursor(text,text),private.candidate_sequence_cursor(text,text),private.candidate_matches(jsonb,text,jsonb),private.candidate_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.candidate_summary(uuid),private.candidate_observation(uuid),private.candidate_cursor(jsonb),private.read_candidate_cursor(text,text),private.candidate_sequence_cursor(text,text),private.candidate_matches(jsonb,text,jsonb),private.candidate_workflow(uuid,text,jsonb) to service_role;
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_candidates;
alter function public.rw_workflow_before_candidates(uuid,text,jsonb) set schema private;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_action like 'candidate.%' then return private.candidate_workflow(p_actor,p_action,p_input); end if;
  return private.rw_workflow_before_candidates(p_actor,p_action,p_input);
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb) to service_role;
