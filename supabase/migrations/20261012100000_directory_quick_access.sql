-- Quick access for doctor-selected directory referrals.
--
-- A directory referral is released to the claiming account, for that one
-- referral only, when all of these hold at release time:
--   * the account verified the exact invited mailbox and claimed the invitation;
--   * the bound directory record was reviewed for onboarding at the exact
--     observation the doctor selected;
--   * that mailbox belongs to exactly one active directory contact.
-- No member profile, credential, directory listing or practice access is
-- created. Shared mailboxes and unreviewed records keep the independent
-- identity review (directory_identity_review). Every read and response
-- re-checks the same conditions, so withdrawal or a changed source removes
-- access.

alter table public.referrals add column directory_recipient_user_id uuid references auth.users(id);
create index referrals_directory_recipient on public.referrals(directory_recipient_user_id) where directory_recipient_user_id is not null;
alter table public.referrals drop constraint referrals_selection_check;
alter table public.referrals add constraint referrals_selection_check check(selection_mode='patient' or selected_practitioner_id is not null
  or directory_recipient_user_id is not null or status in ('awaiting_onboarding','cancelled'));
alter table public.referrals add constraint referrals_single_recipient_kind check(directory_recipient_user_id is null or selected_practitioner_id is null);

create function private.directory_quick_access_ready(binding private.directory_referral_bindings,mailbox text) returns boolean
language sql stable security invoker set search_path='' as $$
  select binding.referral_id is not null
    and exists(select 1 from private.practitioner_candidates c where c.id=binding.candidate_id
      and c.disposition='reviewed_for_onboarding' and c.reviewed_observation_hash=binding.observation_hash)
    and exists(select 1 from private.directory_contact_routes r where r.id=binding.route_id and r.candidate_id=binding.candidate_id
      and r.active and lower(btrim(r.email))=mailbox)
    and (select count(distinct r.candidate_id) from private.directory_contact_routes r where r.active and lower(btrim(r.email))=mailbox)=1;
$$;

create function private.directory_recipient_access(actor uuid,ref public.referrals) returns boolean
language sql stable security invoker set search_path='' as $$
  select actor is not null and ref.directory_recipient_user_id=actor and ref.selected_practitioner_id is null
    and exists(select 1 from private.referral_invitations g
      join public.workspace_invitations i on i.id=g.invitation_id
      join auth.users u on u.id=actor
      join private.directory_referral_bindings b on b.referral_id=g.referral_id
      join private.practitioner_candidates c on c.id=b.candidate_id
      where g.referral_id=ref.id and g.state='released' and i.status='claimed' and i.claimed_by=actor
        and u.email_confirmed_at is not null and lower(btrim(u.email))=i.recipient_email_normalized
        and c.disposition='reviewed_for_onboarding' and c.reviewed_observation_hash=b.observation_hash
        and private.directory_route_current(b.route_id,b.candidate_id,b.observation_hash));
$$;

-- Same sweep as 20261006080802, plus the quick-access release when no
-- independently linked member exists.
create or replace function private.growth_sweep() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ref public.referrals;g private.referral_invitations;inv public.workspace_invitations;binding private.directory_referral_bindings;
  recipient uuid;candidates integer;released integer:=0;checked integer:=0;outbox uuid;delivery text;
