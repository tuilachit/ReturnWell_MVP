-- Expand first. No policy is activated by a code migration or a scraped flag.
create table private.profession_policies (
  profession_id text primary key, authority_id text not null, route text not null check(route in ('ahpra','professional_body')),
  catalogue_scope text not null check(catalogue_scope in ('supported','review_required','out_of_scope')),
  enabled boolean not null default false, review_interval_days integer check(review_interval_days between 1 and 366),
  approved_by uuid references auth.users(id), approved_at timestamptz, evidence_reference text,
  identifier_pattern text,
  check(not enabled or (catalogue_scope='supported' and authority_id<>'protocol_pending' and review_interval_days is not null and identifier_pattern is not null and length(identifier_pattern)>2 and approved_by is not null and approved_at is not null and length(trim(evidence_reference)) between 5 and 1000))
);
create table private.professional_credentials (
  id uuid primary key default gen_random_uuid(), practitioner_id uuid not null references public.practitioners(id),
  owner_user_id uuid not null references auth.users(id), authority_id text not null,
  identifier_normalized text not null check(length(identifier_normalized) between 3 and 80),
  route text not null check(route in ('ahpra','professional_body')),status text not null check(status in ('not_checked','verified','failed','expired')),
  checked_at timestamptz, expires_at timestamptz, review_due_at timestamptz,
  reviewed_by uuid not null references auth.users(id), application_id uuid not null references public.practitioner_applications(id),
  identity_evidence jsonb not null, registration_evidence jsonb not null,
  created_at timestamptz not null default now(), check(reviewed_by<>owner_user_id),
  check(status<>'verified' or checked_at is not null), check(review_due_at is null or review_due_at>checked_at),
  unique(authority_id,identifier_normalized),unique(id,practitioner_id)
);
create table private.practitioner_professions (
  practitioner_id uuid not null references public.practitioners(id),profession_id text not null references private.profession_policies(profession_id),
  credential_id uuid not null, primary key(practitioner_id,profession_id),
  foreign key(credential_id,practitioner_id) references private.professional_credentials(id,practitioner_id)
);
create table private.credential_migration_exceptions (
  practitioner_id uuid primary key references public.practitioners(id),reason text not null,created_at timestamptz not null default now()
);
alter table private.profession_policies enable row level security;
alter table private.professional_credentials enable row level security;
alter table private.practitioner_professions enable row level security;
alter table private.credential_migration_exceptions enable row level security;
revoke all on private.profession_policies,private.professional_credentials,private.practitioner_professions,private.credential_migration_exceptions from public,anon,authenticated;
grant all on private.profession_policies,private.professional_credentials,private.practitioner_professions,private.credential_migration_exceptions to service_role;
create index professional_credentials_owner on private.professional_credentials(owner_user_id);
create index professional_credentials_application on private.professional_credentials(application_id);
create index practitioner_professions_credential on private.practitioner_professions(credential_id);
alter table public.practitioners add column access_suspended_at timestamptz;

create function private.practitioner_has_access(practitioner uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.practitioners p where p.id=practitioner and p.lifecycle_status='active' and p.provider_confirmation_status='confirmed' and p.access_suspended_at is null
    and exists(select 1 from private.professional_credentials c where c.practitioner_id=p.id and c.checked_at is not null));
