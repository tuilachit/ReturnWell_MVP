-- Fixed-size aggregate signals: no request bodies, clinical values or user IDs.
create table private.operational_signals(event text primary key check(event in ('dispatch_started','dispatch_completed','dispatch_failed','webhook_persist_failed')),observed_at timestamptz not null default now(),window_started_at timestamptz not null default now(),window_count integer not null default 1);
alter table private.operational_signals enable row level security;
revoke all on private.operational_signals from public,anon,authenticated;
grant select,insert,update on private.operational_signals to service_role;
create function private.queue_health() returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'pendingCount',count(*) filter(where state in ('pending','processing')),
    'oldestPendingSeconds',coalesce(greatest(0,extract(epoch from now()-min(due_at) filter(where state in ('pending','processing')))),0),
    'authOverdueCount',count(*) filter(where family='auth_verification' and state in ('pending','processing') and due_at<now()-interval '2 minutes'),
    'needsReviewCount',count(*) filter(where state='needs_review'),
    'failedCount',count(*) filter(where state='exhausted'),
    'pausedCount',count(*) filter(where state='paused_configuration'),
    'lastDispatchAt',(select observed_at from private.operational_signals where event='dispatch_completed'),
    'webhookFailureCount',coalesce((select window_count from private.operational_signals where event='webhook_persist_failed' and window_started_at>now()-interval '5 minutes'),0))
  from private.email_jobs;
$$;
revoke all on function private.queue_health() from public,anon,authenticated;
grant execute on function private.queue_health() to service_role;
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_signals;
alter function public.rw_workflow_before_signals(uuid,text,jsonb) set schema private;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_action='operations.record' then
    if p_actor is not null then raise exception 'denied' using errcode='42501';end if;
    if coalesce(p_input->>'event','') not in ('dispatch_started','dispatch_completed','dispatch_failed','webhook_persist_failed') then raise exception 'invalid_request';end if;
    insert into private.operational_signals(event) values(p_input->>'event') on conflict(event) do update set observed_at=now(),
      window_count=case when private.operational_signals.window_started_at>now()-interval '5 minutes' then least(private.operational_signals.window_count+1,1000000) else 1 end,
      window_started_at=case when private.operational_signals.window_started_at>now()-interval '5 minutes' then private.operational_signals.window_started_at else now() end;
    return '{"ok":true}';
  end if;
  result:=private.rw_workflow_before_signals(p_actor,p_action,p_input);
  -- The delegated view already enforced current operator status.
  if p_action='operations.email' then result:=result||jsonb_build_object('health',private.queue_health());end if;
  return result;
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb) to service_role;