begin
  for ref in select r.* from public.referrals r join private.referral_invitations pending on pending.referral_id=r.id
    where r.status='awaiting_onboarding' and pending.state in ('awaiting_signup','awaiting_review')
    order by pending.last_checked_at nulls first,r.id limit 50 for update of r skip locked loop
    checked:=checked+1;
    select * into g from private.referral_invitations where referral_id=ref.id for update;
    select * into inv from public.workspace_invitations where id=g.invitation_id for share;
    update private.referral_invitations set last_checked_at=now() where referral_id=ref.id;
    if g.consent_valid_until<=now() then perform private.growth_block(ref.id,'consent_expired');continue;end if;
    if g.release_snapshot_hash is distinct from private.referral_release_digest(ref) then perform private.growth_block(ref.id,'requirements_changed');continue;end if;
    perform 1 from public.organisation_memberships where organisation_id=ref.organisation_id and user_id=g.confirmed_by and active for share;
    if not found then perform private.growth_block(ref.id,'referrer_inactive');continue;end if;
    if inv.status in ('declined','revoked') or (inv.status='pending' and inv.expires_at<=now()) then perform private.growth_block(ref.id,'invitation_unavailable');continue;end if;
    select * into binding from private.directory_referral_bindings where referral_id=ref.id;
    if binding.referral_id is not null and not private.directory_route_current(binding.route_id,binding.candidate_id,binding.observation_hash) then
      perform private.growth_block(ref.id,'directory_source_changed');continue;
    end if;
    if inv.status<>'claimed' then continue;end if;
    perform 1 from auth.users where id=inv.claimed_by and email_confirmed_at is not null and lower(btrim(email))=inv.recipient_email_normalized;
    if not found then perform private.growth_block(ref.id,'recipient_unavailable');continue;end if;
    recipient:=null;
    if binding.referral_id is not null then
      select app.practitioner_id into recipient from private.candidate_application_links link
        join public.practitioner_applications app on app.id=link.application_id
        join public.practitioners p on p.id=app.practitioner_id
        join private.practitioner_professions pp on pp.practitioner_id=p.id and pp.profession_id=ref.profession
        join private.professional_credentials credential on credential.id=pp.credential_id and credential.application_id=app.id
        where link.candidate_id=binding.candidate_id and link.observation_hash=binding.observation_hash
          and link.application_owner=inv.claimed_by and app.user_id=inv.claimed_by and link.linked_by<>app.user_id
          and app.status='approved' and app.version in (link.application_version,link.application_version+1)
          and app.profile->>'profession'=binding.profession_id
          and lower(regexp_replace(btrim(app.profile->>'practiceName'),'\s+',' ','g'))=binding.practice_key
          and credential.owner_user_id=inv.claimed_by;
      if recipient is null then
        if private.directory_quick_access_ready(binding,inv.recipient_email_normalized) then
          update public.referrals set directory_recipient_user_id=inv.claimed_by,status='sent',version=version+1 where id=ref.id returning * into ref;
          update private.referral_invitations set state='released',reason='directory_mailbox',released_at=now() where referral_id=ref.id;
          insert into public.referral_events(referral_id,actor_user_id,event_type,details) values(ref.id,g.confirmed_by,'sent','{"source":"verified_directory_mailbox"}');
          insert into public.notification_outbox(referral_id,kind,recipient_email,idempotency_key) values(ref.id,'referral_created',inv.recipient_email_normalized,'referral_created/'||ref.id) returning id into outbox;
          delivery:=case when exists(select 1 from private.email_suppressions where email=inv.recipient_email_normalized and reason<>'declined_invitation') then 'suppressed' else 'pending' end;
          insert into private.email_jobs(family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,state,payload)
            values('referral',ref.id,ref.version,outbox,'referral_created/'||ref.id,inv.recipient_email_normalized,delivery,jsonb_build_object('kind','referral_created','referralId',ref.id));
          released:=released+1;
          continue;
        end if;
        update private.referral_invitations set state='awaiting_review',reason='directory_identity_review' where referral_id=ref.id;continue;
      end if;
    else
      select count(*),(array_agg(p.id order by p.id))[1] into candidates,recipient from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id
        where u.user_id=inv.claimed_by and u.active and u.revoked_at is null and p.profession=ref.profession;
      if candidates=0 and exists(select 1 from public.practitioner_applications where user_id=inv.claimed_by and status in ('draft','submitted','changes_requested')) then
        update private.referral_invitations set state='awaiting_review' where referral_id=ref.id;continue;
      end if;
      if candidates<>1 then perform private.growth_block(ref.id,'recipient_unavailable');continue;end if;
    end if;
    perform 1 from public.practitioners where id=recipient for share;
    perform 1 from private.profession_policies where profession_id=ref.profession for share;
    perform 1 from public.practitioner_users where practitioner_id=recipient for share;
    if not exists(select 1 from public.practitioner_users where user_id=inv.claimed_by and practitioner_id=recipient and active and revoked_at is null)
      or not exists(select 1 from private.professional_credentials c join private.practitioner_professions pp on pp.credential_id=c.id where pp.practitioner_id=recipient and pp.profession_id=ref.profession and c.owner_user_id=inv.claimed_by)
      or not private.practitioner_is_eligible(recipient,ref.profession,now()) then perform private.growth_block(ref.id,'recipient_ineligible');continue;end if;
    if not private.practitioner_meets_requirements(recipient,ref.profession,ref.funding_path,ref.appointment_format,ref.preferred_language,ref.required_service_ids,ref.patient_age_group_id) then perform private.growth_block(ref.id,'requirements_changed');continue;end if;
    update public.referrals set selected_practitioner_id=recipient,status='sent',version=version+1 where id=ref.id returning * into ref;
    update private.referral_invitations set state='released',reason=null,released_at=now() where referral_id=ref.id;
    insert into public.referral_events(referral_id,actor_user_id,event_type,details) values(ref.id,g.confirmed_by,'sent','{"source":"verified_invitation_release"}');
    insert into public.notification_outbox(referral_id,kind,recipient_email,idempotency_key) values(ref.id,'referral_created',inv.recipient_email_normalized,'referral_created/'||ref.id) returning id into outbox;
    delivery:=case when exists(select 1 from private.email_suppressions where email=inv.recipient_email_normalized and reason<>'declined_invitation') then 'suppressed' else 'pending' end;
    insert into private.email_jobs(family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,state,payload)
      values('referral',ref.id,ref.version,outbox,'referral_created/'||ref.id,inv.recipient_email_normalized,delivery,jsonb_build_object('kind','referral_created','referralId',ref.id));
    released:=released+1;
  end loop;
  return jsonb_build_object('checked',checked,'released',released);