$$;
create function private.practitioner_credential_current(practitioner uuid,profession text,at_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
  select private.practitioner_has_access(practitioner) and exists(select 1 from private.practitioner_professions pp
    join private.professional_credentials c on c.id=pp.credential_id and c.practitioner_id=pp.practitioner_id
    join private.profession_policies policy on policy.profession_id=pp.profession_id
    where pp.practitioner_id=practitioner and pp.profession_id=profession and policy.enabled and policy.approved_at<=at_time
      and policy.authority_id=c.authority_id and policy.route=c.route and c.status='verified' and c.checked_at<=at_time
      and c.review_due_at>at_time and (c.expires_at is null or c.expires_at>at_time)
      and exists(select 1 from public.practitioner_users u join auth.users account on account.id=u.user_id where u.practitioner_id=pp.practitioner_id and u.user_id=c.owner_user_id and u.active and u.revoked_at is null and account.email_confirmed_at is not null));
$$;
create function private.practitioner_is_eligible(practitioner uuid,profession text,at_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
  select private.practitioner_credential_current(practitioner,profession,at_time) and exists(select 1 from public.practitioners p where p.id=practitioner and p.accepting_new_referrals and nullif(trim(p.contact_email),'') is not null);
$$;
create or replace function private.owns_practitioner(practitioner uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.practitioner_has_access(practitioner) and exists(select 1 from public.practitioner_users u where u.user_id=auth.uid() and u.practitioner_id=practitioner and u.active and u.revoked_at is null);
$$;
create or replace function private.can_use_directory() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (exists(select 1 from public.organisation_memberships m where m.user_id=auth.uid() and m.active)
    or exists(select 1 from public.practitioner_users u where u.user_id=auth.uid() and u.active and u.revoked_at is null and private.practitioner_has_access(u.practitioner_id)));
$$;
create or replace function private.directory_visible(practitioner uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.can_use_directory() and exists(select 1 from public.practitioners p where p.id=practitioner and private.practitioner_is_eligible(p.id,p.profession,now()));
$$;
drop policy practitioners_select_approved on public.practitioners;
create policy practitioners_select_approved on public.practitioners for select to authenticated using(private.owns_practitioner(id) or private.directory_visible(id));
create function private.credential_summary(practitioner uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('professionId',pp.profession_id,'authorityId',c.authority_id,'route',c.route,'status',c.status,'checkedAt',c.checked_at,'expiresAt',c.expires_at,'reviewDueAt',c.review_due_at,'policyEnabled',policy.enabled)), '[]'::jsonb)
  from private.practitioner_professions pp join private.professional_credentials c on c.id=pp.credential_id join private.profession_policies policy on policy.profession_id=pp.profession_id
  where pp.practitioner_id=practitioner and (private.owns_practitioner(practitioner) or private.directory_visible(practitioner) or private.can_read_assigned_practitioner(practitioner));
$$;
create or replace view public.verified_practitioners with(security_invoker=true) as
  select id,display_name,profession,practice_name,telehealth,services,funding,languages,ahpra_verified_at,provider_confirmed_at,updated_at,private.credential_summary(id) as credentials
  from public.practitioners where private.directory_visible(id);

-- This trigger covers old REST clients as well as new draft finalisation.
create function private.guard_referral_credential() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' or new.selected_practitioner_id is distinct from old.selected_practitioner_id or (new.status='sent' and old.status<>'sent') then
    if new.selected_practitioner_id is not null then
      perform 1 from public.practitioners p where p.id=new.selected_practitioner_id for share;
      perform 1 from private.professional_credentials c where c.practitioner_id=new.selected_practitioner_id for share;
      perform 1 from private.profession_policies p where p.profession_id=new.profession for share;
      perform 1 from public.practitioner_users u where u.practitioner_id=new.selected_practitioner_id for share;
      if not private.practitioner_is_eligible(new.selected_practitioner_id,new.profession,now()) then raise exception 'recipient_ineligible' using errcode='23514'; end if;
    end if;
  elsif new.status='accepted' and old.status<>'accepted' then
    perform 1 from public.practitioners p where p.id=new.selected_practitioner_id for share;
    perform 1 from private.professional_credentials c where c.practitioner_id=new.selected_practitioner_id for share;
    perform 1 from private.profession_policies p where p.profession_id=new.profession for share;
    perform 1 from public.practitioner_users u where u.practitioner_id=new.selected_practitioner_id for share;
    if not private.practitioner_credential_current(new.selected_practitioner_id,new.profession,now()) then raise exception 'recipient_ineligible' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger referrals_guard_credential before insert or update on public.referrals for each row execute function private.guard_referral_credential();

alter function private.application_workflow(uuid,text,jsonb) rename to application_workflow_before_credentials;
create function private.application_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
    insert into private.professional_credentials(practitioner_id,owner_user_id,authority_id,identifier_normalized,route,status,checked_at,expires_at,review_due_at,reviewed_by,application_id,identity_evidence,registration_evidence)
    values((result->>'practitioner_id')::uuid,app.user_id,policy.authority_id,upper(regexp_replace(app.profile->>'registrationNumber','[[:space:]]','','g')),policy.route,'verified',checked,expiry,checked+make_interval(days=>policy.review_interval_days),actor,app.id,input->'identityEvidence',input->'registrationEvidence') returning id into credential;
    insert into private.practitioner_professions(practitioner_id,profession_id,credential_id) values((result->>'practitioner_id')::uuid,policy.profession_id,credential);
  end if;
  return result;
end $$;
revoke all on function private.practitioner_has_access(uuid),private.practitioner_credential_current(uuid,text,timestamptz),private.practitioner_is_eligible(uuid,text,timestamptz),private.credential_summary(uuid),private.guard_referral_credential(),private.application_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.practitioner_has_access(uuid),private.practitioner_credential_current(uuid,text,timestamptz),private.practitioner_is_eligible(uuid,text,timestamptz),private.application_workflow(uuid,text,jsonb) to service_role;
grant execute on function private.credential_summary(uuid) to authenticated,service_role;
-- No evidence is manufactured from legacy verified booleans. An explicit
-- reconciliation queue identifies records needing independent re-review.
insert into private.credential_migration_exceptions(practitioner_id,reason)
  select id,'independent_credential_review_required' from public.practitioners where lifecycle_status='active';

insert into private.profession_policies(profession_id,authority_id,route,catalogue_scope) values
('physiotherapist','ahpra_physiotherapy','ahpra','supported'),
('psychologist','ahpra_psychology','ahpra','supported'),
('occupational_therapist','ahpra_occupational_therapy','ahpra','review_required'),
('exercise_physiologist','protocol_pending','professional_body','review_required'),
('speech_pathologist','protocol_pending','professional_body','review_required'),
('dietitian','protocol_pending','professional_body','review_required'),
('nutritionist','protocol_pending','professional_body','out_of_scope'),
('podiatrist','ahpra_podiatry','ahpra','review_required'),
('audiologist','protocol_pending','professional_body','review_required'),
('social_worker','protocol_pending','professional_body','review_required'),
('genetic_counsellor','protocol_pending','professional_body','review_required'),
('rehabilitation_counsellor','protocol_pending','professional_body','review_required'),
('counsellor','protocol_pending','professional_body','review_required'),
('psychotherapist','protocol_pending','professional_body','review_required'),
('chiropractor','ahpra_chiropractic','ahpra','review_required'),
('osteopath','ahpra_osteopathy','ahpra','review_required'),
('optometrist','ahpra_optometry','ahpra','review_required'),
('pharmacist','ahpra_pharmacy','ahpra','review_required'),
('orthoptist','protocol_pending','professional_body','review_required'),
('orthotist','protocol_pending','professional_body','review_required'),
('prosthetist','protocol_pending','professional_body','review_required'),
('pedorthist','protocol_pending','professional_body','review_required'),
('art_therapist','protocol_pending','professional_body','review_required'),
('music_therapist','protocol_pending','professional_body','review_required'),
('child_life_therapist','protocol_pending','professional_body','review_required'),
('diversional_therapist','protocol_pending','professional_body','review_required'),
('radiographer','ahpra_medical_radiation','ahpra','review_required'),
('medical_radiation_practitioner','ahpra_medical_radiation','ahpra','review_required'),
('radiation_therapist','ahpra_medical_radiation','ahpra','review_required'),
('nuclear_medicine_technologist','ahpra_medical_radiation','ahpra','review_required'),
('sonographer','protocol_pending','professional_body','review_required'),
('cardiac_physiologist','protocol_pending','professional_body','review_required'),
('sexual_assault_worker','protocol_pending','professional_body','out_of_scope'),
('welfare_worker','protocol_pending','professional_body','out_of_scope');
alter table public.practitioners drop constraint practitioners_profession_check;
alter table public.practitioners add constraint practitioners_profession_policy foreign key(profession) references private.profession_policies(profession_id);
alter table public.practitioners drop constraint practitioners_active_trust_check;
alter table public.practitioners add constraint practitioners_active_confirmation_check check(lifecycle_status<>'active' or (provider_confirmation_status='confirmed' and accepting_new_referrals is not null));
alter table public.referrals drop constraint referrals_profession_check;
alter table public.referrals add constraint referrals_profession_policy foreign key(profession) references private.profession_policies(profession_id);
drop policy referrals_insert_organisation_member on public.referrals;
create policy referrals_insert_organisation_member on public.referrals for insert to authenticated with check(
 created_by=(select auth.uid()) and consent_confirmed_at<=now() and exists(select 1 from public.organisation_memberships m where m.user_id=(select auth.uid()) and m.organisation_id=referrals.organisation_id and m.active)
 and (selected_practitioner_id is null or private.directory_visible(selected_practitioner_id))
);
create or replace function private.validate_practitioner_profile(p jsonb,complete boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
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
  if (p ? 'profession' and (p->>'profession'<>'' and not exists(select 1 from private.profession_policies where profession_id=p->>'profession' and catalogue_scope='supported'))) or (complete and not exists(select 1 from private.profession_policies where profession_id=p->>'profession' and enabled)) then raise exception 'invalid_profile'; end if;
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
        or input#>>'{registrationEvidence,method}' is distinct from (select case route when 'ahpra' then 'manual_register' else 'professional_body_register' end from private.profession_policies where profession_id=p->>'profession') or input#>'{registrationEvidence,matched}' is distinct from 'true'::jsonb
        or upper(regexp_replace(input#>>'{registrationEvidence,registrationNumber}','[[:space:]]','','g')) is distinct from p->>'registrationNumber'
        or coalesce(length(trim(input#>>'{registrationEvidence,reference}')),0) not between 5 and 1000 then raise exception 'evidence_required'; end if;
      if (input#>>'{identityEvidence,checkedAt}')::timestamptz is null or (input#>>'{registrationEvidence,checkedAt}')::timestamptz is null
        or (input#>>'{identityEvidence,checkedAt}')::timestamptz not between now()-interval '30 days' and now()+interval '5 minutes'
        or (input#>>'{registrationEvidence,checkedAt}')::timestamptz not between now()-interval '7 days' and now()+interval '5 minutes' then raise exception 'evidence_required'; end if;
      select email into email_address from auth.users where id=app.user_id and email_confirmed_at is not null;
      if email_address is null then raise exception 'verified_email_required'; end if;
      insert into public.practitioners(display_name,profession,practice_name,contact_email,lifecycle_status,ahpra_registration_number,ahpra_verification_status,ahpra_verified_at,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages)
        values(p->>'displayName',p->>'profession',p->>'practiceName',email_address,'active',case when (select route from private.profession_policies where profession_id=p->>'profession')='ahpra' then p->>'registrationNumber' end,case when (select route from private.profession_policies where profession_id=p->>'profession')='ahpra' then 'verified' else 'not_checked' end,(input#>>'{registrationEvidence,checkedAt}')::timestamptz,'confirmed',app.profile_confirmed_at,(p->>'acceptingNewReferrals')::boolean,(p->>'telehealth')::boolean,array(select jsonb_array_elements_text(p->'services')),array(select jsonb_array_elements_text(p->'funding')),array(select jsonb_array_elements_text(p->'languages'))) returning id into practitioner;
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
create or replace function private.referral_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ref public.referrals; req private.workflow_requests; result jsonb; notification_address text; notification_state text; outbox_id uuid;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  select * into ref from public.referrals where id=(input->>'referralId')::uuid for update;
  if ref.id is null then raise exception 'denied' using errcode='42501'; end if;
  if action='referral.notifications' then
    if not (exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active) or exists(select 1 from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id where u.user_id=actor and u.practitioner_id=ref.selected_practitioner_id and u.active and u.revoked_at is null and private.practitioner_has_access(p.id))) then raise exception 'denied' using errcode='42501'; end if;
    return jsonb_build_object('ok',true,'status',case when ref.response_notification_state='configuration_needed' then 'configuration_needed' else coalesce((select coalesce(j.state,o.status) from public.notification_outbox o left join private.email_jobs j on j.source_outbox_id=o.id where o.referral_id=ref.id order by o.created_at desc limit 1),'configuration_needed') end,'notifications',coalesce((select jsonb_agg(jsonb_build_object('kind',o.kind,'status',coalesce(j.state,o.status),'createdAt',o.created_at,'errorCode',j.error_code,'delivered',exists(select 1 from private.email_events e where e.matched_job_id=j.id and e.event_type='delivered'))) from public.notification_outbox o left join private.email_jobs j on j.source_outbox_id=o.id where o.referral_id=ref.id),'[]'::jsonb));
  end if;
  if not exists(select 1 from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id where u.user_id=actor and u.practitioner_id=ref.selected_practitioner_id and u.active and u.revoked_at is null and private.practitioner_has_access(p.id)) then raise exception 'denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
  if found then
    if req.operation<>action or req.request_payload<>input then raise exception 'conflict' using errcode='40001'; end if;
    return req.response;
  end if;
  if ref.status<>'sent' or ref.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001'; end if;
  if coalesce(input->>'decision','') not in ('accepted','declined') or length(input->>'note')>500 or (input->>'decision'='declined' and coalesce(input->>'reasonCode','') not in ('capacity','service_not_offered','funding_not_supported','other')) then raise exception 'invalid_response'; end if;
  update public.referrals set status=input->>'decision',version=version+1 where id=ref.id returning * into ref;
  insert into public.referral_events(referral_id,actor_user_id,event_type,details) values(ref.id,actor,ref.status,
    case when ref.status='declined' then jsonb_strip_nulls(jsonb_build_object('reasonCode',input->>'reasonCode','note',nullif(trim(input->>'note'),''))) else '{}'::jsonb end);
  select trim(notification_email) into notification_address from public.organisations where id=ref.organisation_id;
  notification_state:='configuration_needed';
  if length(notification_address)<=254 and notification_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    notification_state:=case when exists(select 1 from private.email_suppressions where email=lower(trim(notification_address)) and reason<>'declined_invitation') then 'suppressed' else 'pending' end;
    insert into public.notification_outbox(referral_id,kind,recipient_email,idempotency_key) values(ref.id,'referral_'||ref.status,notification_address,'referral_'||ref.status||'/'||ref.id) returning id into outbox_id;
    insert into private.email_jobs(family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,state,payload)
      values('referral',ref.id,ref.version,outbox_id,'referral_'||ref.status||'/'||ref.id,notification_address,notification_state,jsonb_build_object('kind','referral_'||ref.status,'referralId',ref.id));
  end if;
  update public.referrals set response_notification_state=notification_state where id=ref.id returning * into ref;
  result:=jsonb_build_object('referralId',ref.id,'status',ref.status,'version',ref.version,'updatedAt',ref.updated_at,'notification',notification_state);
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,action,input,result);
  return result;
end $$;
create or replace function private.validate_referral_draft(p jsonb,complete boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare k text; max_len integer;
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>12000 then raise exception 'invalid_draft'; end if;
  for k in select jsonb_object_keys(p) loop
    if not k=any(array['patientReference','patientPostcode','profession','clinicalSummary','fundingPath',
      'appointmentFormat','languageOrAccess','preferredLanguage','accessNotes','selectedPractitionerId'])
      then raise exception 'invalid_draft'; end if;
    if k='selectedPractitionerId' and p->k='null'::jsonb then continue; end if;
    if jsonb_typeof(p->k)<>'string' then raise exception 'invalid_draft'; end if;
    max_len:=case k when 'clinicalSummary' then 4000 when 'accessNotes' then 500 when 'languageOrAccess' then 240 when 'patientPostcode' then 4 when 'selectedPractitionerId' then 36 else 120 end;
    if length(p->>k)>max_len then raise exception 'invalid_draft'; end if;
  end loop;
  if coalesce(p->>'patientPostcode','')<>'' and p->>'patientPostcode' !~ '^[0-9]{4}$' then raise exception 'invalid_draft'; end if;
  if coalesce(p->>'profession','')<>'' and not exists(select 1 from private.profession_policies where profession_id=p->>'profession' and catalogue_scope='supported') then raise exception 'invalid_draft'; end if;
  if coalesce(p->>'appointmentFormat','')<>'' and p->>'appointmentFormat' not in ('either','in_person','telehealth') then raise exception 'invalid_draft'; end if;
  if coalesce(p->>'selectedPractitionerId','')<>'' and p->>'selectedPractitionerId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'invalid_draft'; end if;
  if complete then
    foreach k in array array['patientReference','patientPostcode','profession','clinicalSummary','fundingPath','appointmentFormat','selectedPractitionerId'] loop
      if coalesce(length(trim(p->>k)),0)=0 then raise exception 'invalid_draft'; end if;
    end loop;
  end if;
  return p;
end $$;
create or replace function private.referral_draft_workflow(actor uuid,action text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.referral_drafts; req private.workflow_requests; result jsonb; p jsonb;
  ref public.referrals; recipient public.practitioners; previous_actor text;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  if action='draft.list' then
    if not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=(p_input->>'organisationId')::uuid and active)
      then raise exception 'denied' using errcode='42501'; end if;
    return jsonb_build_object('drafts',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'patientReference',q.input->>'patientReference','version',q.version,'updatedAt',q.updated_at) order by q.updated_at desc,q.id)
      from (select * from public.referral_drafts where created_by=actor and organisation_id=(p_input->>'organisationId')::uuid and finalized_referral_id is null order by updated_at desc,id limit 50) q),'[]'::jsonb));
  end if;
  -- Actor lock gives replay checks and concurrent creation one consistent order.
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into d from public.referral_drafts where id=(p_input->>'id')::uuid for update;
  if d.id is not null then
    if d.created_by<>actor or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=d.organisation_id and active)
      then raise exception 'denied' using errcode='42501'; end if;
  elsif action<>'draft.save' or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=(p_input->>'organisationId')::uuid and active) then
    raise exception 'denied' using errcode='42501';
  end if;
  if action='draft.load' then return private.draft_json(d); end if;
  if nullif(p_input->>'requestId','') is null then raise exception 'invalid_draft'; end if;
  select * into req from private.workflow_requests where actor_id=actor and request_id=(p_input->>'requestId')::uuid;
  if found then
    if req.operation<>action or req.request_payload<>p_input then raise exception 'conflict' using errcode='40001'; end if;
    return req.response;
  end if;
  if d.finalized_referral_id is not null then raise exception 'conflict' using errcode='40001'; end if;
  if coalesce(d.version,-1) is distinct from (p_input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001'; end if;
  if action='draft.save' then
    p:=private.validate_referral_draft(p_input->'input',false);
    if d.id is null then
      insert into public.referral_drafts(id,organisation_id,created_by,input) values((p_input->>'id')::uuid,(p_input->>'organisationId')::uuid,actor,p) returning * into d;
    else
      if d.organisation_id is distinct from (p_input->>'organisationId')::uuid then raise exception 'denied' using errcode='42501'; end if;
      update public.referral_drafts set input=p,version=version+1,updated_at=now() where id=d.id returning * into d;
    end if;
    result:=private.draft_json(d);
  elsif action='draft.finalize' then
    if p_input->'consentConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required'; end if;
    p:=private.validate_referral_draft(d.input,true);
    select * into recipient from public.practitioners where id=(p->>'selectedPractitionerId')::uuid for share;
    if recipient.id is null or not private.practitioner_is_eligible(recipient.id,p->>'profession',now())
      or recipient.provider_confirmation_status<>'confirmed' or recipient.accepting_new_referrals is distinct from true or recipient.contact_email is null
      or recipient.profession<>p->>'profession'
      or not exists(select 1 from unnest(recipient.funding) f where lower(trim(f))=lower(trim(p->>'fundingPath')))
      or (p->>'appointmentFormat'='telehealth' and recipient.telehealth is distinct from true)
      or (p->>'appointmentFormat'='in_person' and not exists(select 1 from public.practitioner_locations where practitioner_id=recipient.id))
      or (coalesce(p->>'preferredLanguage','')<>'' and not exists(select 1 from unnest(recipient.languages) l where lower(trim(l))=lower(trim(p->>'preferredLanguage'))))
      then raise exception 'recipient_ineligible'; end if;
    previous_actor:=current_setting('request.jwt.claim.sub',true);
    perform set_config('request.jwt.claim.sub',actor::text,true);
    insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,
      funding_path,appointment_format,language_or_access,preferred_language,access_notes,selection_mode,selected_practitioner_id,consent_confirmed_at)
    values(d.id,'RW-'||d.id::text,d.organisation_id,actor,trim(p->>'patientReference'),p->>'patientPostcode',p->>'profession',trim(p->>'clinicalSummary'),
      p->>'fundingPath',p->>'appointmentFormat',coalesce(p->>'languageOrAccess',''),coalesce(p->>'preferredLanguage',''),coalesce(p->>'accessNotes',''),'doctor',recipient.id,now()) returning * into ref;
    perform set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true);
    update public.referral_drafts set finalized_referral_id=ref.id,version=version+1,updated_at=now() where id=d.id;
    result:=to_jsonb(ref);
  else raise exception 'unsupported_operation'; end if;
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response)
    values(actor,(p_input->>'requestId')::uuid,action,p_input,result);
  return result;
end $$;
create or replace function private.record_new_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
begin
  if (select auth.uid()) is null or new.created_by <> (select auth.uid()) then
    raise exception 'Referral creator must match the signed-in user';
  end if;

  insert into public.referral_events (referral_id, actor_user_id, event_type)
  values (new.id, new.created_by, 'created');

  if new.selected_practitioner_id is not null then
    select p.contact_email, p.display_name, p.practice_name
      into recipient
    from public.practitioners p
    where p.id = new.selected_practitioner_id
      and private.practitioner_is_eligible(p.id,new.profession,now());

    if recipient.contact_email is not null then
      insert into public.notification_outbox (
        referral_id,
        kind,
        recipient_email,
        template_data,
        idempotency_key
      ) values (
        new.id,
        'referral_created',
        recipient.contact_email,
        jsonb_build_object(
          'recipient_name', recipient.display_name,
          'practice_name', recipient.practice_name
        ),
        'referral_created/' || new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

-- Migrate independently evidenced legacy approvals for historical access only.
-- No fabricated expiry/review deadline: policies are disabled until reviewed.
create function private.reconcile_legacy_credentials() returns void language plpgsql security invoker set search_path='' as $$
declare r record; credential uuid; checked timestamptz; expiry timestamptz; normalized text;
begin
  for r in select a.id as application_id,a.user_id,a.practitioner_id,a.profile,review.reviewer_id,review.identity_evidence,review.registration_evidence,review.created_at as reviewed_at,policy.*
    from public.practitioner_applications a join private.practitioner_reviews review on review.application_id=a.id and review.application_version=a.version-1 and review.decision='approved'
    join private.profession_policies policy on policy.profession_id=a.profile->>'profession'
    where a.status='approved' and policy.catalogue_scope='supported' and a.user_id<>review.reviewer_id
      and not exists(select 1 from private.professional_credentials c where c.practitioner_id=a.practitioner_id)
  loop
    begin
      normalized:=upper(regexp_replace(r.profile->>'registrationNumber','[[:space:]]','','g'));
      checked:=(r.registration_evidence->>'checkedAt')::timestamptz;
      expiry:=nullif(r.registration_evidence->>'expiresAt','')::timestamptz;
      if r.identity_evidence->>'method' is distinct from 'independent_practice_contact' or r.identity_evidence->'matched' is distinct from 'true'::jsonb
        or r.registration_evidence->>'method' is distinct from 'manual_register' or r.registration_evidence->'matched' is distinct from 'true'::jsonb
        or coalesce(length(trim(r.identity_evidence->>'reference')),0)<5 or coalesce(length(trim(r.registration_evidence->>'reference')),0)<5
        or checked is null or checked not between r.reviewed_at-interval '7 days' and r.reviewed_at+interval '5 minutes'
        or (r.identity_evidence->>'checkedAt')::timestamptz is null
        or (r.identity_evidence->>'checkedAt')::timestamptz not between r.reviewed_at-interval '30 days' and r.reviewed_at+interval '5 minutes'
        or upper(regexp_replace(r.registration_evidence->>'registrationNumber','[[:space:]]','','g')) is distinct from normalized
        or not exists(select 1 from public.practitioners p join public.practitioner_users u on u.practitioner_id=p.id where p.id=r.practitioner_id and u.user_id=r.user_id and p.profession=r.profession_id and p.ahpra_verification_status='verified' and upper(regexp_replace(p.ahpra_registration_number,'[[:space:]]','','g'))=normalized)
        then continue; end if;
      insert into private.professional_credentials(practitioner_id,owner_user_id,authority_id,identifier_normalized,route,status,checked_at,expires_at,review_due_at,reviewed_by,application_id,identity_evidence,registration_evidence)
        values(r.practitioner_id,r.user_id,r.authority_id,normalized,r.route,'verified',checked,expiry,null,r.reviewer_id,r.application_id,r.identity_evidence,r.registration_evidence) returning id into credential;
      insert into private.practitioner_professions(practitioner_id,profession_id,credential_id) values(r.practitioner_id,r.profession_id,credential);
      insert into private.credential_migration_exceptions(practitioner_id,reason) values(r.practitioner_id,'review_deadline_requires_reconfirmation') on conflict(practitioner_id) do update set reason=excluded.reason;
    exception when invalid_datetime_format or datetime_field_overflow or unique_violation or check_violation or not_null_violation then
      -- One malformed/duplicate historical row never promotes another record.
      insert into private.credential_migration_exceptions(practitioner_id,reason) values(r.practitioner_id,'legacy_evidence_invalid_or_duplicate') on conflict(practitioner_id) do update set reason=excluded.reason;
    end;
  end loop;
end $$;
revoke all on function private.reconcile_legacy_credentials() from public,anon,authenticated;
grant execute on function private.reconcile_legacy_credentials() to service_role;
select private.reconcile_legacy_credentials();
