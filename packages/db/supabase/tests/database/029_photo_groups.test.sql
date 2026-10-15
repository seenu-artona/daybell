-- Photos' groups (D156; Seenu's answers of Oct 14, 2026; ADR 0030): groups, their members and their group photos are
-- the studio's own (row-level security, composite keys); nobody signed in writes them; the functions act for the
-- person and refuse staff, other studios, other jobs' ids and closed jobs; group photos are linked when their files
-- are registered and never by tagging; nothing (uploads, tagging, roster changes, new groups) moves a group's photos
-- or removes a member by itself; "add everyone to a group" only adds; deleting a group sends its photos to another
-- group or the bin, never binning a sold photo; parents see the group photos of their child's groups only; old class
-- photos are group photos in no group that nobody sees (C2); events carry ids and counts only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(132);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff');

-- Fixtures, as the database owner. Studio A: job 1 (classes 4B and 5A: Maya and Liam in 4B with grade 3, Ava in 5A
-- with grade 4, Noah in no class and no grade), job 2 (Zed), job 3 closed. Studio B: job 1 (Bea).
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Spring', 'school', '2026-10-01', 'JOB00002'),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Closed', 'school', '2026-10-01', 'JOB00003'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000003';
update public.jobs set status = 'closed' where id = 'a0000000-0000-4000-8000-000000000003';
insert into public.job_groups (id, studio_id, job_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '4B'),
  ('e1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '5A');
insert into public.children (id, studio_id, job_id, group_id, grade, first_name, last_name, access_code_hash,
  access_code_ciphertext) values
  ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', '3', 'Maya', 'Johnson', repeat('1', 64), 'v1.' || repeat('A', 48)),
  ('c1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', '3', 'Liam', 'Chen', repeat('2', 64), 'v1.' || repeat('A', 48)),
  ('c1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000002', '4', 'Ava', 'Patel', repeat('3', 64), 'v1.' || repeat('A', 48)),
  ('c1000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   null, null, 'Noah', 'Brown', repeat('4', 64), 'v1.' || repeat('A', 48)),
  ('c2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   null, null, 'Zed', 'Other', repeat('5', 64), 'v1.' || repeat('A', 48)),
  ('d0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   null, null, 'Bea', 'Secret', repeat('6', 64), 'v1.' || repeat('B', 48));
-- A group of job 2 and one of studio B, for refusals.
insert into public.photo_groups (id, studio_id, job_id, name) values
  ('99000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'Job 2 group'),
  ('99000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 'B group');
-- An old class-photo upload of job 1 (C2): after the migration a group upload in no group, its photo a group photo.
insert into public.upload_batches (id, studio_id, job_id, created_by, kind) values
  ('a2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   '33333333-3333-4333-8333-333333333333', 'group');
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, created_by)
select '9c000000-0000-4000-8000-000000000001', b.studio_id, b.job_id, b.id, b.seq, 'ready', 'Old class.JPG', 1,
  extensions.digest('old', 'sha256'), 1200, 1500, 'none', b.created_by
from public.upload_batches b where b.id = 'a2000000-0000-4000-8000-000000000001';
insert into public.photo_tags (photo_id, studio_id, job_id, place, source) values
  ('9c000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'group_photo', 'auto');
update public.upload_batches set tagged_round = tag_round;

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.as_server() returns boolean language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) is not null $$;
create function pg_temp.f(p_name text) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'size', 10, 'sha256', encode(extensions.digest(p_name, 'sha256'), 'hex')) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
create temp table ids (k text primary key, id uuid) on commit drop;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;
grant all on table ids to authenticated, service_role;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'photo_groups', 'photo_groups exists');
select has_table('public', 'photo_group_members', 'photo_group_members exists');
select has_table('public', 'photo_group_photos', 'photo_group_photos exists');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.photo_groups'::regclass, 'public.photo_group_members'::regclass,
                           'public.photo_group_photos'::regclass)), 'all three have row-level security');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app') and p.prosrc like '%class\_set%'), 0::bigint,
  'no function body still says class_set (the enum value is renamed)');
select is((select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e
           where e.enumtypid = 'public.photo_place'::regtype),
  array['child', 'group_photo', 'leftovers', 'card', 'blank_card'], 'class photo sets are now group photos');