end $$;

-- Same guard as 20261001135200, except acceptance by a quick-access
-- recipient, who has no member credential by design.
create or replace function private.guard_referral_credential() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' or new.selected_practitioner_id is distinct from old.selected_practitioner_id or (new.status='sent' and old.status<>'sent') then
    if new.selected_practitioner_id is not null then
      perform 1 from public.practitioners p where p.id=new.selected_practitioner_id for share;
      perform 1 from private.professional_credentials c where c.practitioner_id=new.selected_practitioner_id for share;
      perform 1 from private.profession_policies p where p.profession_id=new.profession for share;
      perform 1 from public.practitioner_users u where u.practitioner_id=new.selected_practitioner_id for share;
      if not private.practitioner_is_eligible(new.selected_practitioner_id,new.profession,now()) then raise exception 'recipient_ineligible' using errcode='23514'; end if;
    end if;
  elsif new.status='accepted' and old.status<>'accepted' and not (new.selected_practitioner_id is null and new.directory_recipient_user_id is not null) then
    perform 1 from public.practitioners p where p.id=new.selected_practitioner_id for share;
    perform 1 from private.professional_credentials c where c.practitioner_id=new.selected_practitioner_id for share;
    perform 1 from private.profession_policies p where p.profession_id=new.profession for share;
    perform 1 from public.practitioner_users u where u.practitioner_id=new.selected_practitioner_id for share;
    if not private.practitioner_credential_current(new.selected_practitioner_id,new.profession,now()) then raise exception 'recipient_ineligible' using errcode='23514'; end if;
  end if;
  return new;
end $$;

create or replace function private.referral_contact_read(actor uuid,input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ref public.referrals;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'denied' using errcode='42501';end if;
  select * into ref from public.referrals where id=(input->>'referralId')::uuid;
  if not found or not (exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active)
    or (ref.status<>'awaiting_onboarding' and exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=ref.selected_practitioner_id and u.active and u.revoked_at is null and private.practitioner_has_access(u.practitioner_id)))
    or (ref.status in ('sent','accepted') and private.directory_recipient_access(actor,ref)))
    then raise exception 'denied' using errcode='42501';end if;
  return (select contact from private.referral_patient_contacts where referral_id=ref.id);
end $$;

