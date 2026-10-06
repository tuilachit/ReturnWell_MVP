-- JSON operators share precedence: parenthesise page extraction before
-- appending it. Without this, array || page -> 'items' yields NULL and silently
-- drops every confirmed member from the combined recipient projection.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('private.directory_recipients(uuid,jsonb)'::regprocedure);
  if strpos(definition,'members:=members||page->''items'';')=0 then
    raise exception 'Unexpected recipient projection definition';
  end if;
  execute replace(definition,'members:=members||page->''items'';','members:=members||(page->''items'');');
end $$;
