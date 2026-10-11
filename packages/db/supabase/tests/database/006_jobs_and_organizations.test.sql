-- Jobs and organizations (D96, D131): studio separation, roles, the status lock, Quebec, and events.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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

-- Studio B's organization and job, written as the database owner.
insert into public.organizations (id, studio_id, name, kind) values
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Secret School', 'school');
insert into public.jobs (id, studio_id, name, type, organization_id) values
  ('b0000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school',
   'b0000000-0000-4000-8000-000000000001');

-- Ids of rows created below, readable after switching roles.
create temp table ids (k text primary key, id uuid not null);
grant all on ids to authenticated;

-- ── As the owner of studio A ──────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true) is not null as signed_in;

select lives_ok($$
  with r as (
    insert into public.organizations (studio_id, name, kind, city, region_code, postal_code, country)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Elementary', 'school', 'Toronto', 'ON', 'M5V 2T6', 'CA')
    returning id)
  insert into ids select 'org', id from r $$,
  'owner A adds an organization');
select lives_ok($$
  with r as (
    insert into public.jobs (studio_id, name, type, organization_id, picture_day)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Fall 2026', 'school', (select id from ids where k = 'org'),
            '2026-10-14')
    returning id)
  insert into ids select 'job', id from r $$,
  'owner A adds a job for it');
select is((select status::text from public.jobs where id = (select id from ids where k = 'job')), 'draft',
  'new jobs start as drafts');
