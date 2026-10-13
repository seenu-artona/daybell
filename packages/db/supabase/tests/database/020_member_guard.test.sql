-- A membership's person and studio never change (step 8 security review M2; D96; ADR 0021): signed-in people may
-- update a member's role only; nobody, not even the database owner, moves a row to another person or studio (so the
-- invite flow and the last-owner guard can't be bypassed); and someone removed then invited again sees none of the
-- notifications from before.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('77777777-7777-4777-8777-777777777777', 'outsider@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer');
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001');
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000001';
-- The shop closes by its date: the photographer gets a notification.
insert into public.events (studio_id, type, actor_id, subject_id, data) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'job.closed', null, 'a0000000-0000-4000-8000-000000000001', '{"scheduled": true}');

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ── Privileges ────────────────────────────────────────────────────────────────────────────────────────────────────
select ok(has_column_privilege('authenticated', 'public.studio_members', 'role', 'update'),
  'signed-in people may update a member''s role');
select ok(not has_column_privilege('authenticated', 'public.studio_members', 'user_id', 'update')
  and not has_column_privilege('authenticated', 'public.studio_members', 'studio_id', 'update'),
  'but not whose membership it is, or which studio''s');
select ok(not has_table_privilege('authenticated', 'public.studio_members', 'update'),
  'and have no table-wide update');
select ok((select proconfig @> array['search_path=""'] from pg_proc where proname = 'guard_member_identity'),
  'the guard has an empty search_path');
select ok(not has_function_privilege('authenticated', 'app.guard_member_identity()', 'execute'),
  'browsers can''t run the guard');

-- ── As owner A ────────────────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$ update public.studio_members set user_id = '77777777-7777-4777-8777-777777777777'
  where user_id = '33333333-3333-4333-8333-333333333333' $$, '42501', null,
  'an owner can''t hand a photographer''s membership to someone else (no invite)');
select throws_ok($$ update public.studio_members set studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  where user_id = '33333333-3333-4333-8333-333333333333' $$, '42501', null,
  'nor move it to another studio they own');
select lives_ok($$ update public.studio_members set role = 'staff'
  where user_id = '33333333-3333-4333-8333-333333333333' $$, 'changing a role still works');
reset role;

-- ── Whoever writes ────────────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ update public.studio_members set user_id = '77777777-7777-4777-8777-777777777777'
  where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'owner' $$, '23514', 'member_fixed',
  'not even the database owner moves the only owner''s row past the last-owner guard');
select throws_ok($$ update public.studio_members set studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  where user_id = '22222222-2222-4222-8222-222222222222' $$, '23514', 'member_fixed',
  'nor moves a membership to another studio');

-- ── Notifications after leaving and coming back ───────────────────────────────────────────────────────────────────
select is((select count(*) from public.notifications where user_id = '33333333-3333-4333-8333-333333333333'),
  1::bigint, 'the member (now staff) has the shop-closed notification');
delete from public.studio_members where user_id = '33333333-3333-4333-8333-333333333333';
insert into public.studio_members (studio_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer');
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select is((select count(*) from public.notifications), 0::bigint,
  'removed and invited again, they see none from before');
reset role;

-- The clean-up is a backstop on the ids too: with the guard off, moving a row drops the old person's notifications.
insert into public.events (studio_id, type, actor_id, subject_id, data) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'job.closed', null, 'a0000000-0000-4000-8000-000000000001', '{"scheduled": true}');
alter table public.studio_members disable trigger studio_members_guard_identity;
update public.studio_members set user_id = '77777777-7777-4777-8777-777777777777'
  where user_id = '33333333-3333-4333-8333-333333333333';
alter table public.studio_members enable trigger studio_members_guard_identity;
select is((select count(*) from public.notifications where user_id = '33333333-3333-4333-8333-333333333333'),
  0::bigint, 'a row moved to someone else takes the old person''s notifications with it');

select * from finish();
rollback;
