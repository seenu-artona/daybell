-- The roster (D23, D96; Seenu's answers of Oct 11 2026; ADR 0011): studio separation, roles, column grants that
-- hide and freeze access codes, server-only code writes (add_child and import_roster run only as the service role,
-- re-check the acting person's role and attribute events to them), globally unique codes, the draft-only delete guard,
-- the import RPC, the roster list with duplicate flags, and events without personal data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(102);

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

-- Fixtures written as the database owner: two jobs in studio A (a group in the second), and studio B's job, group and
-- child. Hashes and ciphertexts are fixed fakes in the right format.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Spring', 'school', '2027-04-01', 'JOB00002'),
  ('b0000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
insert into public.job_groups (id, studio_id, job_id, name) values
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'Other job room'),
  ('b0000000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000002', 'B Room');
insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, access_code_hash, access_code_ciphertext) values
  ('b0000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000003', 'Bianca', 'Secret', repeat('b', 64), 'v1.' || repeat('B', 48));

create temp table ids (k text primary key, id uuid not null);
grant all on ids to authenticated;
insert into ids values
  ('job', 'a0000000-0000-4000-8000-000000000001'), ('job2', 'a0000000-0000-4000-8000-000000000002'),
  ('other_group', 'a0000000-0000-4000-8000-000000000003'), ('b_job', 'b0000000-0000-4000-8000-000000000002'),
  ('b_group', 'b0000000-0000-4000-8000-000000000003'), ('b_child', 'b0000000-0000-4000-8000-000000000004'),
  ('c1', 'c0000000-0000-4000-8000-000000000001'), ('c2', 'c0000000-0000-4000-8000-000000000002'),
  ('c3', 'c0000000-0000-4000-8000-000000000003'), ('c4', 'c0000000-0000-4000-8000-000000000004');

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'job_groups', 'job_groups exists');
select has_table('public', 'children', 'children exists');
select ok(exists (select 1 from pg_constraint where conname = 'jobs_studio_id_id_key'),
  'jobs have a (studio_id, id) key for composite studio FKs');

-- Switching who is acting: as a signed-in person (authenticated, RLS applies) or as the server (service role).
create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.as_server() returns boolean language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) is not null $$;
-- A child for add_child, with fake code values in the right format.
create function pg_temp.child(p_id uuid, p_first text, p_last text, p_hash text, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'first_name', p_first, 'last_name', p_last, 'access_code_hash', p_hash,
    'access_code_ciphertext', 'v1.' || repeat('A', 48)) || p_extra $$;
grant all on ids to service_role;

-- ── As the owner of studio A ──────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;

