-- Service-only administration. HTTP verifies MFA; transactions independently
-- enforce current operator authority, separate reviewer and current versions.
alter table public.organisations add column version integer not null default 0;
alter table public.organisation_memberships add column version integer not null default 0;
create table private.practice_contacts (
  organisation_id uuid primary key references public.organisations(id),
  phone text, email text, instructions text,
  evidence_reference text not null check(length(evidence_reference) between 1 and 500),
  reviewed_by uuid not null references auth.users(id), reviewed_at timestamptz not null default now(),
  check(coalesce(length(phone),0)<=60 and coalesce(length(email),0)<=254 and coalesce(length(instructions),0)<=1000),
  check(phone is not null or instructions is not null)
);
create table private.practice_member_reviews (
  member_id bigint primary key references public.organisation_memberships(id),
  reviewed_by uuid not null references auth.users(id), reviewed_at timestamptz not null default now(),
  evidence_reference text not null check(length(evidence_reference) between 1 and 500)
);
create table private.practice_admin_events (
  id bigint generated always as identity primary key, organisation_id uuid not null references public.organisations(id),
  actor_id uuid not null references auth.users(id), kind text not null, snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.practice_contacts enable row level security;
alter table private.practice_member_reviews enable row level security;
alter table private.practice_admin_events enable row level security;
revoke all on private.practice_contacts,private.practice_member_reviews,private.practice_admin_events from public,anon,authenticated;
grant select,insert,update on private.practice_contacts to service_role;
grant select,insert on private.practice_member_reviews,private.practice_admin_events to service_role;
grant usage,select on sequence private.practice_admin_events_id_seq to service_role;

create function private.practice_workflow(actor uuid,action text,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid; v_owner uuid; v_member public.organisation_memberships; v_practice public.organisations;
  v_request uuid; prior private.workflow_requests; result jsonb; v_name text; v_evidence text;
  v_phone text; v_email text; v_instructions text; v_reason text; v_member_id bigint;
begin
  if actor is null or not private.is_operator(actor) or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'denied' using errcode='42501'; end if;
  if action='practice.list' then
    v_org:=nullif(input->>'organisationId','')::uuid;
    with scope as materialized (
      select o.* from public.organisations o where (v_org is null or o.id=v_org)
        and (nullif(input->>'cursor','') is null or o.id>(input->>'cursor')::uuid) order by o.id limit 26
    ), page as materialized(select * from scope order by id limit 25)
    select jsonb_build_object('nextCursor',case when (select count(*) from scope)>25 then (select id from page order by id desc limit 1) end,
      'practices',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'version',o.version,
        'contact',(select jsonb_build_object('phone',c.phone,'email',c.email,'instructions',c.instructions,'reviewedAt',c.reviewed_at) from private.practice_contacts c where c.organisation_id=o.id),
        'members',case when v_org is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(m) order by m.id::bigint) from (
          select m.id::text as id,m.user_id as "userId",u.email,m.role,m.active,m.version,i.display_name as "inviterName"
          from public.organisation_memberships m join auth.users u on u.id=m.user_id
          left join private.inviter_identities i on i.user_id=m.user_id and i.organisation_id=m.organisation_id and i.active
          where m.organisation_id=o.id and m.id>coalesce((input->>'memberCursor')::bigint,0) order by m.id limit 50
        ) m),'[]'::jsonb) end,
        'nextMemberCursor',case when v_org is not null and (select count(*) from (select 1 from public.organisation_memberships m where m.organisation_id=o.id and m.id>coalesce((input->>'memberCursor')::bigint,0) limit 51) n)>50
          then (select m.id::text from public.organisation_memberships m where m.organisation_id=o.id and m.id>coalesce((input->>'memberCursor')::bigint,0) order by m.id offset 49 limit 1) end
      ) order by o.id) from page o),'[]'::jsonb)) into result;
    return result;
  end if;
  if action not in ('practice.create','practice.reviewContact','practice.reviewInviter','practice.revokeMember') then raise exception 'invalid_request'; end if;
  v_request:=(input->>'requestId')::uuid;
  if v_request is null then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into prior from private.workflow_requests where actor_id=actor and request_id=v_request;
  if found then
    if prior.operation<>action or prior.request_payload<>input then raise exception 'conflict'; end if;
    return prior.response;
  end if;
  v_evidence:=nullif(trim(input->>'evidenceReference'),'');
  if action<>'practice.revokeMember' and (v_evidence is null or length(v_evidence)>500) then raise exception 'evidence_required'; end if;
  if action='practice.create' then
    v_name:=trim(input->>'name'); v_owner:=(input->>'ownerUserId')::uuid;
    if coalesce(length(v_name),0) not between 1 and 160 then raise exception 'invalid_request'; end if;
    if v_owner=actor then raise exception 'denied'; end if;
    if not exists(select 1 from auth.users where id=v_owner and email_confirmed_at is not null) then raise exception 'verified_owner_required'; end if;
    insert into public.organisations(name,created_by) values(v_name,actor) returning id into v_org;
    insert into public.organisation_memberships(organisation_id,user_id,role) values(v_org,v_owner,'owner') returning id into v_member_id;
    insert into private.practice_member_reviews(member_id,reviewed_by,evidence_reference) values(v_member_id,actor,v_evidence);
    result:=jsonb_build_object('organisationId',v_org,'version',0);
  else
    v_org:=(input->>'organisationId')::uuid;
    select * into v_practice from public.organisations where id=v_org for update;
    if not found then raise exception 'denied'; end if;
    if action='practice.reviewContact' then
      -- A reviewer cannot independently attest their own practice's contact.
      if exists(select 1 from public.organisation_memberships where organisation_id=v_org and user_id=actor and active) then raise exception 'denied'; end if;
      if v_practice.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict'; end if;
      v_phone:=nullif(trim(input->>'contactPhone'),''); v_email:=nullif(lower(trim(input->>'contactEmail')),''); v_instructions:=nullif(trim(input->>'secureInstructions'),'');
      if (v_phone is null and v_instructions is null) or coalesce(length(v_phone),0)>60 or coalesce(length(v_email),0)>254 or coalesce(length(v_instructions),0)>1000
        or (v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{5,60}$')
        or (v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'invalid_request'; end if;
      insert into private.practice_contacts(organisation_id,phone,email,instructions,evidence_reference,reviewed_by)
        values(v_org,v_phone,v_email,v_instructions,v_evidence,actor)
        on conflict(organisation_id) do update set phone=excluded.phone,email=excluded.email,instructions=excluded.instructions,evidence_reference=excluded.evidence_reference,reviewed_by=actor,reviewed_at=now();
      update public.organisations set notification_email=v_email,version=version+1,updated_at=now() where id=v_org returning version into v_practice.version;
      result:=jsonb_build_object('ok',true,'version',v_practice.version);
    else
      select * into v_member from public.organisation_memberships where id=(input->>'memberId')::bigint and organisation_id=v_org for update;
      if not found then raise exception 'denied'; end if;
      if action='practice.reviewInviter' then
        if actor=v_member.user_id or not v_member.active then raise exception 'denied'; end if;
        if v_practice.version is distinct from (input->>'expectedVersion')::integer then raise exception 'conflict'; end if;
        if not exists(select 1 from auth.users where id=v_member.user_id and email_confirmed_at is not null) then raise exception 'verified_owner_required'; end if;
        v_name:=trim(input->>'displayName');
        if coalesce(length(v_name),0) not between 1 and 160 then raise exception 'invalid_request'; end if;
        insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by)
          values(v_member.user_id,v_org,v_name,v_practice.name,actor)
          on conflict(user_id,organisation_id) do update set display_name=excluded.display_name,practice_name=excluded.practice_name,verified_by=actor,verified_at=now(),active=true;
        update public.organisations set version=version+1,updated_at=now() where id=v_org returning version into v_practice.version;
        result:=jsonb_build_object('ok',true,'version',v_practice.version);
      else
        if v_member.version is distinct from (input->>'expectedVersion')::integer or not v_member.active then raise exception 'conflict'; end if;
        v_reason:=trim(input->>'reason');
        if coalesce(length(v_reason),0) not between 1 and 500 then raise exception 'invalid_request'; end if;
        if v_member.role='owner' and not exists(select 1 from public.organisation_memberships m join private.practice_member_reviews r on r.member_id=m.id
          where m.organisation_id=v_org and m.id<>v_member.id and m.role='owner' and m.active and r.reviewed_by<>m.user_id) then raise exception 'last_owner'; end if;
        update public.organisation_memberships set active=false,version=version+1 where id=v_member.id returning version into v_member.version;
        update private.inviter_identities set active=false where organisation_id=v_org and user_id=v_member.user_id;
        with revoked as (
          update public.workspace_invitations set status='revoked',version=version+1,updated_at=now() where organisation_id=v_org and invited_by=v_member.user_id and status='pending' returning id
        ) insert into private.invitation_events(invitation_id,actor_user_id,kind) select id,actor,'revoked' from revoked;
        update private.email_jobs j set state='cancelled',lease_id=null,lease_expires_at=null,updated_at=now()
          where family in ('invitation','auth_verification') and state not in ('sent','cancelled','suppressed') and exists(select 1 from public.workspace_invitations i where i.id=j.related_id and i.organisation_id=v_org and i.invited_by=v_member.user_id and i.status='revoked');
        result:=jsonb_build_object('ok',true,'version',v_member.version);
      end if;
    end if;
  end if;
  insert into private.practice_admin_events(organisation_id,actor_id,kind,snapshot) values(v_org,actor,action,input-'requestId');
  insert into private.workflow_requests(actor_id,request_id,operation,request_payload,response) values(actor,v_request,action,input,result);
  return result;
end $$;
revoke all on function private.practice_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.practice_workflow(uuid,text,jsonb) to service_role;

-- Preserve the previous dispatcher; no public alternate entry point is exposed.
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_practice;
alter function public.rw_workflow_before_practice(uuid,text,jsonb) set schema private;
revoke all on function private.rw_workflow_before_practice(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.rw_workflow_before_practice(uuid,text,jsonb) to service_role;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action like 'practice.%' then return private.practice_workflow(p_actor,p_action,p_input); end if;
  return private.rw_workflow_before_practice(p_actor,p_action,p_input);
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb) to service_role;
