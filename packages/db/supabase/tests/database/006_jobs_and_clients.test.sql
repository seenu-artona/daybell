-- Jobs, clients and job categories (D96, D131): studio separation, roles, the status lock, Quebec, numbers,
-- seeded categories, and events without personal data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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

-- Every new studio gets the starter categories, in order, without extra events.
select results_eq(
  $$ select name from public.job_categories where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by position $$,
  array['Fall', 'Spring', 'Graduation', 'Sports', 'Dance', 'Yearbook', 'Other'],
  'new studios start with the seven job categories');
select is((select count(*) from public.events where type like 'job_category.%'), 0::bigint,
  'seeding categories writes no events of its own');

-- Studio B's client, category and job, written as the database owner.
insert into public.clients (id, studio_id, name, contact_email) values
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Secret School', 'b@example.test');
insert into public.jobs (id, studio_id, name, type, client_id, picture_day, internal_number, category_id) values
  ('b0000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school',
   'b0000000-0000-4000-8000-000000000001', '2026-10-01', 'JOB00001',
   (select id from public.job_categories where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and name = 'Fall'));

-- Ids of rows created below, readable after switching roles.
create temp table ids (k text primary key, id uuid not null);
grant all on ids to authenticated;
insert into ids select 'fall', id from public.job_categories
  where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Fall';
insert into ids select 'b_cat', id from public.job_categories
  where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and name = 'Fall';

-- ── As the owner of studio A ──────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true) is not null as signed_in;

select lives_ok($$
  with r as (
    insert into public.clients (studio_id, name, city, region_code, postal_code, country,
                                contact_first_name, contact_last_name, contact_phone, contact_email)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Elementary', 'Toronto', 'ON', 'M5V 2T6', 'CA',
            'Pat', 'Rivera', '+1 416 555 0100', 'pat.rivera@example.test')
    returning id)
  insert into ids select 'client', id from r $$,
  'owner A adds a client with a contact person');
select lives_ok($$
  with r as (
    insert into public.jobs (studio_id, name, type, client_id, picture_day, internal_number, category_id, subjects_expected)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Fall 2026', 'school', (select id from ids where k = 'client'),
            '2026-10-14', 'JOB00001', (select id from ids where k = 'fall'), 120)
    returning id)
  insert into ids select 'job', id from r $$,
  'owner A adds a job for it');
select is((select status::text from public.jobs where id = (select id from ids where k = 'job')), 'draft',
  'new jobs start as drafts');
select lives_ok($$
  insert into public.jobs (studio_id, name, type, picture_day, internal_number, category_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Spring minis', 'school', '2026-04-02', 'JOB00007',
          (select id from ids where k = 'fall')) $$,
  'a client is optional for every job type');
