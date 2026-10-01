create function private.referral_handover(actor uuid,input jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ref public.referrals; contact private.practice_contacts; practice_name text; next_action text;
begin
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  select * into ref from public.referrals where id=(input->>'referralId')::uuid;
  if not found or not (
    exists(select 1 from public.organisation_memberships where user_id=actor and organisation_id=ref.organisation_id and active)
    or (ref.status<>'awaiting_onboarding' and exists(select 1 from public.practitioner_users u where u.user_id=actor and u.practitioner_id=ref.selected_practitioner_id and u.active and u.revoked_at is null and private.practitioner_has_access(u.practitioner_id)))
  ) then raise exception 'denied' using errcode='42501'; end if;
  select name into practice_name from public.organisations where id=ref.organisation_id;
  select * into contact from private.practice_contacts where organisation_id=ref.organisation_id;
  next_action:=case ref.status
    when 'awaiting_onboarding' then 'Wait for the intended practitioner to complete signup and independent professional review. The referral has not been released.'
    when 'sent' then 'Wait for the receiving practitioner to accept or decline. A notification is not acceptance or an appointment booking.'
    when 'accepted' then 'The receiving practitioner and referring practice should agree a secure external handover channel. Arrange patient contact, appointments and payments outside ReturnWell. Acceptance does not confirm that handover has happened.'
    when 'declined' then 'The referring practice should review the reason and decide whether a new referral is needed. Do not continue handover under this declined referral.'
    when 'cancelled' then 'Do not continue handover under this cancelled referral. Its activity is retained; a new referral needs a fresh recipient choice and consent.'
    when 'closed' then 'Coordination is closed. Check the recorded outcome in activity; closure alone does not prove a consultation occurred.'
    when 'booked' then 'This is a historical booking status, not an appointment managed by ReturnWell. Confirm arrangements through your existing practice channel.'
    else 'Review the current referral status before taking further action.' end;
  if contact.organisation_id is null then next_action:=next_action||' A reviewed practice contact is not available. Contact ReturnWell support through your existing channel; do not send patient information by ordinary email.'; end if;
  return jsonb_build_object('status',ref.status,'practiceName',practice_name,'contactPhone',contact.phone,'secureInstructions',contact.instructions,'reviewedAt',contact.reviewed_at,'nextAction',next_action);
end $$;
revoke all on function private.referral_handover(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.referral_handover(uuid,jsonb) to service_role;
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_handover;
alter function public.rw_workflow_before_handover(uuid,text,jsonb) set schema private;
revoke all on function private.rw_workflow_before_handover(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.rw_workflow_before_handover(uuid,text,jsonb) to service_role;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action='referral.handover' then return private.referral_handover(p_actor,p_input); end if;
  return private.rw_workflow_before_handover(p_actor,p_action,p_input);
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb) to service_role;
