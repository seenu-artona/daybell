-- Price lists in a Canadian database (ADR 0006, 0019; Claude's call 7): a Canadian studio's starter list and every
-- list it makes are in CAD, never USD.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into public.studios (id, name, slug, data_region) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Studio C', 'studio-c', 'ca');

select results_eq($$ select l.currency::text, l.home_shipping_cents from public.price_lists l
  join public.studios s on s.default_price_list_id = l.id where s.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  $$ values ('CAD', 1195::bigint) $$, 'a Canadian studio''s starter list is in CAD, with $11.95 home shipping');
select is((select i.price_cents from public.price_list_items i join public.studios s on s.default_price_list_id = i.price_list_id
  where s.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and i.name = 'Package A'), 8500::bigint,
  'with CAD prices (Package A is $85.00)');
select lives_ok($$ insert into public.price_lists (studio_id, name) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Spring') $$,
  'a new list needs no currency');
select is((select currency::text from public.price_lists where name = 'Spring'), 'CAD', 'it gets CAD');
select throws_ok($$ insert into public.price_lists (studio_id, name, currency)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'US dollars', 'USD') $$,
  '23514', 'price_list_currency', 'USD is refused for a Canadian studio');

select * from finish();
rollback;
