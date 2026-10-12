-- QR cards (D32, D138, D96; Seenu's answers of Oct 11 2026; ADR 0015): studio separation, server-only card writes that
-- re-check the acting person's role, one card per child forever, no card for Do not photograph, blank cards with
-- pre-made access codes unique across children and cards, the Overview status, and events without personal data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

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

-- Fixtures as the database owner: studio A's job (two classes, five children, one of them Do not photograph), a second
-- job of A with only a Do not photograph child, and studio B's job and child. Hashes are fakes in the right format.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Spring', 'school', '2027-04-01', 'JOB00002'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
insert into public.job_groups (id, studio_id, job_id, name) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Room 1'),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Room 2'),
  ('a1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'Other job room'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 'B Room');
insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, do_not_photograph,
  access_code_hash, access_code_ciphertext) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Maya', 'Johnson', false, repeat('1', 64), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Liam', 'Chen', false, repeat('2', 64), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000002', 'Ava', 'Patel', false, repeat('3', 64), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   null, 'Noah', 'Garcia', false, repeat('4', 64), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Zoe', 'Optout', true, repeat('5', 64), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   null, 'Only', 'Optout', true, repeat('6', 64), 'v1.' || repeat('A', 48)),
  ('d0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001', 'Bianca', 'Secret', false, repeat('b', 64), 'v1.' || repeat('B', 48));

-- Switching who is acting, as in 007_roster.
create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.as_server() returns boolean language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) is not null $$;
-- Blank cards for prepare_qr_cards: n cards with fresh ids and fake hashes built from a seed.
create function pg_temp.blanks(p_n int, p_seed text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(),
    'access_code_hash', encode(extensions.digest(p_seed || i, 'sha256'), 'hex'),
    'access_code_ciphertext', 'v1.' || repeat('C', 48))), '[]'::jsonb)
  from generate_series(1, p_n) i $$;
create temp table out (k text primary key, v jsonb not null);
grant all on out to authenticated, service_role;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'qr_cards', 'qr_cards exists');
select has_table('public', 'access_code_hashes', 'access_code_hashes exists');
select ok(exists (select 1 from pg_constraint where conname = 'children_studio_job_id_key'),
  'children have a (studio_id, job_id, id) key, so a card''s child is in the card''s own job');
select is((select count(*) from public.access_code_hashes), 7::bigint,
  'every child''s code is claimed in access_code_hashes');
select ok((select bool_and(app.new_card_code() ~ '^[0-9A-HJKMNP-TV-Z]{20}$') from generate_series(1, 200)),
  'card codes are 20 Crockford base32 symbols');
select is((select count(distinct app.new_card_code()) from generate_series(1, 200)), 200::bigint,
  'card codes are random');

-- ── As the owner of studio A, from a browser session ──────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$
  insert into public.qr_cards (studio_id, job_id, child_id, card_code)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
          'c0000000-0000-4000-8000-000000000001', repeat('A', 20)) $$,
  '42501', null, 'owners cannot make cards directly (no chosen card codes)');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
    null, false, null, '[]') $$,
  '42501', null, 'owners cannot run prepare_qr_cards from a browser session');
select throws_ok($$ select access_code_hash from public.qr_cards $$,
  '42501', null, 'nobody signed in can read a blank card''s code hash');
select throws_ok($$ select access_code_ciphertext from public.qr_cards $$,
  '42501', null, 'nobody signed in can read a blank card''s encrypted code');
select throws_ok($$ select * from public.access_code_hashes $$,
  '42501', null, 'nobody signed in can read the code registry');
