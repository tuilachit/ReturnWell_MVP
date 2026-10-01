-- The earlier cursor guard omitted the fourth UUID group. Keep strict version,
-- scope and shape validation, but accept the standard 8-4-4-4-12 UUID format.
create or replace function private.read_page_cursor(value text, fingerprint text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare c jsonb;
begin
  if coalesce(value,'')='' then return null; end if;
  if length(value)>2048 then raise exception 'invalid_cursor'; end if;
  begin
    c:=convert_from(decode(value,'base64'),'UTF8')::jsonb;
  exception when others then raise exception 'invalid_cursor'; end;
  if (jsonb_typeof(c) is distinct from 'object')
    or (c->>'v' is distinct from '1')
    or (c->>'q' is distinct from fingerprint)
    or (jsonb_typeof(c->'key') is distinct from 'string')
    or (coalesce(c->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
  then raise exception 'invalid_cursor'; end if;
  return c;
end $$;