select lives_ok($$
  with r as (
    insert into public.job_groups (studio_id, job_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job'), '4B') returning id)
  insert into ids select 'g4b', id from r $$,
  'owner A adds a class');
select throws_ok($$
  insert into public.job_groups (studio_id, job_id, name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job'), '4b') $$,
  '23505', null, 'class names are unique per job, ignoring case');
select lives_ok($$
  with r as (
    insert into public.job_groups (studio_id, job_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job2'), '4B') returning id)
  insert into ids select 'g4b_job2', id from r $$,
  'the same class name is fine in another job');

-- Code-bearing writes are server-only (ADR 0011): not even an owner can write codes from a browser session.
select throws_ok($$
  insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
  values (gen_random_uuid(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job'), 'Planted',
          'Code', repeat('9', 64), 'v1.' || repeat('A', 48)) $$,
  '42501', null, 'owners cannot write access code columns directly');
select throws_ok($$
  insert into public.children (studio_id, job_id, first_name, last_name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job'), 'No', 'Code') $$,
  '42501', null, 'owners cannot add children directly at all');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Planted', 'Child', repeat('9', 64))) $$,
  '42501', null, 'owners cannot run add_child from a browser session');
select throws_ok($$
  select public.import_roster('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'),
    jsonb_build_array(jsonb_build_object('action', 'add', 'id', gen_random_uuid(), 'first_name', 'X', 'last_name', 'Y',
      'access_code_hash', repeat('8', 64), 'access_code_ciphertext', 'v1.' || repeat('A', 48)))) $$,
  '42501', null, 'owners cannot run import_roster from a browser session');

-- ── As the server, acting for a person ────────────────────────────────────────────────────────────────────────────
reset role;
set local role service_role;
select pg_temp.as_server() as server;
select is(public.add_child('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'),
    pg_temp.child((select id from ids where k = 'c1'), 'Maya', 'Johnson', repeat('1', 64), jsonb_build_object(
      'group_id', (select id from ids where k = 'g4b'), 'student_id', 'S-1', 'grade', '3',
      'parent_email', 'maya.parent@example.test', 'school_provided', false))),
  (select id from ids where k = 'c1'), 'the server adds a child with a class for owner A');
select is(auth.uid(), null, 'and stops acting for owner A afterwards');
select is((select school_provided from public.children where id = (select id from ids where k = 'c1')), true,
  'roster children are always tagged school-provided (no marketing), whatever is sent');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'b_job'),
    pg_temp.child(gen_random_uuid(), 'Planted', 'Child', repeat('9', 64))) $$,
  '42501', null, 'the server cannot add a child to studio B for owner A');
select throws_ok($$
  select public.add_child('22222222-2222-4222-8222-222222222222', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Planted', 'Child', repeat('9', 64))) $$,
  '42501', null, 'the server cannot add a child to studio A for studio B''s owner');
select throws_ok($$
  select public.add_child('44444444-4444-4444-8444-444444444444', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Staff', 'Child', repeat('9', 64))) $$,
  '42501', null, 'the server cannot add a child for staff');
select throws_ok($$
  select public.add_child(null, (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Nobody', 'Child', repeat('9', 64))) $$,
  '42501', null, 'the server cannot add a child without acting for someone');
select throws_ok($$
  select public.import_roster('44444444-4444-4444-8444-444444444444', (select id from ids where k = 'job'),
    jsonb_build_array(jsonb_build_object('action', 'add', 'id', gen_random_uuid(), 'first_name', 'X', 'last_name', 'Y',
      'access_code_hash', repeat('8', 64), 'access_code_ciphertext', 'v1.' || repeat('A', 48)))) $$,
  '42501', null, 'the server cannot import for staff');
select throws_ok($$
  select public.import_roster('22222222-2222-4222-8222-222222222222', (select id from ids where k = 'job'),
    jsonb_build_array(jsonb_build_object('action', 'add', 'id', gen_random_uuid(), 'first_name', 'X', 'last_name', 'Y',
      'access_code_hash', repeat('8', 64), 'access_code_ciphertext', 'v1.' || repeat('A', 48)))) $$,
  '42501', null, 'the server cannot import into studio A for studio B''s owner');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Planted', 'Child', repeat('9', 64),
      jsonb_build_object('group_id', (select id from ids where k = 'b_group')))) $$,
  '23503', null, 'a child cannot use another studio''s class');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Planted', 'Child', repeat('9', 64),
      jsonb_build_object('group_id', (select id from ids where k = 'other_group')))) $$,
  '23503', null, 'a child cannot use a class from another job of the same studio');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Bad', 'Hash', 'K7QM4XPA')) $$,
  '23514', null, 'the code hash must be 64 hex characters (never the code itself)');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Bad', 'Cipher', repeat('9', 64)) || '{"access_code_ciphertext":"K7QM4XPA"}') $$,
  '23514', null, 'the encrypted code must be in the v1 format');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Twin', 'Code', repeat('1', 64))) $$,
  'P0001', 'access_code_collision', 'a code already in use is refused by name, so the API can try another');

-- ── As the owner of studio A again ────────────────────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;

-- Cross-studio reads and writes.
select is((select count(*) from public.children where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
        + (select count(*) from public.job_groups where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint, 'owner A sees none of studio B''s children or classes');
select is((select count(*) from public.children), 1::bigint, 'owner A sees only studio A children');
select throws_ok($$
  insert into public.job_groups (studio_id, job_id, name)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select id from ids where k = 'b_job'), 'Planted') $$,
  '42501', null, 'owner A cannot add a class to studio B');
select throws_ok($$
  insert into public.job_groups (studio_id, job_id, name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'b_job'), 'Planted') $$,
  '23503', null, 'a class cannot be put in another studio''s job');
update public.children set first_name = 'hacked' where id = (select id from ids where k = 'b_child');
delete from public.children where id = (select id from ids where k = 'b_child');
update public.job_groups set name = 'hacked' where id = (select id from ids where k = 'b_group');
select is(public.list_children((select id from ids where k = 'b_job')),
  '{"children":[],"total":0,"duplicates":0}'::jsonb, 'the roster list shows nothing of studio B''s job');
select is((select count(*) from public.list_job_groups((select id from ids where k = 'b_job'))), 0::bigint,
  'the class list shows nothing of studio B''s job');

-- Codes and fixed columns.
select throws_ok($$
  update public.children set access_code_hash = repeat('c', 64) where id = (select id from ids where k = 'c1') $$,
  '42501', null, 'a child''s code hash can never be changed');
select throws_ok($$
  update public.children set access_code_ciphertext = 'v1.' || repeat('C', 48) where id = (select id from ids where k = 'c1') $$,
  '42501', null, 'a child''s encrypted code can never be changed');
select throws_ok($$
  update public.children set job_id = (select id from ids where k = 'job2') where id = (select id from ids where k = 'c1') $$,
  '42501', null, 'a child cannot move job');
select throws_ok($$
  update public.children set studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = (select id from ids where k = 'c1') $$,
  '42501', null, 'a child cannot move studio');
select throws_ok($$
  update public.children set school_provided = false where id = (select id from ids where k = 'c1') $$,
  '42501', null, 'the school-provided tag cannot be removed');
select throws_ok($$ select access_code_hash from public.children $$,
  '42501', null, 'nobody signed in can read code hashes, not even owners');