select hasnt_column('public', 'photo_tags', 'group_id', 'a tag holds no class or group: a group photo''s groups are its links');
select hasnt_column('public', 'upload_batches', 'group_id', 'an upload no longer names a class');
select is((select count(*) from unnest(array[
    'public.create_photo_group(uuid, uuid, text)', 'public.rename_photo_group(uuid, uuid, text)',
    'public.delete_photo_group(uuid, uuid, text, uuid)', 'public.make_photo_groups_from_column(uuid, uuid, text)',
    'public.set_photo_group_members(uuid, uuid, uuid[], uuid[])',
    'public.move_group_photos(uuid, uuid, uuid, uuid, uuid[])', 'public.also_show_photos(uuid, uuid, uuid[], uuid[])',
    'public.create_upload_batch(uuid, uuid, text, uuid, uuid)', 'app.is_group_photo(uuid)',
    'app.check_group_photos(uuid, uuid[])', 'app.check_job_groups(uuid, uuid[])',
    'app.parent_visible_photos(uuid, uuid, boolean)']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  0::bigint, 'no group write or helper is executable by browsers');
select is((select count(*) from unnest(array['public.photo_people(uuid, uuid, uuid, int, int)',
    'public.list_photo_groups(uuid)', 'public.list_photo_group_members(uuid, uuid, int)',
    'public.photo_group_photos_page(uuid, uuid, uuid, int)']) f
  where has_function_privilege('anon', f, 'execute')), 0::bigint, 'logged-out visitors run no group read');
select ok((select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('photo_people', 'list_photo_groups',
             'list_photo_group_members', 'photo_group_photos_page')),
  'the reads are SECURITY INVOKER (row-level security applies)');

-- ── C2: old class photos are group photos in no group, seen by nobody ─────────────────────────────────────────────
select ok(not public.photo_parent_visible('9c000000-0000-4000-8000-000000000001'),
  'an old class photo in no group is seen by no parent');
select is((public.list_photo_groups('a0000000-0000-4000-8000-000000000001') ->> 'not_in_group')::int, 1,
  'and is counted as Not in a group');
select is((select array_agg(id) from public.photo_group_photos_page('a0000000-0000-4000-8000-000000000001', null, null, 50)),
  array['9c000000-0000-4000-8000-000000000001'::uuid], 'and listed there');

-- ── Browsers write nothing ────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select throws_ok($$ insert into public.photo_groups (studio_id, job_id, name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Direct') $$,
  '42501', null, 'owners cannot add a group directly');
select throws_ok($$ insert into public.photo_group_members (studio_id, job_id, group_id, child_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
    '99000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'nor a member');
select throws_ok($$ select public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'Choir') $$, '42501', null, 'nor run create_photo_group from a browser');

-- ── Making groups, as the server acting for a person (C10, C11) ──────────────────────────────────────────────────
reset role;
set local role service_role;
select pg_temp.as_server() as server;
insert into ids values ('choir', public.create_photo_group('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'Choir'));
select is((select name from public.photo_groups where id = pg_temp.id('choir')), 'Choir', 'a photographer makes a group');
select is(auth.uid(), null, 'and the server stops acting for them');
select is((select data from public.events where type = 'photo_group.created' and subject_id = pg_temp.id('choir')),
  '{"job_id": "a0000000-0000-4000-8000-000000000001", "source": "manual"}'::jsonb,
  'one photo_group.created event: ids only, never the name');
select is(pg_temp.try($$ select public.create_photo_group('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001', 'Staff group') $$), '42501 Owners, admins and photographers only',
  'staff cannot make groups (C11)');
select is(pg_temp.try($$ select public.create_photo_group('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001', 'B''s group') $$), '42501 Owners, admins and photographers only',
  'nor another studio''s owner');
select is(pg_temp.try($$ select public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000003', 'Late') $$), 'P0001 job_closed', 'closed jobs refuse new groups (C11)');
select is(pg_temp.try($$ select public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'CHOIR') $$), 'P0001 group_name_taken',
  'names are unique per job, ignoring case (C10)');
select is(pg_temp.try($$ select public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', ' Band') $$), '22023 A group name is 1 to 60 characters',
  'names are trimmed');
select is(pg_temp.try(format($$ select public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', %L) $$, repeat('x', 61))), '22023 A group name is 1 to 60 characters',
  'and up to 60 characters');
reset role;
insert into public.photo_groups (studio_id, job_id, name)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'G' || n
from generate_series(1, 499) n;
set local role service_role;
select pg_temp.as_server() as server;
select is(pg_temp.try($$ select public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', 'One too many') $$), 'P0001 group_limit', 'at most 500 groups per job (C10)');
insert into ids values ('band', public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'Band'));
select is(pg_temp.try($$ select public.rename_photo_group('11111111-1111-4111-8111-111111111111',
  pg_temp.id('band'), 'choir') $$), 'P0001 group_name_taken', 'a rename can''t take another group''s name');
select lives_ok($$ select public.rename_photo_group('33333333-3333-4333-8333-333333333333', pg_temp.id('band'),
  'Jazz band') $$, 'a photographer renames a group');
select is((select data from public.events where type = 'photo_group.updated' and subject_id = pg_temp.id('band')),
  '{"fields": ["name"]}'::jsonb, 'one photo_group.updated event with the field''s name');
select is(pg_temp.try($$ select public.rename_photo_group('22222222-2222-4222-8222-222222222222', pg_temp.id('band'),
  'Taken over') $$), '42501 Owners, admins and photographers only', 'another studio can''t rename it');

-- ── Members (D156: a person can be in several groups) ────────────────────────────────────────────────────────────
select is(public.set_photo_group_members('33333333-3333-4333-8333-333333333333', pg_temp.id('choir'),
  array['c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002']::uuid[], null),
  '{"added": 2, "removed": 0, "count": 2}'::jsonb, 'Maya and Liam join the choir');
select is(public.set_photo_group_members('11111111-1111-4111-8111-111111111111', pg_temp.id('band'),
  array['c1000000-0000-4000-8000-000000000001']::uuid[], null),
  '{"added": 1, "removed": 0, "count": 1}'::jsonb, 'and Maya the band too');
select is((select data from public.events where type = 'photo_group.members_changed' and subject_id = pg_temp.id('choir')),
  '{"added": 2, "count": 2, "removed": 0}'::jsonb, 'one members_changed event: counts only');
select is(pg_temp.try($$ select public.set_photo_group_members('11111111-1111-4111-8111-111111111111',
  pg_temp.id('choir'), array['c2000000-0000-4000-8000-000000000001']::uuid[], null) $$), 'P0001 group_not_in_job',
  'another job''s person can''t join');
select is(pg_temp.try($$ select public.set_photo_group_members('11111111-1111-4111-8111-111111111111',
  pg_temp.id('choir'), array['d0000000-0000-4000-8000-000000000001']::uuid[], null) $$), 'P0001 group_not_in_job',
  'nor another studio''s');
select is(pg_temp.try($$ select public.set_photo_group_members('11111111-1111-4111-8111-111111111111',
  pg_temp.id('choir'), array['c1000000-0000-4000-8000-000000000003']::uuid[],
  array['c1000000-0000-4000-8000-000000000003']::uuid[]) $$), '22023 Send up to 500 people to add and to remove',
  'nobody is added and removed at once');
select is(pg_temp.try($$ select public.set_photo_group_members('44444444-4444-4444-8444-444444444444',
  pg_temp.id('choir'), array['c1000000-0000-4000-8000-000000000003']::uuid[], null) $$),
  '42501 Owners, admins and photographers only', 'staff can''t change members');
select is(pg_temp.try($$ select public.set_photo_group_members('22222222-2222-4222-8222-222222222222',
  pg_temp.id('choir'), array['c1000000-0000-4000-8000-000000000003']::uuid[], null) $$),
  '42501 Owners, admins and photographers only', 'nor another studio''s owner');

-- ── Groups from a roster column, once (C3) ────────────────────────────────────────────────────────────────────────
select lives_ok($$ select public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', '5a') $$, 'a group named like class 5A exists already');
select is(public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'class'), '{"groups": 1, "members": 2, "skipped": 1}'::jsonb,
  'Class makes 4B with its two people and skips 5A, whose name is taken; Noah has no class');
select is((select array_agg(c.first_name order by c.first_name) from public.photo_group_members m
           join public.photo_groups g on g.id = m.group_id join public.children c on c.id = m.child_id
           where g.job_id = 'a0000000-0000-4000-8000-000000000001' and g.name = '4B'), array['Liam', 'Maya'],
  '4B''s members are the class''s people');
select is((select count(*) from public.photo_group_members m join public.photo_groups g on g.id = m.group_id
           where g.job_id = 'a0000000-0000-4000-8000-000000000001' and g.name = '5a'), 0::bigint,
  'the existing group is left alone');
select is((select data from public.events where type = 'photo_groups.made_from_column'),
  '{"column": "class", "groups": 1, "job_id": "a0000000-0000-4000-8000-000000000001", "members": 2}'::jsonb,
  'one made_from_column event: the column and counts');
select is(public.make_photo_groups_from_column('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'grade'), '{"groups": 2, "members": 3, "skipped": 0}'::jsonb,
  'Grade makes 3 and 4; a blank grade makes no group');
select is(pg_temp.try($$ select public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'teacher') $$),
  '22023 The column is class, grade, firstName, lastName or studentId', 'only the roster''s columns (no Teacher field)');
-- The other roster columns that name a group (C3; ADR 0030, call 9), tried and then removed so the counts below stay.
select is(public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'lastName'), '{"groups": 4, "members": 4, "skipped": 0}'::jsonb,
  'Last name makes a group per family name');
select is(public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'firstName'), '{"groups": 4, "members": 4, "skipped": 0}'::jsonb,
  'First name too');
reset role;
update public.children set student_id = case first_name when 'Maya' then 'A-1' when 'Liam' then 'a-1' else null end
  where job_id = 'a0000000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.as_server() as server;
select is(public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'studentId'), '{"groups": 1, "members": 2, "skipped": 0}'::jsonb,
  'Student ID, values compared ignoring case; blank IDs make no group');
select is(pg_temp.try($$ select public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'parentEmail') $$),
  '22023 The column is class, grade, firstName, lastName or studentId', 'never the parent''s email (call 9)');
select is(pg_temp.try($$ select public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'doNotPhotograph') $$),
  '22023 The column is class, grade, firstName, lastName or studentId', 'nor a yes/no flag (call 9)');
reset role;
delete from public.photo_groups where job_id = 'a0000000-0000-4000-8000-000000000001'
  and name in ('Johnson', 'Chen', 'Patel', 'Brown', 'Maya', 'Liam', 'Ava', 'Noah', 'A-1');
update public.children set student_id = null where job_id = 'a0000000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.as_server() as server;
select is(pg_temp.try($$ select public.make_photo_groups_from_column('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001', 'class') $$), '42501 Owners, admins and photographers only',
  'staff can''t');
reset role;
update public.children set grade = 'K' where job_id = 'a0000000-0000-4000-8000-000000000002';
set local role service_role;
select pg_temp.as_server() as server;
select is(pg_temp.try($$ select public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', 'grade') $$), 'P0001 group_limit',
  'a job already at 500 groups gets none (all or nothing)');
reset role;
delete from public.photo_groups where job_id = 'a0000000-0000-4000-8000-000000000002' and name in ('G1', 'G2');
set local role service_role;
select pg_temp.as_server() as server;
select is(pg_temp.try($$ select public.make_photo_groups_from_column('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', 'grade') $$), 'ok', 'a job with room for its groups gets them');

-- ── Uploads: links written once, when the files are registered (C12) ──────────────────────────────────────────────
select is(pg_temp.try($$ select public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'group', null) $$),
  '22023 An upload is individual photos or one group''s photos', 'a group upload names its group');
select is(pg_temp.try($$ select public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'individual', pg_temp.id('choir')) $$),
  '22023 An upload is individual photos or one group''s photos', 'an individual upload holds no group photos');
select is(pg_temp.try($$ select public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'group', '99000000-0000-4000-8000-000000000002') $$),
  'P0001 group_not_in_job', 'another job''s group is refused');
select is(pg_temp.try($$ select public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'individual', null, '99000000-0000-4000-8000-0000000000b1') $$),
  'P0001 group_not_in_job', 'so is another studio''s, for "add everyone"');
insert into ids values ('gb', public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'group', pg_temp.id('choir')));
select is((select count(*) from jsonb_array_elements(public.register_photos('33333333-3333-4333-8333-333333333333',
  pg_temp.id('gb'), jsonb_build_array(pg_temp.f('CHOIR_1.JPG'), pg_temp.f('CHOIR_2.JPG')))) r
  where r ->> 'outcome' = 'new'), 2::bigint, 'two group photos are registered');
insert into ids select 'g' || row_number() over (order by p.original_filename), p.id from public.photos p
  where p.batch_id = pg_temp.id('gb');
select is((select array_agg(l.photo_id order by l.photo_id) from public.photo_group_photos l
           where l.group_id = pg_temp.id('choir')),
  (select array_agg(p.id order by p.id) from public.photos p where p.batch_id = pg_temp.id('gb')),
  'and linked to the choir as they are registered');
select is((select count(*) from jsonb_array_elements(public.register_photos('33333333-3333-4333-8333-333333333333',
  pg_temp.id('gb'), jsonb_build_array(pg_temp.f('CHOIR_1.JPG')))) r where r ->> 'outcome' = 'resume'), 1::bigint,
  'the same file again resumes');
select is((select count(*) from public.photo_group_photos l where l.group_id = pg_temp.id('choir')), 2::bigint,
  'and links nothing twice');
select lives_ok($$ select public.finish_upload_batch('33333333-3333-4333-8333-333333333333', pg_temp.id('gb'), 0, 0) $$,
  'the group upload finishes');
select is((select data ->> 'kind' || ':' || (data ->> 'photo_group_id') from public.events
           where type = 'photos.uploaded' and data ->> 'batch_id' = pg_temp.id('gb')::text),
  'group:' || pg_temp.id('choir'), 'photos.uploaded says its kind and group (C12)');
select is((select count(*) from public.events where type like 'photo_group%' and subject_id = pg_temp.id('choir')
           and type not in ('photo_group.created', 'photo_group.members_changed')), 0::bigint,
  'and the links write no event of their own');

-- ── Tagging never moves group photos ──────────────────────────────────────────────────────────────────────────────
reset role;
update public.photos set status = 'ready', qr_kind = 'none', width = 1200, height = 1500
where batch_id = pg_temp.id('gb');
set local role service_role;
select pg_temp.as_server() as server;
select is(pg_temp.try(format($$ select public.apply_batch_tags(%L, %s, jsonb_build_array(jsonb_build_object(
  'photo_id', %L, 'place', 'child', 'child_id', 'c1000000-0000-4000-8000-000000000001'))) $$,
  pg_temp.id('gb'), (select tag_round from public.upload_batches where id = pg_temp.id('gb')), pg_temp.id('g1'))),
  '22023 Every write must be one of the batch''s photos, tagged to the job',
  'a group upload''s photo is never tagged to a person');
select is(public.apply_batch_tags(pg_temp.id('gb'), (select tag_round from public.upload_batches where id = pg_temp.id('gb')),
  (select jsonb_agg(jsonb_build_object('photo_id', p.id, 'place', 'group_photo')) from public.photos p
   where p.batch_id = pg_temp.id('gb'))), 2, 'tagging makes them group photos');
select is((select count(*) from public.photo_group_photos l where l.group_id = pg_temp.id('choir')), 2::bigint,
  'and changes none of the links');
select ok(public.photo_parent_visible(pg_temp.id('g1')), 'a group photo in a group with members is visible');

-- ── "Add everyone in this upload to a group" (C7): add only ───────────────────────────────────────────────────────
insert into ids values ('ib', public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'individual', null, pg_temp.id('band')));
select is((select count(*) from jsonb_array_elements(public.register_photos('33333333-3333-4333-8333-333333333333',
  pg_temp.id('ib'), jsonb_build_array(pg_temp.f('IMG_1.JPG'), pg_temp.f('IMG_2.JPG')))) r), 2::bigint,
  'an individual upload adding everyone to the band');
select is((select count(*) from public.photo_group_photos l join public.photos p on p.id = l.photo_id
           where p.batch_id = pg_temp.id('ib')), 0::bigint, 'links none of its photos to a group');
insert into ids select 'i' || row_number() over (order by p.original_filename), p.id from public.photos p
  where p.batch_id = pg_temp.id('ib');
reset role;
update public.photos set status = 'ready', qr_kind = 'none' where batch_id = pg_temp.id('ib');
set local role service_role;
select pg_temp.as_server() as server;
select is(pg_temp.try(format($$ select public.apply_batch_tags(%L, %s, jsonb_build_array(jsonb_build_object(
  'photo_id', %L, 'place', 'group_photo'))) $$,
  pg_temp.id('ib'), (select tag_round from public.upload_batches where id = pg_temp.id('ib')), pg_temp.id('i1'))),
  '22023 Every write must be one of the batch''s photos, tagged to the job',
  'an individual upload never holds group photos');
select is(public.apply_batch_tags(pg_temp.id('ib'), (select tag_round from public.upload_batches where id = pg_temp.id('ib')),
  jsonb_build_array(
    jsonb_build_object('photo_id', pg_temp.id('i1'), 'place', 'child', 'child_id', 'c1000000-0000-4000-8000-000000000002'),
    jsonb_build_object('photo_id', pg_temp.id('i2'), 'place', 'child', 'child_id', 'c1000000-0000-4000-8000-000000000003'))),
  2, 'the split places Liam''s and Ava''s photos');
select is((select array_agg(m.child_id order by m.child_id) from public.photo_group_members m
           where m.group_id = pg_temp.id('band')),
  array['c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
        'c1000000-0000-4000-8000-000000000003']::uuid[], 'and adds them to the band, keeping Maya');
select is((select count(*) from public.events e where e.type = 'photo_group.members_changed'
           and e.subject_id = pg_temp.id('band') and e.data = '{"added": 2, "count": 3, "removed": 0}'::jsonb),
  1::bigint, 'in one members_changed event');
select is((select actor_id from public.events e where e.type = 'photo_group.members_changed'
           and e.subject_id = pg_temp.id('band') and (e.data ->> 'added')::int = 2),
  '33333333-3333-4333-8333-333333333333'::uuid, 'attributed to whoever started the upload');
select is(public.set_photo_group_members('11111111-1111-4111-8111-111111111111', pg_temp.id('band'), null,
  array['c1000000-0000-4000-8000-000000000003']::uuid[]), '{"added": 0, "removed": 1, "count": 2}'::jsonb,
  'Ava is taken out of the band by hand');
select is(public.apply_batch_tags(pg_temp.id('ib'), (select tag_round from public.upload_batches where id = pg_temp.id('ib')),
  '[]'::jsonb), 0, 'tagging the upload again');
select is((select count(*) from public.photo_group_members m where m.group_id = pg_temp.id('band')
           and m.child_id = 'c1000000-0000-4000-8000-000000000003'), 0::bigint, 'never puts her back');

-- ── Nothing moves people or group photos by itself (D156) ─────────────────────────────────────────────────────────
create temp table before_state on commit drop as
  select (select count(*) from public.photo_group_members) as members,
         (select count(*) from public.photo_group_photos) as links;
grant select on before_state to service_role;
select lives_ok($$ select public.import_roster('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('action', 'update', 'id', 'c1000000-0000-4000-8000-000000000001', 'first_name', 'Maya',
      'last_name', 'Johnson', 'group_name', '5A', 'grade', '4'),
    jsonb_build_object('action', 'add', 'id', 'c1000000-0000-4000-8000-000000000009', 'first_name', 'New',
      'last_name', 'Kid', 'group_name', 'Choir', 'access_code_hash', repeat('8', 64),
      'access_code_ciphertext', 'v1.' || repeat('A', 48)))) $$,
  'a roster import moves Maya to 5A and adds a child to a class named like a group');
