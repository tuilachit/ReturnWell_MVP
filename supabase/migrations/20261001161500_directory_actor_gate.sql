-- The 5k+ regression fixture exposed a per-row denial scan in the legacy view.
-- Cache only actor-wide eligibility, never row eligibility or the session itself.
-- Row-level ownership, assignment and current credential checks remain intact.
alter policy practitioners_select_approved on public.practitioners using (
 (select private.can_use_directory()) and (private.owns_practitioner(id) or private.directory_visible(id))
);
alter policy practitioners_read_assigned on public.practitioners using (
 (select private.can_use_directory()) and private.can_read_assigned_practitioner(id)
);
create or replace view public.verified_practitioners with(security_invoker=true) as
 select id,display_name,profession,practice_name,telehealth,services,funding,languages,ahpra_verified_at,provider_confirmed_at,updated_at,private.credential_summary(id) as credentials,service_ids,age_group_ids
 from public.practitioners where (select private.can_use_directory()) and private.directory_visible(id);
