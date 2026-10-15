-- Job › Shop (D157; Seenu's answers B1, B2, N4 of Oct 14, 2026; ADR 0033): a job's own prices and Sold switches over
-- its list, and products only it sells, are the studio's own rows (row-level security, composite keys); members read,
-- owners and admins write, refused with 42501 before anything is read; a closed job's shop never changes; a change is
-- only for an item on the job's current list (a swap in between is not_on_list); swapping the list drops the old list's
-- changes but keeps the job's products (B1); deleting a list item takes its change with it; at most 100 products per
-- job and 20 lines per package; one resolver (app.job_offer) gives the job's prices; Start selling needs something
-- sold (N3, in 018); events carry ids and field names, never amounts; another studio sees and changes nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(105);

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

-- Fixtures as the database owner. Studio A: job 1 and job 2 on the starter list, job 3 closed, and a second list
-- "Spring" with one print. Studio B: job 1 on its starter list.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Spring', 'school', '2026-10-01', 'JOB00002'),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Closed', 'school', '2026-10-01', 'JOB00003'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000003';
-- Job 3 switched its wallets off while it was selling.
insert into public.job_price_overrides (studio_id, job_id, price_list_id, price_list_item_id, sold)
select i.studio_id, j.id, i.price_list_id, i.id, false from public.price_list_items i
join public.jobs j on j.price_list_id = i.price_list_id
where j.id = 'a0000000-0000-4000-8000-000000000003' and i.name = 'Wallets (sheet of 8)';
update public.jobs set status = 'closed' where id = 'a0000000-0000-4000-8000-000000000003';
insert into public.price_lists (id, studio_id, name) values
  ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Spring');
insert into public.price_list_items (id, studio_id, price_list_id, kind, name, print_size, price_cents) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e0000000-0000-4000-8000-000000000001', 'print', 'Spring 5×7', '5x7', 1200);

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
-- A starter list item of a job's list by name (database owner's view).
create function pg_temp.item(p_job uuid, p_name text) returns uuid language sql security definer as $$
  select i.id from public.price_list_items i join public.jobs j on j.price_list_id = i.price_list_id
  where j.id = p_job and i.name = p_name $$;
create function pg_temp.list_of(p_job uuid) returns uuid language sql security definer as $$
  select j.price_list_id from public.jobs j where j.id = p_job $$;
create temp table ids (k text primary key, id uuid) on commit drop;
grant all on table ids to authenticated;
create function pg_temp.offer(p_job uuid) returns setof jsonb language sql security definer as $$
  select to_jsonb(o) from app.job_offer(p_job) o order by o.ord $$;
-- Events of a type, leaving out the fixtures' (job 3's).
create function pg_temp.events(p_type text) returns bigint language sql security definer as $$
  select count(*) from public.events e
  where e.type = p_type and e.data ->> 'job_id' is distinct from 'a0000000-0000-4000-8000-000000000003' $$;
create function pg_temp.event_data(p_type text) returns jsonb language sql security definer as $$
  select e.data from public.events e where e.type = p_type order by e.occurred_at desc, e.id desc limit 1 $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ── Shape and grants ──────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'job_price_overrides', 'job_price_overrides exists');
select has_table('public', 'job_shop_items', 'job_shop_items exists');
select has_table('public', 'job_shop_package_lines', 'job_shop_package_lines exists');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.job_price_overrides'::regclass, 'public.job_shop_items'::regclass,
                           'public.job_shop_package_lines'::regclass)), 'all three have row-level security');
select col_is_pk('public', 'job_price_overrides', array['job_id', 'price_list_item_id'],
  'a change is keyed by (job, list item)');
select ok(not has_column_privilege('authenticated', 'public.job_price_overrides', 'studio_id', 'update')
  and not has_column_privilege('authenticated', 'public.job_price_overrides', 'job_id', 'update')
  and not has_column_privilege('authenticated', 'public.job_price_overrides', 'price_list_item_id', 'update')
  and has_column_privilege('authenticated', 'public.job_price_overrides', 'price_cents', 'update'),
  'browsers may change a price and Sold, never which job or item');
