-- D96 guard: no table can ever ship without row-level security or a studio_id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select is_empty(
  $$ select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every public table has row-level security enabled'
);

-- studios is the tenant root (its id is the studio id). Add other global tables here only with a decision ID.
select is_empty(
  $$ select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('studios')
       and not exists (
         select 1 from pg_attribute a
         where a.attrelid = c.oid and a.attname = 'studio_id' and a.attnotnull and not a.attisdropped
       ) $$,
  'every studio-owned table has a non-null studio_id'
);

select * from finish();
rollback;
