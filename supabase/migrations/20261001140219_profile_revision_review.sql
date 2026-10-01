alter table public.practitioner_applications alter column invitation_id drop not null,
  add column revision_practitioner_id uuid references public.practitioners(id);
alter table public.practitioner_applications add constraint application_origin_required check(invitation_id is not null or revision_practitioner_id is not null);
create index application_revision_practitioner on public.practitioner_applications(revision_practitioner_id) where revision_practitioner_id is not null;
alter table public.practitioners add column profile_version integer not null default 0,
  add column profile_revision_pending boolean not null default false;
create table private.profile_access_events (
  id uuid primary key default gen_random_uuid(), practitioner_id uuid not null references public.practitioners(id),
  actor_id uuid not null references auth.users(id), action text not null check(action in ('review.suspend','review.restore')),
  version integer not null,reason text not null,evidence_reference text not null,created_at timestamptz not null default now(),
  unique(practitioner_id,version)
);
alter table private.profile_access_events enable row level security;
revoke all on private.profile_access_events from public,anon,authenticated;
grant select,insert on private.profile_access_events to service_role;

alter function private.practitioner_is_eligible(uuid,text,timestamptz) rename to practitioner_is_eligible_before_revision;
create function private.practitioner_is_eligible(practitioner uuid,profession text,at_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
  select private.practitioner_is_eligible_before_revision(practitioner,profession,at_time) and exists(select 1 from public.practitioners p where p.id=practitioner and not p.profile_revision_pending);
$$;
revoke all on function private.practitioner_is_eligible(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function private.practitioner_is_eligible(uuid,text,timestamptz) to service_role;

create function private.profile_revision_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.practitioners; app public.practitioner_applications; original public.practitioner_applications; req private.workflow_requests; result jsonb;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
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
    select * into app from public.practitioner_applications where user_id=actor and status in ('draft','submitted','changes_requested') for update;
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
revoke all on function private.profile_revision_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.profile_revision_workflow(uuid,text,jsonb) to service_role;
create or replace function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action in ('application.revision_start','review.suspend','review.restore','review.access_detail') then return private.profile_revision_workflow(p_actor,p_action,p_input); end if;
  if p_action='application.credentials' then return private.own_credential_summary(p_actor,(p_input->>'practitionerId')::uuid); end if;
  if p_action like 'draft.%' then return private.referral_draft_workflow(p_actor,p_action,p_input); end if;
  if p_action like 'email.%' then return private.email_workflow(p_action,p_input); end if;
  if p_action like 'referral.%' then return private.referral_workflow(p_actor,p_action,p_input); end if;
  if p_action in ('workspace.access','invitation.claim') or p_action like 'application.%' or p_action like 'review.%' then return private.application_workflow(p_actor,p_action,p_input); end if;
  return private.invitation_workflow(p_actor,p_action,p_input);
end $$;
create or replace function private.application_workflow_before_credentials(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.workspace_invitations; attempt private.invitation_auth_attempts; app public.practitioner_applications;
  req private.workflow_requests; result jsonb; practitioner uuid; p jsonb; loc jsonb; decision text; email_address text;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  if action='workspace.access' then
    return jsonb_build_object('doctors',coalesce((select jsonb_agg(jsonb_build_object('organisationId',m.organisation_id,'organisationName',o.name,'displayName',coalesce(pf.display_name,'Practice member'),'role',m.role)) from public.organisation_memberships m join public.organisations o on o.id=m.organisation_id left join public.profiles pf on pf.id=actor where m.user_id=actor and m.active),'[]'::jsonb),
      'practitioners',coalesce((select jsonb_agg(jsonb_build_object('practitionerId',p.id,'displayName',p.display_name,'acceptingNewReferrals',p.accepting_new_referrals)) from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id where u.user_id=actor and u.active and u.revoked_at is null and private.practitioner_has_access(p.id)),'[]'::jsonb),
      'applicationId',(select id from public.practitioner_applications where user_id=actor and status<>'approved' order by created_at desc limit 1),'operator',private.is_operator(actor),
      'invitationOrganisations',coalesce((select jsonb_agg(jsonb_build_object('organisationId',o.id,'organisationName',o.name)) from private.inviter_identities i join public.organisations o on o.id=i.organisation_id where i.user_id=actor and i.active and private.is_operator(actor)),'[]'::jsonb));
  end if;
  if action='invitation.claim' then
    perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
    select * into inv from public.workspace_invitations where id=(input->>'invitationId')::uuid for update;
    select * into attempt from private.invitation_auth_attempts where id=(input->>'attemptId')::uuid and invitation_id=inv.id for update;
    if inv.id is null or attempt.id is null or attempt.auth_user_id is distinct from actor or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and lower(trim(email))=inv.recipient_email_normalized) then raise exception 'denied' using errcode='42501'; end if;
    if inv.status='claimed' and inv.claimed_by=actor and attempt.claimed_at is not null then
      return jsonb_build_object('ok',true,'organisationId',case when inv.kind='doctor' then inv.organisation_id end,'applicationId',(select id from public.practitioner_applications where user_id=actor order by created_at desc limit 1));
    end if;
    if inv.status<>'pending' or inv.expires_at<=now() or inv.generation<>attempt.generation or attempt.expires_at<=now() or attempt.token_type is null then raise exception 'invitation_unavailable' using errcode='42501'; end if;
    if coalesce(length(trim(input->>'displayName')),0) not between 1 and 120 then raise exception 'invalid_name'; end if;
    insert into public.profiles(id,display_name) values(actor,trim(input->>'displayName')) on conflict(id) do nothing;
    if inv.kind='doctor' then
      insert into public.organisation_memberships(organisation_id,user_id,role) values(inv.organisation_id,actor,'referrer') on conflict(user_id,organisation_id) do nothing;
      if not exists(select 1 from public.organisation_memberships where organisation_id=inv.organisation_id and user_id=actor and active) then raise exception 'membership_inactive' using errcode='42501'; end if;
    else
      select * into app from public.practitioner_applications where user_id=actor and status in ('draft','submitted','changes_requested') for update;
      if app.id is null and not exists(select 1 from public.practitioner_users u join public.practitioners pr on pr.id=u.practitioner_id where u.user_id=actor and u.active and u.revoked_at is null and pr.lifecycle_status='active') then
        insert into public.practitioner_applications(invitation_id,user_id,terms_version,privacy_version) values(inv.id,actor,attempt.terms_version,attempt.privacy_version) returning * into app;
      end if;
    end if;
    update private.invitation_auth_attempts set claimed_at=now() where id=attempt.id;
    update public.workspace_invitations set status='claimed',claimed_by=actor,signup_completed_at=now(),account_was_new=attempt.new_user,version=version+1,updated_at=now() where id=inv.id;
    perform private.invalidate_invitation(inv.id);
    insert into private.invitation_events(invitation_id,actor_user_id,kind) values(inv.id,actor,'claimed');
    return jsonb_build_object('ok',true,'organisationId',case when inv.kind='doctor' then inv.organisation_id end,'applicationId',app.id);
  end if;
  if action='application.availability' then
    if jsonb_typeof(input->'acceptingNewReferrals') is distinct from 'boolean' then raise exception 'invalid_availability'; end if;
    update public.practitioners pr set accepting_new_referrals=(input->>'acceptingNewReferrals')::boolean where id=(input->>'practitionerId')::uuid and private.practitioner_has_access(pr.id) and exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=pr.id and u.active and u.revoked_at is null);
    if not found then raise exception 'denied' using errcode='42501'; end if;
    return '{"ok":true}';
  end if;
  if action like 'review.%' then
    if not private.is_operator(actor) then raise exception 'denied' using errcode='42501'; end if;
    if action='review.list' then
      return jsonb_build_object('applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at) from (select * from public.practitioner_applications where status in ('submitted','changes_requested','approved') order by updated_at desc limit 100) a),'[]'::jsonb));
    end if;
  end if;
  select * into app from public.practitioner_applications where id=(input->>'applicationId')::uuid for update;
  if not found or (action not like 'review.%' and app.user_id<>actor) then raise exception 'denied' using errcode='42501'; end if;
  if action='application.load' then return to_jsonb(app); end if;
  if action='review.detail' then return jsonb_build_object('application',to_jsonb(app),'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from private.practitioner_reviews r where r.application_id=app.id),'[]'::jsonb)); end if;
  if action='review.decide' then
    perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
    select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
    if found then
      if req.operation<>action or req.request_payload<>input then raise exception 'conflict' using errcode='40001'; end if;
      return req.response;
    end if;
  end if;
  if app.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001'; end if;
  if action in ('application.save','application.submit') then
    if app.status not in ('draft','changes_requested') then raise exception 'conflict' using errcode='40001'; end if;
    if action='application.save' then
      p:=private.validate_practitioner_profile(input->'profile',false);
      update public.practitioner_applications set profile=p,version=version+1,updated_at=now() where id=app.id returning * into app;
    else
      p:=private.validate_practitioner_profile(app.profile,true);
      if input->'profileConfirmed' is distinct from 'true'::jsonb or input->'referralConsent' is distinct from 'true'::jsonb or coalesce(length(input->>'termsVersion'),0)=0 then raise exception 'consent_required'; end if;
      update public.practitioner_applications set profile=p,status='submitted',submitted_at=now(),profile_confirmed_at=now(),referral_consent_at=now(),terms_version=input->>'termsVersion',privacy_version=coalesce(input->>'privacyVersion',privacy_version),version=version+1,updated_at=now() where id=app.id returning * into app;
    end if;
    return to_jsonb(app);
  elsif action='review.decide' then
    if app.user_id=actor then raise exception 'denied' using errcode='42501'; end if;
    if app.status<>'submitted' then raise exception 'conflict' using errcode='40001'; end if;
    decision:=input->>'decision';
    if coalesce(decision,'') not in ('approved','changes_requested','rejected') then raise exception 'invalid_decision'; end if;
    if length(input->>'applicantFeedback')>1000 or (decision<>'approved' and coalesce(length(trim(input->>'applicantFeedback')),0)=0) then raise exception 'feedback_required'; end if;
    if decision='approved' then
      p:=private.validate_practitioner_profile(app.profile,true);
      if app.profile_confirmed_at is null or app.referral_consent_at is null then raise exception 'consent_required'; end if;
      if input#>>'{identityEvidence,method}' is distinct from 'independent_practice_contact' or input#>'{identityEvidence,matched}' is distinct from 'true'::jsonb
        or coalesce(length(trim(input#>>'{identityEvidence,reference}')),0) not between 5 and 1000
        or input#>>'{registrationEvidence,method}' is distinct from (select case route when 'ahpra' then 'manual_register' else 'professional_body_register' end from private.profession_policies where profession_id=p->>'profession') or input#>'{registrationEvidence,matched}' is distinct from 'true'::jsonb
        or upper(regexp_replace(input#>>'{registrationEvidence,registrationNumber}','[[:space:]]','','g')) is distinct from p->>'registrationNumber'
        or coalesce(length(trim(input#>>'{registrationEvidence,reference}')),0) not between 5 and 1000 then raise exception 'evidence_required'; end if;
      if (input#>>'{identityEvidence,checkedAt}')::timestamptz is null or (input#>>'{registrationEvidence,checkedAt}')::timestamptz is null
        or (input#>>'{identityEvidence,checkedAt}')::timestamptz not between now()-interval '30 days' and now()+interval '5 minutes'
        or (input#>>'{registrationEvidence,checkedAt}')::timestamptz not between now()-interval '7 days' and now()+interval '5 minutes' then raise exception 'evidence_required'; end if;
      select email into email_address from auth.users where id=app.user_id and email_confirmed_at is not null;
      if email_address is null then raise exception 'verified_email_required'; end if;
      if app.revision_practitioner_id is not null then
        select id into practitioner from public.practitioners where id=app.revision_practitioner_id for update;
        if practitioner is null or not exists(select 1 from public.practitioner_users where practitioner_id=practitioner and user_id=app.user_id and active and revoked_at is null) then raise exception 'denied' using errcode='42501'; end if;
        update public.practitioners pr set display_name=p->>'displayName',profession=p->>'profession',practice_name=p->>'practiceName',contact_email=email_address,
          ahpra_registration_number=case when (select route from private.profession_policies where profession_id=p->>'profession')='ahpra' then p->>'registrationNumber' end,
          ahpra_verification_status=case when (select route from private.profession_policies where profession_id=p->>'profession')='ahpra' then 'verified' else 'not_checked' end,
          ahpra_verified_at=(input#>>'{registrationEvidence,checkedAt}')::timestamptz,provider_confirmation_status='confirmed',provider_confirmed_at=app.profile_confirmed_at,
          accepting_new_referrals=pr.accepting_new_referrals and (p->>'acceptingNewReferrals')::boolean,
          telehealth=(p->>'telehealth')::boolean,services=array(select jsonb_array_elements_text(p->'services')),funding=array(select jsonb_array_elements_text(p->'funding')),languages=array(select jsonb_array_elements_text(p->'languages')),
          profile_revision_pending=false,profile_version=profile_version+1 where id=practitioner;
        delete from public.practitioner_locations where practitioner_id=practitioner;
      else
      insert into public.practitioners(display_name,profession,practice_name,contact_email,lifecycle_status,ahpra_registration_number,ahpra_verification_status,ahpra_verified_at,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages)
        values(p->>'displayName',p->>'profession',p->>'practiceName',email_address,'active',case when (select route from private.profession_policies where profession_id=p->>'profession')='ahpra' then p->>'registrationNumber' end,case when (select route from private.profession_policies where profession_id=p->>'profession')='ahpra' then 'verified' else 'not_checked' end,(input#>>'{registrationEvidence,checkedAt}')::timestamptz,'confirmed',app.profile_confirmed_at,(p->>'acceptingNewReferrals')::boolean,(p->>'telehealth')::boolean,array(select jsonb_array_elements_text(p->'services')),array(select jsonb_array_elements_text(p->'funding')),array(select jsonb_array_elements_text(p->'languages'))) returning id into practitioner;

      end if;
      for loc in select value from jsonb_array_elements(p->'locations') loop
        insert into public.practitioner_locations(practitioner_id,suburb,postcode,state,is_primary) values(practitioner,loc->>'suburb',loc->>'postcode','NSW',(loc->>'isPrimary')::boolean);
      end loop;
      insert into public.practitioner_users(practitioner_id,user_id) values(practitioner,app.user_id) on conflict do nothing;
    end if;
    insert into private.practitioner_reviews(application_id,application_version,reviewer_id,decision,identity_evidence,registration_evidence,applicant_feedback) values(app.id,app.version,actor,decision,input->'identityEvidence',input->'registrationEvidence',input->>'applicantFeedback');
    update public.practitioner_applications set status=decision,practitioner_id=practitioner,applicant_feedback=input->>'applicantFeedback',version=version+1,updated_at=now() where id=app.id returning * into app;
    result:=to_jsonb(app);
    insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,action,input,result);
    return result;
  end if;
  raise exception 'unsupported_operation';
end $$;
create or replace function private.application_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare app public.practitioner_applications; policy private.profession_policies; result jsonb; credential uuid; checked timestamptz; expiry timestamptz;
begin
  if action='review.decide' and input->>'decision'='approved' then
    if not private.is_operator(actor) then raise exception 'denied' using errcode='42501'; end if;
    select * into app from public.practitioner_applications where id=(input->>'applicationId')::uuid for update;
    if app.id is null or app.user_id=actor then raise exception 'denied' using errcode='42501'; end if;
    -- The request ledger remains authoritative for completed replay, including
    -- when the underlying credential has subsequently become due for review.
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
    values((result->>'practitioner_id')::uuid,app.user_id,policy.authority_id,upper(regexp_replace(app.profile->>'registrationNumber','[[:space:]]','','g')),policy.route,'verified',checked,expiry,checked+make_interval(days=>policy.review_interval_days),actor,app.id,input->'identityEvidence',input->'registrationEvidence')
    on conflict(authority_id,identifier_normalized) do update set status=excluded.status,checked_at=excluded.checked_at,expires_at=excluded.expires_at,review_due_at=excluded.review_due_at,reviewed_by=excluded.reviewed_by,application_id=excluded.application_id,identity_evidence=excluded.identity_evidence,registration_evidence=excluded.registration_evidence
      where private.professional_credentials.practitioner_id=excluded.practitioner_id and private.professional_credentials.owner_user_id=excluded.owner_user_id returning id into credential;
    if credential is null then raise exception 'evidence_required'; end if;
    insert into private.practitioner_professions(practitioner_id,profession_id,credential_id) values((result->>'practitioner_id')::uuid,policy.profession_id,credential);
    delete from private.credential_migration_exceptions where practitioner_id=(result->>'practitioner_id')::uuid;
  end if;
  return result;
end $$;
create or replace function private.practitioner_credential_current(practitioner uuid,profession text,at_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
  select private.practitioner_has_access(practitioner) and exists(select 1 from private.practitioner_professions pp
    join private.professional_credentials c on c.id=pp.credential_id and c.practitioner_id=pp.practitioner_id
    join private.profession_policies policy on policy.profession_id=pp.profession_id
    where pp.practitioner_id=practitioner and pp.profession_id=profession and policy.enabled and policy.approved_at<=at_time
      and policy.authority_id=c.authority_id and policy.route=c.route and c.status='verified' and c.checked_at<=at_time
      and (case when c.review_due_at is null then null else least(c.review_due_at,c.checked_at+make_interval(days=>policy.review_interval_days)) end)>at_time and (c.expires_at is null or c.expires_at>at_time)
      and exists(select 1 from public.practitioner_users u join auth.users account on account.id=u.user_id where u.practitioner_id=pp.practitioner_id and u.user_id=c.owner_user_id and u.active and u.revoked_at is null and account.email_confirmed_at is not null));
$$;
create or replace function private.credential_summary(practitioner uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('professionId',pp.profession_id,'authorityId',c.authority_id,'route',c.route,'status',c.status,'checkedAt',c.checked_at,'expiresAt',c.expires_at,'reviewDueAt',case when c.review_due_at is null then null else least(c.review_due_at,c.checked_at+make_interval(days=>policy.review_interval_days)) end,'policyEnabled',policy.enabled)), '[]'::jsonb)
  from private.practitioner_professions pp join private.professional_credentials c on c.id=pp.credential_id join private.profession_policies policy on policy.profession_id=pp.profession_id
  where pp.practitioner_id=practitioner and (private.owns_practitioner(practitioner) or private.directory_visible(practitioner) or private.can_read_assigned_practitioner(practitioner));
$$;
create or replace function private.own_credential_summary(actor uuid,practitioner uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if actor is null or not private.practitioner_has_access(practitioner) or not exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=practitioner and u.active and u.revoked_at is null) then raise exception 'denied' using errcode='42501'; end if;
  select jsonb_build_object('eligibleForNewReferral',private.practitioner_is_eligible(practitioner,p.profession,now()),'credentials',
    coalesce((select jsonb_agg(jsonb_build_object('professionId',pp.profession_id,'authorityId',c.authority_id,'route',c.route,'status',c.status,'checkedAt',c.checked_at,'expiresAt',c.expires_at,'reviewDueAt',case when c.review_due_at is null then null else least(c.review_due_at,c.checked_at+make_interval(days=>policy.review_interval_days)) end,'policyEnabled',policy.enabled))
    from private.practitioner_professions pp join private.professional_credentials c on c.id=pp.credential_id join private.profession_policies policy on policy.profession_id=pp.profession_id where pp.practitioner_id=practitioner),'[]'::jsonb)) into result from public.practitioners p where p.id=practitioner;
  return result;
end $$;