select throws_ok($$
  update public.children set first_name = repeat('x', 61) where id = (select id from ids where k = 'c1') $$,
  '23514', null, 'first names are at most 60 characters');
select throws_ok($$
  update public.children set parent_email = 'Maya.Parent@Example.test' where id = (select id from ids where k = 'c1') $$,
  '23514', null, 'parent emails are stored in lower case');

-- ── As a photographer of studio A: roster editor ──────────────────────────────────────────────────────────────────
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select lives_ok($$
  with r as (
    insert into public.job_groups (studio_id, job_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job'), 'Room 5') returning id)
  insert into ids select 'g5', id from r $$,
  'photographers add classes');
select lives_ok($$ update public.job_groups set name = 'Room 5A' where id = (select id from ids where k = 'g5') $$,
  'photographers rename classes');
select throws_ok($$
  insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
  values (gen_random_uuid(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job'), 'Planted',
          'Code', repeat('9', 64), 'v1.' || repeat('A', 48)) $$,
  '42501', null, 'photographers cannot write access code columns directly');
select throws_ok($$
  select public.import_roster('33333333-3333-4333-8333-333333333333', (select id from ids where k = 'job'),
    jsonb_build_array(jsonb_build_object('action', 'add', 'id', gen_random_uuid(), 'first_name', 'X', 'last_name', 'Y',
      'access_code_hash', repeat('8', 64), 'access_code_ciphertext', 'v1.' || repeat('A', 48)))) $$,
  '42501', null, 'photographers cannot run import_roster from a browser session');
reset role;
set local role service_role;
select pg_temp.as_server() as server;
select lives_ok($$
  select public.add_child('33333333-3333-4333-8333-333333333333', (select id from ids where k = 'job'),
    pg_temp.child((select id from ids where k = 'c2'), 'Noah', 'Garcia', repeat('2', 64))) $$,
  'the server adds children for photographers');
reset role;
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select lives_ok($$
  update public.children set grade = '4', do_not_photograph = true where id = (select id from ids where k = 'c2') $$,
  'photographers edit children');
select lives_ok($$ delete from public.children where id = (select id from ids where k = 'c2') $$,
  'photographers remove children while the job is a draft');
select is((select count(*) from public.children where id = (select id from ids where k = 'c2')), 0::bigint,
  'the removed child is gone');

-- import_roster, run by the server for the photographer: two adds (one into a new class, one into "4B" spelled
-- differently) and an update of Maya by id.
reset role;
set local role service_role;
select pg_temp.as_server() as server;
select is(public.import_roster('33333333-3333-4333-8333-333333333333', (select id from ids where k = 'job'), jsonb_build_array(
    jsonb_build_object('action', 'add', 'id', (select id from ids where k = 'c3'), 'first_name', 'Liam',
      'last_name', 'Chen', 'group_name', '4b', 'student_id', 'S-2', 'access_code_hash', repeat('3', 64),
      'access_code_ciphertext', 'v1.' || repeat('A', 48)),
    jsonb_build_object('action', 'add', 'id', (select id from ids where k = 'c4'), 'first_name', 'Ava',
      'last_name', 'Patel', 'group_name', 'Room 6', 'do_not_publish', true, 'access_code_hash', repeat('4', 64),
      'access_code_ciphertext', 'v1.' || repeat('A', 48)),
    jsonb_build_object('action', 'update', 'id', (select id from ids where k = 'c1'), 'first_name', 'Maya',
      'last_name', 'Johnson-Lee', 'group_name', null, 'grade', null, 'parent_email', null,
      'do_not_photograph', true, 'do_not_publish', null))),
  '{"added":2,"updated":1,"groups_added":1}'::jsonb,
  'the server imports 2 new children (1 new class) and updates 1 for a photographer');
select is(auth.uid(), null, 'and stops acting for the photographer afterwards');
select results_eq($$
  select last_name, grade, parent_email, group_id, do_not_photograph, do_not_publish
  from public.children where id = (select id from ids where k = 'c1') $$,
  $$ values ('Johnson-Lee', '3', 'maya.parent@example.test', (select id from ids where k = 'g4b'), true, false) $$,
  're-import replaces names, keeps values the file left blank, and turns opt-outs on');
select is((select group_id from public.children where id = (select id from ids where k = 'c3')),
  (select id from ids where k = 'g4b'), 'imported rows find classes by name, ignoring case');
select is((select do_not_publish from public.children where id = (select id from ids where k = 'c4')), true,
  'imported opt-outs are kept');
select is(public.import_roster('11111111-1111-4111-8111-111111111111', (select id from ids where k = 'job'), jsonb_build_array(
    jsonb_build_object('action', 'update', 'id', (select id from ids where k = 'c1'), 'first_name', 'Maya',
      'last_name', 'Johnson-Lee', 'do_not_photograph', false))) ->> 'updated', '1',
  'a later import updates the child again');
select is((select do_not_photograph from public.children where id = (select id from ids where k = 'c1')), true,
  'a file can never turn an opt-out off');
select throws_ok($$
  select public.import_roster('33333333-3333-4333-8333-333333333333', (select id from ids where k = 'job'), jsonb_build_array(
    jsonb_build_object('action', 'add', 'id', gen_random_uuid(), 'first_name', 'Twin', 'last_name', 'Code',
      'group_name', 'Room 9', 'access_code_hash', repeat('3', 64), 'access_code_ciphertext', 'v1.' || repeat('A', 48)))) $$,
  'P0001', 'access_code_collision', 'a code already in use stops the whole import');
select is((select count(*) from public.job_groups where name = 'Room 9'), 0::bigint,
  'and nothing of it is kept, not even new classes');
select throws_ok($$
  select public.import_roster('33333333-3333-4333-8333-333333333333', (select id from ids where k = 'job'), jsonb_build_array(
    jsonb_build_object('action', 'update', 'id', (select id from ids where k = 'b_child'), 'first_name', 'X',
      'last_name', 'Y'))) $$,
  'P0001', 'roster_changed', 'an update must point at a child of this job');
select throws_ok($$
  select public.import_roster('33333333-3333-4333-8333-333333333333', (select id from ids where k = 'job'),
    (select jsonb_agg(jsonb_build_object('action', 'add', 'id', gen_random_uuid())) from generate_series(1, 5001))) $$,
  '22023', null, 'an import has at most 5,000 rows');
select throws_ok($$
  select public.import_roster('33333333-3333-4333-8333-333333333333', (select id from ids where k = 'job'), jsonb_build_array(
    jsonb_build_object('action', 'delete', 'id', (select id from ids where k = 'c1')))) $$,
  '22023', null, 'an import only adds and updates');
select throws_ok($$
  select public.import_roster('33333333-3333-4333-8333-333333333333', (select id from ids where k = 'b_job'), jsonb_build_array(
    jsonb_build_object('action', 'add', 'id', gen_random_uuid(), 'first_name', 'X', 'last_name', 'Y',
      'access_code_hash', repeat('8', 64), 'access_code_ciphertext', 'v1.' || repeat('A', 48)))) $$,
  '42501', null, 'nobody imports into another studio''s job');
reset role;
set local role authenticated;

-- ── As staff of studio A: read-only ───────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
select is((select count(*) from public.children), 3::bigint, 'staff see the studio''s children');
select is((public.list_children((select id from ids where k = 'job')) ->> 'total')::int, 3,
  'staff can list the roster');
select is((select count(*) from jsonb_array_elements(public.list_children((select id from ids where k = 'job')) -> 'children') c
           where c -> 'photo_groups' = '[]'::jsonb), 3::bigint,
  'each child comes with their photo groups (none yet; ADR 0030), and a class is not a group');
select throws_ok($$
  insert into public.children (studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job'), 'Staff', 'Child',
          repeat('9', 64), 'v1.' || repeat('A', 48)) $$,
  '42501', null, 'staff cannot add children');
select throws_ok($$
  select public.add_child('44444444-4444-4444-8444-444444444444', (select id from ids where k = 'job'),
    pg_temp.child(gen_random_uuid(), 'Staff', 'Child', repeat('9', 64))) $$,
  '42501', null, 'staff cannot run add_child');
select throws_ok($$
  insert into public.job_groups (studio_id, job_id, name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job'), 'Staff room') $$,
  '42501', null, 'staff cannot add classes');
select throws_ok($$ select access_code_hash from public.children $$, '42501', null, 'staff cannot read code hashes');
select throws_ok($$
  select public.import_roster('44444444-4444-4444-8444-444444444444', (select id from ids where k = 'job'),
    jsonb_build_array(jsonb_build_object('action', 'update', 'id', (select id from ids where k = 'c1'),
      'first_name', 'X', 'last_name', 'Y'))) $$,
  '42501', null, 'staff cannot import');
update public.children set first_name = 'staff edit' where id = (select id from ids where k = 'c1');
update public.job_groups set name = 'staff edit' where id = (select id from ids where k = 'g4b');
delete from public.children where id = (select id from ids where k = 'c3');

-- ── The roster list, as the owner of studio A (ASCII fixtures: local Postgres may use the C collation) ───────────
-- Fixtures written as the database owner (children are never inserted from a browser session).
reset role;
select lives_ok($$
  insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, student_id,
    access_code_hash, access_code_ciphertext)
  select d.id::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'job2'), d.g, d.fn, d.ln, d.sid,
    md5(d.id) || md5(d.id || 'x'), 'v1.' || repeat('A', 48)
  from (values
    ('d0000000-0000-4000-8000-000000000001', null::uuid, 'Ann', 'Lee', 'S-1'),
    ('d0000000-0000-4000-8000-000000000002', null::uuid, 'Kim', 'Ray', 's- 1'),
    ('d0000000-0000-4000-8000-000000000003', (select id from ids where k = 'other_group'), 'Zed', 'Moe', null),
    ('d0000000-0000-4000-8000-000000000004', (select id from ids where k = 'other_group'), 'ZED', 'Mo e', null),
    ('d0000000-0000-4000-8000-000000000005', (select id from ids where k = 'g4b_job2'), 'Zed', 'Moe', null),
    ('d0000000-0000-4000-8000-000000000006', null::uuid, 'Ann', 'Lee', null)
  ) as d(id, g, fn, ln, sid) $$,
  'duplicate fixtures are added to the second job');
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select results_eq($$
  select l ->> 'total', l ->> 'duplicates' from public.list_children((select id from ids where k = 'job2')) l $$,
  $$ values ('6', '4') $$, 'the roster counts children and duplicates');
select results_eq($$
  select c ->> 'id' from jsonb_array_elements(public.list_children((select id from ids where k = 'job2')) -> 'children') c
  where (c ->> 'duplicate')::boolean order by 1 $$,
  $$ values ('d0000000-0000-4000-8000-000000000001'), ('d0000000-0000-4000-8000-000000000002'),
            ('d0000000-0000-4000-8000-000000000003'), ('d0000000-0000-4000-8000-000000000004') $$,
  'duplicates: same student ID ignoring case and spaces, or same name in the same class without IDs');
select results_eq($$
  select l ->> 'total', l ->> 'duplicates'
  from public.list_children((select id from ids where k = 'job2'), p_group_id => (select id from ids where k = 'other_group')) l $$,
  $$ values ('2', '2') $$, 'the class filter narrows the list and its counts');
select is((public.list_children((select id from ids where k = 'job2'), p_no_group => true) ->> 'total')::int, 3,
  'the "no class" filter lists children without a class');
select is(
  (select jsonb_agg(c -> 'id') from jsonb_array_elements(
    public.list_children((select id from ids where k = 'job2'), p_limit => 2) -> 'children') c),
  (select jsonb_agg(c -> 'id') from (select c from jsonb_array_elements(
    public.list_children((select id from ids where k = 'job2')) -> 'children') with ordinality as e(c, n) where n <= 2) s),
  'the first page is the start of the sorted roster');
select is(
  public.list_children((select id from ids where k = 'job2'), p_limit => 2,
    p_after => (public.list_children((select id from ids where k = 'job2')) -> 'children' -> 1 ->> 'id')::uuid)
    -> 'children' -> 0 -> 'id',
  public.list_children((select id from ids where k = 'job2')) -> 'children' -> 2 -> 'id',
  'the next page continues after the cursor child');
select ok(public.list_children((select id from ids where k = 'job2'))::text !~ 'access_code_hash',
  'the roster list never includes code hashes');
select results_eq($$
  select name, child_count from public.list_job_groups((select id from ids where k = 'job')) order by name $$,
  $$ values ('4B', 2::bigint), ('Room 5A', 0::bigint), ('Room 6', 1::bigint) $$,
  'classes are listed with how many children each has');

-- ── D147: photos and orders per child (ADR 0026) ──────────────────────────────────────────────────────────────────
-- Studio B's job (studio A is deleted at the end, and orders are never deleted): Bianca has three ready photos (one
-- of them flagged), a binned one and one still processing, and a paid order with a line for her. Quinn has no photos
-- and only a canceled order. B's photographer and staff join to check who sees the order column.
reset role;
select pg_temp.as_server();
insert into auth.users (id, email) values
  ('66666666-6666-4666-8666-666666666666', 'photographer-b@example.test'),
  ('77777777-7777-4777-8777-777777777777', 'staff-b@example.test');
insert into public.studio_members (studio_id, user_id, role) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '66666666-6666-4666-8666-666666666666', 'photographer'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '77777777-7777-4777-8777-777777777777', 'staff');
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
values ('b0000000-0000-4000-8000-000000000005', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'b0000000-0000-4000-8000-000000000002', 'Quinn', 'Zephyr', repeat('e', 64), 'v1.' || repeat('E', 48));
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('be000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'b0000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222');
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, binned_at, binned_by, created_by)
select ('bf000000-0000-4000-8000-00000000000' || n)::uuid, b.studio_id, b.job_id, b.id, b.seq,
  (case when n = 5 then 'processing' else 'ready' end)::public.photo_status, 'IMG_' || n || '.JPG', 1,
  extensions.digest('b' || n, 'sha256'), case when n = 5 then null else 1200 end, case when n = 5 then null else 1500 end,
  case when n = 4 then now() end, case when n = 4 then '22222222-2222-4222-8222-222222222222'::uuid end,
  b.created_by