select throws_ok($$ select app.claim_access_code(repeat('f', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null, 'nobody signed in can claim a code directly');
select throws_ok($$ select app.new_card_code() $$, '42501', null, 'nobody signed in can make card codes');
select is((select count(*) from unnest(array['app.claim_access_code(text, uuid)', 'app.on_access_code_added()',
    'app.on_access_code_removed()', 'app.new_card_code()']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  0::bigint, 'no new app function is executable by browsers');

-- ── As the server, for the photographer: the whole job plus two blank cards ───────────────────────────────────────
reset role;
set local role service_role;
select pg_temp.as_server() as server;
insert into out values ('first', public.prepare_qr_cards('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', null, false, null, pg_temp.blanks(2, 'first')));
select is(auth.uid(), null, 'and stops acting for the photographer afterwards');
select results_eq($$ select c ->> 'child_id' from out, jsonb_array_elements(v -> 'cards') c where k = 'first' order by 1 $$,
  $$ values ('c0000000-0000-4000-8000-000000000001'), ('c0000000-0000-4000-8000-000000000002'),
            ('c0000000-0000-4000-8000-000000000003'), ('c0000000-0000-4000-8000-000000000004') $$,
  'every child of the job gets a card except the one marked Do not photograph');
select is((select jsonb_array_length(v -> 'blanks') from out where k = 'first'), 2, 'and two blank cards are made');
select is((select (v ->> 'new_cards')::int from out where k = 'first'), 4, 'the four child cards are new');
select ok((select bool_and(c ->> 'card_code' ~ '^[0-9A-HJKMNP-TV-Z]{20}$')
           from out, jsonb_array_elements(v -> 'cards') c where k = 'first'),
  'each card has a card code');

-- A reprint reuses every child's card (Seenu, answer 2).
insert into out values ('again', public.prepare_qr_cards('55555555-5555-4555-8555-555555555555',
  'a0000000-0000-4000-8000-000000000001', null, false, null, '[]'));
select is((select v -> 'cards' from out where k = 'again'), (select v -> 'cards' from out where k = 'first'),
  'a reprint (by an admin) prints the same card codes');
select is((select (v ->> 'new_cards')::int from out where k = 'again'), 0, 'and makes no new cards');

-- Chosen classes, "no class", and one child.
select results_eq($$
  select c ->> 'child_id' from jsonb_array_elements(public.prepare_qr_cards('11111111-1111-4111-8111-111111111111',
    'a0000000-0000-4000-8000-000000000001', array['a1000000-0000-4000-8000-000000000001']::uuid[], false, null,
    '[]') -> 'cards') c order by 1 $$,
  $$ values ('c0000000-0000-4000-8000-000000000001'), ('c0000000-0000-4000-8000-000000000002') $$,
  'one class prints only its children (never Do not photograph)');
select results_eq($$
  select c ->> 'child_id' from jsonb_array_elements(public.prepare_qr_cards('11111111-1111-4111-8111-111111111111',
    'a0000000-0000-4000-8000-000000000001', '{}'::uuid[], true, null, '[]') -> 'cards') c $$,
  $$ values ('c0000000-0000-4000-8000-000000000004') $$,
  '"no class" prints the children without one');
select is(
  public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', null, false,
    'c0000000-0000-4000-8000-000000000003', '[]') -> 'cards',
  (select jsonb_agg(c) from out, jsonb_array_elements(v -> 'cards') c
   where k = 'first' and c ->> 'child_id' = 'c0000000-0000-4000-8000-000000000003'),
  'a single card from the child panel is the child''s same card');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', null,
    false, 'c0000000-0000-4000-8000-000000000005', '[]') $$,
  'P0001', 'do_not_photograph', 'a child marked Do not photograph never gets a card');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002', null,
    false, null, '[]') $$,
  'P0001', 'nothing_to_print', 'a job with only Do not photograph children and no blank cards has nothing to print');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', null,
    false, 'c0000000-0000-4000-8000-000000000006', '[]') $$,
  '22023', null, 'a single card must be for a child of the job');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
    array['a1000000-0000-4000-8000-000000000003']::uuid[], false, null, '[]') $$,
  '22023', null, 'a class of another job is refused');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
    array['b1000000-0000-4000-8000-000000000001']::uuid[], false, null, '[]') $$,
  '22023', null, 'a class of another studio is refused');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
    array['a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001']::uuid[], false, null, '[]') $$,
  '22023', null, 'a class can be chosen only once');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', null,
    false, null, pg_temp.blanks(101, 'many')) $$,
  '22023', null, 'at most 100 blank cards per print (Seenu, answer 3)');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', null,
    false, 'c0000000-0000-4000-8000-000000000001', pg_temp.blanks(1, 'single')) $$,
  '22023', null, 'a single card comes without blank cards');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000009', null,
    false, null, '[]') $$,
  'P0002', null, 'a job that doesn''t exist is not found');

