-- D113: a database that has not recorded its region refuses every studio.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select throws_ok(
  $$ insert into public.studios (name, slug, data_region) values ('No region yet', 'no-region-yet', 'us') $$,
  '23514', null, 'no studios can be written before the database region is recorded'
);

select * from finish();
rollback;
