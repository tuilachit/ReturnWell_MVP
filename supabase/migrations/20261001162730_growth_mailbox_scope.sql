-- Referral membership permits progress, not broader invitation mailbox access.
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_mailbox_scope;
alter function public.rw_workflow_before_mailbox_scope(uuid,text,jsonb) set schema private;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; inv public.workspace_invitations;
begin
  result:=private.rw_workflow_before_mailbox_scope(p_actor,p_action,p_input);
  if p_actor is not null and p_action like 'growth.%' and result ? 'recipientEmail' then
    select * into inv from public.workspace_invitations where id=(result->>'invitationId')::uuid;
    if inv.id is not null and inv.invited_by<>p_actor and not private.is_operator(p_actor) and not exists(select 1 from public.organisation_memberships where user_id=p_actor and organisation_id=inv.organisation_id and active and role in ('owner','admin')) then
      result:=jsonb_set(result,'{recipientEmail}',to_jsonb(left(inv.recipient_email,1)||'***@'||split_part(inv.recipient_email,'@',2)));
    end if;
  end if;
  return result;
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb) to service_role;