select ok(not has_column_privilege('authenticated', 'public.job_shop_items', 'kind', 'update')
  and not has_column_privilege('authenticated', 'public.job_shop_items', 'job_id', 'update')
  and not has_column_privilege('authenticated', 'public.job_shop_items', 'position', 'update'),
  'a product never changes kind or job, and its position is the database''s');
select is((select count(*) from unnest(array['public.job_price_overrides', 'public.job_shop_items',
    'public.job_shop_package_lines']) t where has_table_privilege('anon', t, 'select')), 0::bigint,
  'logged-out visitors read none of them');
select is((select count(*) from unnest(array['app.job_offer(uuid)', 'app.check_job_shop_open(uuid, uuid, uuid)',
    'app.guard_job_price_override()', 'app.guard_job_shop_item()', 'app.guard_job_package_line()']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  0::bigint, 'nobody signed in runs the resolver or the guards');
select is((select count(*) from unnest(array['public.set_job_price(uuid, uuid, bigint, boolean)',
    'public.reset_job_price(uuid, uuid)', 'public.save_job_item(uuid, uuid, jsonb, jsonb)',
    'public.delete_job_item(uuid, uuid)', 'public.job_shop(uuid, uuid)']) f
  where has_function_privilege('anon', f, 'execute')), 0::bigint, 'logged-out visitors run none of the functions');
select ok((select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('set_job_price', 'reset_job_price', 'save_job_item',
             'delete_job_item')), 'the writes are SECURITY INVOKER (row-level security applies)');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n
           on n.oid = p.pronamespace where (n.nspname, p.proname) in (('public', 'set_job_price'),
             ('public', 'reset_job_price'), ('public', 'save_job_item'), ('public', 'delete_job_item'),
             ('public', 'job_shop'), ('app', 'job_offer'))), 'every function has an empty search_path');

-- ── The resolver before any change ────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from pg_temp.offer('a0000000-0000-4000-8000-000000000001')), 10::bigint,
  'job 1 sells its list''s ten items');
select is((select array_agg(x ->> 'name') from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x
           where x ->> 'kind' = 'package'), array['Package A', 'Package B', 'Package C'], 'in the list''s order');
select ok((select bool_and((x ->> 'price_cents') = (x ->> 'list_price_cents') and (x ->> 'sold')::boolean
                           and x ->> 'source' = 'list')
           from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x), 'at the list''s prices, all sold');
select is((select x ->> 'currency' from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x limit 1), 'USD',
  'in the list''s currency');

-- ── Owners change this job's prices (D157, N4) ────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 7000, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A')), 'an owner sets Package A to $70 for job 1');
select is((select price_cents from public.job_price_overrides
           where job_id = 'a0000000-0000-4000-8000-000000000001'), 7000::bigint, 'one row holds the job''s price');
select is((select (x ->> 'price_cents')::bigint from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x
           where x ->> 'name' = 'Package A'), 7000::bigint, 'the resolver gives the job''s price');
select is((select (x ->> 'list_price_cents')::bigint from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x
           where x ->> 'name' = 'Package A'), 6400::bigint, 'and still the list''s');
