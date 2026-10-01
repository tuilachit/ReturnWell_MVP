-- Application owners need the public shape of enabled review routes, not the
-- independent evidence used to approve those routes. Existing ownership checks
-- run before the projection; no additional browser table grants are introduced.
alter function private.application_workflow(uuid,text,jsonb) rename to application_workflow_before_onboarding;
create function private.application_workflow(actor uuid,action text,input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  result:=private.application_workflow_before_onboarding(actor,action,input);
  if action='application.load' then
    result:=result||jsonb_build_object('professionPolicies',coalesce((
      select jsonb_agg(jsonb_build_object('professionId',profession_id,'enabled',enabled,
        'scope',catalogue_scope,'route',route,'authorityId',authority_id) order by profession_id)
      from private.profession_policies),'[]'::jsonb));
  end if;
  return result;
end $$;
revoke all on function private.application_workflow(uuid,text,jsonb),private.application_workflow_before_onboarding(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.application_workflow(uuid,text,jsonb),private.application_workflow_before_onboarding(uuid,text,jsonb) to service_role;