from generate_series(1, 5) n, public.upload_batches b where b.id = 'be000000-0000-4000-8000-000000000001';
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, flag, source)
select ('bf000000-0000-4000-8000-00000000000' || n)::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'b0000000-0000-4000-8000-000000000002', 'child', 'b0000000-0000-4000-8000-000000000004',
  (case when n = 2 then 'unreadable_card' end)::public.photo_flag, 'auto'
from generate_series(1, 5) n;
insert into public.payout_accounts (id, studio_id, stripe_account_id, country, livemode, status, payout_interval,
  weekly_anchor, delay_days)
values ('bd000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'acct_B7', 'US', false,
  'active', 'weekly', 'friday', 2);
insert into public.orders (id, studio_id, reference, currency, shipping_method, products_cents, shipping_cents,
  daybell_fee_bps, daybell_fee_cents, card_fee_recovery, tax_enabled, payout_account_id, stripe_account_id,
  bag_fingerprint)
select ('bc000000-0000-4000-8000-00000000000' || n)::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  case n when 1 then '7KQ2M9XA' else '7KQ2M9XB' end, 'USD', 'home', 2000, 0, 300, 60, 'per_sale', false,
  'bd000000-0000-4000-8000-000000000001', 'acct_B7', repeat(n::text, 64)