select lives_ok($$ select public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'Another group') $$, 'a new group is made');
select is((select row(members, links)::text from before_state),
  (select row((select count(*) from public.photo_group_members), (select count(*) from public.photo_group_photos))::text),
  'no member and no link changed');

-- ── Moving group photos by hand ───────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.try($$ select public.move_group_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', pg_temp.id('choir'), pg_temp.id('band'), array[pg_temp.id('i1')]) $$),
  'P0001 not_group_photo', 'a person''s photo is never a group photo (C8)');
select is(pg_temp.try($$ select public.move_group_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', pg_temp.id('band'), pg_temp.id('choir'), array[pg_temp.id('g1')]) $$),
  'P0001 group_not_in_job', 'a photo must be in the group it moves from');
select is(pg_temp.try($$ select public.move_group_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', pg_temp.id('choir'), '99000000-0000-4000-8000-000000000002',
  array[pg_temp.id('g1')]) $$), 'P0001 group_not_in_job', 'nor go to another job''s group');
select is(public.move_group_photos('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  pg_temp.id('choir'), pg_temp.id('band'), array[pg_temp.id('g1')]), 1, 'a group photo moves to the band');
select is((select array_agg(l.group_id) from public.photo_group_photos l where l.photo_id = pg_temp.id('g1')),
  array[pg_temp.id('band')], 'and leaves the choir');
select is((select data - 'photo_ids' from public.events where type = 'photo_group.photos_moved'),
  jsonb_build_object('from', pg_temp.id('choir'), 'to', pg_temp.id('band')), 'one photos_moved event, ids only');
select is(public.move_group_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  null, pg_temp.id('choir'), array['9c000000-0000-4000-8000-000000000001'::uuid]), 1,
  'the old class photo goes from Not in a group to the choir');
select is(public.also_show_photos('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.id('g2')], array[pg_temp.id('band'), pg_temp.id('choir')]), 1,
  'Also show in… adds the band and skips the choir, which already shows it');
select is((select data - 'photo_ids' from public.events where type = 'photo_group.photos_shown'),
  jsonb_build_object('group_ids', jsonb_build_array(least(pg_temp.id('band'), pg_temp.id('choir')),
    greatest(pg_temp.id('band'), pg_temp.id('choir')))), 'one photos_shown event, ids only');
select is(pg_temp.try($$ select public.also_show_photos('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.id('g2')], array[pg_temp.id('band')]) $$),
  '42501 Owners, admins and photographers only', 'staff can''t show photos in groups');
select is(pg_temp.try($$ select public.also_show_photos('22222222-2222-4222-8222-222222222222',
  'b0000000-0000-4000-8000-000000000001', array[pg_temp.id('g2')], array['99000000-0000-4000-8000-0000000000b1'::uuid]) $$),
  'P0001 not_group_photo', 'another studio can''t show A''s photos in its groups');

-- ── What parents see (amends ADR 0022) ────────────────────────────────────────────────────────────────────────────
reset role;
select is((select array_agg(v.id order by v.ord) from app.parent_visible_photos('a0000000-0000-4000-8000-000000000001',
           'c1000000-0000-4000-8000-000000000001', true) v),
  array['9c000000-0000-4000-8000-000000000001'::uuid, pg_temp.id('g1'), pg_temp.id('g2')],
  'Maya (choir and band) sees each of their group photos once, in tagging order, even one shown in both');
select is((select count(*) from app.parent_visible_photos('a0000000-0000-4000-8000-000000000001',
           'c1000000-0000-4000-8000-000000000004', true)), 0::bigint, 'Noah, in neither, sees none');
select is((select count(*) from app.parent_visible_photos('a0000000-0000-4000-8000-000000000001',
           'c1000000-0000-4000-8000-000000000001', false) v where v.place = 'group_photo'), 0::bigint,
  'portraits alone hold no group photo');
select ok(public.photo_parent_visible('9c000000-0000-4000-8000-000000000001'),
  'the old class photo, now in the choir, is seen by the choir''s members (C2)');
select is((select count(*) from public.photos p where p.job_id = 'a0000000-0000-4000-8000-000000000001'
  and public.photo_parent_visible(p.id) is distinct from exists (
    select 1 from public.children c cross join lateral app.parent_visible_photos(p.job_id, c.id, true) v
    where c.job_id = p.job_id and v.id = p.id)), 0::bigint, 'the twins agree on every photo of the job');
select lives_ok($$ select public.set_photo_group_members('11111111-1111-4111-8111-111111111111', pg_temp.id('band'),
  null, array['c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002']::uuid[]) $$,
  'the band loses its last members');
select ok(not public.photo_parent_visible(pg_temp.id('g1')), 'a photo only in a group with no members is seen by nobody');

-- ── Deleting a group (C4) ─────────────────────────────────────────────────────────────────────────────────────────
set local role service_role;
select pg_temp.as_server() as server;
select is(pg_temp.try($$ select public.delete_photo_group('11111111-1111-4111-8111-111111111111', pg_temp.id('band'),
  null, null) $$), 'P0001 group_has_photos', 'a group with photos needs a destination');
select is(pg_temp.try($$ select public.delete_photo_group('11111111-1111-4111-8111-111111111111', pg_temp.id('band'),
  'group', '99000000-0000-4000-8000-000000000002') $$), 'P0001 group_not_in_job',
  'another job''s group is no destination');
reset role;
update public.photos set sold_at = now() where id = pg_temp.id('g1');
set local role service_role;
select pg_temp.as_server() as server;
select is(pg_temp.try($$ select public.delete_photo_group('11111111-1111-4111-8111-111111111111', pg_temp.id('band'),
  'bin', null) $$), 'P0001 photo_sold', 'a sold photo is never binned: nothing changes');
select is((select count(*) from public.photo_groups where id = pg_temp.id('band')), 1::bigint, 'the band is still there');
insert into ids values ('kept', public.create_photo_group('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', 'Kept'));
select is(public.delete_photo_group('11111111-1111-4111-8111-111111111111', pg_temp.id('band'), 'group',
  pg_temp.id('kept')), '{"moved": 2, "binned": 0}'::jsonb, 'its photos go to another group');
select is((select count(*) from public.photo_group_photos l where l.group_id = pg_temp.id('kept')), 2::bigint,
  'which now shows them');
select is((select data from public.events where type = 'photo_group.deleted' and subject_id = pg_temp.id('band')),
  jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001', 'photos_to', 'group',
    'target_group_id', pg_temp.id('kept')), 'one photo_group.deleted event, ids only');
reset role;
update public.photos set sold_at = null where id = pg_temp.id('g1');
set local role service_role;
select pg_temp.as_server() as server;
select is(public.delete_photo_group('33333333-3333-4333-8333-333333333333', pg_temp.id('kept'), 'bin', null),
  '{"moved": 0, "binned": 1}'::jsonb, 'to the bin: only the photo in no other group is binned');
select is((select array_agg(p.id order by p.id) from public.photos p
           where p.batch_id = pg_temp.id('gb') and p.binned_at is not null), array[pg_temp.id('g1')],
  'the one still shown in the choir stays');
select is((select count(*) from public.events where type = 'photos.binned'), 1::bigint,
  'the bin writes its own photos.binned event');
select is(pg_temp.try($$ select public.delete_photo_group('44444444-4444-4444-8444-444444444444', pg_temp.id('choir'),
  'bin', null) $$), '42501 Owners, admins and photographers only', 'staff can''t delete groups');

-- ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select is((select x ->> 'members' || '/' || (x ->> 'photos') || '/' || (x ->> 'ordered')
           from jsonb_array_elements(public.list_photo_groups('a0000000-0000-4000-8000-000000000001') -> 'groups') x
           where x ->> 'id' = pg_temp.id('choir')::text), '2/2/0',
  'the choir: 2 members, 2 group photos, ordered 0 (owners and admins see it)');
select is((select jsonb_agg(x ->> 'name') from jsonb_array_elements(
             public.list_photo_groups('a0000000-0000-4000-8000-000000000001') -> 'groups') x),
  '["3", "4", "4B", "5a", "Another group", "Choir"]'::jsonb, 'groups are listed by name');
select is((select jsonb_agg(x ->> 'first_name') from jsonb_array_elements(
             public.list_photo_group_members(pg_temp.id('choir'), null, 100)) x), '["Liam", "Maya"]'::jsonb,
  'a group''s members by last name');
select is((select jsonb_agg(x ->> 'first_name') from jsonb_array_elements(public.photo_people(
             'a0000000-0000-4000-8000-000000000001', pg_temp.id('choir'), null, 50, 12) -> 'people') x),
  '["Liam"]'::jsonb, 'People with the Choir chip: its members who have photos');
select is((select x -> 'photo_groups' from jsonb_array_elements(
             public.list_children('a0000000-0000-4000-8000-000000000001') -> 'children') x
           where x ->> 'id' = 'c1000000-0000-4000-8000-000000000001'),
  (select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by lower(g.name))
   from public.photo_groups g join public.photo_group_members m on m.group_id = g.id
   where m.child_id = 'c1000000-0000-4000-8000-000000000001'), 'Subjects lists each person''s groups');
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_photos',
  'a0000000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('key', 'group', 'value', pg_temp.id('choir')))) $$,
  'a Group chip is saved on Photos');
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_subjects',
  'a0000000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('key', 'group', 'value', pg_temp.id('choir')))) $$,
  'and on Subjects');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_photos',
  'a0000000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('key', 'group',
  'value', 'e1000000-0000-4000-8000-000000000001'))) $$, '22023', 'list_filters_record', 'a class is no Group chip');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_photos',
  'a0000000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('key', 'group',
  'value', '99000000-0000-4000-8000-000000000002'))) $$, '22023', 'list_filters_record', 'nor another job''s group');

