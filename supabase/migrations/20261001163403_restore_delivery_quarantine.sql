-- Separate database latch survives copied worker environment configuration.
-- Activation/resumption is a reviewed restore operation, not a browser action.
create table private.delivery_quarantine(singleton boolean primary key default true check(singleton),active boolean not null default false,reason_code text,activated_at timestamptz);
insert into private.delivery_quarantine(singleton) values(true);
alter table private.delivery_quarantine enable row level security;
revoke all on private.delivery_quarantine from public,anon,authenticated,service_role;
grant select on private.delivery_quarantine to service_role;
alter function private.email_workflow(text,jsonb) rename to email_workflow_before_quarantine;
create function private.email_workflow(action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  -- Missing latch is unsafe too. Already-started transport can still record its
  -- receipt or callback; neither a restore nor this gate proves it did not send.
  if action in ('email.claim','email.start') and not exists(select 1 from private.delivery_quarantine where singleton and not active) then
    if action='email.claim' then return '[]';else return '{"sendAllowed":false}';end if;
  end if;
  return private.email_workflow_before_quarantine(action,input);
end $$;
revoke all on function private.email_workflow(text,jsonb) from public,anon,authenticated;
grant execute on function private.email_workflow(text,jsonb) to service_role;
alter function private.queue_health() rename to queue_health_before_quarantine;
create function private.queue_health() returns jsonb language sql stable security invoker set search_path='' as $$
  select private.queue_health_before_quarantine()||jsonb_build_object('quarantined',not exists(select 1 from private.delivery_quarantine where singleton and not active));
$$;
revoke all on function private.queue_health() from public,anon,authenticated;
grant execute on function private.queue_health() to service_role;
