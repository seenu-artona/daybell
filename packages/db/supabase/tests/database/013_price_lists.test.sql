-- Products and price lists (D36, D59, D104, D143, D96; Seenu's answers 1–8 and Claude's calls of Oct 12 2026; ADR
-- 0019): every studio starts with the starter list as its default, in its region's currency, with no events; money is
-- whole cents within bounds; owners and admins edit, photographers and staff read; another studio sees and changes
-- nothing (lists, items, package lines, defaults, jobs, functions); new jobs get the default; closed jobs keep their
-- list and delivery; the default and lists in use can't be deleted while a studio still can be; events carry ids,
-- kinds and field names only; "Review your price list" is stamped once, by the database, from a person's own change.
begin;
create extension if not exists pgtap with schema extensions;
select plan(111);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'admin');

-- Jobs, as the database owner: A has a draft and a closed job, B a draft. None names a price list.
insert into public.jobs (id, studio_id, name, type, status, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', 'draft', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Old', 'school', 'closed', '2026-01-01', 'JOB00002'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', 'draft', '2026-10-01', 'JOB00001');

-- The seeded ids, readable by every test role (B's are what A must never reach).
create temp table ids as
select
  (select default_price_list_id from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as a_list,
  (select default_price_list_id from public.studios where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as b_list,
  (select i.id from public.price_list_items i join public.studios s on s.default_price_list_id = i.price_list_id
   where s.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and i.name = 'Package A') as a_package,
  (select i.id from public.price_list_items i join public.studios s on s.default_price_list_id = i.price_list_id
   where s.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and i.print_size = '8x10') as a_print,
  (select i.id from public.price_list_items i join public.studios s on s.default_price_list_id = i.price_list_id
   where s.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and i.name = 'Package A') as b_package,
  (select i.id from public.price_list_items i join public.studios s on s.default_price_list_id = i.price_list_id
   where s.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and i.print_size = '8x10') as b_print,
  null::uuid as a_second, null::uuid as a_copy, null::uuid as a_new_package;
grant all on ids to authenticated, anon;
-- The whole test is one transaction; the starter rows were really written when each studio was created, earlier.
update public.price_list_items set created_at = now() - interval '1 day';

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.changed(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.as_user(uuid), pg_temp.changed(text) to authenticated, anon;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'price_lists', 'price_lists exists');
select has_table('public', 'price_list_items', 'price_list_items exists');
select has_table('public', 'price_list_package_lines', 'price_list_package_lines exists');
select col_not_null('public', 'jobs', 'price_list_id', 'every job has a price list');
select col_default_is('public', 'jobs', 'deliver_to_school', 'false', 'free delivery to school is off by default');
select is((select data_type from information_schema.columns
  where table_name = 'price_list_items' and column_name = 'price_cents'), 'bigint', 'prices are whole cents (bigint)');
select is((select data_type from information_schema.columns
  where table_name = 'price_lists' and column_name = 'home_shipping_cents'), 'bigint', 'shipping is whole cents');
select ok(not (select prosecdef from pg_proc where proname = 'save_price_list_item'),
  'save_price_list_item is SECURITY INVOKER (row-level security applies)');
select ok(not (select prosecdef from pg_proc where proname = 'copy_price_list'),
  'copy_price_list is SECURITY INVOKER');
select ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc
  where proname in ('save_price_list_item', 'copy_price_list', 'set_price_list_item_order', 'price_list_summaries',
    'seed_price_list', 'guard_price_list', 'on_price_list_change')),
  'the new functions run with an empty search_path');
select is((select count(*) from unnest(array['public.save_price_list_item(uuid, uuid, jsonb, jsonb)',
    'public.copy_price_list(uuid, text)', 'public.set_price_list_item_order(uuid, uuid[])',
    'public.price_list_summaries(uuid, uuid)']) f
  where has_function_privilege('anon', f, 'execute')), 0::bigint, 'logged-out visitors can run none of them');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
  where p.proname in ('save_price_list_item', 'copy_price_list', 'set_price_list_item_order', 'price_list_summaries')
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC can run none of them');
select is((select count(*) from unnest(array['app.seed_price_list(uuid)', 'app.mark_price_list_reviewed(uuid)',
    'app.starter_price_list()', 'app.guard_price_list()', 'app.on_price_list_change()']) f
  where has_function_privilege('authenticated', f, 'execute')), 0::bigint, 'browsers can run no app helper');

-- ── The starter list, seeded with no events ───────────────────────────────────────────────────────────────────────
select is((select count(*) from public.price_lists where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1::bigint,
  'a new studio has one price list');
select isnt((select a_list from ids), null, 'and it is the studio''s default');
select results_eq($$ select name, currency::text, home_shipping_cents from public.price_lists where id = (select a_list from ids) $$,
  $$ values ('Starter price list', 'USD', 895::bigint) $$, 'named Starter price list, in USD with $8.95 home shipping');
select results_eq($$ select kind::text, count(*) from public.price_list_items where price_list_id = (select a_list from ids)
  group by kind order by min(position) $$,
  $$ values ('package', 3::bigint), ('print', 5::bigint), ('digital_single', 1::bigint), ('digital_all', 1::bigint) $$,
  '3 packages, 5 prints, a single digital and all digitals');
select results_eq($$ select print_size::text from public.price_list_items where price_list_id = (select a_list from ids)
  and kind = 'print' order by position $$,
  $$ values ('4x6'), ('5x7'), ('8x10'), ('11x14'), ('wallets_8') $$, 'the five fixed print sizes');
select results_eq($$ select line_kind, print_size::text, quantity from public.price_list_package_lines
  where package_item_id = (select a_package from ids) order by position $$,
  $$ values ('print', '8x10', 1), ('print', '5x7', 2), ('print', 'wallets_8', 1), ('digital', null, 1) $$,
  'Package A holds an 8x10, two 5x7s, a wallet sheet and the digital download');
select is((select price_cents from public.price_list_items where id = (select a_package from ids)), 6400::bigint,
  'Package A is $64.00');
select is((select count(*) from public.events where type like 'price_list%'), 0::bigint,
  'seeding writes no price list events (part of studio.created)');
select is((select count(*) from public.studios where price_list_reviewed_at is not null), 0::bigint,
  'seeding does not tick "Review your price list"');
select is((select count(*) from public.jobs j join public.studios s on s.id = j.studio_id
  where j.price_list_id is distinct from s.default_price_list_id), 0::bigint, 'jobs get their studio''s default list');
select ok((select bool_and((i -> 'price' ->> 'CAD')::bigint >= 0 and (i -> 'price' ->> 'USD')::bigint >= 0)
  from jsonb_array_elements(app.starter_price_list() -> 'items') i)
  and (app.starter_price_list() -> 'homeShipping' ->> 'CAD')::bigint = 1195,
  'the starter list has whole-cent prices in both currencies (CAD for Canadian studios)');

-- ── Money and shape rules (as the database owner, so only the checks stop them) ────────────────────────────────────
select throws_ok($$ insert into public.price_lists (studio_id, name, currency)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CAD in the US', 'CAD') $$,
  '23514', 'price_list_currency', 'a list''s currency must be its studio''s region''s');
select throws_ok($$ update public.price_lists set currency = 'CAD' where id = (select a_list from ids) $$,
  '23514', 'price_list_currency', 'a list''s currency never changes');
select throws_ok($$ update public.price_list_items set kind = 'digital_all' where id = (select a_print from ids) $$,
  '23514', 'price_list_item_fixed', 'an item never changes kind');
select throws_ok($$ update public.price_list_items set price_cents = -1 where id = (select a_print from ids) $$,
  '23514', null, 'no negative prices');
select throws_ok($$ update public.price_list_items set price_cents = 1000001 where id = (select a_print from ids) $$,
  '23514', null, 'no price over $10,000');
select lives_ok($$ update public.price_list_items set price_cents = 0 where id = (select a_print from ids) $$,
  '$0 items are allowed');
update public.price_list_items set price_cents = 2000 where id = (select a_print from ids);
select throws_ok($$ update public.price_lists set home_shipping_cents = 100001 where id = (select a_list from ids) $$,
  '23514', null, 'no home shipping over $1,000');
select throws_ok($$ update public.price_list_items set print_size = null where id = (select a_print from ids) $$,
  '23514', null, 'a print needs a size');
select throws_ok($$ update public.price_list_items set print_size = '4x6' where id = (select a_package from ids) $$,
  '23514', null, 'a package has no size of its own');
select throws_ok($$ insert into public.price_list_items (studio_id, price_list_id, kind, name, price_cents)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select a_list from ids), 'digital_single', 'Another', 100) $$,
  '23505', null, 'one single digital per list');
select throws_ok($$ insert into public.price_list_package_lines (studio_id, price_list_id, package_item_id, line_kind,
  quantity) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select a_list from ids), (select a_print from ids), 'digital', 1) $$,
  '23514', 'not_package', 'only packages have contents');
