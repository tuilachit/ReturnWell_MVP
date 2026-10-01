-- Durable proof that this exact worker lease crossed the transport boundary.
create table private.email_attempts (
  job_id uuid not null references private.email_jobs(id),lease_id uuid not null,
  started_at timestamptz not null default now(),primary key(job_id,lease_id)
);
alter table private.email_attempts enable row level security;
revoke all on private.email_attempts from public,anon,authenticated;
grant select,insert on private.email_attempts to service_role;
create function private.cancelled_email_uncertain() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.state='cancelled' and old.attempts>0 and old.provider_message_id is null and old.state in ('processing','pending','paused_configuration','needs_review') then
    new.state:='needs_review';new.error_code:='cancelled_after_start';
  end if;
  return new;
end $$;
create trigger email_cancelled_uncertain before update of state on private.email_jobs for each row execute function private.cancelled_email_uncertain();
revoke all on function private.cancelled_email_uncertain() from public,anon,authenticated;

alter function private.email_workflow(text,jsonb) rename to email_workflow_before_operations;
create function private.email_workflow(action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare job private.email_jobs; result jsonb; delay_seconds integer; boundary timestamptz;
begin
  if action='email.finish' then
    select * into job from private.email_jobs j where j.id=(input->>'jobId')::uuid for update;
    if input->>'outcome'='sent' and job.id is not null and
      (job.lease_id is distinct from (input->>'leaseId')::uuid or job.state<>'processing' or job.lease_expires_at<=now()) then
      if not exists(select 1 from private.email_attempts a where a.job_id=job.id and a.lease_id=(input->>'leaseId')::uuid) then raise exception 'lease_unavailable' using errcode='40001';end if;
      if coalesce(length(input->>'providerId'),0) not between 1 and 256 or (job.provider_message_id is not null and job.provider_message_id<>input->>'providerId') then raise exception 'invalid_provider_id';end if;
      -- A receipt can arrive after cancellation/lease loss. Record it, but never
      -- reopen a revoked invitation or cancel a later referral lifecycle state.
      update private.email_jobs j set provider_message_id=input->>'providerId',
        state=case when j.state in ('cancelled','needs_review') then 'needs_review' when j.state='suppressed' then 'suppressed' else 'sent' end,
        error_code=case when j.state in ('cancelled','needs_review') then 'late_provider_acceptance' else j.error_code end,
        payload=case when j.family='referral' then j.payload else null end,prepared_payload=null,lease_id=null,lease_expires_at=null,updated_at=now() where j.id=job.id;
      if job.source_outbox_id is not null then update public.notification_outbox set provider_message_id=input->>'providerId' where id=job.source_outbox_id;end if;
      perform private.reconcile_email_events();return '{"ok":true}';
    end if;
  end if;
  result:=private.email_workflow_before_operations(action,input);
  if action='email.start' and result->'sendAllowed' is distinct from 'false'::jsonb then
    insert into private.email_attempts(job_id,lease_id) values((input->>'jobId')::uuid,(input->>'leaseId')::uuid) on conflict do nothing;
  elsif action='email.finish' and input->>'outcome'='transient' then
    delay_seconds:=greatest(0,least(coalesce((input->>'retryAfterSeconds')::integer,0),3600));
    update private.email_jobs j set due_at=greatest(j.due_at,now()+make_interval(secs=>delay_seconds)) where j.id=job.id and j.state='pending';
    select * into job from private.email_jobs j where j.id=job.id;
    boundary:=least(job.expires_at,job.first_attempt_at+interval '24 hours');
    if job.state='pending' and job.due_at>=boundary then
      update private.email_jobs j set state='needs_review',error_code='retry_window_expired',updated_at=now() where j.id=job.id;
    end if;
  end if;
  return result;
end $$;
revoke all on function private.email_workflow(text,jsonb) from public,anon,authenticated;
grant execute on function private.email_workflow(text,jsonb) to service_role;

create index email_jobs_health_page on private.email_jobs(created_at desc,id desc);
create function private.email_operations(actor uuid,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare page_limit integer:=greatest(1,least(coalesce((input->>'limit')::integer,25),50)); result jsonb;
begin
  if actor is null or not private.is_operator(actor) then raise exception 'denied' using errcode='42501';end if;
  with page as materialized (
    select j.* from private.email_jobs j where input->'cursor' is null or input->'cursor'='null'::jsonb or
      (j.created_at,j.id)<((input#>>'{cursor,createdAt}')::timestamptz,(input#>>'{cursor,id}')::uuid)
    order by j.created_at desc,j.id desc limit page_limit+1
  ), shown as (select * from page order by created_at desc,id desc limit page_limit)
  select jsonb_build_object('jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'family',j.family,'state',j.state,'attempts',j.attempts,'dueAt',j.due_at,'updatedAt',j.updated_at,
    'safeErrorCode',case when j.error_code in ('configuration_needed','recipient_suppressed','provider_delivery_failed','idempotency_window_expired','final_attempt_uncertain','retry_limit','provider_rejected','delivery_uncertain','referral_state_changed','cancelled_after_start','late_provider_acceptance','retry_window_expired') then j.error_code when j.error_code is not null then 'unknown_error' else null end,
    'delivery',private.email_delivery_summary(j.id),'recipientMasked',left(j.recipient_email,1)||'***@'||split_part(j.recipient_email,'@',2)) order by j.created_at desc,j.id desc) from shown j),'[]'::jsonb),
    'nextCursor',case when (select count(*) from page)>page_limit then (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) else null end) into result;
  return result;
end $$;
revoke all on function private.email_operations(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.email_operations(uuid,jsonb) to service_role;
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_email_operations;
alter function public.rw_workflow_before_email_operations(uuid,text,jsonb) set schema private;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action='operations.email' then return private.email_operations(p_actor,p_input);end if;
  return private.rw_workflow_before_email_operations(p_actor,p_action,p_input);
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb) to service_role;
