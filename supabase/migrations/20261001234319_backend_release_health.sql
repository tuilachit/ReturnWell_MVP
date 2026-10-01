-- Narrow read-only deployment probe. Never grants access to application rows.
-- History remains private; only the service role can invoke this fixed query.
create function public.rw_backend_migrations() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'backend_unavailable';
  end if;
  execute 'select coalesce(jsonb_agg(version order by version), ''[]''::jsonb) from supabase_migrations.schema_migrations' into result;
  return result;
end $$;
revoke all on function public.rw_backend_migrations() from public, anon, authenticated;
grant execute on function public.rw_backend_migrations() to service_role;