select throws_ok($$ insert into public.price_list_package_lines (studio_id, price_list_id, package_item_id, line_kind,
  quantity) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select a_list from ids), (select a_package from ids), 'digital', 1) $$,
  '23505', null, 'a package holds one digital at most (one pose)');
select throws_ok($$ insert into public.price_list_package_lines (studio_id, price_list_id, package_item_id, line_kind,
  print_size, quantity) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select a_list from ids), (select a_package from ids),
  'print', '4x6', 100) $$, '23514', null, 'at most 99 prints per line');

-- ── Photographers and staff read only (answer 8) ──────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select is((select count(*) from public.price_list_items where price_list_id = (select a_list from ids)), 10::bigint,
  'a photographer reads the studio''s list');
select throws_ok($$ insert into public.price_lists (studio_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mine') $$,
  '42501', null, 'a photographer can''t add a list');
select is(pg_temp.changed($$ update public.price_list_items set price_cents = 1 where id = (select a_print from ids) $$),
  0::bigint, 'a photographer can''t change a price');
select is(pg_temp.changed($$ delete from public.price_list_items where id = (select a_print from ids) $$), 0::bigint,
  'a photographer can''t delete an item');
select throws_ok($$ select public.save_price_list_item((select a_list from ids), null,
  '{"kind":"print","name":"x","print_size":"4x6","price_cents":1}', null) $$, '42501', null,
  'a photographer can''t add an item through the function either');
select throws_ok($$ select public.set_price_list_item_order((select a_list from ids), array[]::uuid[]) $$, '42501', null,
  'a photographer can''t reorder');
select is(pg_temp.changed($$ update public.studios set default_price_list_id = default_price_list_id
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$), 0::bigint, 'a photographer can''t change the default');
select is(pg_temp.changed($$ update public.jobs set deliver_to_school = true
  where id = 'a0000000-0000-4000-8000-000000000001' $$), 0::bigint, 'a photographer can''t change a job''s delivery');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
select is((select count(*) from public.price_list_package_lines where price_list_id = (select a_list from ids)), 9::bigint,
  'staff read package contents');
select is(pg_temp.changed($$ delete from public.price_lists where id = (select a_list from ids) $$), 0::bigint,
  'staff can''t delete a list');
select is((select count(*) from public.studios where price_list_reviewed_at is not null), 0::bigint,
  'none of that ticked "Review your price list"');

-- ── Another studio sees and changes nothing (as A's owner) ────────────────────────────────────────────────────────
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select is((select count(*) from public.price_lists where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0::bigint,
  'A can''t see B''s lists');
select is((select count(*) from public.price_list_items where price_list_id = (select b_list from ids)), 0::bigint,
  'A can''t see B''s items');
select is((select count(*) from public.price_list_package_lines where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint, 'A can''t see B''s package contents');
select throws_ok($$ insert into public.price_lists (studio_id, name) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Planted') $$,
  '42501', null, 'A can''t add a list to B');
select is(pg_temp.changed($$ update public.price_lists set name = 'Hacked' where id = (select b_list from ids) $$), 0::bigint,
  'A can''t rename B''s list');
select is(pg_temp.changed($$ update public.price_list_items set price_cents = 1 where id = (select b_print from ids) $$),
  0::bigint, 'A can''t change B''s prices');
select is(pg_temp.changed($$ delete from public.price_list_items where id = (select b_print from ids) $$), 0::bigint,
  'A can''t delete B''s items');
select is(pg_temp.changed($$ delete from public.price_lists where id = (select b_list from ids) $$), 0::bigint,
  'A can''t delete B''s list');
select throws_ok($$ insert into public.price_list_items (studio_id, price_list_id, kind, name, print_size, price_cents)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select b_list from ids), 'print', 'Planted', '4x6', 1) $$,
  '23503', null, 'A can''t put an item in B''s list under its own studio');
select throws_ok($$ insert into public.price_list_items (studio_id, price_list_id, kind, name, print_size, price_cents)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select b_list from ids), 'print', 'Planted', '4x6', 1) $$,
  '42501', null, 'nor under B''s');
