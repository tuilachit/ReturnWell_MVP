alter table public.workspace_invitations add column directory_route_id uuid references private.directory_contact_routes(id);
drop index public.invitations_one_pending;
create unique index invitations_one_pending on public.workspace_invitations(kind,organisation_id,recipient_email_normalized)
  nulls not distinct where status='pending' and directory_route_id is null;
create unique index invitations_one_directory_pending on public.workspace_invitations(organisation_id,directory_route_id)
  where status='pending' and directory_route_id is not null;
create table private.directory_referral_bindings (
  referral_id uuid primary key references private.referral_invitations(referral_id),
  candidate_id uuid not null references private.practitioner_candidates(id),
  observation_id uuid not null references private.candidate_observations(id),observation_hash text not null,
  route_id uuid not null references private.directory_contact_routes(id),
  practice_key text not null,display_name text not null,practice_name text not null,profession_id text not null
);
alter table private.directory_referral_bindings enable row level security;
revoke all on private.directory_referral_bindings from public,anon,authenticated,service_role;
grant select,insert on private.directory_referral_bindings to service_role;

create function private.directory_route_current(route uuid,candidate uuid,observation text) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from private.directory_contact_routes r join private.practitioner_candidates c on c.id=r.candidate_id
    join private.candidate_observations o on o.id=r.observation_id
    where r.id=route and c.id=candidate and r.observation_hash=observation and c.current_observation_id=o.id
      and r.active and c.disposition not in ('duplicate','unsuitable')
      and exists(select 1 from private.candidate_batch_items i join private.candidate_import_batches b on b.id=i.batch_id where i.observation_id=o.id and b.status='completed')
      and not exists(select 1 from private.email_suppressions s where s.email=r.email));