select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as photographer_a;
select is((select x -> 'ordered' from jsonb_array_elements(
             public.list_photo_groups('a0000000-0000-4000-8000-000000000001') -> 'groups') x
           where x ->> 'id' = pg_temp.id('choir')::text), 'null'::jsonb, 'photographers don''t see Ordered (C16)');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as staff_a;
select is((select x -> 'ordered' from jsonb_array_elements(
             public.list_photo_groups('a0000000-0000-4000-8000-000000000001') -> 'groups') x
           where x ->> 'id' = pg_temp.id('choir')::text), 'null'::jsonb, 'nor staff (C16)');
select is((select count(*) from public.photo_groups where job_id = 'a0000000-0000-4000-8000-000000000001'), 6::bigint,
  'staff read the groups');

-- ── Another studio sees nothing (D96) ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as owner_b;
select is((select count(*) from public.photo_groups where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'studio B reads none of A''s groups');
select is((select count(*) from public.photo_group_members where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0::bigint, 'nor their members');
select is((select count(*) from public.photo_group_photos where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0::bigint, 'nor their photos');
select is(public.list_photo_groups('a0000000-0000-4000-8000-000000000001'),
  '{"groups": [], "not_in_group": 0}'::jsonb, 'nor A''s Groups list');
select is(public.list_photo_group_members(pg_temp.id('choir'), null, 100), '[]'::jsonb, 'nor a group''s members');
select is((select count(*) from public.photo_group_photos_page('a0000000-0000-4000-8000-000000000001',
  pg_temp.id('choir'), null, 50)), 0::bigint, 'nor a group''s photos');
select is(public.photo_people('a0000000-0000-4000-8000-000000000001', null, null, 50, 12),
  '{"total": 0, "people": []}'::jsonb, 'nor A''s people');
select throws_ok($$ select public.save_list_filters('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'job_photos',
  'b0000000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('key', 'group', 'value', pg_temp.id('choir')))) $$,
  '22023', 'list_filters_record', 'nor save a chip naming A''s group');

-- ── Events: ids and counts only ───────────────────────────────────────────────────────────────────────────────────
reset role;
select is((select count(*) from public.events e where (e.type like 'photo_group%' or e.type like 'photo_groups%')
           and e.data::text ~ '(Maya|Liam|Ava|Noah|Choir|Jazz|Band|Kept|4B|5A|CHOIR_)'), 0::bigint,
  'no group event holds a name, a group name or a filename');

select * from finish();
rollback;
