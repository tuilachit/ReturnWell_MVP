create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  abn text check (abn is null or abn ~ '^[0-9]{11}$'),
  notification_email text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisation_memberships (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'referrer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index organisation_memberships_user_organisation_idx
  on public.organisation_memberships (user_id, organisation_id);
create index organisation_memberships_organisation_active_idx
  on public.organisation_memberships (organisation_id, active);

create table public.practitioners (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 160),
  profession text not null check (profession in ('physiotherapist', 'psychologist')),
  practice_name text not null check (char_length(practice_name) between 1 and 200),
  contact_email text,
  lifecycle_status text not null default 'candidate'
    check (lifecycle_status in ('candidate', 'active', 'inactive')),
  ahpra_registration_number text,
  ahpra_verification_status text not null default 'not_checked'
    check (ahpra_verification_status in ('not_checked', 'verified', 'failed')),
  ahpra_verified_at timestamptz,
  provider_confirmation_status text not null default 'not_contacted'
    check (provider_confirmation_status in ('not_contacted', 'confirmed', 'declined')),
  provider_confirmed_at timestamptz,
  accepting_new_referrals boolean,
  telehealth boolean,
  services text[] not null default '{}',
  funding text[] not null default '{}',
  languages text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practitioners_verified_fields_check check (
    ahpra_verification_status <> 'verified'
    or (ahpra_registration_number is not null and ahpra_verified_at is not null)
  ),
  constraint practitioners_confirmed_fields_check check (
    provider_confirmation_status <> 'confirmed'
    or provider_confirmed_at is not null
  ),
  constraint practitioners_active_trust_check check (
    lifecycle_status <> 'active'
    or (
      ahpra_verification_status = 'verified'
      and provider_confirmation_status = 'confirmed'
      and accepting_new_referrals is not null
    )
  )
);

create index practitioners_verified_profession_idx
  on public.practitioners (profession, updated_at desc)
  where lifecycle_status = 'active'
    and ahpra_verification_status = 'verified'
    and provider_confirmation_status = 'confirmed'
    and accepting_new_referrals is true;