$$;
create function private.directory_invite(actor uuid,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.referral_drafts;ref public.referrals;inv public.workspace_invitations;route private.directory_contact_routes;
  observation private.candidate_observations;prior private.workflow_requests;ident jsonb;p jsonb;result jsonb;selection jsonb:=input->'selection';
  clean jsonb:=input-array['tokenHash','envelope','keyId','recipientName','recipientEmail'];previous_actor text;
begin
  if actor is null then raise exception 'denied' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  -- Same lock as imports, source withdrawal and association review.
  perform pg_advisory_xact_lock(71423811);
  select * into d from public.referral_drafts where id=(directory_invite.input->>'id')::uuid for update;
  if d.id is null or d.created_by<>actor or not exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=d.organisation_id and active)
    then raise exception 'denied' using errcode='42501';end if;
  ident:=private.inviter(actor,d.organisation_id,'practitioner');
  select * into prior from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
  if found then
    if prior.operation<>'growth.directoryInvite' or prior.request_payload<>clean then raise exception 'conflict' using errcode='40001';end if;
    select * into ref from public.referrals where id=d.finalized_referral_id;
    return private.growth_projection(ref);
  end if;
  if d.finalized_referral_id is not null or d.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict' using errcode='40001';end if;
  if input->'consentConfirmed' is distinct from 'true'::jsonb or input->'contactConsentConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required';end if;
  if coalesce(input->>'contactBasis','') not in ('recipient_requested','documented_permission') then raise exception 'invalid_request';end if;
  if jsonb_typeof(selection) is distinct from 'object' or not(selection ?& array['candidateId','routeId','observationHash'])
    or (select count(*) from jsonb_object_keys(selection))<>3 or coalesce(selection->>'observationHash','') !~ '^[a-f0-9]{64}$' then raise exception 'recipient_changed';end if;
  perform 1 from private.practitioner_candidates where id=(selection->>'candidateId')::uuid for share;
  select * into route from private.directory_contact_routes where id=(selection->>'routeId')::uuid for share;
  if not private.directory_route_current(route.id,(selection->>'candidateId')::uuid,selection->>'observationHash') then raise exception 'recipient_changed';end if;
  select * into observation from private.candidate_observations where id=route.observation_id;
  if not(observation.record->'professionIds' ? (d.input->>'profession')) or observation.record#>'{raw,accepting_new_referrals}'='false'::jsonb
    or (d.input->>'appointmentFormat'='telehealth' and observation.record#>'{raw,telehealth}'='false'::jsonb)
    or (d.input->>'appointmentFormat'='in_person' and jsonb_array_length(observation.record->'locations')=0)
    or (exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(observation.record#>'{raw,funding_types_raw}')='array' then observation.record#>'{raw,funding_types_raw}' else '[]' end) x where private.normalize_term('funding',x) is not null)
      and not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(observation.record#>'{raw,funding_types_raw}')='array' then observation.record#>'{raw,funding_types_raw}' else '[]' end) x where private.normalize_term('funding',x)=private.normalize_term('funding',d.input->>'fundingPath')))
    or (coalesce(d.input->>'preferredLanguage','')<>'' and exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(observation.record#>'{raw,languages_raw}')='array' then observation.record#>'{raw,languages_raw}' else '[]' end) x where private.normalize_term('language',x) is not null)
      and not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(observation.record#>'{raw,languages_raw}')='array' then observation.record#>'{raw,languages_raw}' else '[]' end) x where private.normalize_term('language',x)=private.normalize_term('language',d.input->>'preferredLanguage')))
    then raise exception 'recipient_changed';end if;
  if nullif(d.input->>'selectedPractitionerId','') is not null or not(d.input ? 'patientContact') then raise exception 'invalid_draft';end if;
  p:=private.validate_referral_draft(d.input||'{"selectedPractitionerId":"00000000-0000-4000-8000-000000000000"}',true)-'selectedPractitionerId';
  perform pg_advisory_xact_lock(hashtextextended('mailbox:'||route.email,0));
  -- Expired scoped invitations never block a fresh, explicitly consented send.
  for inv in select * from public.workspace_invitations where directory_route_id=route.id and organisation_id=d.organisation_id and status='pending' and expires_at<=now() for update loop
    perform private.invalidate_invitation(inv.id);update public.workspace_invitations set status='revoked',version=version+1 where id=inv.id;
  end loop;
  select * into inv from public.workspace_invitations where directory_route_id=route.id and organisation_id=d.organisation_id and status='pending' and expires_at>now() for update;
  if inv.id is null then
    if (select count(*) from public.workspace_invitations where invited_by=actor and created_at>now()-interval '1 day')>=20 then raise exception 'rate_limited' using errcode='54000';end if;
    if coalesce(input->>'tokenHash','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(input->'envelope') is distinct from 'object' or coalesce(length(input->>'keyId'),0) not between 1 and 160 then raise exception 'sender_configuration';end if;
    insert into public.workspace_invitations(kind,organisation_id,invited_by,inviter_name,practice_name,recipient_name,recipient_email,recipient_email_normalized,consent_recorded_at,directory_route_id)
      values('practitioner',d.organisation_id,actor,ident->>'display_name',ident->>'practice_name',observation.record->>'displayName',route.email,route.email,now(),route.id) returning * into inv;
    insert into private.invitation_secrets values(inv.id,input->>'tokenHash',input->'envelope',input->>'keyId');
    insert into private.email_jobs(family,related_id,related_version,idempotency_key,recipient_email,payload,expires_at)
      values('invitation',inv.id,inv.generation,'invitation:'||inv.id||':'||inv.generation,route.email,
        jsonb_build_object('envelope',input->'envelope','context',input->>'tokenHash','invitation',to_jsonb(inv)),inv.expires_at);
    insert into private.invitation_events(invitation_id,actor_user_id,kind) values(inv.id,actor,'invitations.create');
  end if;
  previous_actor:=current_setting('request.jwt.claim.sub',true);perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,language_or_access,preferred_language,access_notes,selection_mode,selected_practitioner_id,consent_confirmed_at,status,required_service_ids,patient_age_group_id)
    values(d.id,'RW-'||d.id,d.organisation_id,actor,btrim(p->>'patientReference'),p->>'patientPostcode',p->>'profession',btrim(p->>'clinicalSummary'),p->>'fundingPath',p->>'appointmentFormat',coalesce(p->>'languageOrAccess',''),coalesce(p->>'preferredLanguage',''),coalesce(p->>'accessNotes',''),'doctor',null,now(),'awaiting_onboarding',array(select jsonb_array_elements_text(coalesce(p->'requiredServiceIds','[]'))),nullif(p->>'patientAgeGroupId','')) returning * into ref;
  perform set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true);
  insert into private.referral_invitations(referral_id,invitation_id,confirmed_by,consent_confirmed_at,consent_valid_until,contact_basis,contact_consented_at)
    values(ref.id,inv.id,actor,now(),now()+interval '7 days',input->>'contactBasis',now());
  insert into private.directory_referral_bindings(referral_id,candidate_id,observation_id,observation_hash,route_id,practice_key,display_name,practice_name,profession_id)
    values(ref.id,route.candidate_id,route.observation_id,route.observation_hash,route.id,route.practice_key,observation.record->>'displayName',observation.record#>>'{practiceNames,0}',ref.profession);
  update public.referral_drafts set finalized_referral_id=ref.id,version=version+1,updated_at=now() where id=d.id;
  result:=private.growth_projection(ref);
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,'growth.directoryInvite',clean,result);
  return result;
end $$;

-- A legacy manually-addressed invitation must never reuse a directory identity
-- merely because it shares a mailbox. Serialize with source-bound sends.
create function private.directory_legacy_guard(actor uuid,input jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare d public.referral_drafts;
begin
    if actor is null then raise exception 'denied' using errcode='42501';end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
    perform pg_advisory_xact_lock(71423811);
    select * into d from public.referral_drafts where id=(directory_legacy_guard.input->>'id')::uuid for update;
    if d.created_by is distinct from actor or not exists(select 1 from public.organisation_memberships where organisation_id=d.organisation_id and user_id=actor and active) then raise exception 'denied' using errcode='42501';end if;
    perform private.inviter(actor,d.organisation_id,'practitioner');
    perform pg_advisory_xact_lock(hashtextextended('mailbox:'||lower(btrim(input->>'recipientEmail')),0));
    if not exists(select 1 from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid)
      and exists(select 1 from public.workspace_invitations where organisation_id=d.organisation_id and recipient_email_normalized=lower(btrim(input->>'recipientEmail')) and directory_route_id is not null and status='pending' and expires_at>now())
      then raise exception 'directory_selection_required';end if;
end $$;
revoke all on function private.directory_legacy_guard(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.directory_legacy_guard(uuid,jsonb) to service_role;

-- Preserve the old member eligibility gate. Only directory-bound referrals
-- additionally need an independently reviewed, version-bound association.
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

alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_directory_binding;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;invitation uuid;identity jsonb;
begin
  if p_action='growth.directoryInvite' then return private.directory_invite(p_actor,p_input);end if;
  if p_action='growth.invite' then perform private.directory_legacy_guard(p_actor,p_input);end if;
  result:=public.rw_workflow_before_directory_binding(p_actor,p_action,p_input);
  if p_action in ('invitation.inspect','application.load') then
    invitation:=case when p_action='invitation.inspect' then (result->>'invitationId')::uuid else (result->>'invitation_id')::uuid end;
    select jsonb_build_object('displayName',b.display_name,'practiceName',b.practice_name,'professionId',b.profession_id,'reviewRequired',true) into identity
      from private.directory_referral_bindings b join private.referral_invitations g on g.referral_id=b.referral_id where g.invitation_id=invitation order by b.referral_id limit 1;
    if identity is not null then result:=result||jsonb_build_object('intendedIdentity',identity);end if;
  end if;
  return result;
end $$;
revoke all on function private.directory_route_current(uuid,uuid,text),private.directory_invite(uuid,jsonb),public.rw_workflow(uuid,text,jsonb),public.rw_workflow_before_directory_binding(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.directory_route_current(uuid,uuid,text),private.directory_invite(uuid,jsonb),public.rw_workflow(uuid,text,jsonb),public.rw_workflow_before_directory_binding(uuid,text,jsonb) to service_role;
