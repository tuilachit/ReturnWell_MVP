-- A referral is never assigned merely because its invitation link was opened.
create table private.referral_invitations (
  referral_id uuid primary key references public.referrals(id),
  invitation_id uuid not null references public.workspace_invitations(id),
  confirmed_by uuid not null references auth.users(id),
  consent_confirmed_at timestamptz not null,
  consent_valid_until timestamptz not null,
  contact_basis text not null check(contact_basis in ('recipient_requested','documented_permission')),
  contact_consented_at timestamptz not null,
  state text not null default 'awaiting_signup' check(state in ('awaiting_signup','awaiting_review','needs_reconfirmation','released')),
  reason text, generation integer not null default 1,
  released_at timestamptz, last_checked_at timestamptz,
  check(consent_valid_until=consent_confirmed_at+interval '7 days')
);
create index referral_invitations_invitation on private.referral_invitations(invitation_id);
create index referral_invitations_pending on private.referral_invitations(last_checked_at nulls first,referral_id) where state in ('awaiting_signup','awaiting_review');
alter table private.referral_invitations enable row level security;
revoke all on private.referral_invitations from public,anon,authenticated;
grant all on private.referral_invitations to service_role;
alter table public.referrals drop constraint referrals_status_check;
alter table public.referrals add constraint referrals_status_check check(status in ('awaiting_onboarding','sent','accepted','declined','booked','cancelled','closed'));
alter table public.referrals drop constraint referrals_selection_check;
alter table public.referrals add constraint referrals_selection_check check(selection_mode='patient' or selected_practitioner_id is not null or status in ('awaiting_onboarding','cancelled'));
alter table private.email_jobs drop constraint email_jobs_family_check;
alter table private.email_jobs add constraint email_jobs_family_check check(family in ('invitation','auth_verification','referral','coordination'));

create function private.growth_projection(ref public.referrals) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('referralId',ref.id,'invitationId',g.invitation_id,'version',ref.version,
    'status',case when ref.status='cancelled' then 'cancelled' when g.state='released' then 'released'
      when g.consent_valid_until<=now() then 'needs_reconfirmation' else g.state end,
    'reason',case when g.state<>'released' and ref.status<>'cancelled' and g.consent_valid_until<=now() then 'consent_expired' else g.reason end,
    'consentValidUntil',g.consent_valid_until,'releasedAt',g.released_at,
    'invitationStatus',i.status,'signupCompletedAt',i.signup_completed_at,'accountWasNew',i.account_was_new,
    'recipientName',i.recipient_name,'recipientEmail',i.recipient_email,
    'notification',coalesce((select j.state from private.email_jobs j where j.related_id=ref.id and j.family='coordination' order by j.created_at desc limit 1),'not_queued'))
  from private.referral_invitations g join public.workspace_invitations i on i.id=g.invitation_id where g.referral_id=ref.id;
$$;

create function private.growth_block(referral uuid,why text) returns void language plpgsql security invoker set search_path='' as $$
declare g private.referral_invitations; address text;
begin
  update private.referral_invitations set state='needs_reconfirmation',reason=why,last_checked_at=now()
    where referral_id=referral and state in ('awaiting_signup','awaiting_review') returning * into g;
  if g.referral_id is null then return; end if;
  update public.referrals set version=version+1 where id=referral;
  select trim(o.notification_email) into address from public.organisations o join public.referrals r on r.organisation_id=o.id where r.id=referral;
  if length(address)<=254 and address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    insert into private.email_jobs(family,related_id,related_version,idempotency_key,recipient_email,state,payload)
      values('coordination',referral,g.generation,'coordination:'||referral||':'||g.generation,address,
        case when exists(select 1 from private.email_suppressions where email=lower(address) and reason<>'declined_invitation') then 'suppressed' else 'pending' end,
        jsonb_build_object('kind','referral_action_required','referralId',referral)) on conflict(idempotency_key) do nothing;
  end if;
end $$;

create function private.growth_sweep() returns jsonb language plpgsql security invoker set search_path='' as $$
declare ref public.referrals; g private.referral_invitations; inv public.workspace_invitations;
  recipient uuid; candidates integer; released integer:=0; checked integer:=0; outbox uuid; delivery text;
