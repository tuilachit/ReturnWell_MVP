-- Keep all credential identifiers/evidence behind independent review access.
revoke select(ahpra_registration_number) on public.practitioners from authenticated;
create function private.own_credential_summary(actor uuid,practitioner uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if actor is null or not private.practitioner_has_access(practitioner) or not exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=practitioner and u.active and u.revoked_at is null) then raise exception 'denied' using errcode='42501'; end if;
  select jsonb_build_object('eligibleForNewReferral',private.practitioner_is_eligible(practitioner,p.profession,now()),'credentials',
    coalesce((select jsonb_agg(jsonb_build_object('professionId',pp.profession_id,'authorityId',c.authority_id,'route',c.route,'status',c.status,'checkedAt',c.checked_at,'expiresAt',c.expires_at,'reviewDueAt',c.review_due_at,'policyEnabled',policy.enabled))
    from private.practitioner_professions pp join private.professional_credentials c on c.id=pp.credential_id join private.profession_policies policy on policy.profession_id=pp.profession_id where pp.practitioner_id=practitioner),'[]'::jsonb)) into result from public.practitioners p where p.id=practitioner;
  return result;
end $$;
revoke all on function private.own_credential_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function private.own_credential_summary(uuid,uuid) to service_role;
create or replace function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action='application.credentials' then return private.own_credential_summary(p_actor,(p_input->>'practitionerId')::uuid); end if;
  if p_action like 'draft.%' then return private.referral_draft_workflow(p_actor,p_action,p_input); end if;
  if p_action like 'email.%' then return private.email_workflow(p_action,p_input); end if;
  if p_action like 'referral.%' then return private.referral_workflow(p_actor,p_action,p_input); end if;
  if p_action in ('workspace.access','invitation.claim') or p_action like 'application.%' or p_action like 'review.%' then return private.application_workflow(p_actor,p_action,p_input); end if;
  return private.invitation_workflow(p_actor,p_action,p_input);
end $$;
