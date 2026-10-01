create index invitation_attempts_account_recovery on private.invitation_auth_attempts(auth_user_id,created_at desc) where auth_user_id is not null;
alter function private.invitation_workflow(uuid,text,jsonb) rename to invitation_workflow_before_recovery;
create function private.invitation_workflow(actor uuid,action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if action<>'invitation.recovery' then return private.invitation_workflow_before_recovery(actor,action,input); end if;
  if actor is null then raise exception 'denied' using errcode='42501'; end if;
  -- No link credential, email override, account creation or implicit claim.
  -- An existing authenticated mailbox owner may finish their own live attempt.
  select coalesce(jsonb_agg(x.projection order by x.created_at desc),'[]'::jsonb) into result from (
    select jsonb_build_object('invitationId',i.id,'attemptId',a.id,'practiceName',i.practice_name,
      'expiresAt',least(a.expires_at,i.expires_at),'claimed',a.claimed_at is not null) as projection,a.created_at
    from private.invitation_auth_attempts a
    join public.workspace_invitations i on i.id=a.invitation_id
    join auth.users u on u.id=actor and u.email_confirmed_at is not null and lower(trim(u.email))=i.recipient_email_normalized
    where a.auth_user_id=actor and a.token_type is not null and i.generation=a.generation
      and (nullif(input->>'invitationId','') is null or i.id=(input->>'invitationId')::uuid)
      and (nullif(input->>'attemptId','') is null or a.id=(input->>'attemptId')::uuid)
      and ((i.status='pending' and i.expires_at>now() and a.expires_at>now() and a.claimed_at is null)
        or (i.status='claimed' and i.claimed_by=actor and a.claimed_at>now()-interval '1 day'))
    order by a.created_at desc,a.id limit 10
  ) x;
  return jsonb_build_object('attempts',result);
end $$;
revoke execute on function private.invitation_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.invitation_workflow(uuid,text,jsonb) to service_role;
