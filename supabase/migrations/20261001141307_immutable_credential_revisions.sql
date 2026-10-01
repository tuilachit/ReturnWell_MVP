-- An identifier has one owner; each independent review has its own immutable
-- credential row. Active profession links point at the latest approved review.
create table private.credential_identities (
  authority_id text not null, identifier_normalized text not null,
  practitioner_id uuid not null references public.practitioners(id),
  owner_user_id uuid not null references auth.users(id),
  primary key(authority_id,identifier_normalized),
  unique(authority_id,identifier_normalized,practitioner_id,owner_user_id)
);
alter table private.credential_identities enable row level security;
revoke all on private.credential_identities from public,anon,authenticated,service_role;
grant select on private.credential_identities to service_role;
insert into private.credential_identities select distinct authority_id,identifier_normalized,practitioner_id,owner_user_id from private.professional_credentials;
alter table private.professional_credentials drop constraint professional_credentials_authority_id_identifier_normalized_key;
alter table private.professional_credentials add constraint credential_identity_owner foreign key(authority_id,identifier_normalized,practitioner_id,owner_user_id)
  references private.credential_identities(authority_id,identifier_normalized,practitioner_id,owner_user_id);
create unique index credential_application_review on private.professional_credentials(application_id);
create function private.claim_credential_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.credential_identities(authority_id,identifier_normalized,practitioner_id,owner_user_id)
    values(new.authority_id,new.identifier_normalized,new.practitioner_id,new.owner_user_id) on conflict do nothing;
  if not exists(select 1 from private.credential_identities where authority_id=new.authority_id and identifier_normalized=new.identifier_normalized and practitioner_id=new.practitioner_id and owner_user_id=new.owner_user_id) then
    raise exception 'evidence_required';
  end if;
  return new;
end $$;
revoke all on function private.claim_credential_identity() from public,anon,authenticated,service_role;
create trigger credential_claim_identity before insert on private.professional_credentials for each row execute function private.claim_credential_identity();
-- No application workflow can edit or remove an approved review snapshot.
revoke update,delete,truncate on private.professional_credentials from service_role;

