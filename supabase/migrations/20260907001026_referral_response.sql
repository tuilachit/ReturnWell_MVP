alter table public.referrals add column version integer not null default 0,
  add column response_notification_state text check(response_notification_state in ('pending','suppressed','configuration_needed'));
-- Initial creation cannot forge a practitioner's response or the audit clocks.
revoke insert on public.referrals from authenticated;
grant insert(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,language_or_access,selection_mode,selected_practitioner_id,consent_confirmed_at) on public.referrals to authenticated;
drop trigger referrals_record_status_change on public.referrals;
-- The transaction below owns the response event and outbox write. There is no
-- direct browser UPDATE grant, and no duplicate trigger with a null actor.
drop policy referrals_select_organisation_member on public.referrals;
create policy referrals_select_current_participant on public.referrals for select to authenticated using(
  exists(select 1 from public.organisation_memberships m where m.user_id=auth.uid() and m.organisation_id=referrals.organisation_id and m.active)
  or private.owns_practitioner(selected_practitioner_id)
);
-- Pausing intake must not erase the assigned clinician's name from the
-- referring practice's existing records. This does not add them to matching.
create function private.can_read_assigned_practitioner(practitioner uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.referrals r join public.organisation_memberships m on m.organisation_id=r.organisation_id where r.selected_practitioner_id=practitioner and m.user_id=auth.uid() and m.active);
$$;
revoke execute on function private.can_read_assigned_practitioner(uuid) from public,anon;
grant execute on function private.can_read_assigned_practitioner(uuid) to authenticated,service_role;
create policy practitioners_read_assigned on public.practitioners for select to authenticated using(private.can_read_assigned_practitioner(id));

create function private.referral_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ref public.referrals; req private.workflow_requests; result jsonb; notification_address text; notification_state text; outbox_id uuid;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  select * into ref from public.referrals where id=(input->>'referralId')::uuid for update;
  if ref.id is null then raise exception 'denied' using errcode='42501'; end if;
  if action='referral.notifications' then
    if not (exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active) or exists(select 1 from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id where u.user_id=actor and u.practitioner_id=ref.selected_practitioner_id and u.active and u.revoked_at is null and p.lifecycle_status='active' and p.ahpra_verification_status='verified' and p.provider_confirmation_status='confirmed')) then raise exception 'denied' using errcode='42501'; end if;
    return jsonb_build_object('ok',true,'status',case when ref.response_notification_state='configuration_needed' then 'configuration_needed' else coalesce((select coalesce(j.state,o.status) from public.notification_outbox o left join private.email_jobs j on j.source_outbox_id=o.id where o.referral_id=ref.id order by o.created_at desc limit 1),'configuration_needed') end,'notifications',coalesce((select jsonb_agg(jsonb_build_object('kind',o.kind,'status',coalesce(j.state,o.status),'createdAt',o.created_at,'errorCode',j.error_code,'delivered',exists(select 1 from private.email_events e where e.matched_job_id=j.id and e.event_type='delivered'))) from public.notification_outbox o left join private.email_jobs j on j.source_outbox_id=o.id where o.referral_id=ref.id),'[]'::jsonb));
  end if;
  if not exists(select 1 from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id where u.user_id=actor and u.practitioner_id=ref.selected_practitioner_id and u.active and u.revoked_at is null and p.lifecycle_status='active' and p.ahpra_verification_status='verified' and p.provider_confirmation_status='confirmed') then raise exception 'denied' using errcode='42501'; end if;
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

