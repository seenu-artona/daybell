-- Saved filter chips (D147, D96, D113; ADR 0026): row-level security is on; a person reads only their own chips in
-- their own studio (not another member's, not another studio's); nobody signed in writes the table directly;
-- save_list_filters checks membership, the job's studio, the count, the keys and the ids (never echoing a value);
-- chips go with their job and with their person's membership; the event holds the page and the count only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'admin');
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Spring', 'school', '2027-04-01', 'JOB00002'),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Winter', 'school', '2027-01-10', 'JOB00003'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
-- Nine clients of studio A (c…01 to c…09) and one of B; a class in job A1 and one in job A3.
insert into public.clients (id, studio_id, name)
select ('c0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Client ' || n
from generate_series(1, 9) n;
insert into public.clients (id, studio_id, name) values
  ('cb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Client');
insert into public.job_groups (id, studio_id, job_id, name) values
  ('d0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Room 1'),
  ('d0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000003', 'Room 3');

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
-- Client chips for Jobs, naming studio A's clients 1 to n.
create function pg_temp.chips(p_n int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', 'client',
    'value', ('c0000000-0000-4000-8000-' || lpad(n::text, 12, '0')))), '[]'::jsonb)
  from generate_series(1, p_n) n $$;
grant execute on function pg_temp.chips(int) to authenticated;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'list_filter_chips', 'list_filter_chips exists');
select ok((select relrowsecurity from pg_class where oid = 'public.list_filter_chips'::regclass),
  'row-level security is on');
select ok(not has_table_privilege('authenticated', 'public.list_filter_chips', 'insert')
  and not has_table_privilege('authenticated', 'public.list_filter_chips', 'update')
  and not has_table_privilege('authenticated', 'public.list_filter_chips', 'delete')
  and not has_table_privilege('anon', 'public.list_filter_chips', 'select'),
  'nobody signed in writes the table directly, and logged-out visitors can''t read it');
select ok(has_function_privilege('authenticated', 'public.save_list_filters(uuid, public.list_page, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.save_list_filters(uuid, public.list_page, uuid, jsonb)', 'execute'),
  'signed-in people save through save_list_filters; logged-out visitors can''t');

-- ── Saving as studio A's owner ────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select lives_ok($$
  select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
    '[{"key": "closingThisWeek"}, {"key": "client", "value": "c0000000-0000-4000-8000-000000000001"}]') $$,
  'the owner saves two chips on Jobs');
select results_eq($$
  select position::int, filter_key, filter_value from public.list_filter_chips
  where page = 'jobs' order by position $$,
  $$ values (1, 'closingThisWeek', null::uuid), (2, 'client', 'c0000000-0000-4000-8000-000000000001'::uuid) $$,
  'and reads them back in order');
select lives_ok($$
  select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null, '[{"key": "pictureDayThisMonth"}]') $$,
  'saving again replaces the list');
select results_eq($$ select filter_key from public.list_filter_chips where page = 'jobs' $$,
  $$ values ('pictureDayThisMonth') $$, 'only the new chip is left');
select lives_ok($$
  select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_subjects',
    'a0000000-0000-4000-8000-000000000001',
  '[{"key": "doNotPhotograph"}, {"key": "class", "value": "d0000000-0000-4000-8000-000000000001"}]') $$,
  'a job tab''s chips belong to that job, with its own classes');
select lives_ok($$
  select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_subjects',
    'a0000000-0000-4000-8000-000000000002', '[{"key": "noClass"}, {"key": "doNotPublish"}]') $$,
  'and another job''s tab keeps its own');
select is((select count(*) from public.list_filter_chips
  where page = 'job_subjects' and job_id = 'a0000000-0000-4000-8000-000000000001'), 2::bigint,
  'saving one job''s chips doesn''t touch another job''s');
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'orders', null, '[]') $$,
  'an empty list clears a page');
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'orders', null,
  '[{"key": "deliveryHome"}, {"key": "job", "value": "a0000000-0000-4000-8000-000000000002"}]') $$,
  'Orders takes a delivery and one of the studio''s jobs');
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_orders',
  'a0000000-0000-4000-8000-000000000003', '[{"key": "deliverySchool"}]') $$, 'a job''s Orders takes a delivery');
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  pg_temp.chips(8)) $$, 'eight chips are allowed');

