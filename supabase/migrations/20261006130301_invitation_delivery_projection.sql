-- Delivery is evidence from the authenticated webhook, not provider acceptance.
alter function private.growth_projection(public.referrals) rename to growth_projection_before_delivery_receipt;
create function private.growth_projection(ref public.referrals) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.growth_projection_before_delivery_receipt(ref)||jsonb_build_object('invitationDelivered',coalesce((
    select exists(select 1 from private.email_events e where e.matched_job_id=j.id and e.event_type='delivered') from private.referral_invitations g
      join public.workspace_invitations i on i.id=g.invitation_id
      join private.email_jobs j on j.family='invitation' and j.related_id=i.id and j.related_version=i.generation
    where g.referral_id=ref.id order by j.created_at desc,j.id desc limit 1
  ),false));
$$;
revoke all on function private.growth_projection(public.referrals),private.growth_projection_before_delivery_receipt(public.referrals) from public,anon,authenticated;
grant execute on function private.growth_projection(public.referrals),private.growth_projection_before_delivery_receipt(public.referrals) to service_role;