-- Who may print (Seenu, answer 3).
select throws_ok($$
  select public.prepare_qr_cards('44444444-4444-4444-8444-444444444444', 'a0000000-0000-4000-8000-000000000001', null,
    false, null, '[]') $$,
  '42501', null, 'the server cannot print for staff');
select throws_ok($$
  select public.prepare_qr_cards('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-000000000001', null,
    false, null, '[]') $$,
  '42501', null, 'the server cannot print studio A''s cards for studio B''s owner');
select throws_ok($$
  select public.prepare_qr_cards(null, 'a0000000-0000-4000-8000-000000000001', null, false, null, '[]') $$,
  '42501', null, 'the server cannot print without acting for someone');

-- Blank codes are unique against children's codes and other blank cards' codes (Seenu, answer 1).
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', null,
    false, null, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'access_code_hash', repeat('b', 64),
      'access_code_ciphertext', 'v1.' || repeat('C', 48)))) $$,
  'P0001', 'access_code_collision', 'a blank card cannot take a child''s code, even another studio''s');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', null,
    false, null, pg_temp.blanks(1, 'first')) $$,
  'P0001', 'access_code_collision', 'a blank card cannot take another blank card''s code');
select throws_ok($$
  select public.add_child('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
    jsonb_build_object('id', gen_random_uuid(), 'first_name', 'Twin', 'last_name', 'Code',
      'access_code_hash', encode(extensions.digest('first1', 'sha256'), 'hex'),
      'access_code_ciphertext', 'v1.' || repeat('A', 48))) $$,
  'P0001', 'access_code_collision', 'a new child cannot take a blank card''s code');
select throws_ok($$
  select public.import_roster('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('action', 'add', 'id', gen_random_uuid(), 'first_name', 'Twin',
      'last_name', 'Code', 'access_code_hash', encode(extensions.digest('first2', 'sha256'), 'hex'),
      'access_code_ciphertext', 'v1.' || repeat('A', 48)))) $$,
  'P0001', 'access_code_collision', 'an imported child cannot take a blank card''s code');
select is((select count(*) from public.qr_cards where child_id is null), 2::bigint,
  'failed prints leave no blank cards behind');

-- ── Reading cards and the Overview status ─────────────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
select is((select count(*) from public.qr_cards), 6::bigint, 'staff read their studio''s cards (4 children, 2 blank)');
select is(public.qr_card_status('a0000000-0000-4000-8000-000000000001'),
  '{"eligible":4,"with_card":4,"blank_cards":2}'::jsonb,
  'every child who may be photographed has a card, so "Print QR cards" is done');
select throws_ok($$ update public.qr_cards set card_code = repeat('A', 20) $$,
  '42501', null, 'card codes never change');
select throws_ok($$ delete from public.qr_cards $$, '42501', null, 'cards cannot be deleted from a browser session');

