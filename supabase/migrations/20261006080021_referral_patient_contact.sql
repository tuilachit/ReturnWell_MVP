create table private.referral_patient_contacts (
  referral_id uuid primary key references public.referrals(id),contact jsonb not null
);
alter table private.referral_patient_contacts enable row level security;
revoke all on private.referral_patient_contacts from public,anon,authenticated,service_role;
grant select,insert on private.referral_patient_contacts to service_role;

create function private.validate_patient_contact(p jsonb,complete boolean) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text;initials text;phone text;email text;method text;
begin
  if p is null or jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x where x not in ('initials','preferredMethod','phone','email'))
    or exists(select 1 from jsonb_each(p) e where jsonb_typeof(e.value)<>'string') then raise exception 'invalid_patient_contact';end if;
  initials:=btrim(p->>'initials');phone:=btrim(p->>'phone');email:=btrim(p->>'email');method:=p->>'preferredMethod';
  if coalesce(length(p->>'initials'),0)>16 or coalesce(length(p->>'phone'),0)>32 or coalesce(length(p->>'email'),0)>254
    or coalesce(p->>'initials','') ~ '[[:digit:][:cntrl:]]'
    or (coalesce(initials,'')<>'' and initials !~ '^[[:alpha:] .''-]+$')
    or (complete and coalesce(initials,'')='') then raise exception 'invalid_patient_contact';end if;
  if (method is not null or complete) and coalesce(method,'') not in ('phone','email') then raise exception 'invalid_patient_contact';end if;
  if complete and method='phone' and coalesce(phone,'')<>'' and (phone !~ '^\+?[0-9 ().-]+$' or length(regexp_replace(phone,'[^0-9]','','g')) not between 8 and 15) then raise exception 'invalid_patient_contact';end if;
  if complete and method='email' and coalesce(email,'')<>'' and (email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
    or email like '.%' or email like '%..%' or email like '%.@%') then raise exception 'invalid_patient_contact';end if;
  if complete then
    if (method='phone' and coalesce(phone,'')='') or (method='email' and coalesce(email,'')='') then raise exception 'invalid_patient_contact';end if;
    return jsonb_build_object('initials',initials,'preferredMethod',method,
      'phone',case when method='phone' then case when phone like '+%' then '+' else '' end||regexp_replace(phone,'[^0-9]','','g') else '' end,
      'email',case when method='email' then lower(email) else '' end);
  end if;
  return p;
end $$;
alter function private.validate_referral_draft(jsonb,boolean) rename to validate_referral_draft_before_contacts;
create function private.validate_referral_draft(p jsonb,complete boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  result:=private.validate_referral_draft_before_contacts(p-'patientContact',complete);
  if p ? 'patientContact' then result:=result||jsonb_build_object('patientContact',private.validate_patient_contact(p->'patientContact',complete));end if;
  return result;
end $$;

-- Both member and directory finalisation insert from the creator-owned draft.
-- This executes in the same transaction before the invitation snapshot is taken.
create function private.capture_patient_contact() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb;
begin
  select d.input->'patientContact' into p from public.referral_drafts d where d.id=new.id and d.created_by=new.created_by and d.organisation_id=new.organisation_id;
  if p is not null then
    if auth.uid() is distinct from new.created_by then raise exception 'denied' using errcode='42501';end if;
    insert into private.referral_patient_contacts(referral_id,contact) values(new.id,private.validate_patient_contact(p,true));
  end if;
  return new;
end $$;
create trigger referrals_capture_patient_contact after insert on public.referrals for each row execute function private.capture_patient_contact();

alter function private.referral_release_digest(public.referrals) rename to referral_release_digest_before_contacts;
create function private.referral_release_digest(ref public.referrals) returns text
language sql stable security invoker set search_path='' as $$
  select case when c.contact is null then private.referral_release_digest_before_contacts(ref)
    else encode(sha256(convert_to(jsonb_build_array(private.referral_release_digest_before_contacts(ref),c.contact)::text,'UTF8')),'hex') end
  from (select (select contact from private.referral_patient_contacts where referral_id=ref.id) as contact) c;
$$;
create function private.guard_patient_contact_snapshot() returns trigger
language plpgsql security invoker set search_path='' as $$
declare ref public.referrals;
begin
  select * into ref from public.referrals where id=coalesce(new.referral_id,old.referral_id) for update;
  if ref.status='awaiting_onboarding' and exists(select 1 from private.referral_invitations g where g.referral_id=ref.id
    and g.state in ('awaiting_signup','awaiting_review') and g.release_snapshot_hash is distinct from private.referral_release_digest(ref))
    then perform private.growth_block(ref.id,'requirements_changed');end if;
  return coalesce(new,old);
end $$;
create trigger patient_contact_snapshot after insert or update or delete on private.referral_patient_contacts
  for each row execute function private.guard_patient_contact_snapshot();

create function private.referral_contact_read(actor uuid,input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ref public.referrals;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'denied' using errcode='42501';end if;
  select * into ref from public.referrals where id=(input->>'referralId')::uuid;
  if not found or not (exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active)
    or (ref.status<>'awaiting_onboarding' and exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=ref.selected_practitioner_id and u.active and u.revoked_at is null and private.practitioner_has_access(u.practitioner_id))))
    then raise exception 'denied' using errcode='42501';end if;
  return (select contact from private.referral_patient_contacts where referral_id=ref.id);
end $$;
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_patient_contacts;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_action='referral.contact.read' then return private.referral_contact_read(p_actor,p_input);end if;
  return public.rw_workflow_before_patient_contacts(p_actor,p_action,p_input);
end $$;
revoke all on function private.validate_patient_contact(jsonb,boolean),private.validate_referral_draft(jsonb,boolean),private.capture_patient_contact(),
  private.referral_release_digest(public.referrals),private.referral_release_digest_before_contacts(public.referrals),private.guard_patient_contact_snapshot(),
  private.referral_contact_read(uuid,jsonb),public.rw_workflow(uuid,text,jsonb),public.rw_workflow_before_patient_contacts(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.validate_patient_contact(jsonb,boolean),private.validate_referral_draft(jsonb,boolean),private.capture_patient_contact(),
  private.referral_release_digest(public.referrals),private.referral_release_digest_before_contacts(public.referrals),private.guard_patient_contact_snapshot(),
  private.referral_contact_read(uuid,jsonb),public.rw_workflow(uuid,text,jsonb),public.rw_workflow_before_patient_contacts(uuid,text,jsonb) to service_role;
