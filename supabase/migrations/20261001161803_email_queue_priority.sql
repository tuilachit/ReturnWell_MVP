-- Earlier virtual deadlines for auth; all work ages into priority. No second
-- scheduler, attempts reset, lease bypass or idempotency-key change.
create or replace function private.email_workflow_before_growth(action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
      select id from private.email_jobs where ((state in ('pending','paused_configuration') and due_at<=now()) or (state='processing' and lease_expires_at<=now())) and attempts<5 order by case when family='auth_verification' then least(coalesce(expires_at,'infinity'::timestamptz),due_at+interval '2 minutes') else due_at+interval '5 minutes' end,due_at,created_at,id for update skip locked limit greatest(1,least(coalesce((input->>'limit')::integer,10),20))
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