select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select is((select count(*) from public.qr_cards where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'owner B sees none of studio A''s cards');
select is(public.qr_card_status('a0000000-0000-4000-8000-000000000001'),
  '{"eligible":0,"with_card":0,"blank_cards":0}'::jsonb, 'and nothing of studio A''s job status');
select is((select count(*) from public.qr_cards), 0::bigint, 'studio B has no cards yet');

-- A child added after printing reopens the to-do (Seenu, answer 2).
reset role;
set local role service_role;
select pg_temp.as_server() as server;
select lives_ok($$
  select public.add_child('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
    jsonb_build_object('id', 'c0000000-0000-4000-8000-000000000007', 'first_name', 'Late', 'last_name', 'Comer',
      'access_code_hash', repeat('7', 64), 'access_code_ciphertext', 'v1.' || repeat('A', 48))) $$,
  'a child is added after printing');
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select is(public.qr_card_status('a0000000-0000-4000-8000-000000000001') ->> 'with_card',
  '4', 'the new child has no card yet');
select is(public.qr_card_status('a0000000-0000-4000-8000-000000000001') ->> 'eligible',
  '5', 'so not every child has a card');
select lives_ok($$ delete from public.children where id = 'c0000000-0000-4000-8000-000000000004' $$,
  'a child with a card is removed while the job is a draft');

-- ── As a logged-out visitor ───────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok($$ select * from public.qr_cards $$, '42501', null, 'logged-out visitors cannot read cards');
select throws_ok($$ select app.claim_access_code(repeat('f', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null, 'logged-out visitors cannot claim a code');
select throws_ok($$ select app.new_card_code() $$, '42501', null, 'logged-out visitors cannot make card codes');
select throws_ok($$ select public.qr_card_status('a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'logged-out visitors cannot read card status');
select throws_ok($$
  select public.prepare_qr_cards('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', null,
    false, null, '[]') $$,
  '42501', null, 'logged-out visitors cannot print');

-- ── Checked as the database owner ─────────────────────────────────────────────────────────────────────────────────
reset role;
select is((select count(*) from public.qr_cards where child_id = 'c0000000-0000-4000-8000-000000000004'), 0::bigint,
  'a removed child''s card goes with them');
select is((select count(*) from public.access_code_hashes where access_code_hash = repeat('4', 64)), 0::bigint,
  'and so does their claim on the code, which can be used again');
select is((select count(*) from public.access_code_hashes h join public.qr_cards q using (access_code_hash)
           where q.child_id is null), 2::bigint, 'each blank card''s code is claimed');
select throws_ok($$
  insert into public.qr_cards (studio_id, job_id, child_id, card_code, access_code_hash, access_code_ciphertext)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
          'c0000000-0000-4000-8000-000000000007', repeat('A', 20), repeat('e', 64), 'v1.' || repeat('C', 48)) $$,
  '23514', null, 'a child''s card never carries a code (the child has it)');
select throws_ok($$
  insert into public.qr_cards (studio_id, job_id, card_code)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', repeat('A', 20)) $$,
  '23514', null, 'a blank card always carries a code');
select throws_ok($$
  insert into public.qr_cards (studio_id, job_id, child_id, card_code)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
          'c0000000-0000-4000-8000-000000000007', repeat('A', 20)) $$,
  '23503', null, 'a card''s child is always in the card''s own job');
select throws_ok($$
  insert into public.qr_cards (studio_id, job_id, child_id, card_code)
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
         'c0000000-0000-4000-8000-000000000001', repeat('B', 20) $$,
  '23505', null, 'a child has one card');

-- Events: one per print, counts and IDs only, attributed to the person the server acted for.
select results_eq($$
  select actor_id, data from public.events where type = 'qr_cards.printed' order by id limit 2 $$,
  $$ values
    ('33333333-3333-4333-8333-333333333333'::uuid,
     '{"cards":4,"new_cards":4,"blank_cards":2,"groups":null,"single":false}'::jsonb),
    ('55555555-5555-4555-8555-555555555555'::uuid,
     '{"cards":4,"new_cards":0,"blank_cards":0,"groups":null,"single":false}'::jsonb) $$,
  'each print writes one event with counts only, attributed to the person printing');
select is((select count(*) from public.events where type = 'qr_cards.printed'), 5::bigint,
  'failed prints write no event');
select is((select count(*) from public.events e
  where e.type = 'qr_cards.printed'
    and (e.data::text ~* '(maya|johnson|liam|chen|patel|room|[0-9a-f]{64})'
         or exists (select 1 from public.qr_cards q where position(q.card_code in e.data::text) > 0))),
  0::bigint, 'print events never contain names, class names, card codes or code hashes');

select lives_ok($$ delete from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'a studio with cards can still be deleted');
select is((select count(*) from public.qr_cards) + (select count(*) from public.access_code_hashes
           where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'and its cards and code claims go with it');

select * from finish();
rollback;
