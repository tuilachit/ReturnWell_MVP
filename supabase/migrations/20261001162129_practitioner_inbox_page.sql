-- Assignment history remains readable while intake is paused/credential expires;
-- current ownership and explicit access suspension are checked on every page.
create index referrals_assignee_page on public.referrals(selected_practitioner_id,status,created_at desc,id desc);
create function private.practitioner_inbox_page(actor uuid,input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare pid uuid:=(input->>'practitionerId')::uuid; status_filter text:=coalesce(input->>'status','sent');
  page_limit integer:=greatest(1,least(coalesce((input->>'limit')::integer,25),50)); fingerprint text; cursor_value jsonb; result jsonb;
begin
  if actor is null or not private.practitioner_has_access(pid) or not exists(select 1 from public.practitioner_users where practitioner_id=pid and user_id=actor and active and revoked_at is null) then raise exception 'denied' using errcode='42501';end if;
  if status_filter not in ('sent','accepted','declined','cancelled','closed','booked') then raise exception 'invalid_request';end if;
  fingerprint:=md5(jsonb_build_object('actor',actor,'practitioner',pid,'status',status_filter)::text);
  cursor_value:=private.read_page_cursor(input->>'cursor',fingerprint);
  if cursor_value is not null then begin perform (cursor_value->>'key')::timestamptz;exception when others then raise exception 'invalid_cursor';end;end if;
  with page as materialized (
    select id,reference,patient_reference,status,version,created_at from public.referrals
    where selected_practitioner_id=pid and status=status_filter and (cursor_value is null or (created_at,id)<((cursor_value->>'key')::timestamptz,(cursor_value->>'id')::uuid))
    order by created_at desc,id desc limit page_limit+1
  ), shown as (select * from page order by created_at desc,id desc limit page_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
    'total',(select count(*) from public.referrals where selected_practitioner_id=pid and status=status_filter),
    'nextCursor',case when (select count(*) from page)>page_limit then (select private.page_cursor(fingerprint,created_at::text,id) from shown order by created_at,id limit 1) else null end) into result;
  return result;
end $$;
revoke all on function private.practitioner_inbox_page(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.practitioner_inbox_page(uuid,jsonb) to service_role;
alter function public.rw_workflow(uuid,text,jsonb) rename to rw_workflow_before_inbox;
alter function public.rw_workflow_before_inbox(uuid,text,jsonb) set schema private;
create function public.rw_workflow(p_actor uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action='referral.inbox' then return private.practitioner_inbox_page(p_actor,p_input);end if;
  return private.rw_workflow_before_inbox(p_actor,p_action,p_input);
end $$;
revoke all on function public.rw_workflow(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rw_workflow(uuid,text,jsonb) to service_role;