from generate_series(1, 2) n;
insert into public.order_lines (studio_id, order_id, position, job_id, child_id, price_list_id, price_list_item_id,
  kind, name, unit_price_cents, quantity, line_total_cents)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ('bc000000-0000-4000-8000-00000000000' || n)::uuid, 1,
  'b0000000-0000-4000-8000-000000000002',
  (case n when 1 then 'b0000000-0000-4000-8000-000000000004' else 'b0000000-0000-4000-8000-000000000005' end)::uuid,
  gen_random_uuid(), gen_random_uuid(), 'print', 'Print', 2000, 1, 2000
from generate_series(1, 2) n;
update public.orders set status = 'paid', paid_at = now(), tax_cents = 0, total_cents = 2000,
  payment_intent_id = 'pi_B' || right(id::text, 1)
where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.orders set fulfilment_status = 'canceled' where id = 'bc000000-0000-4000-8000-000000000002';
-- Quinn also has a paid order in another of B's jobs (a line for Quinn, but not in this job), and a paid order in this
-- job that was refunded in full: neither counts as ordered here.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('b0000000-0000-4000-8000-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Spring', 'school', '2027-04-01', 'JOB00002');
insert into public.orders (id, studio_id, reference, currency, shipping_method, products_cents, shipping_cents,
  daybell_fee_bps, daybell_fee_cents, card_fee_recovery, tax_enabled, payout_account_id, stripe_account_id,
  bag_fingerprint)