select is(public.next_job_number('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'JOB00008',
  'the next job number follows the highest one');
select is(public.next_job_number('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'JOB00001',
  'the next job number never looks at another studio''s jobs');

-- Cross-studio reads and writes.
select is((select count(*) from public.clients), 1::bigint, 'owner A sees only studio A clients');
select is((select count(*) from public.jobs), 2::bigint, 'owner A sees only studio A jobs');
select is((select count(*) from public.job_categories), 7::bigint, 'owner A sees only studio A categories');
select throws_ok($$
  insert into public.clients (studio_id, name) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Planted') $$,
  '42501', null, 'owner A cannot add a client to studio B');
select throws_ok($$
  insert into public.job_categories (studio_id, name) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Planted') $$,
  '42501', null, 'owner A cannot add a category to studio B');
select throws_ok($$
  insert into public.jobs (studio_id, name, type, picture_day, internal_number, category_id)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Planted', 'seniors', '2026-10-01', 'X1', (select id from ids where k = 'b_cat')) $$,
  '42501', null, 'owner A cannot add a job to studio B');
update public.clients set name = 'hacked' where id = 'b0000000-0000-4000-8000-000000000001';
update public.jobs set name = 'hacked' where id = 'b0000000-0000-4000-8000-000000000002';
update public.job_categories set name = 'hacked' where id = (select id from ids where k = 'b_cat');
select throws_ok($$
  insert into public.jobs (studio_id, name, type, client_id, picture_day, internal_number, category_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Borrowed', 'school', 'b0000000-0000-4000-8000-000000000001',
          '2026-10-01', 'JOB00100', (select id from ids where k = 'fall')) $$,
  '23503', null, 'a job cannot use another studio''s client');
select throws_ok($$
  update public.jobs set category_id = (select id from ids where k = 'b_cat') where id = (select id from ids where k = 'job') $$,
  '23503', null, 'a job cannot use another studio''s category');

-- Numbers, dates and categories.
select throws_ok($$
  insert into public.jobs (studio_id, name, type, picture_day, internal_number, category_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Twin', 'seniors', '2026-10-01', 'job00001', (select id from ids where k = 'fall')) $$,
  '23505', null, 'internal job numbers are unique per studio, ignoring case');
select throws_ok($$
  insert into public.jobs (studio_id, name, type, internal_number, category_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Undated', 'seniors', 'JOB00200', (select id from ids where k = 'fall')) $$,
  '23502', null, 'a job needs a picture day');
select throws_ok($$
  update public.jobs set subjects_expected = 0 where id = (select id from ids where k = 'job') $$,
  '23514', null, 'subjects expected is at least 1');
select throws_ok($$
  insert into public.job_categories (studio_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fall') $$,
  '23505', null, 'category names are unique per studio, ignoring case');

-- The status lock (step 8 adds the function that changes it) and other fixed columns.
select throws_ok($$ update public.jobs set status = 'selling' where id = (select id from ids where k = 'job') $$,
  '42501', null, 'a job''s status cannot be changed directly');
select throws_ok($$
  update public.jobs set studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = (select id from ids where k = 'job') $$,
  '42501', null, 'a job cannot move studio');
select throws_ok($$ delete from public.jobs $$, '42501', null, 'jobs cannot be deleted');
select throws_ok($$ delete from public.clients $$, '42501', null, 'clients cannot be deleted');
select throws_ok($$ delete from public.job_categories $$, '42501', null, 'categories cannot be deleted');

-- Quebec (D131) and the contact email.
select throws_ok($$
  insert into public.clients (studio_id, name, region_code, country)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'École Montréal', 'QC', 'CA') $$,
  '23514', null, 'Quebec clients are refused (D131)');
select throws_ok($$
  insert into public.clients (studio_id, name, postal_code, country)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'École Laval', 'H7N 1A1', 'CA') $$,
  '23514', null, 'a Quebec postal code is refused even without a province');
select throws_ok($$
  update public.clients set region_code = 'QC' where id = (select id from ids where k = 'client') $$,
  '23514', null, 'a client cannot be moved to Quebec');
select throws_ok($$
  update public.clients set contact_email = 'not an email' where id = (select id from ids where k = 'client') $$,
  '23514', null, 'the contact email must look like an email');

-- One event per change, with field names only: no names, addresses or contact details.
update public.jobs set name = 'Lincoln Fall Picture Day', picture_day = '2026-10-15', subjects_expected = 130
  where id = (select id from ids where k = 'job');
update public.jobs set name = name where id = (select id from ids where k = 'job');
update public.clients set city = 'Ottawa', contact_phone = '+1 613 555 0199' where id = (select id from ids where k = 'client');
select results_eq(
  $$ select type, data from public.events where type like 'job.%' or type like 'client.%' order by id $$,
  $$ values ('client.created', '{}'::jsonb),
            ('job.created', '{"type":"school","status":"draft"}'::jsonb),
            ('job.created', '{"type":"school","status":"draft"}'::jsonb),
            ('job.updated', '{"fields":["name","picture_day","subjects_expected"]}'::jsonb),
            ('client.updated', '{"fields":["city","contact_phone"]}'::jsonb) $$,
  'each change writes one event with field names only'
);
select is(
  (select count(*) from public.events
    where data::text ~* '(lincoln|toronto|ottawa|rivera|pat|555|@|M5V|JOB0)'),
  0::bigint, 'events never contain names, addresses, contact details or job numbers');
select is((select subject_id from public.events where type = 'job.updated'),
  (select id from ids where k = 'job'), 'events point at the job by id');

-- ── As an admin of studio A ───────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555"}', true) is not null as signed_in;
select lives_ok($$
  update public.clients set notes = 'Front office entrance' where id = (select id from ids where k = 'client') $$,
  'admins edit clients');
select lives_ok($$
  insert into public.job_categories (studio_id, name, position) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Winter', 8) $$,
  'admins add categories');

-- ── As a photographer and as staff of studio A: read-only ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true) is not null as signed_in;
select is((select count(*) from public.jobs), 2::bigint, 'photographers see the studio''s jobs');
select throws_ok($$
  insert into public.jobs (studio_id, name, type, picture_day, internal_number, category_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mine', 'seniors', '2026-10-01', 'P1', (select id from ids where k = 'fall')) $$,
  '42501', null, 'photographers cannot add jobs');
update public.jobs set name = 'photographer edit' where id = (select id from ids where k = 'job');
update public.job_categories set name = 'photographer edit' where id = (select id from ids where k = 'fall');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true) is not null as signed_in;
select is((select count(*) from public.clients), 1::bigint, 'staff see the studio''s clients');
select throws_ok($$
  insert into public.clients (studio_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mine') $$,
  '42501', null, 'staff cannot add clients');
select throws_ok($$
  insert into public.job_categories (studio_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mine') $$,
  '42501', null, 'staff cannot add categories');
update public.clients set name = 'staff edit' where id = (select id from ids where k = 'client');

-- ── As owner B ────────────────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true) is not null as signed_in;
select results_eq($$ select name from public.jobs $$, array['B Fall'], 'owner B sees only studio B jobs');
select is((select count(*) from public.job_categories where name = 'Winter'), 0::bigint,
  'owner B does not see studio A''s categories');

-- ── As a logged-out visitor ───────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok($$ select * from public.jobs $$, '42501', null, 'logged-out visitors cannot read jobs');
select throws_ok($$ select * from public.clients $$, '42501', null, 'logged-out visitors cannot read clients');
select throws_ok($$ select * from public.job_categories $$, '42501', null, 'logged-out visitors cannot read categories');

-- ── Results of the blocked writes, checked as the database owner ──────────────────────────────────────────────────
reset role;
select results_eq(
  $$ select (select name from public.clients where id = 'b0000000-0000-4000-8000-000000000001')
         || ' / ' || (select name from public.jobs where id = 'b0000000-0000-4000-8000-000000000002')
         || ' / ' || (select name from public.job_categories where id = (select id from ids where k = 'b_cat')) $$,
  array['B Secret School / B Fall / Fall'], 'owner A could not edit studio B''s client, job or category');
select results_eq(
  $$ select (select name from public.clients where id = (select id from ids where k = 'client'))
         || ' / ' || (select name from public.jobs where id = (select id from ids where k = 'job'))
         || ' / ' || (select name from public.job_categories where id = (select id from ids where k = 'fall')) $$,
  array['Lincoln Elementary / Lincoln Fall Picture Day / Fall'], 'photographers and staff could not edit anything');
select lives_ok($$ delete from public.studios where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  'a studio can still be deleted with its jobs, clients and categories');

select * from finish();
rollback;