alter table private.email_jobs add column prepared_payload jsonb;
create or replace function private.invalidate_invitation(invitation uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  delete from private.invitation_secrets where invitation_id=invitation;
  update private.invitation_auth_attempts set expires_at=least(expires_at,now()) where invitation_id=invitation and claimed_at is null;
  update private.email_jobs set state=case when state='sent' then state else 'cancelled' end,payload=null,prepared_payload=null,lease_id=null,lease_expires_at=null where related_id=invitation and family in ('invitation','auth_verification');
end $$;
create function private.reconcile_email_events() returns void language plpgsql security invoker set search_path='' as $$
begin
  update private.email_events e set matched_job_id=j.id from private.email_jobs j where e.matched_job_id is null and e.provider_message_id=j.provider_message_id;
  insert into private.email_suppressions(email,reason,source_event)
    select distinct on (lower(trim(j.recipient_email))) lower(trim(j.recipient_email)),case e.event_type when 'bounced' then 'bounce' when 'complained' then 'complaint' else 'provider_suppressed' end,e.provider_event_id
      from private.email_events e join private.email_jobs j on j.id=e.matched_job_id where e.event_type in ('bounced','complained','suppressed') order by lower(trim(j.recipient_email)),e.occurred_at desc
    on conflict(email) do update set reason=excluded.reason,source_event=excluded.source_event;
  update private.email_jobs j set state='suppressed',error_code='recipient_suppressed',payload=null,prepared_payload=null,lease_id=null,lease_expires_at=null
    where j.state not in ('cancelled','suppressed') and exists(select 1 from private.email_suppressions s where s.email=lower(trim(j.recipient_email)) and (s.reason<>'declined_invitation' or j.family in ('invitation','auth_verification')));
  insert into public.email_delivery_events(outbox_id,provider_event_id,event_type,occurred_at)
    select j.source_outbox_id,e.provider_event_id,e.event_type,e.occurred_at from private.email_events e join private.email_jobs j on j.id=e.matched_job_id where j.source_outbox_id is not null
    on conflict(provider_event_id) do nothing;
  update private.email_jobs j set state='exhausted',error_code='provider_delivery_failed' where j.state='sent' and exists(select 1 from private.email_events e where e.matched_job_id=j.id and e.event_type='failed');
end $$;

create function private.email_workflow(action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare job private.email_jobs; result jsonb; retry_minutes integer; inv public.workspace_invitations;
begin
  if action='email.webhook' then
    if coalesce(input->>'eventType','') not in ('sent','delivered','delivery_delayed','bounced','complained','suppressed','failed') then raise exception 'invalid_event'; end if;
    insert into private.email_events(provider_event_id,provider_message_id,event_type,occurred_at) values(input->>'eventId',input->>'providerId',input->>'eventType',(input->>'occurredAt')::timestamptz) on conflict do nothing;
    perform private.reconcile_email_events(); return '{"ok":true}';
  end if;
  if action='email.claim' then
    delete from private.public_token_limits where bucket<now()-interval '1 day';
    -- Import legacy outbox once, preserving old sent/failed ambiguity. Never
    -- resend historical sent messages or reset historical attempt counters.
    insert into private.email_jobs(family,related_id,related_version,source_outbox_id,idempotency_key,recipient_email,payload,state,attempts,provider_message_id,first_attempt_at)
      select 'referral',o.referral_id,0,o.id,o.idempotency_key,o.recipient_email,jsonb_build_object('kind',o.kind,'referralId',o.referral_id),
        case when o.status='sent' then 'sent' when o.attempts>0 then 'needs_review' else 'pending' end,least(o.attempts,5),o.provider_message_id,case when o.attempts>0 then o.created_at end
      from public.notification_outbox o on conflict(source_outbox_id) do nothing;
    for inv in select * from public.workspace_invitations where status='pending' and expires_at<=now() for update skip locked loop
      perform private.invalidate_invitation(inv.id);
      update public.workspace_invitations set status='revoked',version=version+1,updated_at=now() where id=inv.id;
    end loop;
    update private.email_jobs set state=case when state='sent' then state else 'cancelled' end,payload=null,prepared_payload=null,lease_id=null,lease_expires_at=null where expires_at<=now() and (payload is not null or prepared_payload is not null);
    perform private.reconcile_email_events();
    update private.email_jobs set state='needs_review',error_code='idempotency_window_expired',lease_id=null,lease_expires_at=null where state in ('pending','processing','paused_configuration') and first_attempt_at<=now()-interval '24 hours';
    update private.email_jobs set state='needs_review',error_code='final_attempt_uncertain',lease_id=null,lease_expires_at=null where state='processing' and lease_expires_at<=now() and attempts>=5;
    update private.email_jobs set state='exhausted',error_code='retry_limit' where state='pending' and attempts>=5;
    if input->'configured' is distinct from 'true'::jsonb then
      update private.email_jobs set state='paused_configuration',error_code='configuration_needed' where state='pending'; return '[]';
    end if;
    with due as (
      select id from private.email_jobs where ((state in ('pending','paused_configuration') and due_at<=now()) or (state='processing' and lease_expires_at<=now())) and attempts<5 order by due_at,created_at for update skip locked limit greatest(1,least(coalesce((input->>'limit')::integer,10),20))
    ), claimed as (
      update private.email_jobs j set state='processing',lease_id=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now() from due where due.id=j.id returning j.*
    ) select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
    return result;
  end if;
  select * into job from private.email_jobs where id=(input->>'jobId')::uuid for update;
  if job.id is null or job.lease_id is distinct from (input->>'leaseId')::uuid or job.state<>'processing' or job.lease_expires_at<=now() then raise exception 'lease_unavailable' using errcode='40001'; end if;
  if action='email.prepare' then
    if job.prepared_payload is null then update private.email_jobs set prepared_payload=input->'envelope' where id=job.id; end if;
    return '{"ok":true}';
  elsif action='email.start' then
    if job.attempts>=5 or job.first_attempt_at<=now()-interval '24 hours' or job.expires_at<=now() then raise exception 'lease_unavailable'; end if;
    if exists(select 1 from private.email_suppressions s where s.email=lower(trim(job.recipient_email)) and (s.reason<>'declined_invitation' or job.family<>'referral')) then raise exception 'recipient_suppressed'; end if;
    if job.family<>'referral' and not exists(select 1 from public.workspace_invitations i where i.id=job.related_id and i.status='pending' and i.generation=job.related_version and i.expires_at>now()) then raise exception 'invitation_unavailable'; end if;
    update private.email_jobs set attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now() where id=job.id returning * into job;
    return to_jsonb(job);
  elsif action='email.finish' then
    if input->>'outcome'='sent' then
      if coalesce(length(input->>'providerId'),0)=0 then raise exception 'invalid_provider_id'; end if;
      update private.email_jobs set state='sent',provider_message_id=input->>'providerId',payload=case when family='referral' then payload else null end,prepared_payload=null,error_code=null,lease_id=null,lease_expires_at=null,updated_at=now() where id=job.id;
    elsif input->>'outcome'='paused_configuration' then
      update private.email_jobs set state='paused_configuration',error_code='configuration_needed',due_at=now()+interval '15 minutes',lease_id=null,lease_expires_at=null where id=job.id;
    elsif input->>'outcome' in ('transient','permanent') then
      retry_minutes:=(array[1,5,15,60,60])[greatest(1,job.attempts)];
      update private.email_jobs set state=case when input->>'outcome'='permanent' then 'exhausted' when attempts>=5 then 'needs_review' else 'pending' end,error_code=case when input->>'outcome'='permanent' then 'provider_rejected' else 'delivery_uncertain' end,due_at=now()+make_interval(mins=>retry_minutes),lease_id=null,lease_expires_at=null,updated_at=now() where id=job.id;
    else raise exception 'invalid_outcome'; end if;
    if job.source_outbox_id is not null then
      update public.notification_outbox o set status=case when j.state='sent' then 'sent' when j.state='paused_configuration' then 'blocked_configuration' else 'failed' end,attempts=j.attempts,provider_message_id=j.provider_message_id,last_error=j.error_code,sent_at=case when j.state='sent' then now() else o.sent_at end from private.email_jobs j where j.id=job.id and o.id=job.source_outbox_id;
    end if;
    perform private.reconcile_email_events();
    return '{"ok":true}';
  end if;
  raise exception 'unsupported_operation';
end $$;

create or replace function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action like 'email.%' then return private.email_workflow(p_action,p_input); end if;
  if p_action like 'referral.%' then return private.referral_workflow(p_actor,p_action,p_input); end if;
  if p_action in ('workspace.access','invitation.claim') or p_action like 'application.%' or p_action like 'review.%' then return private.application_workflow(p_actor,p_action,p_input); end if;
  return private.invitation_workflow(p_actor,p_action,p_input);
end $$;
revoke execute on function private.referral_workflow(uuid,text,jsonb),private.email_workflow(text,jsonb),private.reconcile_email_events() from public,anon,authenticated;
grant execute on function private.referral_workflow(uuid,text,jsonb),private.email_workflow(text,jsonb),private.reconcile_email_events() to service_role;
