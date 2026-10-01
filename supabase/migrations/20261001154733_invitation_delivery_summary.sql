-- Private, read-only projections; callers must first authorise the parent record.
create index email_jobs_related_generation on private.email_jobs(family,related_id,related_version,created_at desc);
create index email_events_job_kind on private.email_events(matched_job_id,event_type);
create function private.email_delivery_summary(job_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare job private.email_jobs; state text; event_time timestamptz;
begin
  select * into job from private.email_jobs where id=job_id;
  if not found then return jsonb_build_object('state','unknown','updatedAt',null,'nextRetryAt',null); end if;
  select case
    when bool_or(e.event_type in ('bounced','complained','suppressed')) then 'suppressed'
    when bool_or(e.event_type='failed') then 'failed'
    when bool_or(e.event_type='delivered') then 'delivered'
    when bool_or(e.event_type='delivery_delayed') then 'delayed'
    else null end into state from private.email_events e where e.matched_job_id=job.id;
  if job.state='suppressed' then state:='suppressed'; end if;
  select max(e.occurred_at) into event_time from private.email_events e where e.matched_job_id=job.id and
    (case state when 'suppressed' then e.event_type in ('bounced','complained','suppressed') when 'failed' then e.event_type='failed' when 'delivered' then e.event_type='delivered' when 'delayed' then e.event_type='delivery_delayed' else false end);
  state:=coalesce(state,case job.state when 'pending' then 'pending' when 'processing' then 'pending' when 'sent' then 'sent' when 'paused_configuration' then 'configuration_needed' when 'exhausted' then 'failed' when 'needs_review' then 'needs_review' when 'cancelled' then 'cancelled' else 'unknown' end);
  return jsonb_build_object('state',state,'updatedAt',coalesce(event_time,job.updated_at),'nextRetryAt',case when job.state='pending' and job.attempts>0 then job.due_at else null end);
end $$;
create function private.invitation_progress(invitation_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('invitationId',i.id,'status',i.status,'expiresAt',i.expires_at,'generation',i.generation,
    'signupCompletedAt',i.signup_completed_at,'accountWasNew',i.account_was_new,
    'delivery',private.email_delivery_summary((select j.id from private.email_jobs j where j.family='invitation' and j.related_id=i.id and j.related_version=i.generation order by j.created_at desc limit 1)))
  from public.workspace_invitations i where i.id=invitation_id;
$$;
alter function private.invitation_workflow(uuid,text,jsonb) rename to invitation_workflow_before_progress;
create function private.invitation_workflow(actor uuid,action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  result:=private.invitation_workflow_before_progress(actor,action,input);
  if action='invitations.list' then
    result:=jsonb_set(result,'{invitations}',coalesce((select jsonb_agg(row.value||jsonb_build_object('progress',private.invitation_progress((row.value->>'id')::uuid)) order by row.ordinality) from jsonb_array_elements(result->'invitations') with ordinality as row(value,ordinality)),'[]'::jsonb));
  end if;
  return result;
end $$;
revoke execute on function private.email_delivery_summary(uuid),private.invitation_progress(uuid),private.invitation_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.email_delivery_summary(uuid),private.invitation_progress(uuid),private.invitation_workflow(uuid,text,jsonb) to service_role;