select throws_ok($$ insert into public.price_list_package_lines (studio_id, price_list_id, package_item_id, line_kind,
  quantity) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select b_list from ids), (select b_package from ids), 'digital', 1) $$,
  '23514', 'not_package', 'A can''t add a line to B''s package (it can''t even see it)');
select throws_ok($$ update public.jobs set price_list_id = (select b_list from ids)
  where id = 'a0000000-0000-4000-8000-000000000001' $$, '23503', null, 'A can''t give its job B''s list');
select throws_ok($$ insert into public.jobs (studio_id, name, type, picture_day, internal_number, price_list_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sneaky', 'school', '2027-01-01', 'JOB09999', (select b_list from ids)) $$,
  '23503', null, 'nor create a job with it');
select throws_ok($$ update public.studios set default_price_list_id = (select b_list from ids)
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$, '23503', null, 'A can''t make B''s list its default');
select throws_ok($$ select public.save_price_list_item((select b_list from ids), null,
  '{"kind":"print","name":"x","print_size":"4x6","price_cents":1}', null) $$, 'P0002', 'not_found',
  'save_price_list_item can''t find B''s list');
select throws_ok($$ select public.save_price_list_item((select a_list from ids), (select b_print from ids),
  '{"price_cents":1}', null) $$, 'P0002', 'not_found', 'nor B''s item under A''s list');
select throws_ok($$ select public.copy_price_list((select b_list from ids), 'Stolen') $$, 'P0002', 'not_found',
  'copy_price_list can''t copy B''s list');
select throws_ok($$ select public.set_price_list_item_order((select b_list from ids), array[(select b_print from ids)]) $$,
  'P0002', 'not_found', 'set_price_list_item_order can''t find B''s list');
select is_empty($$ select * from public.price_list_summaries('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  'price_list_summaries shows nothing of B');
select throws_ok($$ update public.studios set price_list_reviewed_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null, 'nobody ticks "Review your price list" by hand');

-- ── Owners and admins edit ────────────────────────────────────────────────────────────────────────────────────────
select results_eq($$ select name, currency, is_default, packages, prints, digitals, jobs, selling_jobs
  from public.price_list_summaries('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  $$ values ('Starter price list', 'USD', true, 3, 5, 2, 2, 0) $$, 'the summaries count items by group and jobs');
update public.price_list_items set price_cents = 2500 where id = (select a_print from ids);
select results_eq($$ select type, subject_id, data from public.events where type like 'price_list%'
  and actor_id = '11111111-1111-4111-8111-111111111111' order by id $$,
  $$ values ('price_list_item.updated', (select a_print from ids),
    jsonb_build_object('price_list_id', (select a_list from ids), 'fields', jsonb_build_array('price_cents'))) $$,
  'a price change writes one event with ids and the field name only');
select isnt((select price_list_reviewed_at from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), null,
  'the owner''s first change ticks "Review your price list"');
create temp table first_review as
  select price_list_reviewed_at as at from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- Admin: a new blank list, then a package with contents, through the function.
select pg_temp.as_user('55555555-5555-4555-8555-555555555555') as signed_in;
with x as (insert into public.price_lists (studio_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Spring')
  returning id)
update ids set a_second = (select id from x);
select is((select currency::text from public.price_lists where id = (select a_second from ids)), 'USD',
  'an admin adds a blank list; the database sets its currency');
update ids set a_new_package = public.save_price_list_item((select a_second from ids), null,
  '{"kind":"package","name":"Mini","description":null,"price_cents":3000}',
  '[{"kind":"print","print_size":"5x7","quantity":2},{"kind":"digital","print_size":null,"quantity":1}]');
select results_eq($$ select line_kind, quantity from public.price_list_package_lines
  where package_item_id = (select a_new_package from ids) order by position $$,
  $$ values ('print', 2), ('digital', 1) $$, 'save_price_list_item adds a package with its contents');
select is((select count(*) from public.events where subject_id = (select a_new_package from ids)), 1::bigint,
  'a new package writes one event (its contents are part of it)');
select throws_ok($$ select public.save_price_list_item((select a_second from ids), null,
  '{"kind":"package","name":"Empty","price_cents":1}', '[]') $$, 'P0001', 'package_empty', 'a package needs contents');
select throws_ok($$ select public.save_price_list_item((select a_second from ids), null,
  '{"kind":"package","name":"Empty","price_cents":1}', null) $$, 'P0001', 'package_empty', 'even when none are sent');
select throws_ok($$ select public.save_price_list_item((select a_list from ids), (select a_print from ids), '{}',
  '[{"kind":"digital","print_size":null,"quantity":1}]') $$, '23514', 'not_package', 'a print has no contents');
-- Replacing a package's contents (three lines) writes one event, and the item keeps its id.
select is(public.save_price_list_item((select a_list from ids), (select a_package from ids), '{"name":"Package A+"}',
  '[{"kind":"print","print_size":"8x10","quantity":2},{"kind":"print","print_size":"4x6","quantity":1},{"kind":"digital","print_size":null,"quantity":1}]'),
  (select a_package from ids), 'saving keeps the item''s id (orders refer to it)');
select results_eq($$ select data -> 'fields' from public.events where subject_id = (select a_package from ids) order by id $$,
  $$ values ('["name"]'::jsonb), ('["contents"]'::jsonb) $$, 'one event for the name, one for the contents');
select is((select price_list_reviewed_at from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  (select at from first_review), '"Review your price list" is stamped once and never moves');

-- Copies and order.
update ids set a_copy = public.copy_price_list((select a_list from ids), '  Starter copy  ');
select results_eq($$ select name, home_shipping_cents from public.price_lists where id = (select a_copy from ids) $$,
  $$ values ('Starter copy', 895::bigint) $$, 'a copy has the new name (trimmed) and the same shipping');
select is((select count(*) from public.price_list_items where price_list_id = (select a_copy from ids)), 10::bigint,
  'and every item');
select is((select count(*) from public.price_list_package_lines where price_list_id = (select a_copy from ids)),
  (select count(*) from public.price_list_package_lines where price_list_id = (select a_list from ids)),
  'and every package''s contents');
select throws_ok($$ select public.set_price_list_item_order((select a_list from ids), array[(select a_print from ids)]) $$,
  '22023', 'order_mismatch', 'an order must name every item of the list');
select throws_ok($$ select public.set_price_list_item_order((select a_list from ids),
  (select array_agg(id) || array[(select a_print from ids)] from public.price_list_items where price_list_id = (select a_list from ids))) $$,
  '22023', 'order_mismatch', 'each once');
select lives_ok($$ select public.set_price_list_item_order((select a_list from ids),
  (select array_agg(id order by position desc) from public.price_list_items where price_list_id = (select a_list from ids))) $$,
  'an admin reorders the list');
select is((select position from public.price_list_items where id = (select a_package from ids)), 10,
  'positions follow the new order');
select is((select count(*) from public.events where type = 'price_list.reordered'), 1::bigint,
  'reordering writes one event, not one per item');

-- Jobs: the default for new jobs, a chosen list, a new default, closed jobs.
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
insert into public.jobs (studio_id, name, type, picture_day, internal_number)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'New', 'school', '2027-01-01', 'JOB00003');
select is((select price_list_id from public.jobs where internal_number = 'JOB00003'), (select a_list from ids),
  'a new job gets the default list');
insert into public.jobs (studio_id, name, type, picture_day, internal_number, price_list_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Chosen', 'school', '2027-01-01', 'JOB00004', (select a_second from ids));
select is((select price_list_id from public.jobs where internal_number = 'JOB00004'), (select a_second from ids),
  'or the list it was given');
update public.jobs set price_list_id = (select a_copy from ids), deliver_to_school = true
where id = 'a0000000-0000-4000-8000-000000000001';
select is((select data -> 'fields' from public.events where type = 'job.updated' order by id desc limit 1),
  '["price_list_id", "deliver_to_school"]'::jsonb, 'switching a job''s list and delivery is a job.updated with field names');
select throws_ok($$ update public.jobs set price_list_id = (select a_copy from ids)
  where id = 'a0000000-0000-4000-8000-000000000002' $$, 'P0001', 'job_closed', 'a closed job keeps its list');
select throws_ok($$ update public.jobs set deliver_to_school = true where id = 'a0000000-0000-4000-8000-000000000002' $$,
  'P0001', 'job_closed', 'and its delivery');
update public.studios set default_price_list_id = (select a_second from ids) where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select results_eq($$ select type, subject_id from public.events where type = 'price_list.made_default' $$,
  $$ values ('price_list.made_default', (select a_second from ids)) $$, 'making a list the default writes an event');
insert into public.jobs (studio_id, name, type, picture_day, internal_number)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Later', 'school', '2027-01-01', 'JOB00005');
select is((select price_list_id from public.jobs where internal_number = 'JOB00005'), (select a_second from ids),
  'new jobs get the new default');
select is((select price_list_id from public.jobs where internal_number = 'JOB00003'), (select a_list from ids),
  'existing jobs keep theirs');

-- Deleting.
select throws_ok($$ delete from public.price_lists where id = (select a_second from ids) $$, '23503', null,
  'the default list can''t be deleted');
select throws_ok($$ delete from public.price_lists where id = (select a_list from ids) $$, '23503', null,
  'a list a job uses can''t be deleted');
update public.jobs set price_list_id = (select a_second from ids) where price_list_id = (select a_copy from ids);
select is(pg_temp.changed($$ delete from public.price_lists where id = (select a_copy from ids) $$), 1::bigint,
  'an unused list that isn''t the default can be deleted');
select results_eq($$ select type from public.events where subject_id = (select a_copy from ids) and type like 'price_list.%'
  order by id $$,
  $$ values ('price_list.created'), ('price_list.deleted') $$, 'with one event');
select is((select count(*) from public.events where type = 'price_list_item.deleted'), 0::bigint,
  'its items go with it without an event each');
select is(pg_temp.changed($$ delete from public.price_list_items where id = (select a_new_package from ids) $$), 1::bigint,
  'an owner deletes an item');
select is((select count(*) from public.price_list_package_lines where package_item_id = (select a_new_package from ids)),
  0::bigint, 'with its contents');
select results_eq($$ select data from public.events where type = 'price_list_item.deleted' $$,
  $$ values (jsonb_build_object('price_list_id', (select a_second from ids), 'kind', 'package')) $$,
  'one item event, ids and kind only');

-- Events never carry names, descriptions or prices.
select is((select count(*) from public.events
  where data::text ~* 'package a|starter|spring|mini|copy|6400|2500|895|full resolution'), 0::bigint,
  'events hold ids, kinds and field names only');

-- ── Logged-out visitors get nothing ───────────────────────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok($$ select 1 from public.price_lists $$, '42501', null, 'anon can''t read price lists');
select throws_ok($$ select 1 from public.price_list_items $$, '42501', null, 'anon can''t read items');
select throws_ok($$ select 1 from public.price_list_package_lines $$, '42501', null, 'anon can''t read package contents');

-- ── A studio with lists, jobs and a changed default can still be deleted ──────────────────────────────────────────
reset role;
select lives_ok($$ delete from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'deleting a studio takes its lists and jobs with it');
select is((select count(*) from public.price_list_items where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'nothing of it is left');
select is((select count(*) from public.price_lists where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint,
  'and B''s list is untouched');

select * from finish();
rollback;
