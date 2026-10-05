-- A provenance link is not a registration check, an account claim, or approval.
create table private.candidate_application_links (
  candidate_id uuid primary key references private.practitioner_candidates(id),
  application_id uuid not null unique references public.practitioner_applications(id),
  application_owner uuid not null references auth.users(id), application_version integer not null,
  observation_hash text not null, linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),
  reason text not null check(length(reason) between 1 and 500),
  evidence_reference text not null check(length(evidence_reference) between 1 and 500)
);
alter table private.candidate_application_links enable row level security;
revoke all on private.candidate_application_links from public,anon,authenticated,service_role;
grant select,insert,delete on private.candidate_application_links to service_role;
alter table private.candidate_review_events add column application_snapshot jsonb;

create or replace function private.candidate_summary(candidate uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',c.id,'displayName',o.record->'displayName','professionIds',o.record->'professionIds',
    'practiceNames',o.record->'practiceNames','locations',o.record->'locations','disposition',c.disposition,'version',c.version,
    'reviewRequired',c.current_observation_id is null or c.reviewed_observation_hash is distinct from o.observation_hash,'linkedApplicationId',link.application_id)
  from private.practitioner_candidates c left join private.candidate_application_links link on link.candidate_id=c.id
  left join lateral (select r.record,r.observation_hash from private.candidate_observations r where r.candidate_id=c.id
    order by (r.id=c.current_observation_id) desc nulls last,r.sequence desc limit 1) o on true where c.id=candidate
$$;

alter function private.candidate_workflow(uuid,text,jsonb) rename to candidate_workflow_before_links;
create function private.candidate_workflow(actor uuid,action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate uuid; application uuid; request uuid; expected integer; reason text; evidence text; observation text;
  c private.practitioner_candidates; app public.practitioner_applications; link private.candidate_application_links;
  prior private.workflow_requests; result jsonb; audit_snapshot jsonb;
begin
  if action not in ('candidate.linkApplication','candidate.unlinkApplication') then return private.candidate_workflow_before_links(actor,action,input); end if;
  perform private.candidate_operator(actor);
  if input is null or jsonb_typeof(input)<>'object' or not(input ?& array['candidateId','applicationId','requestId','expectedVersion','reason','evidenceReference'])
    or jsonb_typeof(input->'candidateId')<>'string' or jsonb_typeof(input->'applicationId')<>'string' or jsonb_typeof(input->'requestId')<>'string'
    or jsonb_typeof(input->'expectedVersion')<>'number' or (input->>'expectedVersion') !~ '^[0-9]{1,9}$'
    or jsonb_typeof(input->'reason')<>'string' or length(btrim(input->>'reason')) not between 1 and 500
    or jsonb_typeof(input->'evidenceReference')<>'string' or length(btrim(input->>'evidenceReference')) not between 1 and 500 then raise exception 'invalid_request'; end if;
  candidate:=(input->>'candidateId')::uuid;application:=(input->>'applicationId')::uuid;request:=(input->>'requestId')::uuid;
  expected:=(input->>'expectedVersion')::integer;reason:=input->>'reason';evidence:=input->>'evidenceReference';
  perform pg_advisory_xact_lock(71423811);
  select * into prior from private.workflow_requests where actor_id=actor and request_id=request;
  if found then
    if prior.operation<>action or prior.request_payload<>input then raise exception 'conflict'; end if;
    return prior.response;
  end if;
  select * into c from private.practitioner_candidates where id=candidate for update;
  if not found then raise exception 'invalid_request'; end if;
  if c.version<>expected then raise exception 'conflict'; end if;
  select * into app from public.practitioner_applications where id=application for share;
  if not found then raise exception 'invalid_request'; end if;
  if app.user_id=actor then raise exception 'denied' using errcode='42501'; end if;
  select * into link from private.candidate_application_links where candidate_id=c.id;
  if action='candidate.linkApplication' then
    if app.status not in ('submitted','approved') then raise exception 'invalid_request'; end if;
    if link.candidate_id is not null or exists(select 1 from private.candidate_application_links where application_id=application) then raise exception 'conflict'; end if;
    select observation_hash into observation from private.candidate_observations where id=c.current_observation_id;
    if c.current_observation_id is null or c.disposition<>'reviewed_for_onboarding' or c.reviewed_observation_hash is distinct from observation then raise exception 'evidence_required'; end if;
    insert into private.candidate_application_links(candidate_id,application_id,application_owner,application_version,observation_hash,linked_by,reason,evidence_reference)
      values(c.id,app.id,app.user_id,app.version,observation,actor,reason,evidence);
  else
    -- Corrections must remain possible after the source was withdrawn or the
    -- application changed status; they never change that application or owner.
    if link.candidate_id is null or link.application_id<>application then raise exception 'conflict'; end if;
    observation:=link.observation_hash;
    delete from private.candidate_application_links where candidate_id=c.id;
  end if;
  audit_snapshot:=jsonb_build_object('applicationId',app.id,'ownerId',app.user_id,'applicationVersion',app.version,'observationHash',observation);
  update private.practitioner_candidates set version=version+1 where id=c.id;
  insert into private.candidate_review_events(candidate_id,actor_id,action,expected_version,reason,evidence_reference,application_id,application_snapshot)
    values(c.id,actor,case when action='candidate.linkApplication' then 'link_application' else 'unlink_application' end,expected,reason,evidence,app.id,audit_snapshot);
  result:=jsonb_build_object('ok',true,'candidateId',c.id,'version',c.version+1);
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,request,action,input,result);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_request';
end $$;
revoke all on function private.candidate_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.candidate_workflow(uuid,text,jsonb) to service_role;