create or replace function private.referral_handover(actor uuid,input jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ref public.referrals; contact private.practice_contacts; practice_name text; next_action text;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  select * into ref from public.referrals where id=(input->>'referralId')::uuid;
  if not found or not (
    exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active)
    or (ref.status<>'awaiting_onboarding' and exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=ref.selected_practitioner_id and u.active and u.revoked_at is null and private.practitioner_has_access(u.practitioner_id)))
    or (ref.status<>'cancelled' and private.directory_recipient_access(actor,ref))
  ) then raise exception 'denied' using errcode='42501'; end if;
  select name into practice_name from public.organisations where id=ref.organisation_id;
  select * into contact from private.practice_contacts where organisation_id=ref.organisation_id;
  next_action:=case ref.status
    when 'awaiting_onboarding' then 'Wait for the intended practitioner to complete signup and independent professional review. The referral has not been released.'
    when 'sent' then 'Wait for the receiving practitioner to accept or decline. A notification is not acceptance or an appointment booking.'
    when 'accepted' then 'The receiving practitioner and referring practice should agree a secure external handover channel. Arrange patient contact, appointments and payments outside ReturnWell. Acceptance does not confirm that handover has happened.'
    when 'declined' then 'The referring practice should review the reason and decide whether a new referral is needed. Do not continue handover under this declined referral.'
    when 'cancelled' then 'Do not continue handover under this cancelled referral. Its activity is retained; a new referral needs a fresh recipient choice and consent.'
    when 'closed' then 'Coordination is closed. Check the recorded outcome in activity; closure alone does not prove a consultation occurred.'
    when 'booked' then 'This is a historical booking status, not an appointment managed by ReturnWell. Confirm arrangements through your existing practice channel.'
    else 'Review the current referral status before taking further action.' end;
  if contact.organisation_id is null then next_action:=next_action||' A reviewed practice contact is not available. Contact ReturnWell support through your existing channel; do not send patient information by ordinary email.'; end if;
  return jsonb_build_object('status',ref.status,'practiceName',practice_name,'contactPhone',contact.phone,'secureInstructions',contact.instructions,'reviewedAt',contact.reviewed_at,'nextAction',next_action);
end $$;