create table public.practitioner_locations (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioners (id) on delete cascade,
  suburb text not null,
  postcode text not null check (postcode ~ '^[0-9]{4}$'),
  state text not null default 'NSW' check (state = 'NSW'),
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index practitioner_locations_practitioner_idx
  on public.practitioner_locations (practitioner_id);
create index practitioner_locations_postcode_idx
  on public.practitioner_locations (postcode, practitioner_id);
create unique index practitioner_locations_one_primary_idx
  on public.practitioner_locations (practitioner_id)
  where is_primary is true;

create table public.practitioner_users (
  id bigint generated always as identity primary key,
  practitioner_id uuid not null references public.practitioners (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index practitioner_users_user_practitioner_idx
  on public.practitioner_users (user_id, practitioner_id);
create index practitioner_users_practitioner_idx
  on public.practitioner_users (practitioner_id);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (char_length(reference) between 4 and 40),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  created_by uuid not null references auth.users (id) on delete restrict,
  patient_reference text not null check (char_length(patient_reference) between 1 and 80),
  patient_postcode text not null check (patient_postcode ~ '^[0-9]{4}$'),
  profession text not null check (profession in ('physiotherapist', 'psychologist')),
  clinical_summary text not null check (char_length(clinical_summary) between 1 and 4000),
  funding_path text not null check (char_length(funding_path) between 1 and 120),
  appointment_format text not null check (appointment_format in ('either', 'in_person', 'telehealth')),
  language_or_access text check (language_or_access is null or char_length(language_or_access) <= 240),
  selection_mode text not null check (selection_mode in ('doctor', 'patient')),
  selected_practitioner_id uuid references public.practitioners (id) on delete restrict,
  status text not null default 'sent'
    check (status in ('sent', 'accepted', 'declined', 'booked', 'cancelled')),
  consent_confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referrals_selection_check check (
    selection_mode = 'patient'
    or selected_practitioner_id is not null
  ),
  constraint referrals_reference_organisation_unique unique (organisation_id, reference)
);

create index referrals_organisation_status_created_idx
  on public.referrals (organisation_id, status, created_at desc);
create index referrals_created_by_idx
  on public.referrals (created_by, created_at desc);
create index referrals_selected_practitioner_idx
  on public.referrals (selected_practitioner_id, status)
  where selected_practitioner_id is not null;

create table public.referral_events (
  id bigint generated always as identity primary key,
  referral_id uuid not null references public.referrals (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null
    check (event_type in ('created', 'sent', 'accepted', 'declined', 'booked', 'cancelled', 'reminder_requested')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index referral_events_referral_created_idx
  on public.referral_events (referral_id, created_at desc);
create index referral_events_actor_idx
  on public.referral_events (actor_user_id)
  where actor_user_id is not null;

create table public.communication_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  transactional_email_enabled boolean not null default true,
  reminder_email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id) on delete cascade,
  kind text not null
    check (kind in ('referral_created', 'referral_accepted', 'referral_declined', 'referral_reminder')),
  recipient_email text not null check (position('@' in recipient_email) > 1),
  template_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(template_data) = 'object')
    check (not (template_data ?| array[
      'patient', 'patient_name', 'patient_reference', 'patient_postcode',
      'condition', 'clinical_summary', 'referral_reason', 'attachment'
    ])),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 256),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'blocked_configuration')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create index notification_outbox_pending_idx
  on public.notification_outbox (next_attempt_at, created_at)
  where status in ('pending', 'failed');
create index notification_outbox_referral_idx
  on public.notification_outbox (referral_id, created_at desc);

create table public.email_delivery_events (
  id bigint generated always as identity primary key,
  outbox_id uuid not null references public.notification_outbox (id) on delete cascade,
  provider_event_id text not null unique,
  event_type text not null
    check (event_type in ('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'suppressed', 'failed')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index email_delivery_events_outbox_occurred_idx
  on public.email_delivery_events (outbox_id, occurred_at desc);

create view public.verified_practitioners
with (security_invoker = true)
as
select
  id,
  display_name,
  profession,
  practice_name,
  telehealth,
  services,
  funding,
  languages,
  ahpra_verified_at,
  provider_confirmed_at,
  updated_at
from public.practitioners
where lifecycle_status = 'active'
  and ahpra_verification_status = 'verified'
  and provider_confirmation_status = 'confirmed'
  and accepting_new_referrals is true
  and contact_email is not null;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create trigger organisations_touch_updated_at
before update on public.organisations
for each row execute function private.touch_updated_at();

create trigger practitioners_touch_updated_at
before update on public.practitioners
for each row execute function private.touch_updated_at();

create trigger referrals_touch_updated_at
before update on public.referrals
for each row execute function private.touch_updated_at();

create trigger communication_preferences_touch_updated_at
before update on public.communication_preferences
for each row execute function private.touch_updated_at();

create trigger notification_outbox_touch_updated_at
before update on public.notification_outbox
for each row execute function private.touch_updated_at();

create or replace function private.record_new_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
begin
  if (select auth.uid()) is null or new.created_by <> (select auth.uid()) then
    raise exception 'Referral creator must match the signed-in user';
  end if;

  insert into public.referral_events (referral_id, actor_user_id, event_type)
  values (new.id, new.created_by, 'created');

  if new.selected_practitioner_id is not null then
    select p.contact_email, p.display_name, p.practice_name
      into recipient
    from public.practitioners p
    where p.id = new.selected_practitioner_id
      and p.lifecycle_status = 'active'
      and p.ahpra_verification_status = 'verified'
      and p.provider_confirmation_status = 'confirmed'
      and p.accepting_new_referrals is true;

    if recipient.contact_email is not null then
      insert into public.notification_outbox (
        referral_id,
        kind,
        recipient_email,
        template_data,
        idempotency_key
      ) values (
        new.id,
        'referral_created',
        recipient.contact_email,
        jsonb_build_object(
          'recipient_name', recipient.display_name,
          'practice_name', recipient.practice_name
        ),
        'referral_created/' || new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger referrals_record_new
after insert on public.referrals
for each row execute function private.record_new_referral();

create or replace function private.record_referral_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  organisation_email text;
  notification_kind text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  insert into public.referral_events (referral_id, actor_user_id, event_type)
  values (new.id, (select auth.uid()), new.status);

  if new.status in ('accepted', 'declined') then
    select o.notification_email
      into organisation_email
    from public.organisations o
    where o.id = new.organisation_id;

    notification_kind := case new.status
      when 'accepted' then 'referral_accepted'
      else 'referral_declined'
    end;

    if organisation_email is not null then
      insert into public.notification_outbox (
        referral_id,
        kind,
        recipient_email,
        idempotency_key
      ) values (
        new.id,
        notification_kind,
        organisation_email,
        notification_kind || '/' || new.id::text
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

create trigger referrals_record_status_change
after update of status on public.referrals
for each row execute function private.record_referral_status_change();

revoke execute on function private.touch_updated_at() from public, anon, authenticated, service_role;
revoke execute on function private.record_new_referral() from public, anon, authenticated, service_role;
revoke execute on function private.record_referral_status_change() from public, anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_memberships enable row level security;
alter table public.practitioners enable row level security;
alter table public.practitioner_locations enable row level security;
alter table public.practitioner_users enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_events enable row level security;
alter table public.communication_preferences enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.email_delivery_events enable row level security;

create policy profiles_select_own
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy organisations_select_member
on public.organisations for select to authenticated
using (
  exists (
    select 1
    from public.organisation_memberships membership
    where membership.organisation_id = organisations.id
      and membership.user_id = (select auth.uid())
      and membership.active is true
  )
);

create policy organisation_memberships_select_own
on public.organisation_memberships for select to authenticated
using (user_id = (select auth.uid()) and active is true);

create policy practitioners_select_verified
on public.practitioners for select to authenticated
using (
  lifecycle_status = 'active'
  and ahpra_verification_status = 'verified'
  and provider_confirmation_status = 'confirmed'
  and accepting_new_referrals is true
  and contact_email is not null
);

create policy practitioner_locations_select_verified
on public.practitioner_locations for select to authenticated
using (
  exists (
    select 1
    from public.practitioners practitioner
    where practitioner.id = practitioner_locations.practitioner_id
      and practitioner.lifecycle_status = 'active'
      and practitioner.ahpra_verification_status = 'verified'
      and practitioner.provider_confirmation_status = 'confirmed'
      and practitioner.accepting_new_referrals is true
      and practitioner.contact_email is not null
  )
);

create policy practitioner_users_select_own
on public.practitioner_users for select to authenticated
using (user_id = (select auth.uid()));

create policy referrals_select_organisation_member
on public.referrals for select to authenticated
using (
  exists (
    select 1
    from public.organisation_memberships membership
    where membership.organisation_id = referrals.organisation_id
      and membership.user_id = (select auth.uid())
      and membership.active is true
  )
  or exists (
    select 1
    from public.practitioner_users practitioner_user
    where practitioner_user.practitioner_id = referrals.selected_practitioner_id
      and practitioner_user.user_id = (select auth.uid())
  )
);

create policy referrals_insert_organisation_member
on public.referrals for insert to authenticated
with check (
  created_by = (select auth.uid())
  and consent_confirmed_at <= now()
  and exists (
    select 1
    from public.organisation_memberships membership
    where membership.organisation_id = referrals.organisation_id
      and membership.user_id = (select auth.uid())
      and membership.active is true
      and membership.role in ('owner', 'admin', 'referrer')
  )
  and (
    selected_practitioner_id is null
    or exists (
      select 1
      from public.practitioners practitioner
      where practitioner.id = referrals.selected_practitioner_id
        and practitioner.lifecycle_status = 'active'
        and practitioner.ahpra_verification_status = 'verified'
        and practitioner.provider_confirmation_status = 'confirmed'
        and practitioner.accepting_new_referrals is true
    )
  )
);

create policy referral_events_select_referral_participant
on public.referral_events for select to authenticated
using (
  exists (
    select 1
    from public.referrals referral
    where referral.id = referral_events.referral_id
  )
);

create policy communication_preferences_select_own
on public.communication_preferences for select to authenticated
using (user_id = (select auth.uid()));

create policy communication_preferences_insert_own
on public.communication_preferences for insert to authenticated
with check (user_id = (select auth.uid()));

create policy communication_preferences_update_own
on public.communication_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
revoke all on public.organisations from anon, authenticated;
revoke all on public.organisation_memberships from anon, authenticated;
revoke all on public.practitioners from anon, authenticated;
revoke all on public.practitioner_locations from anon, authenticated;
revoke all on public.practitioner_users from anon, authenticated;
revoke all on public.referrals from anon, authenticated;
revoke all on public.referral_events from anon, authenticated;
revoke all on public.communication_preferences from anon, authenticated;
revoke all on public.notification_outbox from anon, authenticated;
revoke all on public.email_delivery_events from anon, authenticated;
revoke all on public.verified_practitioners from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.organisations to authenticated;
grant select on public.organisation_memberships to authenticated;
grant select (
  id,
  display_name,
  profession,
  practice_name,
  lifecycle_status,
  ahpra_registration_number,
  ahpra_verification_status,
  ahpra_verified_at,
  provider_confirmation_status,
  provider_confirmed_at,
  accepting_new_referrals,
  telehealth,
  services,
  funding,
  languages,
  created_at,
  updated_at
) on public.practitioners to authenticated;
grant select on public.practitioner_locations to authenticated;
grant select on public.practitioner_users to authenticated;
grant select, insert on public.referrals to authenticated;
grant select on public.referral_events to authenticated;
grant select, insert, update on public.communication_preferences to authenticated;
grant select on public.verified_practitioners to authenticated;
