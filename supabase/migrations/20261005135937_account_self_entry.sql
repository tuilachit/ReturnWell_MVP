-- Public account choices are doctor/referring practice and receiving practitioner.
-- Self entry creates a NEW isolated practice or a private application, never
-- joins an existing practice, claims credential verification, or grants operator.
create table private.account_registrations (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  role text not null check(role in ('doctor','practitioner')),display_name text not null,
  declared_registration_number text,organisation_id uuid references public.organisations(id),application_id uuid references public.practitioner_applications(id),
  terms_version text not null,privacy_version text not null,consented_at timestamptz not null default now(),
  unique(user_id,role),check(length(display_name) between 1 and 120),check(coalesce(length(declared_registration_number),0)<=40)
);
alter table private.account_registrations enable row level security;
revoke all on private.account_registrations from public,anon,authenticated;
grant select,insert,update on private.account_registrations to service_role;
alter table public.practitioner_applications add column self_registration_id uuid unique references private.account_registrations(id);
alter table public.practitioner_applications drop constraint application_origin_required;
alter table public.practitioner_applications add constraint application_origin_required check(invitation_id is not null or revision_practitioner_id is not null or self_registration_id is not null);

create function private.account_workflow(actor uuid,action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare registration private.account_registrations;prior private.workflow_requests;result jsonb;account_role text;
  name text;practice text;number text;request uuid;org uuid;application uuid;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'denied' using errcode='42501';end if;
  if action='account.status' then
    return jsonb_build_object('registrations',coalesce((select jsonb_agg(jsonb_build_object('role',r.role,'organisationId',r.organisation_id,'applicationId',r.application_id)) from private.account_registrations r where r.user_id=actor),'[]'::jsonb));
  end if;
  if action<>'account.register' or jsonb_typeof(input)<>'object' then raise exception 'invalid_request';end if;
  account_role:=input->>'role';name:=btrim(input->>'displayName');practice:=btrim(input->>'practiceName');number:=btrim(input->>'registrationNumber');
  if account_role is null or account_role not in ('doctor','practitioner') or jsonb_typeof(input->'displayName') is distinct from 'string' or length(name) not between 1 and 120
    or jsonb_typeof(input->'requestId') is distinct from 'string' then raise exception 'invalid_request';end if;
  request:=(input->>'requestId')::uuid;
  if input->'consentConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required';end if;
  if coalesce(length(input->>'currentTermsVersion'),0) not between 1 and 160 or coalesce(length(input->>'currentPrivacyVersion'),0) not between 1 and 160
    or input->>'termsVersion' is distinct from input->>'currentTermsVersion' or input->>'privacyVersion' is distinct from input->>'currentPrivacyVersion' then raise exception 'terms_changed';end if;
  if account_role='doctor' and (jsonb_typeof(input->'practiceName') is distinct from 'string' or length(practice) not between 1 and 160 or jsonb_typeof(input->'registrationNumber') is distinct from 'string' or length(number) not between 1 and 40) then raise exception 'invalid_request';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into prior from private.workflow_requests where actor_id=actor and request_id=request;
  if found then
    if prior.operation<>action or prior.request_payload<>input then raise exception 'conflict';end if;
    return prior.response;
  end if;
  if exists(select 1 from private.account_registrations where user_id=actor and role=account_role) then raise exception 'conflict';end if;
  if account_role='doctor' and exists(select 1 from public.organisation_memberships where user_id=actor) then raise exception 'conflict';end if;
  if account_role='practitioner' and exists(select 1 from public.practitioner_users where user_id=actor) then raise exception 'conflict';end if;
  insert into public.profiles(id,display_name) values(actor,name) on conflict(id) do nothing;
  insert into private.account_registrations(user_id,role,display_name,declared_registration_number,terms_version,privacy_version)
    values(actor,account_role,name,case when account_role='doctor' then number end,input->>'termsVersion',input->>'privacyVersion') returning * into registration;
  if account_role='doctor' then
    insert into public.organisations(name,created_by) values(practice,actor) returning id into org;
    insert into public.organisation_memberships(organisation_id,user_id,role) values(org,actor,'owner');
    update private.account_registrations set organisation_id=org where id=registration.id;
  else
    select id into application from public.practitioner_applications where user_id=actor and status in ('draft','submitted','changes_requested') for update;
    if application is null then
      insert into public.practitioner_applications(user_id,self_registration_id,profile,terms_version,privacy_version)
        values(actor,registration.id,jsonb_build_object('displayName',name),input->>'termsVersion',input->>'privacyVersion') returning id into application;
    end if;
    update private.account_registrations set application_id=application where id=registration.id;
  end if;
  result:=jsonb_build_object('ok',true,'role',account_role,'organisationId',org,'applicationId',application);
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,request,action,input,result);
  return result;
exception when invalid_text_representation then raise exception 'invalid_request';
end $$;
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_self_entry;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_action like 'account.%' then return private.account_workflow(p_actor,p_action,p_input);end if;
  return public.rw_workflow_before_self_entry(p_actor,p_action,p_input);
end $$;
revoke all on function private.account_workflow(uuid,text,jsonb),public.rw_workflow(uuid,text,jsonb),public.rw_workflow_before_self_entry(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.account_workflow(uuid,text,jsonb),public.rw_workflow(uuid,text,jsonb),public.rw_workflow_before_self_entry(uuid,text,jsonb) to service_role;