create or replace function private.application_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare app public.practitioner_applications; policy private.profession_policies; result jsonb; credential uuid; checked timestamptz; expiry timestamptz;
begin
  if action='review.due' then
    if not private.is_operator(actor) then raise exception 'denied' using errcode='42501'; end if;
    return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(d)) from (
      select p.id as "practitionerId",p.display_name as "displayName",pp.profession_id as "professionId",c.application_id as "applicationId",
        c.expires_at as "expiresAt",case when c.review_due_at is null then null else least(c.review_due_at,c.checked_at+make_interval(days=>pol.review_interval_days)) end as "reviewDueAt",
        case when c.expires_at<=now() then 'credential_expired' when c.status<>'verified' then 'credential_not_current' when not pol.enabled then 'policy_review_required' when c.review_due_at is null then 'deadline_unconfirmed' else 'review_due' end as reason
      from private.practitioner_professions pp join public.practitioners p on p.id=pp.practitioner_id
        join private.professional_credentials c on c.id=pp.credential_id join private.profession_policies pol on pol.profession_id=pp.profession_id
      where c.status<>'verified' or not pol.enabled or c.review_due_at is null or c.expires_at<=now()
        or least(c.review_due_at,c.checked_at+make_interval(days=>pol.review_interval_days))<=now()
      order by c.expires_at nulls last,c.review_due_at nulls first,p.id limit 50
    ) d),'[]'::jsonb));
  end if;
  if action='review.decide' and input->>'decision'='approved' then
    if not private.is_operator(actor) then raise exception 'denied' using errcode='42501'; end if;
    select * into app from public.practitioner_applications where id=(input->>'applicationId')::uuid for update;
    if app.id is null or app.user_id=actor then raise exception 'denied' using errcode='42501'; end if;
    if not exists(select 1 from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid) then
      select * into policy from private.profession_policies where profession_id=app.profile->>'profession' for share;
      if not coalesce(policy.enabled,false) or policy.approved_at>now() then raise exception 'credential_policy_required'; end if;
      if upper(regexp_replace(app.profile->>'registrationNumber','[[:space:]]','','g')) !~ policy.identifier_pattern then raise exception 'evidence_required'; end if;
      checked:=(input#>>'{registrationEvidence,checkedAt}')::timestamptz;
      expiry:=nullif(input#>>'{registrationEvidence,expiresAt}','')::timestamptz;
      if checked is null or checked>now()+interval '5 minutes' or checked<now()-interval '7 days' or expiry<=now() then raise exception 'evidence_required'; end if;
    end if;
  end if;
  result:=private.application_workflow_before_credentials(actor,action,input);
  if action='review.decide' and input->>'decision'='approved' and checked is not null and not exists(select 1 from private.professional_credentials where application_id=app.id) then
    delete from private.practitioner_professions where practitioner_id=(result->>'practitioner_id')::uuid;
    insert into private.professional_credentials(practitioner_id,owner_user_id,authority_id,identifier_normalized,route,status,checked_at,expires_at,review_due_at,reviewed_by,application_id,identity_evidence,registration_evidence)
    values((result->>'practitioner_id')::uuid,app.user_id,policy.authority_id,upper(regexp_replace(app.profile->>'registrationNumber','[[:space:]]','','g')),policy.route,'verified',checked,expiry,checked+make_interval(days=>policy.review_interval_days),actor,app.id,input->'identityEvidence',input->'registrationEvidence') returning id into credential;
    insert into private.practitioner_professions(practitioner_id,profession_id,credential_id) values((result->>'practitioner_id')::uuid,policy.profession_id,credential);
    delete from private.credential_migration_exceptions where practitioner_id=(result->>'practitioner_id')::uuid;
  end if;
  return result;
end $$;

-- Reopen and approval both lock application before practitioner. Locking an
-- owner's unfinished application first also lets READ COMMITTED recheck a row
-- that became approved while reopen was waiting.
create or replace function private.profile_revision_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.practitioners; app public.practitioner_applications; original public.practitioner_applications; req private.workflow_requests; result jsonb;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if action='application.revision_start' then
    select * into app from public.practitioner_applications where user_id=actor and status in ('draft','submitted','changes_requested') for update;
  end if;
  select * into p from public.practitioners where id=(input->>'practitionerId')::uuid for update;
  if p.id is null then raise exception 'denied' using errcode='42501'; end if;
  if action='application.revision_start' then
    if not private.practitioner_has_access(p.id) or not exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=p.id and u.active and u.revoked_at is null) then raise exception 'denied' using errcode='42501'; end if;
  elsif action in ('review.suspend','review.restore','review.access_detail') then
    if not private.is_operator(actor) then raise exception 'denied' using errcode='42501'; end if;
    if action='review.access_detail' then return jsonb_build_object('practitionerId',p.id,'version',p.profile_version,'suspended',p.access_suspended_at is not null); end if;
    if exists(select 1 from public.practitioner_users where practitioner_id=p.id and user_id=actor) then raise exception 'denied' using errcode='42501'; end if;
  else raise exception 'unsupported_operation'; end if;
  select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
  if found then
    if req.operation<>action or req.request_payload<>input then raise exception 'conflict' using errcode='40001'; end if;
    return req.response;
  end if;
  if action='application.revision_start' then
    if app.id is not null and app.revision_practitioner_id is distinct from p.id then raise exception 'conflict' using errcode='40001'; end if;
    if app.id is null then
      select * into original from public.practitioner_applications where user_id=actor and practitioner_id=p.id and status='approved' order by updated_at desc,id limit 1;
      if original.id is null then raise exception 'evidence_required'; end if;
      insert into public.practitioner_applications(user_id,revision_practitioner_id,profile,terms_version,privacy_version)
        values(actor,p.id,original.profile,original.terms_version,original.privacy_version) returning * into app;
      update public.practitioners set profile_revision_pending=true,profile_version=profile_version+1 where id=p.id;
    end if;
    result:=to_jsonb(app);
  else
    if p.profile_version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001'; end if;
    if coalesce(length(trim(input->>'reason')),0) not between 5 and 500 or coalesce(length(trim(input->>'evidenceReference')),0) not between 5 and 1000 then raise exception 'evidence_required'; end if;
    if (action='review.suspend' and p.access_suspended_at is not null) or (action='review.restore' and p.access_suspended_at is null) then raise exception 'conflict' using errcode='40001'; end if;
    update public.practitioners set access_suspended_at=case when action='review.suspend' then now() else null end,profile_version=profile_version+1 where id=p.id returning * into p;
    insert into private.profile_access_events(practitioner_id,actor_id,action,version,reason,evidence_reference) values(p.id,actor,action,p.profile_version,trim(input->>'reason'),trim(input->>'evidenceReference'));
    result:=jsonb_build_object('practitionerId',p.id,'version',p.profile_version,'suspended',p.access_suspended_at is not null);
  end if;
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,action,input,result);
  return result;
end $$;