select ('bc000000-0000-4000-8000-00000000000' || n)::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '7KQ2M9X' || case n when 3 then 'C' else 'D' end, 'USD', 'home', 2000, 0, 300, 60, 'per_sale', false,
  'bd000000-0000-4000-8000-000000000001', 'acct_B7', repeat(n::text, 64)
from generate_series(3, 4) n;
insert into public.order_lines (studio_id, order_id, position, job_id, child_id, price_list_id, price_list_item_id,
  kind, name, unit_price_cents, quantity, line_total_cents)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ('bc000000-0000-4000-8000-00000000000' || n)::uuid, 1,
  (case n when 3 then 'b0000000-0000-4000-8000-000000000006' else 'b0000000-0000-4000-8000-000000000002' end)::uuid,
  'b0000000-0000-4000-8000-000000000005', gen_random_uuid(), gen_random_uuid(), 'print', 'Print', 2000, 1, 2000
from generate_series(3, 4) n;
update public.orders set status = 'paid', paid_at = now(), tax_cents = 0, total_cents = 2000,
  payment_intent_id = 'pi_B' || right(id::text, 1)
where id in ('bc000000-0000-4000-8000-000000000003', 'bc000000-0000-4000-8000-000000000004');
insert into public.order_refunds (studio_id, order_id, request_id, kind, reason, products_cents, shipping_cents,
  tax_cents, amount_cents, daybell_fee_cents, currency)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bc000000-0000-4000-8000-000000000004', gen_random_uuid(), 'custom',
  'other', 2000, 0, 0, 2000, 60, 'USD');
-- Seenu, Oct 14: a child is ordered only if one of their own lines isn't given back in full. Rae and Sol share a paid
-- order and Sol's line is refunded (Rae still ordered, Sol not); Tao's one line of two prints has one given back
-- (still ordered).
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
select ('b0000000-0000-4000-8000-00000000001' || n)::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'b0000000-0000-4000-8000-000000000002', name, 'Zephyr', repeat(n::text, 64), 'v1.' || repeat('E', 48)
from (values (7, 'Rae'), (8, 'Sol'), (9, 'Tao')) c (n, name);
insert into public.orders (id, studio_id, reference, currency, shipping_method, products_cents, shipping_cents,
  daybell_fee_bps, daybell_fee_cents, card_fee_recovery, tax_enabled, payout_account_id, stripe_account_id,
  bag_fingerprint)
values
  ('bc000000-0000-4000-8000-000000000005', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '7KQ2M9XE', 'USD', 'home', 4000, 0,
   300, 120, 'per_sale', false, 'bd000000-0000-4000-8000-000000000001', 'acct_B7', repeat('5', 64)),
  ('bc000000-0000-4000-8000-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '7KQ2M9XF', 'USD', 'home', 2000, 0,
   300, 60, 'per_sale', false, 'bd000000-0000-4000-8000-000000000001', 'acct_B7', repeat('6', 64));
