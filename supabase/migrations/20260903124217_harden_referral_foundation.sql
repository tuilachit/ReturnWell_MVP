create index organisations_created_by_idx
  on public.organisations (created_by)
  where created_by is not null;

do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