begin
  -- Lock order: referral -> association -> identity/credential. Approval runs in
  -- a separate transaction and never waits on one of these referral locks.
  for ref in select r.* from public.referrals r join private.referral_invitations pending on pending.referral_id=r.id
    where r.status='awaiting_onboarding' and pending.state in ('awaiting_signup','awaiting_review')
    order by pending.last_checked_at nulls first,r.id limit 50 for update of r skip locked loop
    checked:=checked+1;
    select * into g from private.referral_invitations where referral_id=ref.id for update;
    select * into inv from public.workspace_invitations where id=g.invitation_id for share;
    update private.referral_invitations set last_checked_at=now() where referral_id=ref.id;
    if g.consent_valid_until<=now() then perform private.growth_block(ref.id,'consent_expired');continue;end if;
    perform 1 from public.organisation_memberships where organisation_id=ref.organisation_id and user_id=g.confirmed_by and active for share;
    if not found then perform private.growth_block(ref.id,'referrer_inactive');continue;end if;
    if inv.status in ('declined','revoked') or (inv.status='pending' and inv.expires_at<=now()) then
      perform private.growth_block(ref.id,'invitation_unavailable');continue;
    end if;
    if inv.status<>'claimed' then continue;end if;
    -- Read-only Auth access. The immutable claimed user is already bound by the
    -- mailbox proof; do not grant service-role UPDATE on Auth for a row lock.
    perform 1 from auth.users where id=inv.claimed_by and email_confirmed_at is not null and lower(trim(email))=inv.recipient_email_normalized;
    if not found then perform private.growth_block(ref.id,'recipient_unavailable');continue;end if;
    select count(*),(array_agg(p.id order by p.id))[1] into candidates,recipient
      from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id
      where u.user_id=inv.claimed_by and u.active and u.revoked_at is null and p.profession=ref.profession;
    if candidates=0 and exists(select 1 from public.practitioner_applications where user_id=inv.claimed_by and status in ('draft','submitted','changes_requested')) then
      update private.referral_invitations set state='awaiting_review' where referral_id=ref.id;continue;
    end if;
    if candidates<>1 then perform private.growth_block(ref.id,'recipient_unavailable');continue;end if;
    perform 1 from public.practitioners where id=recipient for share;
    -- Credential snapshots are immutable; the practitioner lock serialises the
    -- reviewed-profile/pointer update. Do not restore revoked UPDATE grants.
    perform 1 from private.profession_policies where profession_id=ref.profession for share;
    perform 1 from public.practitioner_users where practitioner_id=recipient for share;
    if not exists(select 1 from public.practitioner_users where user_id=inv.claimed_by and practitioner_id=recipient and active and revoked_at is null)
      or not exists(select 1 from private.professional_credentials c join private.practitioner_professions pp on pp.credential_id=c.id where pp.practitioner_id=recipient and pp.profession_id=ref.profession and c.owner_user_id=inv.claimed_by)
      or not private.practitioner_is_eligible(recipient,ref.profession,now()) then
      perform private.growth_block(ref.id,'recipient_ineligible');continue;
    end if;
    if not private.practitioner_meets_requirements(recipient,ref.profession,ref.funding_path,ref.appointment_format,ref.preferred_language,ref.required_service_ids,ref.patient_age_group_id) then
      perform private.growth_block(ref.id,'requirements_changed');continue;
    end if;
    update public.referrals set selected_practitioner_id=recipient,status='sent',version=version+1 where id=ref.id returning * into ref;
    update private.referral_invitations set state='released',reason=null,released_at=now() where referral_id=ref.id;
    insert into public.referral_events(referral_id,actor_user_id,event_type,details) values(ref.id,g.confirmed_by,'sent','{"source":"verified_invitation_release"}');
    insert into public.notification_outbox(referral_id,kind,recipient_email,idempotency_key)
      values(ref.id,'referral_created',inv.recipient_email_normalized,'referral_created/'||ref.id) returning id into outbox;
    delivery:=case when exists(select 1 from private.email_suppressions where email=inv.recipient_email_normalized and reason<>'declined_invitation') then 'suppressed' else 'pending' end;
    insert into private.email_jobs(family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,state,payload)
      values('referral',ref.id,ref.version,outbox,'referral_created/'||ref.id,inv.recipient_email_normalized,delivery,jsonb_build_object('kind','referral_created','referralId',ref.id));
    released:=released+1;
  end loop;
  return jsonb_build_object('checked',checked,'released',released);