insert into public.order_lines (id, studio_id, order_id, position, job_id, child_id, price_list_id, price_list_item_id,
  kind, name, unit_price_cents, quantity, line_total_cents)
values
  ('be100000-0000-4000-8000-000000000007', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bc000000-0000-4000-8000-000000000005',
   1, 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000017', gen_random_uuid(),
   gen_random_uuid(), 'print', 'Print', 2000, 1, 2000),
  ('be100000-0000-4000-8000-000000000008', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bc000000-0000-4000-8000-000000000005',
   2, 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000018', gen_random_uuid(),
   gen_random_uuid(), 'print', 'Print', 2000, 1, 2000),
  ('be100000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bc000000-0000-4000-8000-000000000006',
   1, 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000019', gen_random_uuid(),
   gen_random_uuid(), 'print', 'Print', 1000, 2, 2000);
update public.orders set status = 'paid', paid_at = now(), tax_cents = 0, total_cents = products_cents,
  payment_intent_id = 'pi_B' || right(id::text, 1)
where id in ('bc000000-0000-4000-8000-000000000005', 'bc000000-0000-4000-8000-000000000006');
insert into public.order_refunds (id, studio_id, order_id, request_id, kind, reason, products_cents, shipping_cents,
  tax_cents, amount_cents, daybell_fee_cents, currency)
values
  ('bf100000-0000-4000-8000-000000000008', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bc000000-0000-4000-8000-000000000005',
   gen_random_uuid(), 'lines', 'other', 2000, 0, 0, 2000, 60, 'USD'),
  ('bf100000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bc000000-0000-4000-8000-000000000006',
   gen_random_uuid(), 'lines', 'other', 1000, 0, 0, 1000, 30, 'USD');
insert into public.order_refund_lines (refund_id, studio_id, order_line_id, quantity, products_cents) values
  ('bf100000-0000-4000-8000-000000000008', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'be100000-0000-4000-8000-000000000008', 1, 2000),
  ('bf100000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'be100000-0000-4000-8000-000000000009', 1, 1000);
create function pg_temp.roster_columns() returns table (name text, photos int, ordered boolean)
language sql as $$
  select c ->> 'first_name', (c ->> 'photo_count')::int, (c ->> 'has_paid_order')::boolean
  from jsonb_array_elements(public.list_children('b0000000-0000-4000-8000-000000000002') -> 'children') c
  order by 1 $$;
grant execute on function pg_temp.roster_columns() to authenticated;

set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select results_eq($$ select * from pg_temp.roster_columns() $$,
  $$ values ('Bianca', 3, true), ('Quinn', 0, false), ('Rae', 0, true), ('Sol', 0, false), ('Tao', 0, true) $$,
  'the roster counts each child''s ready photos outside the bin (flagged ones too) and says who has a paid order; '
  'a canceled order doesn''t count');
select ok((select count(*) from public.order_lines where child_id = 'b0000000-0000-4000-8000-000000000005'
    and job_id = 'b0000000-0000-4000-8000-000000000006') = 1
  and not (select o from pg_temp.roster_columns() r (n, p, o) where n = 'Quinn'),
  'a paid order line for the child in another job of the same studio doesn''t make them ordered in this one');
select ok(coalesce((app.studio_order_refund_state('bc000000-0000-4000-8000-000000000004') ->> 'fully_refunded')::boolean, false)
  and not (select o from pg_temp.roster_columns() r (n, p, o) where n = 'Quinn'),
  'nor does a paid order in this job that was refunded in full');
select ok((select o from pg_temp.roster_columns() r (n, p, o) where n = 'Rae')
  and not (select o from pg_temp.roster_columns() r (n, p, o) where n = 'Sol'),
  'Seenu, Oct 14: in a two-child order, the child whose lines were refunded is not ordered, the sibling still is');
select ok((select o from pg_temp.roster_columns() r (n, p, o) where n = 'Tao'),
  'a line with only part of its quantity given back still counts as ordered');
select pg_temp.as_user('77777777-7777-4777-8777-777777777777') as signed_in;
select results_eq($$ select * from pg_temp.roster_columns() $$,
  $$ values ('Bianca', 3, true), ('Quinn', 0, false), ('Rae', 0, true), ('Sol', 0, false), ('Tao', 0, true) $$, 'staff see the order column too (they fulfil orders)');
select pg_temp.as_user('66666666-6666-4666-8666-666666666666') as signed_in;
select results_eq($$ select * from pg_temp.roster_columns() $$,
  $$ values ('Bianca', 3, null::boolean), ('Quinn', 0, null::boolean), ('Rae', 0, null::boolean),
            ('Sol', 0, null::boolean), ('Tao', 0, null::boolean) $$,
  'photographers get the photo counts but no order data (null), as they read no orders');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select is(public.list_children('b0000000-0000-4000-8000-000000000002'),
  '{"children":[],"total":0,"duplicates":0}'::jsonb,
  'another studio''s owner gets none of B''s children, photo counts or orders');

-- ── The draft guard ───────────────────────────────────────────────────────────────────────────────────────────────
reset role;
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select throws_ok($$ delete from public.children where id = (select id from ids where k = 'c3') $$,
  '23514', 'Children can be removed only while the job is a draft',
  'children cannot be removed once the job is selling');

-- ── As a logged-out visitor ───────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok($$ select * from public.children $$, '42501', null, 'logged-out visitors cannot read children');
select throws_ok($$ select * from public.job_groups $$, '42501', null, 'logged-out visitors cannot read classes');
select throws_ok($$
  select public.import_roster('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', '[]'::jsonb) $$,
  '42501', null, 'logged-out visitors cannot import');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '42501', null, 'logged-out visitors cannot add children');
