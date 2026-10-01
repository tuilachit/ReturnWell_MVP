-- The existing non-null client timestamp is the consent acknowledgement,
-- not an authoritative clock. Keep old clients compatible while recording
-- the server's receipt time. Missing acknowledgement must still fail.
create function private.stamp_referral_consent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.consent_confirmed_at is null then
    raise exception 'consent_required' using errcode = '23502';
  end if;
  new.consent_confirmed_at := now();
  return new;
end;
$$;

create trigger referrals_stamp_consent
before insert on public.referrals
for each row execute function private.stamp_referral_consent();

revoke all on function private.stamp_referral_consent()
  from public, anon, authenticated, service_role;

comment on column public.referrals.consent_confirmed_at is
  'Server receipt time of the referrer consent acknowledgement; not the patient consent event time. Historical rows are unchanged.';