end $$;

create function private.growth_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.referral_drafts; ref public.referrals; inv public.workspace_invitations; req private.workflow_requests;
  p jsonb; result jsonb; clean jsonb:=input-array['tokenHash','envelope','keyId']; previous_actor text; mailbox text;
begin
  -- Service maintenance has no browser mapping. All user actions require an actor.
  if action='growth.sweep' and actor is null then return private.growth_sweep();end if;
  if actor is null then raise exception 'denied' using errcode='42501';end if;
  if action in ('growth.status','growth.reconfirm') then
    select * into ref from public.referrals where id=(input->>'referralId')::uuid for update;
    if ref.id is null or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active)
      then raise exception 'denied' using errcode='42501';end if;
    if action='growth.status' then return coalesce(private.growth_projection(ref),'null'::jsonb);end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
    select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
    if found then
      if req.operation<>action or req.request_payload<>clean then raise exception 'conflict' using errcode='40001';end if;
      return req.response;
    end if;
    if input->'consentConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required';end if;
    if ref.status<>'awaiting_onboarding' or ref.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001';end if;
    select i.* into inv from public.workspace_invitations i join private.referral_invitations g on g.invitation_id=i.id where g.referral_id=ref.id for share of i;
    if inv.id is null or inv.status<>'claimed' then raise exception 'invitation_unavailable';end if;
    update private.referral_invitations set consent_confirmed_at=now(),consent_valid_until=now()+interval '7 days',confirmed_by=actor,state='awaiting_review',reason=null,generation=generation+1,last_checked_at=null where referral_id=ref.id;
    update private.email_jobs set state='cancelled',payload=null,prepared_payload=null,lease_id=null,lease_expires_at=null where family='coordination' and related_id=ref.id and state<>'sent';
    update public.referrals set version=version+1,consent_confirmed_at=now() where id=ref.id returning * into ref;
    result:=private.growth_projection(ref);
  elsif action='growth.invite' then
    perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
    select * into d from public.referral_drafts where id=(growth_workflow.input->>'id')::uuid for update;
    if d.id is null or d.created_by<>actor or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=d.organisation_id and active)
      then raise exception 'denied' using errcode='42501';end if;
    perform private.inviter(actor,d.organisation_id,'practitioner');
    select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
    if found then
      if req.operation<>action or req.request_payload<>clean then raise exception 'conflict' using errcode='40001';end if;
      return req.response;
    end if;
    if d.finalized_referral_id is not null or d.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001';end if;
    if input->'consentConfirmed' is distinct from 'true'::jsonb or input->'contactConsentConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required';end if;
    if coalesce(input->>'contactBasis','') not in ('recipient_requested','documented_permission') then raise exception 'invalid_request';end if;
    if nullif(d.input->>'selectedPractitionerId','') is not null then raise exception 'invalid_draft';end if;
    -- Reuse complete requirements validation, but this internal placeholder is
    -- never stored, queried or assigned as a recipient.
    p:=private.validate_referral_draft(d.input||'{"selectedPractitionerId":"00000000-0000-4000-8000-000000000000"}',true)-'selectedPractitionerId';
    mailbox:=lower(trim(input->>'recipientEmail'));
    if mailbox is null or length(mailbox)>254 or mailbox !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(length(trim(input->>'recipientName')),0) not between 1 and 160 then raise exception 'invalid_request';end if;
    if exists(select 1 from private.email_suppressions where email=mailbox) then raise exception 'recipient_suppressed';end if;
    perform pg_advisory_xact_lock(hashtextextended('mailbox:'||mailbox,0));
    select * into inv from public.workspace_invitations where kind='practitioner' and organisation_id=d.organisation_id and recipient_email_normalized=mailbox and status='pending' and expires_at>now() for update;
    if inv.id is null then
      result:=private.invitation_workflow(actor,'invitations.create',jsonb_build_object('kind','practitioner','organisationId',d.organisation_id,'recipientName',trim(input->>'recipientName'),'recipientEmail',mailbox,'consentConfirmed',true,'requestId',gen_random_uuid(),'tokenHash',input->'tokenHash','envelope',input->'envelope','keyId',input->'keyId'));
      select * into inv from public.workspace_invitations where id=(result->>'id')::uuid;
    end if;
    previous_actor:=current_setting('request.jwt.claim.sub',true);perform set_config('request.jwt.claim.sub',actor::text,true);
    insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,language_or_access,preferred_language,access_notes,selection_mode,selected_practitioner_id,consent_confirmed_at,status,required_service_ids,patient_age_group_id)
      values(d.id,'RW-'||d.id,d.organisation_id,actor,trim(p->>'patientReference'),p->>'patientPostcode',p->>'profession',trim(p->>'clinicalSummary'),p->>'fundingPath',p->>'appointmentFormat',coalesce(p->>'languageOrAccess',''),coalesce(p->>'preferredLanguage',''),coalesce(p->>'accessNotes',''),'doctor',null,now(),'awaiting_onboarding',array(select jsonb_array_elements_text(coalesce(p->'requiredServiceIds','[]'))),nullif(p->>'patientAgeGroupId','')) returning * into ref;
    perform set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true);
    insert into private.referral_invitations(referral_id,invitation_id,confirmed_by,consent_confirmed_at,consent_valid_until,contact_basis,contact_consented_at)
      values(ref.id,inv.id,actor,now(),now()+interval '7 days',input->>'contactBasis',now());
    update public.referral_drafts set finalized_referral_id=ref.id,version=version+1,updated_at=now() where id=d.id;
    result:=private.growth_projection(ref);
  else raise exception 'invalid_request';end if;
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,action,clean,result);
  return result;