select throws_ok($$ select public.list_children('a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'logged-out visitors cannot list children');
select throws_ok($$ select * from public.list_job_groups('a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'logged-out visitors cannot list classes');

-- ── Checked as the database owner ─────────────────────────────────────────────────────────────────────────────────
reset role;
select results_eq($$
  select c.first_name, g.name from public.children c join public.job_groups g on g.id = c.group_id
  where c.id = 'b0000000-0000-4000-8000-000000000004' $$,
  $$ values ('Bianca', 'B Room') $$, 'owner A could not edit or remove studio B''s child or class');
select results_eq($$
  select (select first_name from public.children where id = (select id from ids where k = 'c1')),
         (select name from public.job_groups where id = (select id from ids where k = 'g4b')),
         (select count(*) from public.children where id = (select id from ids where k = 'c3')) $$,
  $$ values ('Maya', '4B', 1::bigint) $$, 'staff could not edit or remove anything');
select is((select access_code_hash from public.children where id = (select id from ids where k = 'c1')), repeat('1', 64),
  'an updated child keeps its code');
select throws_ok($$
  insert into public.children (studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000002', 'Same', 'Code',
          repeat('1', 64), 'v1.' || repeat('A', 48)) $$,
  '23505', null, 'access codes are unique across all studios, not per studio');

-- Events: one per change, IDs and field names only.
select results_eq($$
  select type, data from public.events
  where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and subject_id in (
    select id from ids where k in ('g4b', 'g5', 'c1', 'c2'))
  order by id $$,
  $$ values
    ('job_group.created', jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001')),
    ('child.created', jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001',
       'group_id', (select id from ids where k = 'g4b'))),
    ('job_group.created', jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001')),
    ('job_group.updated', '{"fields":["name"]}'::jsonb),
    ('child.created', jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001', 'group_id', null)),
    ('child.updated', '{"fields":["grade","do_not_photograph"]}'::jsonb),
    ('child.deleted', jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001')),
    ('child.updated', '{"fields":["last_name","do_not_photograph"]}'::jsonb) $$,
  'class and child changes write events with IDs and field names only');
select results_eq($$
  select type, actor_id from public.events
  where subject_id in (select id from ids where k in ('c1', 'c2', 'c3')) and type = 'child.created' order by id $$,
  $$ values ('child.created', '11111111-1111-4111-8111-111111111111'::uuid),
            ('child.created', '33333333-3333-4333-8333-333333333333'::uuid),
            ('child.created', '33333333-3333-4333-8333-333333333333'::uuid) $$,
  'children added by the server are attributed to the person it acted for, not the service role');
select results_eq($$
  select actor_id from public.events where type = 'roster.imported' and subject_id = 'a0000000-0000-4000-8000-000000000001'
  order by id $$,
  $$ values ('33333333-3333-4333-8333-333333333333'::uuid), ('11111111-1111-4111-8111-111111111111'::uuid) $$,
  'each import is attributed to the person the server acted for');
select results_eq($$
  select data from public.events where type = 'roster.imported' and subject_id = 'a0000000-0000-4000-8000-000000000001'
  order by id $$,
  $$ values ('{"added":2,"updated":1,"groups_added":1}'::jsonb), ('{"added":0,"updated":1,"groups_added":0}'::jsonb) $$,
  'each import writes one summary event with counts only; failed imports write none');
select is((select count(*) from public.events e
  where e.data::text ~ '@'
     or exists (select 1 from public.children c
                where position(c.access_code_hash in e.data::text) > 0
                   or position(lower(c.first_name) in lower(e.data::text)) > 0
                   or position(lower(c.last_name) in lower(e.data::text)) > 0
                   or position(lower(coalesce(c.student_id, '@')) in lower(e.data::text)) > 0)
     or e.data::text ~* '(maya|johnson|liam|chen|patel|noah|garcia|room)'),
  0::bigint, 'events never contain names, emails, student IDs, class names or code hashes');

select lives_ok($$ delete from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'a studio with a selling job, classes and children can still be deleted');
select is((select count(*) from public.children where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'and its children go with it');

select * from finish();
rollback;