select is((select price_cents from public.price_list_items
           where id = pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A')), 6400::bigint,
  'the shared list never changes');
select is((select (x ->> 'price_cents')::bigint from pg_temp.offer('a0000000-0000-4000-8000-000000000002') x
           where x ->> 'name' = 'Package A'), 6400::bigint, 'another job on the same list keeps the list''s price');
select is(pg_temp.events('job_price.changed'), 1::bigint, 'one job_price.changed event');
select is(pg_temp.event_data('job_price.changed'), jsonb_build_object(
    'job_id', 'a0000000-0000-4000-8000-000000000001',
    'price_list_item_id', pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A'),
    'fields', jsonb_build_array('price_cents')),
  'naming the job, the item and the field, never the amount');
select is((public.job_shop('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001')
           ->> 'changes')::int, 1, 'Job › Shop counts one change');
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 7000, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A')), 'the same price again');
select is(pg_temp.events('job_price.changed'), 1::bigint, 'changes nothing and writes no event');
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 6400, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A')), 'typing the list''s price back');
select is((select count(*) from public.job_price_overrides where job_id = 'a0000000-0000-4000-8000-000000000001'),
  0::bigint, 'undoes it: the row is gone');
select is(pg_temp.events('job_price.reset'), 1::bigint, 'with one job_price.reset event');
select is(pg_temp.event_data('job_price.reset') - 'price_list_item_id',
  jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001'), 'ids only');

-- Switched off at the list's price counts as a change (N1); switched on again it is gone.
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, null, false) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package B')), 'an owner switches Package B off');
select is((select (price_cents, sold)::text from public.job_price_overrides
           where job_id = 'a0000000-0000-4000-8000-000000000001'), '(,f)', 'off at the list''s price');
select is((select (x ->> 'sold')::boolean from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x
           where x ->> 'name' = 'Package B'), false, 'the resolver says it isn''t sold');
select is(pg_temp.event_data('job_price.changed') -> 'fields', '["sold"]'::jsonb, 'the event names sold');
select is((public.job_shop('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001')
           ->> 'changes')::int, 1, 'and it counts as a change (N1)');
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 5000, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package B')), 'a price for the item that is off');
select is((select (price_cents, sold)::text from public.job_price_overrides
           where job_id = 'a0000000-0000-4000-8000-000000000001'), '(5000,f)', 'keeps it off');
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 4400, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package B')), 'the list''s price typed back');
select is((select (price_cents, sold)::text from public.job_price_overrides
           where job_id = 'a0000000-0000-4000-8000-000000000001'), '(,f)', 'clears the price, still off');
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, null, true) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package B')), 'switched on again');
select is((select count(*) from public.job_price_overrides where job_id = 'a0000000-0000-4000-8000-000000000001'),
  0::bigint, 'nothing differs, so nothing is kept');
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 1100, false) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', '4×6 print')), 'a price and off at once');
select lives_ok(format($$ select public.reset_job_price('a0000000-0000-4000-8000-000000000001', %L) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', '4×6 print')), 'Undo');
select is((select count(*) from public.job_price_overrides where job_id = 'a0000000-0000-4000-8000-000000000001'),
  0::bigint, 'puts the list''s price back and sells it again');
select is(pg_temp.try($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001', 900, null) $$), 'P0001 not_on_list',
  'an item of another list is refused');
select is(pg_temp.try(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, null, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', '4×6 print'))), '22023 Send a price or whether it is sold',
  'nothing to change is refused');
select is(pg_temp.try(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 1000001, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', '4×6 print'))) like '23514%', true,
  'more than $10,000 is refused');
-- An admin may too.
select pg_temp.as_user('55555555-5555-4555-8555-555555555555') as admin_a;
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 1800, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', '5×7 print')), 'an admin sets the 5×7 to $18');

-- ── Who may: 42501 before anything is read; other studios see nothing ─────────────────────────────────────────────
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as photographer_a;
select is(pg_temp.try(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 100, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A'))), '42501 Owners and admins only',
  'a photographer can''t change a price');
select is(pg_temp.try(format($$ insert into public.job_price_overrides (studio_id, job_id, price_list_id,
    price_list_item_id, price_cents) select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
    price_list_id, %L, 100 from public.jobs where id = 'a0000000-0000-4000-8000-000000000001' $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A'))), '42501 Owners and admins only',
  'nor write the row directly');
select is(pg_temp.try($$ select public.save_job_item('a0000000-0000-4000-8000-000000000001', null,
  '{"kind": "print", "name": "Job print", "print_size": "5x7", "price_cents": 100}', null) $$),
  '42501 Owners and admins only', 'nor add a product');
select is((public.job_shop('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001')
           ->> 'changes')::int, 1, 'a photographer reads Job › Shop with its prices (N10)');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as staff_a;
select is(pg_temp.try(format($$ select public.reset_job_price('a0000000-0000-4000-8000-000000000001', %L) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', '5×7 print'))), '42501 Owners and admins only',
  'staff can''t undo one');
select is((select count(*) from public.job_price_overrides), 2::bigint, 'staff read the jobs'' prices');
select is(pg_temp.try($$ update public.job_price_overrides set price_cents = 1 $$), 'ok', 'an update by staff');
select is((select price_cents from public.job_price_overrides where job_id = 'a0000000-0000-4000-8000-000000000001'),
  1800::bigint, 'touches nothing (row-level security)');

select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as owner_b;
select is((select count(*) from public.job_price_overrides), 0::bigint, 'another studio reads none of A''s prices');
select is(pg_temp.try(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 100, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A'))), 'P0002 not_found',
  'nor finds A''s job to change');
select is(pg_temp.try(format($$ insert into public.job_price_overrides (studio_id, job_id, price_list_id,
    price_list_item_id, price_cents) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a0000000-0000-4000-8000-000000000001', %L, %L, 100) $$,
  pg_temp.list_of('a0000000-0000-4000-8000-000000000001'),
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A'))), '42501 Owners and admins only',
  'and a direct write is refused before anything about A is read');
select is(pg_temp.try($$ select public.job_shop('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'a0000000-0000-4000-8000-000000000001') $$), '42501 Members only', 'nor reads A''s Job › Shop');
select is(pg_temp.try($$ select public.job_shop('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a0000000-0000-4000-8000-000000000001') $$), 'P0002 not_found', 'not even through its own studio');
select is(pg_temp.try($$ select public.delete_job_item('a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001') $$), 'P0002 not_found', 'nor removes a product of A''s');
select is(pg_temp.try($$ select public.save_job_item('a0000000-0000-4000-8000-000000000001', null,
  '{"kind": "print", "name": "Job print", "print_size": "5x7", "price_cents": 100}', null) $$), 'P0002 not_found',
  'nor adds one to A''s job');

-- ── A closed job's shop never changes ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select is(pg_temp.try(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000003', %L, 100, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000003', 'Package A'))), 'P0001 job_closed',
  'a closed job''s price is refused');
select is(pg_temp.try($$ select public.save_job_item('a0000000-0000-4000-8000-000000000003', null,
  '{"kind": "print", "name": "Job print", "print_size": "5x7", "price_cents": 100}', null) $$), 'P0001 job_closed',
  'and a product for it');
select is(pg_temp.try(format($$ select public.reset_job_price('a0000000-0000-4000-8000-000000000003', %L) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000003', 'Package A'))), 'P0001 job_closed', 'and an Undo');

-- ── Products only this job sells (B2) ─────────────────────────────────────────────────────────────────────────────
select lives_ok($$ insert into ids values ('pkg', public.save_job_item('a0000000-0000-4000-8000-000000000001', null,
  '{"kind": "package", "name": "Sibling package", "description": "Two kids, one pose each", "price_cents": 9900}',
  '[{"kind": "print", "print_size": "8x10", "quantity": 1}, {"kind": "digital", "print_size": null, "quantity": 1}]')) $$,
  'an owner adds a package only job 1 sells');
select lives_ok($$ insert into ids values ('print', public.save_job_item('a0000000-0000-4000-8000-000000000001', null,
  '{"kind": "print", "name": "Panorama", "print_size": "11x14", "price_cents": 4500}', null)) $$,
  'and a print');
select is((select array_agg(x ->> 'name' order by (x ->> 'ord')::int) from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x
           where x ->> 'kind' = 'package'), array['Package A', 'Package B', 'Package C', 'Sibling package'],
  'job-only products come after the list''s in their group (N5)');
select is((select x -> 'list_price_cents' from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x
           where x ->> 'name' = 'Panorama'), 'null'::jsonb, 'with no list price');
select is((select x -> 'contents' from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x
           where x ->> 'name' = 'Sibling package'),
  '[{"kind": "print", "quantity": 1, "print_size": "8x10"}, {"kind": "digital", "quantity": 1, "print_size": null}]'::jsonb,
  'and its own contents');
select is((public.job_shop('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001')
           ->> 'changes')::int, 3, 'each counts as a change (N1)');
select is(pg_temp.event_data('job_item.created'), jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001',
  'kind', 'print'), 'job_item.created names the job and kind');
select is(pg_temp.events('job_item.updated'), 0::bigint, 'a new package''s contents write no event of their own');
select lives_ok($$ select public.save_job_item('a0000000-0000-4000-8000-000000000001', (select id from ids where k = 'pkg'),
  '{"price_cents": 9500}', '[{"kind": "print", "print_size": "5x7", "quantity": 2}]') $$,
  'its price and contents change in one go');
select is((select (price_cents, id)::text from public.job_shop_items where name = 'Sibling package'),
  (9500, (select id from ids where k = 'pkg'))::text, 'in place: the id stays (orders point at it)');
select is((select array_agg(e.data -> 'fields' order by e.id) from public.events e where e.type = 'job_item.updated'),
  array['["price_cents"]'::jsonb],
  'one event for the fields (a package made in the same transaction writes no contents event, as price lists)');
select lives_ok($$ select public.save_job_item('a0000000-0000-4000-8000-000000000001', (select id from ids where k = 'print'),
  '{"sold": false}', null) $$, 'the Sold switch works on a job''s product');
select is((select (x ->> 'sold')::boolean from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x
           where x ->> 'name' = 'Panorama'), false, 'it isn''t sold');
select is(pg_temp.try($$ select public.save_job_item('a0000000-0000-4000-8000-000000000001', null,
  '{"kind": "digital_single", "name": "Job download", "price_cents": 100}', null) $$) like '23514%', true,
  'a job can''t add a download (one per list, B2)');
select is(pg_temp.try($$ select public.save_job_item('a0000000-0000-4000-8000-000000000001', null,
  '{"kind": "package", "name": "Empty", "price_cents": 100}', '[]') $$), 'P0001 package_empty',
  'a package needs contents');
select is(pg_temp.try(format($$ select public.save_job_item('a0000000-0000-4000-8000-000000000001', null, %L, null) $$,
  jsonb_build_object('kind', 'print', 'name', 'Bad ' || U&'\202E' || 'name', 'print_size', '5x7', 'price_cents', 100)))
  like '23514%', true,
  'names follow the price list''s text rules');
select is(pg_temp.try($$ select public.save_job_item('a0000000-0000-4000-8000-000000000001', null,
  '{"kind": "package", "name": "Too much", "price_cents": 100}',
  (select jsonb_agg(jsonb_build_object('kind', 'print', 'print_size', '4x6', 'quantity', 1)) from generate_series(1, 21))) $$),
  'P0001 line_limit', 'at most 20 lines');
select is(pg_temp.try($$ insert into public.job_shop_package_lines (studio_id, job_id, job_item_id, line_kind,
  print_size, quantity) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
  (select id from ids where k = 'print'), 'print', '4x6', 1) $$), '23514 not_package', 'only packages have lines');
select is(pg_temp.try($$ update public.job_shop_items set kind = 'package' where name = 'Panorama' $$) like '42501%',
  true, 'a product never changes kind');
select is(pg_temp.try($$ select public.delete_job_item('a0000000-0000-4000-8000-000000000001',
  (select id from ids where k = 'print')) $$), 'ok', 'an owner removes a product');
select is(pg_temp.event_data('job_item.deleted'), jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001',
  'kind', 'print'), 'job_item.deleted names the job and kind');

-- At most 100 per job, whoever writes.
reset role;
insert into public.job_shop_items (studio_id, job_id, kind, name, print_size, price_cents)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'print', 'Print ' || n, '4x6', 100
from generate_series(1, 100) n;
select is(pg_temp.try($$ insert into public.job_shop_items (studio_id, job_id, kind, name, print_size, price_cents)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'print', 'One more', '4x6', 100) $$),
  'P0001 item_limit', 'the 101st product of a job is refused (B2)');
delete from public.job_shop_items where job_id = 'a0000000-0000-4000-8000-000000000002';
select is(pg_temp.try($$ insert into public.job_shop_items (studio_id, job_id, kind, name, price_cents)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'package', 'No lines', 100);
  set constraints all immediate $$), 'P0001 package_empty', 'a package without lines fails at commit');
set constraints all deferred;

-- ── A row is for the job's current list (not_on_list); a swap drops the old list's changes (B1) ──────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select lives_ok(format($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001', %L, 7000, null) $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'Package A')), 'job 1 has two changes on its list');
insert into ids values ('starter', (select price_list_id from public.jobs where id = 'a0000000-0000-4000-8000-000000000001'));
select lives_ok($$ update public.jobs set price_list_id = 'e0000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000001' $$, 'an owner swaps job 1 to Spring');
select is((select count(*) from public.job_price_overrides where job_id = 'a0000000-0000-4000-8000-000000000001'),
  0::bigint, 'the old list''s changes are gone');
select is((select count(*) from public.job_shop_items where job_id = 'a0000000-0000-4000-8000-000000000001'),
  1::bigint, 'the job''s own package stays');
select is(pg_temp.events('job_price.reset'), 3::bigint, 'dropping them writes no job_price.reset events');
select is((select e.data -> 'fields' from public.events e where e.type = 'job.updated' order by e.occurred_at desc,
           e.id desc limit 1), '["price_list_id"]'::jsonb, 'job.updated says the list changed');
select is(pg_temp.try(format($$ insert into public.job_price_overrides (studio_id, job_id, price_list_id,
    price_list_item_id, price_cents) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a0000000-0000-4000-8000-000000000001', %L, %L, 100) $$, (select id from ids where k = 'starter'),
  pg_temp.item('a0000000-0000-4000-8000-000000000002', 'Package A'))), 'P0001 not_on_list',
  'a change written for the list the job had before the swap is refused (the swap race)');
select is((select array_agg(x ->> 'name' order by (x ->> 'ord')::int) from pg_temp.offer('a0000000-0000-4000-8000-000000000001') x),
  array['Sibling package', 'Spring 5×7'], 'job 1 now sells Spring''s print and its own package');

-- Deleting a list item takes this job's change with it, with no event.
select lives_ok($$ select public.set_job_price('a0000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001', 1500, null) $$, 'a price for Spring''s print');
select lives_ok($$ delete from public.price_list_items where id = 'e1000000-0000-4000-8000-000000000001' $$,
  'the print is deleted from Spring');
select is((select count(*) from public.job_price_overrides where job_id = 'a0000000-0000-4000-8000-000000000001'),
  0::bigint, 'its change for job 1 went with it');
select is(pg_temp.events('job_price.reset'), 3::bigint, 'with no job_price.reset event');

select lives_ok(format($$ delete from public.price_list_items where id = %L $$,
  pg_temp.item('a0000000-0000-4000-8000-000000000003', 'Wallets (sheet of 8)')),
  'deleting a list item a closed job switched off works (a cascade never fails on a closed job)');
select is((select count(*) from public.job_price_overrides where job_id = 'a0000000-0000-4000-8000-000000000003'),
  0::bigint, 'and takes the closed job''s change with it');

-- ── Events never hold amounts or names ────────────────────────────────────────────────────────────────────────────
reset role;
select is((select count(*) from public.events e where e.type like 'job\_price.%' or e.type like 'job\_item.%'),
  (select count(*) from public.events e where (e.type like 'job\_price.%' or e.type like 'job\_item.%')
     and not e.data::text ~ '(9500|9900|7000|1800|Sibling|Panorama)'),
  'no event holds a price or a name');

select * from finish();
rollback;