end $$;

-- Wrap, rather than replace, previously deployed routing and authorisation.
alter function public.rw_workflow(uuid,text,jsonb) set schema private;
alter function private.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_growth;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_action like 'growth.%' then return private.growth_workflow(p_actor,p_action,p_input);end if;
 return private.rw_workflow_before_growth(p_actor,p_action,p_input);
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb),private.rw_workflow_before_growth(uuid,text,jsonb),private.growth_workflow(uuid,text,jsonb),private.growth_sweep(),private.growth_block(uuid,text),private.growth_projection(public.referrals) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb),private.rw_workflow_before_growth(uuid,text,jsonb),private.growth_workflow(uuid,text,jsonb),private.growth_sweep(),private.growth_block(uuid,text),private.growth_projection(public.referrals) to service_role;

alter function private.email_workflow(text,jsonb) rename to email_workflow_before_growth;
create function private.email_workflow(action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare job private.email_jobs; ref public.referrals;
begin
  if action='email.claim' then perform private.growth_sweep();end if;
  if action='email.start' then
    select * into job from private.email_jobs where id=(input->>'jobId')::uuid;
    if job.family='coordination' then
      select * into ref from public.referrals where id=job.related_id for share;
      if ref.status is distinct from 'awaiting_onboarding' or not exists(select 1 from private.referral_invitations where referral_id=ref.id and state='needs_reconfirmation' and generation=job.related_version) then
        update private.email_jobs set state='cancelled',payload=null,prepared_payload=null,lease_id=null,lease_expires_at=null where id=job.id and state<>'sent';
        return jsonb_build_object('sendAllowed',false);
      end if;
      -- Coordination notices belong to the referring practice, not to a
      -- pending invitation. Preserve the same lease/retry/suppression guards.
      select * into job from private.email_jobs where id=job.id for update;
      if job.lease_id is distinct from (input->>'leaseId')::uuid or job.state<>'processing' or job.lease_expires_at<=now()
        or job.attempts>=5 or job.first_attempt_at<=now()-interval '24 hours' then raise exception 'lease_unavailable';end if;
      if exists(select 1 from private.email_suppressions where email=lower(trim(job.recipient_email)) and reason<>'declined_invitation') then raise exception 'recipient_suppressed';end if;
      update private.email_jobs set attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now() where id=job.id returning * into job;
      return to_jsonb(job);
    end if;
  end if;
  return private.email_workflow_before_growth(action,input);
end $$;
revoke all on function private.email_workflow(text,jsonb),private.email_workflow_before_growth(text,jsonb) from public,anon,authenticated;
grant execute on function private.email_workflow(text,jsonb),private.email_workflow_before_growth(text,jsonb) to service_role;
