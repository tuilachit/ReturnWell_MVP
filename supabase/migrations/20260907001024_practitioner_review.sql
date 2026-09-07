create table public.practitioner_applications (
  id uuid primary key default gen_random_uuid(),invitation_id uuid unique not null references public.workspace_invitations(id),
  user_id uuid not null references auth.users(id),status text not null default 'draft' check(status in ('draft','submitted','changes_requested','approved','rejected')),
  version integer not null default 0,profile jsonb not null default '{}',submitted_at timestamptz,profile_confirmed_at timestamptz,referral_consent_at timestamptz,
  terms_version text not null,privacy_version text not null,applicant_feedback text check(length(applicant_feedback)<=1000),
  practitioner_id uuid references public.practitioners(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index application_one_unfinished on public.practitioner_applications(user_id) where status in ('draft','submitted','changes_requested');
create table private.practitioner_reviews (
  id uuid primary key default gen_random_uuid(),application_id uuid not null references public.practitioner_applications(id),application_version integer not null,
  reviewer_id uuid not null references auth.users(id),decision text not null check(decision in ('approved','changes_requested','rejected')),
  identity_evidence jsonb,registration_evidence jsonb,applicant_feedback text,created_at timestamptz not null default now(),unique(application_id,application_version)
);
create unique index practitioners_unique_registration on public.practitioners(upper(regexp_replace(ahpra_registration_number,'[[:space:]]','','g'))) where ahpra_registration_number is not null;
alter table public.practitioner_applications enable row level security;
revoke all on public.practitioner_applications from public,anon,authenticated;
alter table private.practitioner_reviews enable row level security;
create policy applications_read_own on public.practitioner_applications for select to authenticated using(user_id=auth.uid());
grant select on public.practitioner_applications to authenticated;
grant all on public.practitioner_applications,private.practitioner_reviews to service_role;
revoke all on private.practitioner_reviews from public,anon,authenticated;

create function private.validate_practitioner_profile(p jsonb,complete boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare key text; v jsonb; max_length integer; max_entries integer; loc jsonb; primary_count integer;
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>14000 then raise exception 'invalid_profile'; end if;
  for key in select jsonb_object_keys(p) loop
    if not key=any(array['displayName','profession','registrationNumber','practiceName','services','funding','languages','telehealth','acceptingNewReferrals','locations']) then raise exception 'invalid_profile'; end if;
  end loop;
  foreach key in array array['displayName','practiceName','registrationNumber'] loop
    max_length:=case key when 'displayName' then 160 when 'practiceName' then 200 else 40 end;
    if (p ? key and (jsonb_typeof(p->key)<>'string' or length(p->>key)>max_length)) or (complete and coalesce(length(trim(p->>key)),0)=0) then raise exception 'invalid_profile'; end if;
  end loop;
  if (p ? 'profession' and p->>'profession' not in ('','physiotherapist','psychologist')) or (complete and coalesce(p->>'profession','') not in ('physiotherapist','psychologist')) then raise exception 'invalid_profile'; end if;
  foreach key in array array['telehealth','acceptingNewReferrals'] loop
    if (p ? key and p->key<>'null'::jsonb and jsonb_typeof(p->key)<>'boolean') or (complete and coalesce(jsonb_typeof(p->key),'null')<>'boolean') then raise exception 'invalid_profile'; end if;
  end loop;
  foreach key in array array['services','funding','languages'] loop
    max_entries:=case key when 'services' then 30 else 20 end; max_length:=case key when 'languages' then 80 else 120 end;
    if p ? key then
      if jsonb_typeof(p->key)<>'array' or jsonb_array_length(p->key)>max_entries then raise exception 'invalid_profile'; end if;
      for v in select value from jsonb_array_elements(p->key) loop
        if jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and max_length then raise exception 'invalid_profile'; end if;
      end loop;
    end if;
    if complete and key<>'funding' and (not p ? key or jsonb_array_length(p->key)=0) then raise exception 'invalid_profile'; end if;
  end loop;
  if p ? 'locations' then
    if jsonb_typeof(p->'locations')<>'array' or jsonb_array_length(p->'locations')>10 then raise exception 'invalid_profile'; end if;
    primary_count:=0;
    for loc in select value from jsonb_array_elements(p->'locations') loop
      if jsonb_typeof(loc)<>'object' or exists(select 1 from jsonb_object_keys(loc) k where k not in ('suburb','postcode','state','isPrimary')) then raise exception 'invalid_profile'; end if;
      if complete and (coalesce(length(trim(loc->>'suburb')),0) not between 1 and 120 or coalesce(loc->>'postcode','') !~ '^[0-9]{4}$' or loc->>'state' is distinct from 'NSW' or coalesce(jsonb_typeof(loc->'isPrimary'),'null')<>'boolean') then raise exception 'invalid_profile'; end if;
      if loc->'isPrimary'='true'::jsonb then primary_count:=primary_count+1; end if;
    end loop;
    if complete and jsonb_array_length(p->'locations')>0 and primary_count<>1 then raise exception 'invalid_profile'; end if;
  end if;
  if complete and p->'telehealth'='false'::jsonb and coalesce(jsonb_array_length(p->'locations'),0)=0 then raise exception 'invalid_profile'; end if;
  if p ? 'registrationNumber' then p:=jsonb_set(p,'{registrationNumber}',to_jsonb(upper(regexp_replace(p->>'registrationNumber','[[:space:]]','','g')))); end if;
  return p;
end $$;

create function private.application_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.workspace_invitations; attempt private.invitation_auth_attempts; app public.practitioner_applications;
  req private.workflow_requests; result jsonb; practitioner uuid; p jsonb; loc jsonb; decision text; email_address text;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  if action='workspace.access' then
    return jsonb_build_object('doctors',coalesce((select jsonb_agg(jsonb_build_object('organisationId',m.organisation_id,'organisationName',o.name,'displayName',coalesce(pf.display_name,'Practice member'),'role',m.role)) from public.organisation_memberships m join public.organisations o on o.id=m.organisation_id left join public.profiles pf on pf.id=actor where m.user_id=actor and m.active),'[]'::jsonb),
      'practitioners',coalesce((select jsonb_agg(jsonb_build_object('practitionerId',p.id,'displayName',p.display_name,'acceptingNewReferrals',p.accepting_new_referrals)) from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id where u.user_id=actor and u.active and u.revoked_at is null and p.lifecycle_status='active' and p.ahpra_verification_status='verified' and p.provider_confirmation_status='confirmed'),'[]'::jsonb),
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
    update public.practitioners pr set accepting_new_referrals=(input->>'acceptingNewReferrals')::boolean where id=(input->>'practitionerId')::uuid and lifecycle_status='active' and ahpra_verification_status='verified' and provider_confirmation_status='confirmed' and exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=pr.id and u.active and u.revoked_at is null);
    if not found then raise exception 'denied' using errcode='42501'; end if;
    return '{"ok":true}';
  end if;
  if action like 'review.%' then
    if not private.is_operator(actor) then raise exception 'denied' using errcode='42501'; end if;
    if action='review.list' then
      return jsonb_build_object('applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at) from (select * from public.practitioner_applications where status in ('submitted','changes_requested') order by updated_at limit 100) a),'[]'::jsonb));
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
        or input#>>'{registrationEvidence,method}' is distinct from 'manual_register' or input#>'{registrationEvidence,matched}' is distinct from 'true'::jsonb
        or upper(regexp_replace(input#>>'{registrationEvidence,registrationNumber}','[[:space:]]','','g')) is distinct from p->>'registrationNumber'
        or coalesce(length(trim(input#>>'{registrationEvidence,reference}')),0) not between 5 and 1000 then raise exception 'evidence_required'; end if;
      if (input#>>'{identityEvidence,checkedAt}')::timestamptz is null or (input#>>'{registrationEvidence,checkedAt}')::timestamptz is null
        or (input#>>'{identityEvidence,checkedAt}')::timestamptz not between now()-interval '30 days' and now()+interval '5 minutes'
        or (input#>>'{registrationEvidence,checkedAt}')::timestamptz not between now()-interval '7 days' and now()+interval '5 minutes' then raise exception 'evidence_required'; end if;
      select email into email_address from auth.users where id=app.user_id and email_confirmed_at is not null;
      if email_address is null then raise exception 'verified_email_required'; end if;
      insert into public.practitioners(display_name,profession,practice_name,contact_email,lifecycle_status,ahpra_registration_number,ahpra_verification_status,ahpra_verified_at,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages)
        values(p->>'displayName',p->>'profession',p->>'practiceName',email_address,'active',p->>'registrationNumber','verified',(input#>>'{registrationEvidence,checkedAt}')::timestamptz,'confirmed',app.profile_confirmed_at,(p->>'acceptingNewReferrals')::boolean,(p->>'telehealth')::boolean,array(select jsonb_array_elements_text(p->'services')),array(select jsonb_array_elements_text(p->'funding')),array(select jsonb_array_elements_text(p->'languages'))) returning id into practitioner;
      for loc in select value from jsonb_array_elements(p->'locations') loop
        insert into public.practitioner_locations(practitioner_id,suburb,postcode,state,is_primary) values(practitioner,loc->>'suburb',loc->>'postcode','NSW',(loc->>'isPrimary')::boolean);
      end loop;
      insert into public.practitioner_users(practitioner_id,user_id) values(practitioner,app.user_id);
    end if;
    insert into private.practitioner_reviews(application_id,application_version,reviewer_id,decision,identity_evidence,registration_evidence,applicant_feedback) values(app.id,app.version,actor,decision,input->'identityEvidence',input->'registrationEvidence',input->>'applicantFeedback');
    update public.practitioner_applications set status=decision,practitioner_id=practitioner,applicant_feedback=input->>'applicantFeedback',version=version+1,updated_at=now() where id=app.id returning * into app;
    result:=to_jsonb(app);
    insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,action,input,result);
    return result;
  end if;
  raise exception 'unsupported_operation';
end $$;

create or replace function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action in ('workspace.access','invitation.claim') or p_action like 'application.%' or p_action like 'review.%' then return private.application_workflow(p_actor,p_action,p_input); end if;
  return private.invitation_workflow(p_actor,p_action,p_input);
end $$;
revoke execute on function private.validate_practitioner_profile(jsonb,boolean),private.application_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.validate_practitioner_profile(jsonb,boolean),private.application_workflow(uuid,text,jsonb) to service_role;

-- The security-invoker view cannot filter on contact_email without leaking that
-- column's SELECT privilege. Keep that eligibility lookup narrowly private.
create function private.directory_visible(practitioner uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.can_use_directory() and exists(select 1 from public.practitioners p where p.id=practitioner and p.lifecycle_status='active' and p.ahpra_verification_status='verified' and p.provider_confirmation_status='confirmed' and p.accepting_new_referrals and p.contact_email is not null);
$$;
revoke execute on function private.directory_visible(uuid) from public,anon;
grant execute on function private.directory_visible(uuid) to authenticated,service_role;
create or replace view public.verified_practitioners with (security_invoker=true) as
  select id,display_name,profession,practice_name,telehealth,services,funding,languages,ahpra_verified_at,provider_confirmed_at,updated_at
  from public.practitioners where private.directory_visible(id);
