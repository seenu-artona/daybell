-- Cross-studio leak tests (D96). Two studios, four people; nobody may see or touch the other studio.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Setup as the database owner. This test database is a US database.
insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'staff-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'outsider@example.test');

insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');

insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'staff');

-- As the owner of studio A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true) is not null as signed_in;

select results_eq($$ select slug from public.studios order by slug $$, array['studio-a'], 'owner A sees only studio A');
select is((select count(*) from public.studio_members), 2::bigint, 'owner A sees only studio A members');
-- Writes blocked by RLS silently match no rows; the results are checked as the database owner at the end.
update public.studios set name = 'hacked' where slug = 'studio-b';
select throws_ok(
  $$ insert into public.studio_members (studio_id, user_id, role)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444', 'owner') $$,
  '42501', null, 'owner A cannot add people to studio B'
);
delete from public.studio_members where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select lives_ok(
  $$ update public.studios set name = 'Studio A Photo' where slug = 'studio-a' $$,
  'owner A can rename studio A'
);
select throws_ok(
  $$ delete from public.studio_members where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null, 'the last owner cannot be removed'
);
select throws_ok(
  $$ insert into public.studios (name, slug, data_region) values ('Sneaky', 'sneaky', 'us') $$,
  '42501', null, 'studios cannot be created from the browser'
);

-- As staff of studio A.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true) is not null as signed_in;
select results_eq($$ select slug from public.studios $$, array['studio-a'], 'staff A sees studio A');
update public.studios set name = 'staff edit' where slug = 'studio-a';
update public.studio_members set role = 'owner' where user_id = '33333333-3333-4333-8333-333333333333';

-- As a signed-in person with no studio.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true) is not null as signed_in;
select is((select count(*) from public.studios), 0::bigint, 'an outsider sees no studios');
select is((select count(*) from public.studio_members), 0::bigint, 'an outsider sees no members');

-- As a logged-out visitor.
reset role;
set local role anon;
select throws_ok($$ select * from public.studios $$, '42501', null, 'logged-out visitors cannot read studios');

-- Results of the blocked writes, checked as the database owner.
reset role;
select is((select name from public.studios where slug = 'studio-b'), 'Studio B', 'owner A could not rename studio B');
select is(
  (select count(*) from public.studio_members where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1::bigint, 'owner A could not remove studio B members'
);
select is((select name from public.studios where slug = 'studio-a'), 'Studio A Photo', 'staff could not change studio settings');
select is(
  (select role::text from public.studio_members where user_id = '33333333-3333-4333-8333-333333333333'),
  'staff', 'staff could not promote themselves'
);

-- The server (service role) creates studios at sign-up.
set local role service_role;
select lives_ok(
  $$ insert into public.studios (name, slug, data_region) values ('New Studio', 'new-studio', 'us') $$,
  'the server can create a studio in its own region'
);

-- Region guard (D113), as the database owner.
reset role;
select throws_ok(
  $$ insert into public.studios (name, slug, data_region) values ('Wrong region', 'wrong-region', 'ca') $$,
  '23514', null, 'a Canadian studio cannot be written to the US database'
);
select throws_ok(
  $$ update app.config set value = 'ca' where key = 'data_region' $$,
  '23514', null, 'a database region can never be changed'
);
select throws_ok($$ truncate app.config $$, '23514', null, 'the region record cannot be truncated');
select throws_ok(
  $$ delete from app.config where key = 'data_region' $$,
  '23514', null, 'the region record cannot be deleted'
);

select * from finish();
rollback;