-- ── Refusals: fixed messages, never the value sent ────────────────────────────────────────────────────────────────
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  pg_temp.chips(9)) $$, '22023', 'list_filters_too_many', 'nine are not');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "deliveryHome"}]') $$, '22023', 'list_filters_invalid', 'a key another list takes is refused');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "closingThisWeek", "value": "c0000000-0000-4000-8000-000000000001"}]') $$, '22023',
  'list_filters_invalid', 'so is an id on a key that takes none');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "client"}]') $$, '22023', 'list_filters_invalid', 'and a client chip without its client');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "client", "value": "cb000000-0000-4000-8000-000000000001"}]') $$, '22023', 'list_filters_record',
  'another studio''s client is refused, even called directly');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'orders', null,
  '[{"key": "job", "value": "b0000000-0000-4000-8000-000000000001"}]') $$, '22023', 'list_filters_record',
  'so is another studio''s job');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_subjects',
  'a0000000-0000-4000-8000-000000000001', '[{"key": "class", "value": "d0000000-0000-4000-8000-000000000003"}]') $$,
  '22023', 'list_filters_record', 'and another job''s class');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "client", "value": "Maya Johnson"}]') $$, '22023', 'list_filters_invalid',
  'a value that isn''t an id is refused, and the message doesn''t repeat it');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "grade", "value": 5}]') $$, '22023', 'list_filters_invalid', 'so is a number');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "Maya Johnson"}]') $$, '22023', 'list_filters_invalid', 'and a key that isn''t a key');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "closingThisWeek"}, {"key": "closingThisWeek"}]') $$, '22023', 'list_filters_duplicate',
  'the same chip twice is refused');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_orders', null, '[]') $$,
  '22023', 'list_filters_job', 'a job''s tab needs its job');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs',
  'a0000000-0000-4000-8000-000000000001', '[]') $$, '22023', 'list_filters_job', 'and a studio list takes none');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_orders',
  'b0000000-0000-4000-8000-000000000001', '[]') $$, '22023', 'list_filters_job',
  'another studio''s job is refused');
select throws_ok($$ select public.save_list_filters('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'jobs', null, '[]') $$,
  '42501', 'Not a member of this studio', 'and so is saving in a studio the person isn''t part of');

-- ── Who reads what ────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('55555555-5555-4555-8555-555555555555') as signed_in;
select is((select count(*) from public.list_filter_chips), 0::bigint,
  'another member of the same studio reads none of the owner''s chips');
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'jobs', null,
  '[{"key": "closingThisWeek"}]') $$, 'the admin saves their own');
select results_eq($$ select user_id, filter_key from public.list_filter_chips $$,
  $$ values ('55555555-5555-4555-8555-555555555555'::uuid, 'closingThisWeek') $$, 'and reads only those');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select is((select count(*) from public.list_filter_chips), 0::bigint, 'studio B''s owner reads none of studio A''s chips');
select throws_ok($$
  insert into public.list_filter_chips (studio_id, user_id, page, position, filter_key)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'jobs', 1, 'closingThisWeek') $$,
  '42501', null, 'and can''t write chips directly, even their own');

-- ── Chips go with their job and their person ──────────────────────────────────────────────────────────────────────
reset role;
delete from public.jobs where id = 'a0000000-0000-4000-8000-000000000002';
select is((select count(*) from public.list_filter_chips where job_id = 'a0000000-0000-4000-8000-000000000002'),
  0::bigint, 'a deleted job''s chips go with it');
delete from public.studio_members
where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '55555555-5555-4555-8555-555555555555';
select is((select count(*) from public.list_filter_chips where user_id = '55555555-5555-4555-8555-555555555555'),
  0::bigint, 'and a person who leaves the studio takes theirs');
select is((select count(*) from public.list_filter_chips where user_id = '11111111-1111-4111-8111-111111111111'),
  13::bigint, 'the owner''s other chips stay (Jobs 8, job A1''s Subjects 2, Orders 2, job A3''s Orders 1)');

-- ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────
select results_eq($$
  select actor_id, subject_id, data from public.events where type = 'list_filters.saved' order by id limit 3 $$,
  $$ values
    ('11111111-1111-4111-8111-111111111111'::uuid, null::uuid, '{"page": "jobs", "count": 2}'::jsonb),
    ('11111111-1111-4111-8111-111111111111'::uuid, null::uuid, '{"page": "jobs", "count": 1}'::jsonb),
    ('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid,
     '{"page": "job_subjects", "count": 2}'::jsonb) $$,
  'each save writes one event: who, the job for a job''s tab, the page and how many chips');
select is((select count(*) from public.events
  where type = 'list_filters.saved' and (data::text ~ 'c0000000' or data::text ~* '(closing|client|maya|key|value)')),
  0::bigint, 'events never hold the chips'' keys or values');

select * from finish();
rollback;
