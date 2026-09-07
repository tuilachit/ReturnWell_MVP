-- Privileged workflow transactions; deliberately not callable by browser roles.
-- Managed Supabase does not grant service_role direct auth.users reads by
-- default. These invoker transactions need only identity + mailbox proof;
-- grant those three columns, not auth tokens, passwords or user metadata.
grant usage on schema auth to service_role;
grant select(id,email,email_confirmed_at) on auth.users to service_role;
create table private.platform_operators (
  user_id uuid primary key references auth.users(id), active boolean not null default true,
  created_at timestamptz not null default now()
);
create table private.inviter_identities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  organisation_id uuid references public.organisations(id), display_name text not null check(length(display_name) between 1 and 160),
  practice_name text not null check(length(practice_name) between 1 and 200), verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now(), active boolean not null default true,
  unique nulls not distinct(user_id,organisation_id)
);
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('doctor','practitioner')),
  organisation_id uuid references public.organisations(id),invited_by uuid not null references auth.users(id),
  inviter_name text not null,practice_name text not null,recipient_name text not null check(length(recipient_name) between 1 and 160),
  recipient_email text not null check(length(recipient_email) between 3 and 254),recipient_email_normalized text not null,
  consent_recorded_at timestamptz not null, status text not null default 'pending' check(status in ('pending','claimed','declined','revoked')),
  expires_at timestamptz not null default now()+interval '7 days',generation integer not null default 1,
  claimed_by uuid references auth.users(id),signup_completed_at timestamptz,account_was_new boolean,
  version integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(kind<>'doctor' or organisation_id is not null)
);
create unique index invitations_one_pending on public.workspace_invitations(kind,organisation_id,recipient_email_normalized) nulls not distinct where status='pending';
create index invitations_inviter on public.workspace_invitations(invited_by,created_at);
create table private.invitation_secrets (
  invitation_id uuid primary key references public.workspace_invitations(id),token_hash text unique not null check(token_hash ~ '^[a-f0-9]{64}$'),
  envelope jsonb not null,key_id text not null
);
create table private.invitation_auth_attempts (
  id uuid primary key default gen_random_uuid(),invitation_id uuid not null references public.workspace_invitations(id),generation integer not null,
  auth_user_id uuid references auth.users(id),token_type text check(token_type in ('invite','magiclink')),
  expires_at timestamptz not null default now()+interval '15 minutes',terms_version text not null,privacy_version text not null,
  created_at timestamptz not null default now(),claimed_at timestamptz,new_user boolean not null default false,
  request_id uuid not null,auth_lease_id uuid not null default gen_random_uuid(),auth_lease_expires_at timestamptz not null default now()+interval '2 minutes', unique(invitation_id,request_id)
);
create table private.invitation_events (
  id bigint generated always as identity primary key,invitation_id uuid not null references public.workspace_invitations(id),
  actor_user_id uuid references auth.users(id),kind text not null,created_at timestamptz not null default now()
);
create table private.workflow_requests (
  actor_id uuid not null references auth.users(id),request_id uuid not null,operation text not null,request_payload jsonb not null,
  response jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
create table private.email_jobs (
  id uuid primary key default gen_random_uuid(),family text not null check(family in ('invitation','auth_verification','referral')),
  related_id uuid not null,related_version integer not null,source_outbox_id uuid unique references public.notification_outbox(id),
  idempotency_key text unique not null,recipient_email text not null,payload jsonb,expires_at timestamptz,
  state text not null default 'pending' check(state in ('pending','processing','sent','paused_configuration','suppressed','cancelled','exhausted','needs_review')),
  attempts integer not null default 0 check(attempts between 0 and 5),due_at timestamptz not null default now(),
  lease_id uuid,lease_expires_at timestamptz,first_attempt_at timestamptz,provider_message_id text unique,error_code text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index email_jobs_due on private.email_jobs(due_at) where state in ('pending','processing','paused_configuration');
create table private.email_events (
  provider_event_id text primary key,provider_message_id text not null,event_type text not null,occurred_at timestamptz not null,
  matched_job_id uuid references private.email_jobs(id),received_at timestamptz not null default now()
);
create table private.email_suppressions (
  email text primary key,reason text not null check(reason in ('declined_invitation','bounce','complaint','provider_suppressed')),
  source_event text,created_at timestamptz not null default now()
);
alter table public.practitioner_users add column active boolean not null default true,add column revoked_at timestamptz;
create table private.public_token_limits(token_hash text not null,bucket timestamptz not null,hits integer not null,primary key(token_hash,bucket));

create function private.is_operator(actor uuid) returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from private.platform_operators where user_id=actor and active);
$$;
create function private.inviter(actor uuid,org uuid,invite_kind text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity_row private.inviter_identities;
begin
  if actor is null or not (private.is_operator(actor) or exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=org and active and (invite_kind='practitioner' or role in ('owner','admin')))) then
    raise exception 'denied' using errcode='42501';
  end if;
  select * into identity_row from private.inviter_identities where user_id=actor and organisation_id is not distinct from org and active;
  if not found then raise exception 'reviewed_identity_required' using errcode='42501'; end if;
  return to_jsonb(identity_row);
end $$;
-- Narrow RLS lookup: current user only. No arbitrary actor argument or clinical output.
create function private.can_use_directory() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (exists(select 1 from public.organisation_memberships m where m.user_id=auth.uid() and m.active)
    or exists(select 1 from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id where u.user_id=auth.uid() and u.active and u.revoked_at is null and p.lifecycle_status='active' and p.ahpra_verification_status='verified' and p.provider_confirmation_status='confirmed'));
$$;
create function private.owns_practitioner(practitioner uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.practitioner_users u join public.practitioners p on p.id=u.practitioner_id where u.user_id=auth.uid() and u.practitioner_id=practitioner and u.active and u.revoked_at is null and p.lifecycle_status='active' and p.ahpra_verification_status='verified' and p.provider_confirmation_status='confirmed');
$$;
grant usage on schema private to authenticated,service_role;
revoke all on function private.can_use_directory(),private.owns_practitioner(uuid) from public,anon;
grant execute on function private.can_use_directory(),private.owns_practitioner(uuid) to authenticated,service_role;
drop policy practitioners_select_verified on public.practitioners;
create policy practitioners_select_approved on public.practitioners for select to authenticated using (
  private.owns_practitioner(id) or (private.can_use_directory() and lifecycle_status='active' and ahpra_verification_status='verified' and provider_confirmation_status='confirmed' and accepting_new_referrals and contact_email is not null)
);
-- Remove the former location policy, regardless of its historical local name.
do $$ declare pol record; begin for pol in select policyname from pg_policies where schemaname='public' and tablename='practitioner_locations' loop
  execute format('drop policy %I on public.practitioner_locations',pol.policyname); end loop; end $$;
create policy locations_select_approved on public.practitioner_locations for select to authenticated using(exists(select 1 from public.practitioners p where p.id=practitioner_id));
alter table public.workspace_invitations enable row level security;
revoke all on public.workspace_invitations from public,anon,authenticated;
create policy invitations_read on public.workspace_invitations for select to authenticated using (invited_by=auth.uid() or exists(select 1 from public.organisation_memberships m where m.user_id=auth.uid() and m.organisation_id=workspace_invitations.organisation_id and m.active and m.role in ('owner','admin')));
grant select on public.workspace_invitations to authenticated;

create function private.invalidate_invitation(invitation uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  delete from private.invitation_secrets where invitation_id=invitation;
  update private.invitation_auth_attempts set expires_at=least(expires_at,now()) where invitation_id=invitation and claimed_at is null;
  update private.email_jobs set state=case when state='sent' then state else 'cancelled' end,payload=null,lease_id=null,lease_expires_at=null where related_id=invitation and family in ('invitation','auth_verification');
end $$;

create function private.invitation_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.workspace_invitations; ident jsonb; org uuid; result jsonb; attempt private.invitation_auth_attempts;
  req private.workflow_requests; clean jsonb := input - array['tokenHash','envelope','keyId']; mailbox text; existing_auth uuid;
begin
  if action='invitations.list' then
    org:=nullif(input->>'organisationId','')::uuid;
    ident:=private.inviter(actor,org,'practitioner');
    select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc),'[]'::jsonb) into result from
      (select * from public.workspace_invitations where organisation_id is not distinct from org and (private.is_operator(actor) or invited_by=actor or exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=org and active and role in ('owner','admin'))) order by created_at desc limit 100) i;
    return jsonb_build_object('invitations',result,'inviter',jsonb_build_object('displayName',ident->>'display_name','practiceName',ident->>'practice_name'));
  elsif action='invitations.preview' then
    ident:=private.inviter(actor,nullif(input->>'organisationId','')::uuid,input->>'kind');
    return jsonb_build_object('kind',input->>'kind','recipient_name',input->>'recipientName','inviter_name',ident->>'display_name','practice_name',ident->>'practice_name');
  end if;
  if action in ('invitations.create','invitations.resend','invitations.revoke') then
    if actor is null or input->>'requestId' is null then raise exception 'invalid_request'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
    select * into req from private.workflow_requests where actor_id=actor and request_id=(input->>'requestId')::uuid;
    if found then
      if req.operation<>action or req.request_payload<>clean then raise exception 'conflict' using errcode='40001'; end if;
      return req.response;
    end if;
    if action='invitations.create' then
      org:=nullif(input->>'organisationId','')::uuid;
      ident:=private.inviter(actor,org,input->>'kind');
      if input->'consentConfirmed' is distinct from 'true'::jsonb then raise exception 'consent_required'; end if;
      mailbox:=lower(trim(input->>'recipientEmail'));
      if mailbox is null or mailbox !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
      if exists(select 1 from private.email_suppressions where email=mailbox) then raise exception 'recipient_suppressed' using errcode='42501'; end if;
      if (select count(*) from public.workspace_invitations where invited_by=actor and created_at>now()-interval '1 day')>=20 then raise exception 'rate_limited' using errcode='54000'; end if;
      perform pg_advisory_xact_lock(hashtextextended('mailbox:'||mailbox,0));
      for inv in select * from public.workspace_invitations where recipient_email_normalized=mailbox and organisation_id is not distinct from org and kind=input->>'kind' and status='pending' and expires_at<=now() for update loop
        perform private.invalidate_invitation(inv.id); update public.workspace_invitations set status='revoked',version=version+1 where id=inv.id;
      end loop;
      insert into public.workspace_invitations(kind,organisation_id,invited_by,inviter_name,practice_name,recipient_name,recipient_email,recipient_email_normalized,consent_recorded_at)
        values(input->>'kind',org,actor,ident->>'display_name',ident->>'practice_name',trim(input->>'recipientName'),trim(input->>'recipientEmail'),mailbox,now()) returning * into inv;
    else
      select * into inv from public.workspace_invitations where id=(input->>'invitationId')::uuid;
      if not found then raise exception 'unavailable' using errcode='42501'; end if;
      perform private.inviter(actor,inv.organisation_id,inv.kind);
      if not (private.is_operator(actor) or inv.invited_by=actor or exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=inv.organisation_id and active and role in ('owner','admin'))) then raise exception 'denied' using errcode='42501'; end if;
      -- Global recipient limits span different practices and different actors.
      -- All invitation issuers lock mailbox before invitation to avoid cycles.
      perform pg_advisory_xact_lock(hashtextextended('mailbox:'||inv.recipient_email_normalized,0));
      select * into inv from public.workspace_invitations where id=inv.id for update;
      if action='invitations.resend' and exists(select 1 from private.email_suppressions where email=inv.recipient_email_normalized) then raise exception 'recipient_suppressed' using errcode='42501'; end if;
      if inv.version is distinct from (input->>'expectedVersion')::integer or inv.status<>'pending' or inv.expires_at<=now() then raise exception 'conflict' using errcode='40001'; end if;
      if action='invitations.resend' and ((select count(*) from private.invitation_events e join public.workspace_invitations i on i.id=e.invitation_id where i.recipient_email_normalized=inv.recipient_email_normalized and e.kind='invitations.resend' and e.created_at>now()-interval '1 day')>=3 or inv.updated_at>now()-interval '60 seconds') then raise exception 'rate_limited' using errcode='54000'; end if;
      perform private.invalidate_invitation(inv.id);
      update public.workspace_invitations set version=version+1,generation=generation+1,updated_at=now(),status=case when action='invitations.revoke' then 'revoked' else 'pending' end where id=inv.id returning * into inv;
    end if;
    if inv.status='pending' then
      insert into private.invitation_secrets values(inv.id,input->>'tokenHash',input->'envelope',input->>'keyId');
      insert into private.email_jobs(family,related_id,related_version,idempotency_key,recipient_email,payload,expires_at)
        values('invitation',inv.id,inv.generation,'invitation:'||inv.id||':'||inv.generation,inv.recipient_email,jsonb_build_object('envelope',input->'envelope','context',input->>'tokenHash','invitation',to_jsonb(inv)),inv.expires_at);
    end if;
    insert into private.invitation_events(invitation_id,actor_user_id,kind) values(inv.id,actor,action);
    result:=to_jsonb(inv);
    insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,(input->>'requestId')::uuid,action,clean,result);
    return result;
  end if;
  if action in ('invitation.inspect','invitation.begin','invitation.decline') then
    select i.* into inv from public.workspace_invitations i join private.invitation_secrets s on s.invitation_id=i.id where s.token_hash=input->>'tokenHash' for update of i;
    if not found or inv.status<>'pending' or inv.expires_at<=now() then raise exception 'invitation_unavailable' using errcode='42501'; end if;
    insert into private.public_token_limits(token_hash,bucket,hits) values(input->>'tokenHash',date_trunc('minute',now()),1)
      on conflict(token_hash,bucket) do update set hits=private.public_token_limits.hits+1 where private.public_token_limits.hits<60;
    if not found then raise exception 'rate_limited' using errcode='54000'; end if;
    if action='invitation.inspect' then
      return jsonb_build_object('invitationId',inv.id,'inviterName',inv.inviter_name,'practiceName',inv.practice_name,'recipientName',inv.recipient_name,'maskedEmail',left(inv.recipient_email,1)||'***@'||split_part(inv.recipient_email,'@',2),'kind',inv.kind,'expiresAt',inv.expires_at);
    elsif action='invitation.decline' then
      update public.workspace_invitations set status='declined',version=version+1,updated_at=now() where id=inv.id;
      insert into private.email_suppressions(email,reason) values(inv.recipient_email_normalized,'declined_invitation') on conflict do nothing;
      perform private.invalidate_invitation(inv.id);
      insert into private.invitation_events(invitation_id,kind) values(inv.id,'declined');
      return '{"ok":true}';
    else
      if input->'consentAccepted' is distinct from 'true'::jsonb or coalesce(length(input->>'termsVersion'),0)=0 or coalesce(length(input->>'privacyVersion'),0)=0 then raise exception 'consent_required'; end if;
      select * into attempt from private.invitation_auth_attempts where invitation_id=inv.id and request_id=(input->>'requestId')::uuid;
      if found then
        if attempt.terms_version is distinct from input->>'termsVersion' or attempt.privacy_version is distinct from input->>'privacyVersion' then raise exception 'conflict' using errcode='40001'; end if;
        if attempt.generation<>inv.generation or attempt.expires_at<=now() then raise exception 'invitation_unavailable'; end if;
        if attempt.auth_user_id is not null then return jsonb_build_object('alreadyRequested',true); end if;
        if attempt.auth_lease_expires_at>now() then raise exception 'rate_limited' using errcode='54000'; end if;
        update private.invitation_auth_attempts set auth_lease_id=gen_random_uuid(),auth_lease_expires_at=now()+interval '2 minutes' where id=attempt.id returning * into attempt;
        select id into existing_auth from auth.users where lower(trim(email))=inv.recipient_email_normalized;
        return jsonb_build_object('attemptId',attempt.id,'authLeaseId',attempt.auth_lease_id,'invitationId',inv.id,'email',inv.recipient_email,'existingUserId',existing_auth,'newUser',attempt.new_user);
      end if;
      if exists(select 1 from private.invitation_auth_attempts where invitation_id=inv.id and created_at>now()-interval '60 seconds') or (select count(*) from private.invitation_auth_attempts where invitation_id=inv.id and created_at>now()-interval '1 hour')>=5 then raise exception 'rate_limited' using errcode='54000'; end if;
      if exists(select 1 from private.email_suppressions where email=inv.recipient_email_normalized) then raise exception 'recipient_suppressed' using errcode='42501'; end if;
      select id into existing_auth from auth.users where lower(trim(email))=inv.recipient_email_normalized;
      insert into private.invitation_auth_attempts(invitation_id,generation,terms_version,privacy_version,request_id,new_user)
        values(inv.id,inv.generation,input->>'termsVersion',input->>'privacyVersion',(input->>'requestId')::uuid,existing_auth is null) returning * into attempt;
      return jsonb_build_object('attemptId',attempt.id,'authLeaseId',attempt.auth_lease_id,'invitationId',inv.id,'email',inv.recipient_email,'existingUserId',existing_auth,'newUser',existing_auth is null);
    end if;
  elsif action='invitation.attach_auth' then
    select * into inv from public.workspace_invitations where id=(select invitation_id from private.invitation_auth_attempts where id=(input->>'attemptId')::uuid) for update;
    select * into attempt from private.invitation_auth_attempts where id=(input->>'attemptId')::uuid for update;
    if inv.id is null or attempt.id is null or inv.status<>'pending' or inv.expires_at<=now() or attempt.expires_at<=now() or inv.generation<>attempt.generation or attempt.auth_user_id is not null or attempt.auth_lease_id is distinct from (input->>'authLeaseId')::uuid or attempt.auth_lease_expires_at<=now() then raise exception 'invitation_unavailable'; end if;
    if not exists(select 1 from auth.users where id=(input->>'authUserId')::uuid and lower(trim(email))=inv.recipient_email_normalized) then raise exception 'denied'; end if;
    update private.invitation_auth_attempts set auth_user_id=(input->>'authUserId')::uuid,token_type=input->>'tokenType' where id=attempt.id;
    insert into private.email_jobs(family,related_id,related_version,idempotency_key,recipient_email,payload,expires_at)
      values('auth_verification',inv.id,inv.generation,'verification:'||attempt.id,inv.recipient_email,jsonb_build_object('envelope',input->'envelope','context',attempt.id::text),least(inv.expires_at,attempt.expires_at));
    return '{"ok":true}';
  end if;
  raise exception 'unsupported_operation';
end $$;

create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  return private.invitation_workflow(p_actor,p_action,p_input);
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb) to service_role;
do $$ declare tbl record; begin for tbl in select tablename from pg_tables where schemaname='private' loop
  execute format('alter table private.%I enable row level security',tbl.tablename);
  execute format('revoke all on private.%I from public,anon,authenticated',tbl.tablename);
end loop; end $$;
grant all on all tables in schema private to service_role;
grant usage,select on all sequences in schema private to service_role;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
revoke execute on function private.is_operator(uuid),private.inviter(uuid,uuid,text),private.invalidate_invitation(uuid),private.invitation_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.is_operator(uuid),private.inviter(uuid,uuid,text),private.invalidate_invitation(uuid),private.invitation_workflow(uuid,text,jsonb) to service_role;