-- What a quick-access recipient sees. Cancelled referrals show status only.
create function private.directory_recipient_detail(actor uuid,input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ref public.referrals; b private.directory_referral_bindings; i public.workspace_invitations; practice text;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  select * into ref from public.referrals where id=(input->>'referralId')::uuid;
  if not found or not private.directory_recipient_access(actor,ref) then raise exception 'denied' using errcode='42501'; end if;
  select * into b from private.directory_referral_bindings where referral_id=ref.id;
  select w.* into i from public.workspace_invitations w join private.referral_invitations g on g.invitation_id=w.id where g.referral_id=ref.id;
  select name into practice from public.organisations where id=ref.organisation_id;
  if ref.status='cancelled' then
    return jsonb_build_object('id',ref.id,'reference',ref.reference,'status',ref.status,'version',ref.version,
      'referringPractice',practice,'referrerName',i.inviter_name,'intendedName',b.display_name,'intendedPractice',b.practice_name);
  end if;
  return jsonb_build_object('id',ref.id,'reference',ref.reference,'status',ref.status,'version',ref.version,
    'patientReference',ref.patient_reference,'patientPostcode',ref.patient_postcode,'profession',ref.profession,
    'clinicalSummary',ref.clinical_summary,'fundingPath',ref.funding_path,'appointmentFormat',ref.appointment_format,
    'languageOrAccess',ref.language_or_access,'preferredLanguage',ref.preferred_language,'accessNotes',ref.access_notes,
    'requiredServiceIds',to_jsonb(ref.required_service_ids),'patientAgeGroupId',ref.patient_age_group_id,'createdAt',ref.created_at,
    'referringPractice',practice,'referrerName',i.inviter_name,'intendedName',b.display_name,'intendedPractice',b.practice_name,
    'events',coalesce((select jsonb_agg(jsonb_build_object('type',e.event_type,'at',e.created_at,'details',e.details) order by e.created_at,e.id)
      from public.referral_events e where e.referral_id=ref.id),'[]'::jsonb));
end $$;

-- Accept/decline for a quick-access recipient. Same rules and replay ledger as
-- the member response; only the authorization differs.
create function private.directory_recipient_respond(actor uuid,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ref public.referrals; req private.workflow_requests; result jsonb; notification_address text; notification_state text; outbox_id uuid;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  select * into ref from public.referrals where id=(input->>'referralId')::uuid for update;
  if ref.id is null or not private.directory_recipient_access(actor,ref) then raise exception 'denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if nullif(input->>'requestId','') is null then raise exception 'invalid_request'; end if;
  select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
  if found then
    if req.operation<>'referral.respond' or req.request_payload<>input then raise exception 'conflict' using errcode='40001'; end if;
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
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,'referral.respond',input,result);
  return result;
end $$;

-- Same lifecycle as 20261001154400, except a cancellation or closure notice
-- for a quick-access referral goes to the verified invited mailbox.
create or replace function private.referral_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ref public.referrals; req private.workflow_requests; draft public.referral_drafts; result jsonb; target text; reason text:=input->>'reasonCode';
 address text; delivery text:='configuration_needed'; outbox uuid; kind text;
begin
 if action not in ('referral.transition','referral.replace') then return private.referral_workflow_before_lifecycle(actor,action,input); end if;
 if actor is null then raise exception 'denied' using errcode='42501'; end if;
 -- Same lock order as accept/decline: referral, then actor request ledger.
 select * into ref from public.referrals where id=(input->>'referralId')::uuid for update;
 if ref.id is null or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active) then raise exception 'denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 if nullif(input->>'requestId','') is null then raise exception 'invalid_request'; end if;
 select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
 if found then
   if req.operation<>action or req.request_payload<>input then raise exception 'conflict' using errcode='40001'; end if;
   return req.response;
 end if;
 if ref.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001'; end if;
 if action='referral.replace' then
   if ref.status not in ('declined','cancelled') then raise exception 'conflict' using errcode='40001'; end if;
   insert into public.referral_drafts(id,organisation_id,created_by,supersedes_referral_id,input)
   values(gen_random_uuid(),ref.organisation_id,actor,ref.id,jsonb_build_object('patientReference',ref.patient_reference,'patientPostcode',ref.patient_postcode,
    'profession',ref.profession,'clinicalSummary',ref.clinical_summary,'fundingPath',ref.funding_path,'appointmentFormat',ref.appointment_format,
    'languageOrAccess',coalesce(ref.language_or_access,''),'preferredLanguage',ref.preferred_language,'accessNotes',ref.access_notes,
    'requiredServiceIds',ref.required_service_ids,'patientAgeGroupId',coalesce(ref.patient_age_group_id,''),'selectedPractitionerId',null)) returning * into draft;
   result:=private.draft_json(draft);
 else
   if input ? 'note' and (jsonb_typeof(input->'note')<>'string' or length(input->>'note')>500) then raise exception 'invalid_response'; end if;
   if input->>'action'='cancel' then
     if ref.status not in ('awaiting_onboarding','sent','accepted') then raise exception 'conflict' using errcode='40001'; end if;
     if coalesce(reason,'') not in ('entered_in_error','no_longer_required','other') then raise exception 'invalid_response'; end if;
     target:='cancelled';
   elsif input->>'action'='close' then
     if ref.status<>'accepted' then raise exception 'conflict' using errcode='40001'; end if;
     if coalesce(reason,'') not in ('handover_completed','no_longer_required','unable_to_arrange') then raise exception 'invalid_response'; end if;
     if reason='handover_completed' and input->'handoverConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required'; end if;
     target:='closed';
   else raise exception 'invalid_response'; end if;
   update public.referrals set status=target,version=version+1 where id=ref.id returning * into ref;
   insert into public.referral_events(referral_id,actor_user_id,event_type,details)
    values(ref.id,actor,target,jsonb_strip_nulls(jsonb_build_object('reasonCode',reason,'note',nullif(trim(input->>'note'),''),'handoverConfirmed',case when reason='handover_completed' then true end)));
   perform private.cancel_stale_referral_jobs(ref);
   select trim(contact_email) into address from public.practitioners where id=ref.selected_practitioner_id;
   if address is null and ref.directory_recipient_user_id is not null then
     select i.recipient_email_normalized into address from private.referral_invitations g join public.workspace_invitations i on i.id=g.invitation_id
       where g.referral_id=ref.id and g.state='released' and i.claimed_by=ref.directory_recipient_user_id;
   end if;
   if length(address)<=254 and address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
     kind:='referral_'||target;
     delivery:=case when exists(select 1 from private.email_suppressions s where s.email=lower(address) and s.reason<>'declined_invitation') then 'suppressed' else 'pending' end;
     insert into public.notification_outbox(referral_id,kind,recipient_email,idempotency_key) values(ref.id,kind,address,kind||'/'||ref.id) returning id into outbox;
     insert into private.email_jobs(family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,state,payload)
     values('referral',ref.id,ref.version,outbox,kind||'/'||ref.id,address,delivery,jsonb_build_object('kind',kind,'referralId',ref.id));
   end if;
   update public.referrals set response_notification_state=delivery where id=ref.id returning * into ref;
   result:=jsonb_build_object('referral',to_jsonb(ref)||jsonb_build_object('practitioners',jsonb_build_object('practice_name',(select practice_name from public.practitioners where id=ref.selected_practitioner_id))),'notification',delivery);
 end if;
 insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,action,input,result);
 return result;
