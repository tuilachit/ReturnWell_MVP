-- Current authority is required even when an old request has a stored response.
-- Keep the old direct-read scope: own invitations or active practice admins.
create function private.can_read_invitation(inviter uuid, organisation uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    (inviter=auth.uid() and (private.is_operator(auth.uid()) or exists(
      select 1 from public.organisation_memberships m where m.user_id=auth.uid() and m.organisation_id=organisation and m.active
    ))) or exists(
      select 1 from public.organisation_memberships m where m.user_id=auth.uid() and m.organisation_id=organisation and m.active and m.role in ('owner','admin')
    )
  );
$$;
revoke all on function private.can_read_invitation(uuid,uuid) from public,anon;
grant execute on function private.can_read_invitation(uuid,uuid) to authenticated,service_role;
drop policy invitations_read on public.workspace_invitations;
create policy invitations_read on public.workspace_invitations for select to authenticated
  using (private.can_read_invitation(invited_by,organisation_id));

alter function private.invitation_workflow(uuid,text,jsonb) rename to invitation_workflow_before_current_authority;
create function private.invitation_workflow(actor uuid,action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.workspace_invitations;
begin
  if action='invitations.create' then
    perform private.inviter(actor,nullif(input->>'organisationId','')::uuid,input->>'kind');
  elsif action in ('invitations.resend','invitations.revoke') then
    select * into inv from public.workspace_invitations where id=(input->>'invitationId')::uuid;
    if not found then raise exception 'denied' using errcode='42501'; end if;
    perform private.inviter(actor,inv.organisation_id,inv.kind);
    if not (private.is_operator(actor) or inv.invited_by=actor or exists(
      select 1 from public.organisation_memberships m where m.user_id=actor and m.organisation_id=inv.organisation_id and m.active and m.role in ('owner','admin')
    )) then raise exception 'denied' using errcode='42501'; end if;
  end if;
  return private.invitation_workflow_before_current_authority(actor,action,input);
end $$;
revoke all on function private.invitation_workflow(uuid,text,jsonb),private.invitation_workflow_before_current_authority(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.invitation_workflow(uuid,text,jsonb),private.invitation_workflow_before_current_authority(uuid,text,jsonb) to service_role;
