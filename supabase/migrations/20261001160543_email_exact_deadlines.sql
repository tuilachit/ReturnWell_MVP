-- Service-only auth generation gets the real deadline, including resumed leases.
alter function private.invitation_workflow(uuid,text,jsonb) rename to invitation_workflow_before_email_deadlines;
create function private.invitation_workflow(actor uuid,action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; deadline timestamptz;
begin
  result:=private.invitation_workflow_before_email_deadlines(actor,action,input);
  if action='invitation.begin' and result->>'attemptId' is not null then
    select least(a.expires_at,i.expires_at) into deadline from private.invitation_auth_attempts a join public.workspace_invitations i on i.id=a.invitation_id where a.id=(result->>'attemptId')::uuid;
    result:=result||jsonb_build_object('expiresAt',deadline);
  end if;
  return result;
end $$;
revoke execute on function private.invitation_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.invitation_workflow(uuid,text,jsonb) to service_role;