end $$;

-- A post-commit verification request may send only its own code email, so
-- the recipient is not left waiting for the scheduled worker.
alter function private.email_workflow(text,jsonb) rename to email_workflow_before_auth_scope;
create function private.email_workflow(action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare related uuid; result jsonb;
begin
  if action<>'email.claimScoped' or (input#>>'{scope,family}') is distinct from 'auth_verification' then
    return private.email_workflow_before_auth_scope(action,input);
  end if;
  begin
    if jsonb_typeof(input->'scope') is distinct from 'object' or not(input->'scope' ?& array['family','relatedId'])
      or (select count(*) from jsonb_object_keys(input->'scope'))<>2 then raise exception 'invalid_request'; end if;
    related:=(input#>>'{scope,relatedId}')::uuid;
  exception when invalid_text_representation then raise exception 'invalid_request';
  end;
  if related is null then raise exception 'invalid_request'; end if;
  if not exists(select 1 from private.delivery_quarantine where singleton and not active) then return '[]'; end if;
  -- Unconfigured delivery is left to the scheduled worker's existing handling.
  if input->'configured' is distinct from 'true'::jsonb then return '[]'; end if;
  with due as (
    select j.id from private.email_jobs j where j.family='auth_verification' and j.related_id=related
      and j.state='pending' and j.due_at<=now() and j.attempts<5 and (j.expires_at is null or j.expires_at>now())
      and not exists(select 1 from private.email_suppressions s where s.email=j.recipient_email)
      and exists(select 1 from public.workspace_invitations i where i.id=j.related_id and i.status='pending' and i.generation=j.related_version and i.expires_at>now())
      order by j.created_at desc,j.id for update of j skip locked limit 1
  ), claimed as (
    update private.email_jobs j set state='processing',lease_id=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now() from due where due.id=j.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
  return result;
end $$;

-- Same doctor referral list as 20261001142619, plus whether a quick-access
-- directory recipient opened it (a flag, not their account id).
create or replace function private.referral_page(actor uuid,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid:=(input->>'organisationId')::uuid; v_status text:=coalesce(nullif(input->>'status',''),'all');
 v_query text:=lower(trim(coalesce(input->>'search',''))); v_limit integer:=least(50,greatest(1,coalesce((input->>'limit')::integer,25)));
 v_fingerprint text; v_cursor jsonb; result jsonb;
begin
 if actor is null or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=v_org and active) then raise exception 'denied' using errcode='42501'; end if;
 if length(v_query)>120 or v_status not in ('all','sent','accepted','declined','booked','cancelled','closed','awaiting_onboarding') then raise exception 'invalid_request'; end if;
 v_fingerprint:=md5(jsonb_build_object('actor',actor,'organisation',v_org,'status',v_status,'query',v_query)::text);
 v_cursor:=private.read_page_cursor(input->>'cursor',v_fingerprint);
 if v_cursor is not null then begin perform (v_cursor->>'key')::timestamptz; exception when others then raise exception 'invalid_cursor'; end; end if;
 with authorised as materialized (
   select r.id,r.reference,r.patient_reference,r.patient_postcode,r.profession,r.funding_path,r.appointment_format,r.selection_mode,r.selected_practitioner_id,r.directory_recipient_user_id is not null as directory_recipient,r.status,r.created_at,r.updated_at,p.practice_name
   from public.referrals r left join public.practitioners p on p.id=r.selected_practitioner_id
   where r.organisation_id=v_org and (v_query='' or strpos(lower(r.reference||' '||r.patient_reference||' '||coalesce(p.practice_name,'')),v_query)>0)
 ), page_plus_one as materialized (
   select * from authorised where (v_status='all' or status=v_status) and (v_cursor is null or (created_at,id)<((v_cursor->>'key')::timestamptz,(v_cursor->>'id')::uuid)) order by created_at desc,id desc limit v_limit+1
 ), visible as materialized(select * from page_plus_one order by created_at desc,id desc limit v_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg((to_jsonb(v)-'practice_name')||jsonb_build_object('practitioners',jsonb_build_object('practice_name',v.practice_name)) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
  'nextCursor',case when (select count(*) from page_plus_one)>v_limit then (select private.page_cursor(v_fingerprint,created_at::text,id) from visible order by created_at,id limit 1) end,
  'counts',coalesce((select jsonb_object_agg(s.status,s.total) from (select status,count(*) total from authorised group by status) s),'{}'::jsonb)||jsonb_build_object('all',(select count(*) from authorised))) into result;
 return result;
end $$;

alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_directory_quick_access;
alter function public.rw_workflow_before_directory_quick_access(uuid,text,jsonb) set schema private;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; invitation uuid; binding private.directory_referral_bindings; mailbox text;
begin
  if p_action='referral.recipient.detail' then return private.directory_recipient_detail(p_actor,p_input); end if;
  if p_action='referral.respond' and coalesce(p_input->>'referralId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists(select 1 from public.referrals r where r.id=(p_input->>'referralId')::uuid and r.directory_recipient_user_id is not null and r.selected_practitioner_id is null) then
    return private.directory_recipient_respond(p_actor,p_input);
  end if;
  result:=private.rw_workflow_before_directory_quick_access(p_actor,p_action,p_input);
  if p_action='invitation.inspect' and result ? 'intendedIdentity' then
    invitation:=(result->>'invitationId')::uuid;
    select b.* into binding from private.directory_referral_bindings b join private.referral_invitations g on g.referral_id=b.referral_id
      where g.invitation_id=invitation order by b.referral_id limit 1;
    select recipient_email_normalized into mailbox from public.workspace_invitations where id=invitation;
    if binding.referral_id is not null and private.directory_quick_access_ready(binding,mailbox) then
      result:=jsonb_set(result,'{intendedIdentity}',(result->'intendedIdentity')||jsonb_build_object('quickAccess',true,'referralId',binding.referral_id));
    end if;
  elsif p_action='workspace.access' and p_actor is not null then
    result:=result||jsonb_build_object('directoryReferrals',coalesce((select jsonb_agg(jsonb_build_object('referralId',x.id,'invitationId',x.invitation_id,'practiceName',x.name,'status',x.status,'createdAt',x.created_at) order by x.created_at desc)
      from (select r.id,g.invitation_id,o.name,r.status,r.created_at from public.referrals r join public.organisations o on o.id=r.organisation_id
        join private.referral_invitations g on g.referral_id=r.id
        where r.directory_recipient_user_id=p_actor and private.directory_recipient_access(p_actor,r) order by r.created_at desc limit 50) x),'[]'::jsonb));
  end if;
  return result;
end $$;

revoke all on function private.directory_quick_access_ready(private.directory_referral_bindings,text),private.directory_recipient_access(uuid,public.referrals),
  private.directory_recipient_detail(uuid,jsonb),private.directory_recipient_respond(uuid,jsonb),private.email_workflow(text,jsonb),
  private.email_workflow_before_auth_scope(text,jsonb),public.rw_workflow(uuid,text,jsonb),private.rw_workflow_before_directory_quick_access(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function private.directory_quick_access_ready(private.directory_referral_bindings,text),private.directory_recipient_access(uuid,public.referrals),
  private.directory_recipient_detail(uuid,jsonb),private.directory_recipient_respond(uuid,jsonb),private.email_workflow(text,jsonb),
  private.email_workflow_before_auth_scope(text,jsonb),public.rw_workflow(uuid,text,jsonb),private.rw_workflow_before_directory_quick_access(uuid,text,jsonb)
  to service_role;