select lives_ok($$
  insert into public.jobs (studio_id, name, type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Senior minis', 'seniors') $$,
  'seniors jobs need no organization');

-- Cross-studio reads and writes.
select is((select count(*) from public.organizations), 1::bigint, 'owner A sees only studio A organizations');
select is((select count(*) from public.jobs), 2::bigint, 'owner A sees only studio A jobs');
select throws_ok($$
  insert into public.organizations (studio_id, name, kind) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Planted', 'school') $$,
  '42501', null, 'owner A cannot add an organization to studio B');
select throws_ok($$
  insert into public.jobs (studio_id, name, type) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Planted', 'seniors') $$,
  '42501', null, 'owner A cannot add a job to studio B');
update public.organizations set name = 'hacked' where id = 'b0000000-0000-4000-8000-000000000001';
update public.jobs set name = 'hacked' where id = 'b0000000-0000-4000-8000-000000000002';
select throws_ok($$
  insert into public.jobs (studio_id, name, type, organization_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Borrowed', 'school', 'b0000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a job cannot use another studio''s organization');
select throws_ok($$
  update public.jobs set organization_id = 'b0000000-0000-4000-8000-000000000001'
  where id = (select id from ids where k = 'job') $$,
  '23503', null, 'a job cannot be moved to another studio''s organization');

-- The status lock (step 8 adds the function that changes it) and other fixed columns.
select throws_ok($$ update public.jobs set status = 'selling' where id = (select id from ids where k = 'job') $$,
  '42501', null, 'a job''s status cannot be changed directly');
select throws_ok($$
  insert into public.jobs (studio_id, name, type, status) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Live', 'seniors', 'selling') $$,
  '42501', null, 'a job cannot be created already selling');
select throws_ok($$
  update public.jobs set studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = (select id from ids where k = 'job') $$,
  '42501', null, 'a job cannot move studio');
select throws_ok($$ delete from public.jobs $$, '42501', null, 'jobs cannot be deleted');
select throws_ok($$ delete from public.organizations $$, '42501', null, 'organizations cannot be deleted');

-- Rules.
select throws_ok($$
  insert into public.organizations (studio_id, name, kind, region_code, country)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'École Montréal', 'school', 'QC', 'CA') $$,
  '23514', null, 'Quebec organizations are refused (D131)');
select throws_ok($$
  update public.organizations set region_code = 'QC' where id = (select id from ids where k = 'org') $$,
  '23514', null, 'an organization cannot be moved to Quebec');
select throws_ok($$
  insert into public.organizations (studio_id, name, kind, postal_code, country)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'École Laval', 'school', 'H7N 1A1', 'CA') $$,
  '23514', null, 'a Quebec postal code is refused even without a province');
select throws_ok($$
  insert into public.jobs (studio_id, name, type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'No school', 'school') $$,
  '23514', null, 'school jobs need an organization');
select throws_ok($$
  update public.jobs set type = 'sports' where name = 'Senior minis' $$,
  '23514', null, 'a job without an organization cannot become a sports job');

-- One event per change, without names or addresses.
update public.jobs set name = 'Lincoln Fall Picture Day', picture_day = '2026-10-15'
  where id = (select id from ids where k = 'job');
update public.jobs set name = name where id = (select id from ids where k = 'job');
update public.organizations set city = 'Ottawa' where id = (select id from ids where k = 'org');
select results_eq(
  $$ select type, data from public.events where type like 'job.%' or type like 'organization.%' order by id $$,
  $$ values ('organization.created', '{"kind":"school"}'::jsonb),
            ('job.created', '{"type":"school","status":"draft"}'::jsonb),
            ('job.created', '{"type":"seniors","status":"draft"}'::jsonb),
            ('job.updated', '{"fields":["name","picture_day"]}'::jsonb),
            ('organization.updated', '{"fields":["city"]}'::jsonb) $$,
  'each change writes one event with kinds and field names only'
);
select is(
  (select count(*) from public.events
    where data::text ~* '(lincoln|toronto|ottawa|senior minis|M5V)'),
  0::bigint, 'events never contain names or addresses');
select is((select subject_id from public.events where type = 'job.updated'),
  (select id from ids where k = 'job'), 'events point at the job by id');

-- ── As an admin of studio A ───────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555"}', true) is not null as signed_in;
select lives_ok($$
  update public.organizations set notes = 'Front office entrance' where id = (select id from ids where k = 'org') $$,
  'admins edit organizations');

-- ── As a photographer and as staff of studio A: read-only ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true) is not null as signed_in;
select is((select count(*) from public.jobs), 2::bigint, 'photographers see the studio''s jobs');
select throws_ok($$
  insert into public.jobs (studio_id, name, type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mine', 'seniors') $$,
  '42501', null, 'photographers cannot add jobs');
update public.jobs set name = 'photographer edit' where id = (select id from ids where k = 'job');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true) is not null as signed_in;
select is((select count(*) from public.organizations), 1::bigint, 'staff see the studio''s organizations');
select throws_ok($$
  insert into public.organizations (studio_id, name, kind) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mine', 'club') $$,
  '42501', null, 'staff cannot add organizations');
update public.organizations set name = 'staff edit' where id = (select id from ids where k = 'org');

-- ── As owner B ────────────────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true) is not null as signed_in;
select results_eq($$ select name from public.jobs $$, array['B Fall'], 'owner B sees only studio B jobs');

-- ── As a logged-out visitor ───────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok($$ select * from public.jobs $$, '42501', null, 'logged-out visitors cannot read jobs');
select throws_ok($$ select * from public.organizations $$, '42501', null, 'logged-out visitors cannot read organizations');

-- ── Results of the blocked writes, checked as the database owner ──────────────────────────────────────────────────
reset role;
select results_eq(
  $$ select (select name from public.organizations where id = 'b0000000-0000-4000-8000-000000000001')
         || ' / ' || (select name from public.jobs where id = 'b0000000-0000-4000-8000-000000000002') $$,
  array['B Secret School / B Fall'], 'owner A could not edit studio B''s organization or job');
select results_eq(
  $$ select (select name from public.organizations where id = (select id from ids where k = 'org'))
         || ' / ' || (select name from public.jobs where id = (select id from ids where k = 'job')) $$,
  array['Lincoln Elementary / Lincoln Fall Picture Day'], 'photographers and staff could not edit anything');
select lives_ok($$ delete from public.studios where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  'a studio can still be deleted with its jobs and organizations');

select * from finish();
rollback;
