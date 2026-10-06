-- A post-commit request may lease only the selected notification family/record.
-- All transport remains outside Postgres, using the existing prepare/start/finish.
alter function private.email_workflow(text,jsonb) rename to email_workflow_before_scope;
create function private.email_workflow(action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare scope_family text:=input#>>'{scope,family}';related uuid;result jsonb;job private.email_jobs;inv public.workspace_invitations;
begin
  if action='email.start' then
    select * into job from private.email_jobs where id=(input->>'jobId')::uuid;
    if job.family='invitation' then
      select * into inv from public.workspace_invitations where id=job.related_id;
      if inv.directory_route_id is not null and not exists(select 1 from private.directory_contact_routes r where r.id=inv.directory_route_id and private.directory_route_current(r.id,r.candidate_id,r.observation_hash)) then
        update private.email_jobs set state='cancelled',payload=null,prepared_payload=null,lease_id=null,lease_expires_at=null,error_code='directory_source_changed' where id=job.id and lease_id=(input->>'leaseId')::uuid and state='processing';
        return '{"sendAllowed":false}';
      end if;
    end if;
  end if;
  if action<>'email.claimScoped' then return private.email_workflow_before_scope(action,input);end if;
  if jsonb_typeof(input->'scope') is distinct from 'object' or scope_family not in ('invitation','referral') or scope_family is null
    or not(input->'scope' ?& array['family','relatedId']) or (select count(*) from jsonb_object_keys(input->'scope'))<>2 then raise exception 'invalid_request';end if;
  related:=(input#>>'{scope,relatedId}')::uuid;
  if related is null then raise exception 'invalid_request';end if;
  if not exists(select 1 from private.delivery_quarantine where singleton and not active) then return '[]';end if;
  perform private.reconcile_email_events();
  update private.email_jobs j set state='needs_review',error_code='idempotency_window_expired',lease_id=null,lease_expires_at=null
    where j.family=scope_family and j.related_id=related and j.state in ('pending','processing','paused_configuration') and j.first_attempt_at<=now()-interval '24 hours';
  update private.email_jobs j set state='needs_review',error_code='final_attempt_uncertain',lease_id=null,lease_expires_at=null
    where j.family=scope_family and j.related_id=related and j.state='processing' and j.lease_expires_at<=now() and j.attempts>=5;
  if input->'configured' is distinct from 'true'::jsonb then
    update private.email_jobs j set state='paused_configuration',error_code='configuration_needed'
      where j.family=scope_family and j.related_id=related and j.state='pending';
    return '[]';
  end if;
  with due as (
    select j.id from private.email_jobs j where j.family=scope_family and j.related_id=related
      and ((j.state in ('pending','paused_configuration') and j.due_at<=now()) or (j.state='processing' and j.lease_expires_at<=now()))
      and j.attempts<5 and (j.expires_at is null or j.expires_at>now())
      and not exists(select 1 from private.email_suppressions s where s.email=j.recipient_email and (s.reason<>'declined_invitation' or j.family<>'referral'))
      and ((j.family='invitation' and exists(select 1 from public.workspace_invitations i where i.id=j.related_id and i.status='pending' and i.generation=j.related_version and i.expires_at>now()
        and (i.directory_route_id is null or exists(select 1 from private.directory_contact_routes r where r.id=i.directory_route_id and private.directory_route_current(r.id,r.candidate_id,r.observation_hash)))))
        or (j.family='referral' and exists(select 1 from public.referrals r join public.notification_outbox o on o.referral_id=r.id where r.id=j.related_id and o.id=j.source_outbox_id and private.referral_notice_current(r.status,o.kind))))
      order by j.created_at,j.id for update of j skip locked limit 1
  ), claimed as (
    update private.email_jobs j set state='processing',lease_id=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now() from due where due.id=j.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
  return result;
exception when invalid_text_representation then raise exception 'invalid_request';
end $$;
revoke all on function private.email_workflow(text,jsonb),private.email_workflow_before_scope(text,jsonb) from public,anon,authenticated;
grant execute on function private.email_workflow(text,jsonb),private.email_workflow_before_scope(text,jsonb) to service_role;

create function private.decorate_directory_invitation() returns trigger language plpgsql security invoker set search_path='' as $$
declare practice text;
begin
  if new.family='invitation' then
    select o.record#>>'{practiceNames,0}' into practice from public.workspace_invitations i
      join private.directory_contact_routes r on r.id=i.directory_route_id join private.candidate_observations o on o.id=r.observation_id where i.id=new.related_id;
    if practice is not null then new.payload:=jsonb_set(new.payload,'{invitation}',(new.payload->'invitation')||jsonb_build_object('directory_referral',true,'referral_practice_name',practice));end if;
  end if;
  return new;
end $$;
create trigger email_jobs_directory_purpose before insert on private.email_jobs for each row execute function private.decorate_directory_invitation();
update private.email_jobs j set payload=jsonb_set(j.payload,'{invitation}',(j.payload->'invitation')||jsonb_build_object('directory_referral',true,'referral_practice_name',o.record#>>'{practiceNames,0}'))
  from public.workspace_invitations i join private.directory_contact_routes r on r.id=i.directory_route_id join private.candidate_observations o on o.id=r.observation_id
  where j.family='invitation' and j.related_id=i.id and j.payload is not null and j.prepared_payload is null and j.attempts=0;
revoke all on function private.decorate_directory_invitation() from public,anon,authenticated;
grant execute on function private.decorate_directory_invitation() to service_role;

alter function private.growth_projection(public.referrals) rename to growth_projection_before_delivery;
create function private.growth_projection(ref public.referrals) returns jsonb language sql stable security invoker set search_path='' as $$
  select private.growth_projection_before_delivery(ref)||jsonb_build_object('invitationNotification',coalesce((select j.state from private.referral_invitations g
    join public.workspace_invitations i on i.id=g.invitation_id join private.email_jobs j on j.related_id=i.id and j.family='invitation' and j.related_version=i.generation
    where g.referral_id=ref.id order by j.created_at desc limit 1),'not_queued'));
$$;
revoke all on function private.growth_projection(public.referrals),private.growth_projection_before_delivery(public.referrals) from public,anon,authenticated;
grant execute on function private.growth_projection(public.referrals),private.growth_projection_before_delivery(public.referrals) to service_role;
