-- Consent binds the reviewed referral content, not only a seven-day clock.
alter table private.referral_invitations add column release_snapshot_hash text
  check(release_snapshot_hash is null or release_snapshot_hash ~ '^[a-f0-9]{64}$');
create function private.referral_release_digest(ref public.referrals) returns text
language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array(ref.organisation_id,ref.created_by,
   ref.patient_reference,ref.patient_postcode,ref.profession,ref.clinical_summary,
   ref.funding_path,ref.appointment_format,ref.language_or_access,ref.preferred_language,
   ref.access_notes,ref.required_service_ids,ref.patient_age_group_id)::text,'UTF8')),'hex');
$$;
create function private.capture_release_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare ref public.referrals;
begin
 if TG_OP='INSERT' or new.generation is distinct from old.generation then
   select * into ref from public.referrals where id=new.referral_id;
   new.release_snapshot_hash:=private.referral_release_digest(ref);
 end if;
 return new;
end $$;
create trigger referral_invitation_capture_snapshot before insert or update of generation on private.referral_invitations
  for each row execute function private.capture_release_snapshot();
create function private.guard_release_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='awaiting_onboarding' and exists(select 1 from private.referral_invitations g where g.referral_id=new.id
   and g.state in ('awaiting_signup','awaiting_review') and g.release_snapshot_hash is distinct from private.referral_release_digest(new)) then
   perform private.growth_block(new.id,'requirements_changed');
 end if;
 return new;
end $$;
create trigger referrals_guard_release_snapshot after update on public.referrals for each row execute function private.guard_release_snapshot();
-- Never backfill a claim that older pending content was reviewed. A doctor can
-- explicitly reconfirm it; historical released associations remain unchanged.
do $$ declare pending record;begin
 for pending in select referral_id from private.referral_invitations where state in ('awaiting_signup','awaiting_review') and release_snapshot_hash is null loop
   perform private.growth_block(pending.referral_id,'requirements_changed');
 end loop;
end $$;
revoke all on function private.referral_release_digest(public.referrals),private.capture_release_snapshot(),private.guard_release_snapshot() from public,anon,authenticated,service_role;
grant execute on function private.referral_release_digest(public.referrals) to service_role;
