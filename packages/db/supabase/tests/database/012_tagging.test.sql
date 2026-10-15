-- QR tagging and review (D32, F16, D142 #7, D143, D96; Seenu's answers of Oct 12 2026; ADR 0018): what the worker read
-- is resolved within the photo's own job only; tags are written for the round tagging read and never over manual ones;
-- moves, confirmations, blank-card claims and Mark reviewed re-check the acting person's role and studio; the blank
-- card's code moves to its new child in ADR 0015's order; events carry ids and counts only; another studio sees and
-- changes nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(187);

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

-- Fixtures as the database owner. Studio A: job 1 with class "Room 4" (Maya and Liam, each with a card) and a blank
-- card; job 2 with a child and a card. Studio B: a job with a child and a card.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Spring', 'school', '2026-10-01', 'JOB00002'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
insert into public.job_groups (id, studio_id, job_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Room 4'),
  ('e2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'Room 9');
insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, access_code_hash,
  access_code_ciphertext) values
  ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', 'Maya', 'Johnson', repeat('1', 64), 'v1.' || repeat('A', 48)),
  ('c1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', 'Liam', 'Chen', repeat('2', 64), 'v1.' || repeat('A', 48)),
  ('c2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   'e2000000-0000-4000-8000-000000000001', 'Ava', 'Patel', repeat('3', 64), 'v1.' || repeat('A', 48)),
  ('d0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   null, 'Bianca', 'Secret', repeat('4', 64), 'v1.' || repeat('B', 48));
insert into public.qr_cards (id, studio_id, job_id, child_id, card_code, access_code_hash, access_code_ciphertext) values
  ('f1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001', 'AAAAAAAAAAAAAAAAAAAA', null, null),
  ('f1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000002', 'BBBBBBBBBBBBBBBBBBBB', null, null),
  ('f1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   null, 'CCCCCCCCCCCCCCCCCCCC', repeat('9', 64), 'v1.' || repeat('K', 48)),
  ('f2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   'c2000000-0000-4000-8000-000000000001', 'DDDDDDDDDDDDDDDDDDDD', null, null),
  ('f3000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001', 'EEEEEEEEEEEEEEEEEEEE', null, null);
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('a2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   '33333333-3333-4333-8333-333333333333'),
  ('a2000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111');
-- Ten photos of job 1, being processed, named IMG_0001 … IMG_0010 (the tagging order); one photo of job 2.
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  created_by)
select ('9a000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, b.studio_id, b.job_id, b.id, b.seq,
  'processing', 'IMG_' || lpad(n::text, 4, '0') || '.JPG', 1, extensions.digest('a1-' || n, 'sha256'), b.created_by
from public.upload_batches b, generate_series(1, 10) n
where b.id = 'a2000000-0000-4000-8000-000000000001';
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  created_by)
select '9b000000-0000-4000-8000-000000000001', b.studio_id, b.job_id, b.id, b.seq, 'ready', 'Other.JPG', 1,
  extensions.digest('a2-1', 'sha256'), b.created_by
from public.upload_batches b where b.id = 'a2000000-0000-4000-8000-000000000002';

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.as_server() returns boolean language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) is not null $$;
create function pg_temp.p(n int) returns uuid language sql as $$
  select ('9a000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.w(n int, place text, child uuid default null, grp uuid default null, card uuid default null,
  flag text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('photo_id', pg_temp.p(n), 'place', place, 'child_id', child,
    'card_id', card, 'flag', flag)) $$;
create function pg_temp.round() returns bigint language sql as $$
  select tag_round from public.upload_batches where id = 'a2000000-0000-4000-8000-000000000001' $$;
create function pg_temp.place(n int) returns text language sql as $$
  select t.place::text || coalesce(':' || t.child_id::text, '') || coalesce('!' || t.flag::text, '') || '/' || t.source
  from public.photo_tags t where t.photo_id = pg_temp.p(n) $$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'photo_tags', 'photo_tags exists');
select has_table('public', 'job_tagging_reviews', 'job_tagging_reviews exists');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.photo_tags'::regclass, 'public.job_tagging_reviews'::regclass)),
  'both have row-level security');
select ok((select condeferrable and not condeferred from pg_constraint where conname = 'qr_cards_child_fk'),
  'a card''s child FK can be deferred for claiming a blank card, and is checked at once otherwise');
select has_column('public', 'photos', 'qr_kind', 'photos record what the worker read');
select has_column('public', 'upload_batches', 'kind', 'an upload is individual photos or group photos (ADR 0030)');
select is((select count(*) from unnest(array[
    'public.create_upload_batch(uuid, uuid, text, uuid, uuid)', 'public.tagging_inputs(uuid)',
    'public.apply_batch_tags(uuid, bigint, jsonb)', 'public.batches_to_tag(int)', 'public.batches_of_photos(uuid[])',
    'public.move_photos(uuid, uuid, uuid[], jsonb)', 'public.confirm_photos(uuid, uuid, uuid[], boolean)',
    'public.blank_card_code(uuid, uuid, uuid)', 'public.claim_blank_card(uuid, uuid, uuid, jsonb)',
    'public.mark_tagging_reviewed(uuid, uuid)', 'app.reopen_tagging_review(uuid[])',
    'app.on_photos_tagging_change()', 'app.on_child_removed_tags()', 'app.check_tag_request(uuid, uuid[])',
    'app.job_tagging_state(uuid)', 'app.carry_purged_steps(uuid[])', 'public.delete_purged_photos(uuid[])',
    'public.undo_card_photos(uuid, uuid, uuid[])', 'app.on_photo_after_purge()']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  0::bigint, 'no tagging write, worker or system function is executable by browsers');
select is((select count(*) from unnest(array['public.job_tagging_overview(uuid)',
    'public.tagging_photos(uuid, text, uuid, uuid, int)', 'public.photo_people(uuid, uuid, uuid, int, int)',
    'public.tagging_blank_cards(uuid)', 'public.photo_parent_visible(uuid)']) f
  where has_function_privilege('anon', f, 'execute')), 0::bigint, 'logged-out visitors run no tagging read');
select ok((select tag_round > tagged_round from public.upload_batches where id = 'a2000000-0000-4000-8000-000000000001'),
  'new photos make their batch due for tagging');

-- ── As studio A's owner, from a browser session: reads only ───────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$ insert into public.photo_tags (photo_id, studio_id, job_id, place, source)
  values (pg_temp.p(1), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'leftovers', 'auto') $$,
  '42501', null, 'owners cannot write tags directly');
select throws_ok($$ insert into public.job_tagging_reviews (job_id, studio_id, reviewed_by)
  values ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid()) $$,
  '42501', null, 'nor mark a job reviewed directly');
select throws_ok($$ select public.move_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(1)], '{"kind":"leftovers"}') $$, '42501', null,
  'nor run move_photos from a browser session');
select throws_ok($$ select public.tagging_inputs('a2000000-0000-4000-8000-000000000001') $$, '42501', null,
  'nor read tagging inputs');

-- ── The worker's results, as the server ───────────────────────────────────────────────────────────────────────────
reset role;
set local role service_role;
select pg_temp.as_server() as server;
-- 1 a photo, 2-3 Maya's card twice, 4 a photo, 5 job 2's card, 6 a photo, 7 the blank card, 8 a photo, 9 studio B's
-- card, 10 a failed photo.
select ok(public.record_photo_result(pg_temp.p(1), 1, '{"status":"ready","width":10,"height":10,"qr":{"kind":"none"}}'),
  'a plain photo''s result');
select ok(public.record_photo_result(pg_temp.p(2), 1,
  '{"status":"ready","width":10,"height":10,"qr":{"kind":"card","card_code":"AAAAAAAAAAAAAAAAAAAA"}}'), 'a card''s result');
select public.record_photo_result(pg_temp.p(3), 1,
  '{"status":"ready","width":10,"height":10,"qr":{"kind":"card","card_code":"AAAAAAAAAAAAAAAAAAAA"}}');
select public.record_photo_result(pg_temp.p(4), 1, '{"status":"ready","width":10,"height":10,"qr":{"kind":"none"}}');
select public.record_photo_result(pg_temp.p(5), 1,
  '{"status":"ready","width":10,"height":10,"qr":{"kind":"card","card_code":"DDDDDDDDDDDDDDDDDDDD"}}');
select public.record_photo_result(pg_temp.p(6), 1, '{"status":"ready","width":10,"height":10,"qr":{"kind":"none"}}');
select public.record_photo_result(pg_temp.p(7), 1,
  '{"status":"ready","width":10,"height":10,"qr":{"kind":"card","card_code":"CCCCCCCCCCCCCCCCCCCC"}}');
select public.record_photo_result(pg_temp.p(8), 1, '{"status":"ready","width":10,"height":10,"qr":{"kind":"none"}}');
select public.record_photo_result(pg_temp.p(9), 1,
  '{"status":"ready","width":10,"height":10,"qr":{"kind":"card","card_code":"EEEEEEEEEEEEEEEEEEEE"}}');
select public.record_photo_result(pg_temp.p(10), 1, '{"status":"failed","failure_reason":"unreadable"}');
select results_eq($$ select coalesce(qr_kind, '-') || ':' || coalesce(qr_card_id::text, '-') from public.photos
                     where batch_id = 'a2000000-0000-4000-8000-000000000001' order by original_filename $$,
  $$ values ('none:-'), ('card:f1000000-0000-4000-8000-000000000001'), ('card:f1000000-0000-4000-8000-000000000001'),
            ('none:-'), ('other_card:-'), ('none:-'), ('card:f1000000-0000-4000-8000-000000000003'), ('none:-'),
            ('other_card:-'), ('-:-') $$,
  'a card is found among the photo''s own job''s cards only: another job''s or another studio''s card is other_card');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1,
  '{"status":"ready","width":1,"height":1,"qr":{"kind":"card"}}') $$, '22023', 'A result is ready (with a size) or failed',
  'a card without a code is refused, with no values');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1,
  '{"status":"ready","width":1,"height":1,"qr":{"kind":"card","card_code":"Maya Johnson"}}') $$, '22023',
  'A result is ready (with a size) or failed', 'and so is a code that isn''t one, without echoing it');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1,
  '{"status":"failed","failure_reason":"unreadable","qr":{"kind":"none"}}') $$, '22023', null,
  'a failed photo has nothing read');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1, '{"status":"ready","width":1,"height":1}') $$,
  '22023', null, 'a ready result without what was read is refused, so an old worker''s message is tried again (security review 2)');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1,
  '{"status":"ready","width":1,"height":1,"qr":null}') $$, '22023', null, 'and so is one with qr null');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1,
  '{"status":"ready","width":1,"height":1,"qr":{"kind":"none","card_code":"AAAAAAAAAAAAAAAAAAAA"}}') $$, '22023', null,
  'a code goes only with a card');

-- ── Tagging the batch (the API runs core's rules and writes the result) ──────────────────────────────────────────
select is((select jsonb_array_length(public.tagging_inputs('a2000000-0000-4000-8000-000000000001') -> 'photos')), 10,
  'tagging reads the batch''s ten photos');
select is((select array_agg(x ->> 'id' order by o)::text from jsonb_array_elements(
             public.tagging_inputs('a2000000-0000-4000-8000-000000000001') -> 'photos') with ordinality e (x, o)),
  (select array_agg(pg_temp.p(n)::text order by n)::text from generate_series(1, 10) n),
  'in tagging order (D142 #7)');
select is((public.tagging_inputs('a2000000-0000-4000-8000-000000000001') -> 'photos' -> 1 ->> 'card_child_id'),
  'c1000000-0000-4000-8000-000000000001', 'with each card''s child');
select is((public.tagging_inputs('a2000000-0000-4000-8000-000000000001') -> 'photos' -> 6 ->> 'card_child_id'), null,
  'and none for a blank card');
select is((public.tagging_inputs('a2000000-0000-4000-8000-000000000001') ->> 'processing')::int, 0,
  'nothing is still processing');
select is(public.tagging_inputs(gen_random_uuid()), null, 'an unknown batch has no inputs');
select results_eq($$ select id from public.batches_of_photos(array[pg_temp.p(1), pg_temp.p(2),
  '9b000000-0000-4000-8000-000000000001'::uuid]) order by id $$,
  $$ values ('a2000000-0000-4000-8000-000000000001'::uuid), ('a2000000-0000-4000-8000-000000000002'::uuid) $$,
  'the API finds the batches of the photos it changed');
select is((select count(*) from public.batches_to_tag(10) where id = 'a2000000-0000-4000-8000-000000000001'), 1::bigint,
  'the daily sweep finds the batch until it is tagged');

create temp table writes as select jsonb_build_array(
  pg_temp.w(1, 'leftovers'),
  pg_temp.w(2, 'card', card => 'f1000000-0000-4000-8000-000000000001'),
  pg_temp.w(3, 'card', card => 'f1000000-0000-4000-8000-000000000001'),
  pg_temp.w(4, 'child', child => 'c1000000-0000-4000-8000-000000000001'),
  pg_temp.w(5, 'child', child => 'c1000000-0000-4000-8000-000000000001', flag => 'other_card'),
  pg_temp.w(6, 'child', child => 'c1000000-0000-4000-8000-000000000001', flag => 'after_unreadable'),
  pg_temp.w(7, 'card', card => 'f1000000-0000-4000-8000-000000000003'),
  pg_temp.w(8, 'blank_card', card => 'f1000000-0000-4000-8000-000000000003'),
  pg_temp.w(9, 'blank_card', card => 'f1000000-0000-4000-8000-000000000003', flag => 'other_card')) as v;
grant select on writes to service_role;
select throws_ok($$ select public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round() - 1,
  (select v from writes)) $$, 'P0001', 'tagging_stale', 'a run that read an older round writes nothing');
select is((select count(*) from public.photo_tags), 0::bigint, 'nothing was written');
select throws_ok($$ select public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(),
  jsonb_build_array(pg_temp.w(1, 'child', child => 'c2000000-0000-4000-8000-000000000001'))) $$, '22023', null,
  'a tag naming another job''s child is refused');
select throws_ok($$ select public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(),
  jsonb_build_array(jsonb_build_object('photo_id', '9b000000-0000-4000-8000-000000000001', 'place', 'leftovers'))) $$,
  '22023', null, 'and so is a photo of another batch');
select throws_ok($$ select public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(),
  jsonb_build_array(pg_temp.w(1, 'leftovers'), pg_temp.w(1, 'leftovers'))) $$, '22023', null,
  'and one photo twice');
select throws_ok($$ select public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(),
  jsonb_build_array(pg_temp.w(1, 'child'))) $$, '22023', null, 'and a child tag without a child');
select is(public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(), (select v from writes)), 9,
  'the batch''s tags are written');
select is((select tagged_round from public.upload_batches where id = 'a2000000-0000-4000-8000-000000000001'),
  pg_temp.round(), 'for the round it read');
select is(public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(), (select v from writes)), 0,
  'writing the same tags again changes nothing');
select is((select count(*) from public.events where type = 'photos.tagged'), 1::bigint, 'one photos.tagged event');
select is((select data from public.events where type = 'photos.tagged'),
  jsonb_build_object('batch_id', 'a2000000-0000-4000-8000-000000000001', 'round', pg_temp.round(), 'photos', 9,
    'cards', 3, 'leftovers', 1, 'flagged', 3, 'blank_cards', 1),
  'with ids and counts only');
select is((select actor_id from public.events where type = 'photos.tagged'),
  '33333333-3333-4333-8333-333333333333'::uuid, 'attributed to the person who started the upload');
select is(auth.uid(), null, 'and the server stops acting for them afterwards');

-- ── Parents never see card or flagged photos ──────────────────────────────────────────────────────────────────────
select ok(public.photo_parent_visible(pg_temp.p(4)), 'a child''s photo can be shown to parents later');
select ok(not public.photo_parent_visible(pg_temp.p(2)), 'a card photo never is');
select ok(not public.photo_parent_visible(pg_temp.p(5)), 'nor a flagged photo, until confirmed (Seenu, plan answer 1)');
select ok(not public.photo_parent_visible(pg_temp.p(1)), 'nor a photo in Leftovers');
select ok(not public.photo_parent_visible(pg_temp.p(10)), 'nor a failed photo');

-- ── Moves (owners, admins and photographers; Seenu, answer 8) ────────────────────────────────────────────────────
select throws_ok($$ select public.move_photos('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(1)],
  '{"kind":"child","id":"c1000000-0000-4000-8000-000000000002"}') $$, '42501', null,
  'staff cannot move photos (plan answer 10)');
select throws_ok($$ select public.move_photos('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(1)],
  '{"kind":"child","id":"c1000000-0000-4000-8000-000000000002"}') $$, '42501', null,
  'nor can another studio''s owner');
select throws_ok($$ select public.move_photos('22222222-2222-4222-8222-222222222222',
  'b0000000-0000-4000-8000-000000000001', array[pg_temp.p(1)], '{"kind":"leftovers"}') $$, '22023', null,
  'nor move studio A''s photos under their own job');
select throws_ok($$ select public.move_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', array['9b000000-0000-4000-8000-000000000001'::uuid],
  '{"kind":"leftovers"}') $$, '22023', null, 'another job''s photo can''t be moved in this job');
select throws_ok($$ select public.move_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(1)],
  '{"kind":"child","id":"c2000000-0000-4000-8000-000000000001"}') $$, '22023', null,
  'nor to another job''s child');
select throws_ok($$ select public.move_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(1)],
  '{"kind":"child","id":"d0000000-0000-4000-8000-000000000001"}') $$, '22023', null,
  'nor to another studio''s child');
select throws_ok($$ select public.move_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(2)], '{"kind":"leftovers"}') $$, 'P0001', 'card_photo',
  'card photos stay card photos');
select throws_ok($$ select public.move_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(10)], '{"kind":"leftovers"}') $$, 'P0001',
  'photo_not_ready', 'a failed photo can''t be moved');
select is(public.move_photos('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(1)], '{"kind":"child","id":"c1000000-0000-4000-8000-000000000002"}'), 1,
  'a photographer moves a Leftover to Liam');
select is(pg_temp.place(1), 'child:c1000000-0000-4000-8000-000000000002/manual', 'by hand');
select is(public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(), (select v from writes)), 0,
  'tagging the batch again never overwrites a manual move');
select is(pg_temp.place(1), 'child:c1000000-0000-4000-8000-000000000002/manual', 'the photo stays with Liam');
select is((select data - 'photo_ids' from public.events where type = 'photos.moved'),
  '{"count": 1, "target_kind": "child", "target_id": "c1000000-0000-4000-8000-000000000002"}'::jsonb,
  'one photos.moved event, ids and counts only');
select is(public.move_photos('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(1)], '{"kind":"child","id":"c1000000-0000-4000-8000-000000000002"}'), 0,
  'moving it there again changes nothing');
select throws_ok($$ select public.move_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(4)],
  '{"kind":"class_set","id":"e1000000-0000-4000-8000-000000000001"}') $$, '22023', null,
  'a class is no longer a place for photos (D156, C1)');
select is(public.move_photos('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(4)], '{"kind":"child","id":"c1000000-0000-4000-8000-000000000001"}'), 1, 'a photo goes to Maya');
select ok(public.photo_parent_visible(pg_temp.p(4)), 'which her parents will see');

-- ── Confirming flagged photos (plan answer 1) ─────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.confirm_photos('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)], false) $$, '42501', null, 'staff cannot confirm');
select throws_ok($$ select public.confirm_photos('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)], false) $$, '42501', null,
  'nor can another studio''s owner');
-- A photo of another job's card shows that card's child: never "Looks right", never moved (security review 4, code
-- review M1).
select throws_ok($$ select public.confirm_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5), pg_temp.p(6)], false) $$, 'P0001', 'other_card',
  'another job''s card photo can''t be confirmed as a normal photo');
select throws_ok($$ select public.move_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)],
  '{"kind":"child","id":"c1000000-0000-4000-8000-000000000002"}') $$, 'P0001', 'other_card', 'nor moved to a child');
select throws_ok($$ select public.move_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)], '{"kind":"leftovers"}') $$, 'P0001', 'other_card',
  'nor even to Leftovers');
select ok(not public.photo_parent_visible(pg_temp.p(5)), 'and it stays hidden from parents');
select is(public.confirm_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(6)], false), 1, '"Looks right" keeps a flagged photo where it is');
select is(pg_temp.place(6), 'child:c1000000-0000-4000-8000-000000000001/manual', 'without the flag');
select ok(public.photo_parent_visible(pg_temp.p(6)), 'and it may be shown to parents later');
select is(public.confirm_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(5)], true), 1, 'another job''s card photo can be marked a card photo');
select is((select place::text || ':' || card_id::text from public.photo_tags where photo_id = pg_temp.p(5)),
  'card:f1000000-0000-4000-8000-000000000001', 'and stays listed with the child it was with, as their card photo');
select is(public.confirm_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(9)], true), 1, '"This is a card photo" hides it');
select is(pg_temp.place(9), 'card/manual', 'as a card photo');
select is((select card_id from public.photo_tags where photo_id = pg_temp.p(9)),
  'f1000000-0000-4000-8000-000000000003'::uuid, 'still with its blank card');
-- A card photo stays one (security review 3).
select throws_ok($$ select public.move_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(9)], '{"kind":"leftovers"}') $$, 'P0001', 'card_photo',
  'a photo marked a card photo can''t be moved');
select throws_ok($$ select public.confirm_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(9)], false) $$, 'P0001', 'card_photo',
  'nor confirmed as a normal photo');
select throws_ok($$ select public.confirm_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(9)], true) $$, 'P0001', 'card_photo',
  'nor marked again');

-- ── Undoing "This is a card photo" (Seenu, answer 12): owners and admins only ────────────────────────────────────
select throws_ok($$ select public.undo_card_photos('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)]) $$, '42501', null,
  'a photographer cannot undo a card photo mark');
select throws_ok($$ select public.undo_card_photos('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)]) $$, '42501', null, 'nor can staff');
select throws_ok($$ select public.undo_card_photos('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)]) $$, '42501', null,
  'nor another studio''s owner');
select throws_ok($$ select public.undo_card_photos('22222222-2222-4222-8222-222222222222',
  'b0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)]) $$, '22023', null,
  'nor under their own job');
select is(pg_temp.place(5), 'card/manual', 'and nothing changed');
select throws_ok($$ select public.undo_card_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(2)]) $$, 'P0001', 'not_marked_card',
  'a photo whose card was read stays a card photo');
select throws_ok($$ select public.undo_card_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(4)]) $$, 'P0001', 'not_marked_card',
  'and a photo that isn''t a card photo has nothing to undo');
insert into public.job_tagging_reviews (job_id, studio_id, reviewed_by) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');
select is(public.undo_card_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(5)]), 1, 'an owner undoes the mark');
select is(pg_temp.place(5), 'child:c1000000-0000-4000-8000-000000000001!unreadable_card/manual',
  'the photo is back with the child it was listed under, flagged as a photo that may be a card');
select ok(not public.photo_parent_visible(pg_temp.p(5)), 'hidden from parents until confirmed again');
select is((select count(*) from public.job_tagging_reviews where job_id = 'a0000000-0000-4000-8000-000000000001'),
  0::bigint, 'the flag reopens Review tagging');
select is((select data from public.events where type = 'photos.card_unmarked'),
  jsonb_build_object('photo_ids', jsonb_build_array(pg_temp.p(5)), 'count', 1),
  'one photos.card_unmarked event, ids and a count only');
select is((select actor_id from public.events where type = 'photos.card_unmarked'),
  '11111111-1111-4111-8111-111111111111'::uuid, 'attributed to the owner');
select is(public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(), (select v from writes)), 0,
  'tagging never changes an undone mark');
select throws_ok($$ select public.move_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.p(5)], '{"kind":"leftovers"}') $$, 'P0001', 'other_card',
  'another job''s card photo still can''t be moved once unmarked');
select is(public.confirm_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(5)], true), 1, 'and can be marked a card photo again');
select is(pg_temp.place(5), 'card/manual', 'as before');

-- ── Mark reviewed (answer 4) ─────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.mark_tagging_reviewed('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001') $$, 'P0001', 'tagging_not_ready',
  'refused while a blank card''s photos wait for a name (plan answer 4)');

-- ── Naming a blank card's child (answer 2; ADR 0015) ─────────────────────────────────────────────────────────────
select throws_ok($$ select public.blank_card_code('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003') $$, '42501', null,
  'staff cannot read a blank card''s code');
select throws_ok($$ select public.blank_card_code('22222222-2222-4222-8222-222222222222',
  'b0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003') $$, 'P0002', null,
  'another studio finds no such card in its own job');
select is(public.blank_card_code('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000003'), 'v1.' || repeat('K', 48), 'the server reads the card''s encrypted code');
select throws_ok($$ select public.blank_card_code('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001') $$, 'P0001', 'card_claimed',
  'a child''s card isn''t blank');
select throws_ok($$ select public.claim_blank_card('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003',
  '{"id":"c1000000-0000-4000-8000-000000000009","first_name":"Zoe","last_name":"New","access_code_ciphertext":"v1.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"}') $$,
  '42501', null, 'staff cannot claim a blank card (plan answer 10)');
select throws_ok($$ select public.claim_blank_card('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003',
  '{"id":"c1000000-0000-4000-8000-000000000009","first_name":"Zoe","last_name":"New","access_code_ciphertext":"v1.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"}') $$,
  '42501', null, 'another studio''s owner cannot claim the card');
select throws_ok($$ select public.claim_blank_card('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003',
  '{"id":"c1000000-0000-4000-8000-000000000009","first_name":" Zoe","last_name":"New","access_code_ciphertext":"v1.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"}') $$,
  '22023', 'A child needs a first and last name', 'a name the roster wouldn''t take is refused, with no values');
select throws_ok($$ select public.claim_blank_card('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003',
  '{"id":"c1000000-0000-4000-8000-000000000009","first_name":"Zoe","last_name":"New","group_id":"e2000000-0000-4000-8000-000000000001","access_code_ciphertext":"v1.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"}') $$,
  '22023', null, 'new children go only into the job''s own classes (plan answer 6)');
create temp table before_claim as select pg_temp.round() as round;
grant select on before_claim to service_role;
select is(public.claim_blank_card('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000003',
  '{"id":"c1000000-0000-4000-8000-000000000009","first_name":"Zoe","last_name":"New","group_id":"e1000000-0000-4000-8000-000000000001","access_code_ciphertext":"v1.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"}'),
  'c1000000-0000-4000-8000-000000000009'::uuid, 'a photographer names the blank card''s child');
select is((select access_code_hash from public.children where id = 'c1000000-0000-4000-8000-000000000009'), repeat('9', 64),
  'the child has the card''s code');
select is((select child_id::text || coalesce(access_code_hash, '-') || coalesce(access_code_ciphertext, '-')
           from public.qr_cards where id = 'f1000000-0000-4000-8000-000000000003'),
  'c1000000-0000-4000-8000-000000000009--', 'the card is the child''s now, without a code of its own');
select is((select count(*) from public.access_code_hashes where access_code_hash = repeat('9', 64)), 1::bigint,
  'the code is registered once, for the child');
select is(pg_temp.place(8), 'child:c1000000-0000-4000-8000-000000000009/auto', 'the card''s photos go to the child');
select is(pg_temp.place(7), 'card/auto', 'and its card photo stays a card photo');
-- A tagging run that read the batch before the claim can't hold photos for the claimed card (code review M2).
select ok(pg_temp.round() > (select round from before_claim), 'the claim moves the card''s batch round on');
select throws_ok($$ select public.apply_batch_tags('a2000000-0000-4000-8000-000000000001',
  (select round from before_claim), jsonb_build_array(pg_temp.w(8, 'blank_card', card => 'f1000000-0000-4000-8000-000000000003'))) $$,
  'P0001', 'tagging_stale', 'so a run that read it before the claim is refused');
select throws_ok($$ select public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(),
  jsonb_build_array(pg_temp.w(8, 'blank_card', card => 'f1000000-0000-4000-8000-000000000003'))) $$,
  'P0001', 'tagging_stale', 'and no run ever holds photos for a card that has its child');
select is(pg_temp.place(8), 'child:c1000000-0000-4000-8000-000000000009/auto', 'the photo stays with the child');
select throws_ok($$ select public.claim_blank_card('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003',
  '{"id":"c1000000-0000-4000-8000-000000000010","first_name":"Zed","last_name":"Twice","access_code_ciphertext":"v1.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"}') $$,
  'P0001', 'card_claimed', 'a card is claimed once');
select is((select data from public.events where type = 'qr_card.claimed'),
  '{"card_id": "f1000000-0000-4000-8000-000000000003", "child_id": "c1000000-0000-4000-8000-000000000009"}'::jsonb,
  'one qr_card.claimed event with ids only');
select is((select count(*) from public.events where type = 'child.created'
           and subject_id = 'c1000000-0000-4000-8000-000000000009'), 1::bigint, 'besides the child''s own event');

-- Tagging the batch again agrees: the card now names its child.
select is(public.apply_batch_tags('a2000000-0000-4000-8000-000000000001', pg_temp.round(), jsonb_build_array(
  pg_temp.w(8, 'child', child => 'c1000000-0000-4000-8000-000000000009'))), 0, 'and tagging agrees with the claim');

select ok(public.mark_tagging_reviewed('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001')
  is not null, 'clean: Mark reviewed works');
select is((select count(*) from public.events where type = 'tagging.reviewed' and data = '{}'::jsonb), 1::bigint,
  'with one tagging.reviewed event');
select throws_ok($$ select public.mark_tagging_reviewed('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'staff cannot mark a job reviewed');

-- ── The checklist's facts (D143) ─────────────────────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select is((select row(tagging_pending, leftovers, flagged, blank_cards_pending, tagging_reviewed)::text
           from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['a0000000-0000-4000-8000-000000000001'::uuid])),
  '(f,0,0,0,t)', 'the checklist sees a reviewed, clean job');
select is((select jsonb_agg(x ->> 'last_name' order by o) from jsonb_array_elements(public.photo_people(
  'a0000000-0000-4000-8000-000000000001', null, null, 50, 12) -> 'people') with ordinality y (x, o)),
  '["Chen", "Johnson", "New"]'::jsonb, 'People lists everyone with photos by last name (C15)');
select is((select x -> 'strip' -> 0 ->> 'place' from jsonb_array_elements(public.photo_people(
  'a0000000-0000-4000-8000-000000000001', null, null, 50, 12) -> 'people') x
  where x ->> 'id' = 'c1000000-0000-4000-8000-000000000001'), 'card', 'Maya''s line starts with her card photo');
select is((select (x ->> 'photos') || '+' || (x ->> 'card_photos') from jsonb_array_elements(public.photo_people(
  'a0000000-0000-4000-8000-000000000001', null, null, 50, 12) -> 'people') x
  where x ->> 'id' = 'c1000000-0000-4000-8000-000000000001'), '2+3',
  'and counts her own photos apart from her card photos (5 in all, as below)');
select is((select count(*) from public.tagging_photos('a0000000-0000-4000-8000-000000000001', 'child',
  'c1000000-0000-4000-8000-000000000001', null, 100)), 5::bigint, 'Maya has her three photos and her two card photos');

-- New photos reopen the review (answer 4).
reset role;
set local role service_role;
select pg_temp.as_server() as server_again;
select public.register_photos('33333333-3333-4333-8333-333333333333',
  public.create_upload_batch('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001'),
  jsonb_build_array(jsonb_build_object('name', 'IMG_0100.JPG', 'size', 10,
    'sha256', encode(extensions.digest('new', 'sha256'), 'hex'))));
select is((select count(*) from public.job_tagging_reviews), 0::bigint, 'new photos reopen Review tagging');

-- Binning a photo makes its batch due for tagging again.
select is(public.bin_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[pg_temp.p(6)]), 1, 'a photo goes to the bin');
select ok(pg_temp.round() > (select tagged_round from public.upload_batches
                             where id = 'a2000000-0000-4000-8000-000000000001'), 'and its batch is tagged again');
select ok(not public.photo_parent_visible(pg_temp.p(6)), 'a photo in the bin is never shown');
select ok(not public.photo_parent_visible(pg_temp.p(4)),
  'nor, while its batch is due to be tagged again, any photo of the batch (security review 6)');
select is((select x ->> 'binned' from jsonb_array_elements(
             public.tagging_inputs('a2000000-0000-4000-8000-000000000001') -> 'photos') x
           where x ->> 'id' = pg_temp.p(6)::text), 'true',
  'tagging still reads a binned photo, marked binned, so it still marks where cards were (security review 1)');

-- A group upload must name one of the job's groups (ADR 0030); a class is not a group.
insert into public.photo_groups (id, studio_id, job_id, name) values
  ('e9000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Choir');
select throws_ok($$ select public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'group', 'e1000000-0000-4000-8000-000000000001') $$, 'P0001',
  'group_not_in_job', 'a class is not a group');
create temp table group_batch as select public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001', 'group', 'e9000000-0000-4000-8000-000000000001') as id;
select is((select kind || ':' || photo_group_id from public.upload_batches where id = (select id from group_batch)),
  'group:e9000000-0000-4000-8000-000000000001', 'a group upload remembers its group');

-- ── Another studio sees nothing (D96) ─────────────────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as owner_b;
select is((select count(*) from public.photo_tags), 0::bigint, 'studio B reads none of A''s tags');
select is((select count(*) from public.job_tagging_reviews), 0::bigint, 'nor its reviews');
select is((select count(*) from public.tagging_photos('a0000000-0000-4000-8000-000000000001', 'child',
  'c1000000-0000-4000-8000-000000000001', null, 100)), 0::bigint, 'nor A''s photos by child');
select is((select (public.job_tagging_overview('a0000000-0000-4000-8000-000000000001') ->> 'photos')::int), 0,
  'nor A''s counts');
select is(public.photo_people('a0000000-0000-4000-8000-000000000001', null, null, 50, 12),
  '{"total": 0, "people": []}'::jsonb, 'nor A''s people');
select is(public.tagging_blank_cards('a0000000-0000-4000-8000-000000000001'), '[]'::jsonb, 'nor its blank cards');
select is((select count(*) from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array['a0000000-0000-4000-8000-000000000001'::uuid])), 0::bigint, 'nor its checklist facts');
select ok(not public.photo_parent_visible(pg_temp.p(4)), 'nor whether a photo of A''s is visible');

-- ── Removing a child (drafts only) sends their photos to Leftovers ────────────────────────────────────────────────
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a_again;
delete from public.children where id = 'c1000000-0000-4000-8000-000000000002';
reset role;
select is(pg_temp.place(1), 'leftovers/manual', 'a removed child''s photos go to Leftovers, by hand');

-- ── Job 2: photos that may be cards, the bin's purge, and closed jobs ────────────────────────────────────────────
-- A second child with a card in job 2, and a batch of nine: 1 Ava's card, 2 a photo, 3 Noah's card, 4 an unreadable
-- card, 5 a photo, 6 a failed photo, 7-8 photos, 9 an unreadable card.
insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, access_code_hash,
  access_code_ciphertext) values
  ('c2000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   'e2000000-0000-4000-8000-000000000001', 'Noah', 'Kim', repeat('5', 64), 'v1.' || repeat('A', 48));
insert into public.qr_cards (id, studio_id, job_id, child_id, card_code, access_code_hash, access_code_ciphertext) values
  ('f2000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   'c2000000-0000-4000-8000-000000000002', 'GGGGGGGGGGGGGGGGGGGG', null, null);
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('a2000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111');
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  created_by)
select ('9c000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, b.studio_id, b.job_id, b.id, b.seq,
  'processing', 'IMG_' || lpad((2000 + n)::text, 4, '0') || '.JPG', 1, extensions.digest('a3-' || n, 'sha256'),
  b.created_by
from public.upload_batches b, generate_series(1, 9) n
where b.id = 'a2000000-0000-4000-8000-000000000003';
create function pg_temp.q(n int) returns uuid language sql as $$
  select ('9c000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.qw(n int, place text, child uuid default null, card uuid default null, flag text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('photo_id', pg_temp.q(n), 'place', place, 'child_id', child,
    'card_id', card, 'flag', flag)) $$;
create function pg_temp.qplace(n int) returns text language sql as $$
  select t.place::text || coalesce(':' || t.child_id::text, '') || coalesce('!' || t.flag::text, '') || '/' || t.source
  from public.photo_tags t where t.photo_id = pg_temp.q(n) $$;
create function pg_temp.qbefore(n int) returns text language sql as $$
  select x -> 'before' ->> 'card' || ':' || coalesce(x -> 'before' ->> 'card_child_id', '-') || ':'
    || coalesce(x -> 'before' ->> 'flag', '-')
  from jsonb_array_elements(public.tagging_inputs('a2000000-0000-4000-8000-000000000003') -> 'photos') x
  where x ->> 'id' = pg_temp.q(n)::text $$;
create function pg_temp.qround() returns bigint language sql as $$
  select tag_round from public.upload_batches where id = 'a2000000-0000-4000-8000-000000000003' $$;
select public.record_photo_result(pg_temp.q(1), 1,
  '{"status":"ready","width":10,"height":10,"qr":{"kind":"card","card_code":"DDDDDDDDDDDDDDDDDDDD"}}');
select public.record_photo_result(pg_temp.q(n), 1, '{"status":"ready","width":10,"height":10,"qr":{"kind":"none"}}')
from unnest(array[2, 5, 7, 8]) n;
select public.record_photo_result(pg_temp.q(3), 1,
  '{"status":"ready","width":10,"height":10,"qr":{"kind":"card","card_code":"GGGGGGGGGGGGGGGGGGGG"}}');
select public.record_photo_result(pg_temp.q(n), 1, '{"status":"ready","width":10,"height":10,"qr":{"kind":"unreadable"}}')
from unnest(array[4, 9]) n;
select public.record_photo_result(pg_temp.q(6), 1, '{"status":"failed","failure_reason":"unreadable"}');
-- What core's tagBatch makes of it.
select is(public.apply_batch_tags('a2000000-0000-4000-8000-000000000003', pg_temp.qround(), jsonb_build_array(
  pg_temp.qw(1, 'card', card => 'f2000000-0000-4000-8000-000000000001'),
  pg_temp.qw(2, 'child', child => 'c2000000-0000-4000-8000-000000000001'),
  pg_temp.qw(3, 'card', card => 'f2000000-0000-4000-8000-000000000002'),
  pg_temp.qw(4, 'child', child => 'c2000000-0000-4000-8000-000000000002', flag => 'unreadable_card'),
  pg_temp.qw(5, 'child', child => 'c2000000-0000-4000-8000-000000000002', flag => 'after_unreadable'),
  pg_temp.qw(7, 'child', child => 'c2000000-0000-4000-8000-000000000002', flag => 'after_failed'),
  pg_temp.qw(8, 'child', child => 'c2000000-0000-4000-8000-000000000002', flag => 'after_failed'),
  pg_temp.qw(9, 'child', child => 'c2000000-0000-4000-8000-000000000002', flag => 'unreadable_card'))), 8,
  'job 2''s batch is tagged');

-- A photo that may be a card is confirmed, either way, before it moves (Seenu, plan answer 1; code review M1).
select throws_ok($$ select public.move_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', array[pg_temp.q(9)],
  '{"kind":"child","id":"c2000000-0000-4000-8000-000000000001"}') $$, 'P0001', 'confirm_first',
  'a photo that may be a card can''t be moved before it is confirmed');
select ok(not public.photo_parent_visible(pg_temp.q(9)), 'and stays hidden');
select is(public.move_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002',
  array[pg_temp.q(5)], '{"kind":"child","id":"c2000000-0000-4000-8000-000000000002"}'), 1,
  'a photo flagged only for coming after one can be moved');

-- Only rows actually written reopen the review (code review nice 2): a write skipped for a manual tag doesn't.
insert into public.job_tagging_reviews (job_id, studio_id, reviewed_by) values
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');
update public.upload_batches set tag_round = tag_round + 1 where id = 'a2000000-0000-4000-8000-000000000003';
select is(public.apply_batch_tags('a2000000-0000-4000-8000-000000000003', pg_temp.qround(),
  jsonb_build_array(pg_temp.qw(5, 'leftovers'))), 0, 'tagging never overwrites the manual move');
select is((select count(*) from public.job_tagging_reviews where job_id = 'a0000000-0000-4000-8000-000000000002'),
  1::bigint, 'so the review stays done');
delete from public.job_tagging_reviews where job_id = 'a0000000-0000-4000-8000-000000000002';

-- Binned photos stay in tagging's input; purged ones leave what they did on the next photo (security review 1).
select is(public.bin_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002',
  array[pg_temp.q(1), pg_temp.q(3), pg_temp.q(4), pg_temp.q(6)]), 4, 'four photos go to the bin');
select is((select count(*)::int from jsonb_array_elements(
             public.tagging_inputs('a2000000-0000-4000-8000-000000000003') -> 'photos') x
           where (x ->> 'binned')::boolean), 4, 'tagging still reads them, marked binned');
update public.photos set binned_at = now() - interval '31 days', purge_started_at = now()
where id in (pg_temp.q(1), pg_temp.q(3), pg_temp.q(4), pg_temp.q(6));
select is(public.delete_purged_photos(array[pg_temp.q(1), pg_temp.q(3), pg_temp.q(4), pg_temp.q(6)]), 4,
  'the daily clean-up purges them');
select is(pg_temp.qbefore(2), 'true:c2000000-0000-4000-8000-000000000001:-',
  'the photo after Ava''s purged card still goes to Ava');
select is(pg_temp.qbefore(5), 'true:c2000000-0000-4000-8000-000000000002:after_unreadable',
  'after Noah''s purged card and a purged unreadable card: Noah, flagged');
select is(pg_temp.qbefore(7), 'false:-:after_failed', 'after a purged failed photo: flagged');
select is(pg_temp.qbefore(8), null, 'and a photo after none keeps nothing');
select is((select purge_steps::text || ':' || purge_tail::text from public.upload_batches
           where id = 'a2000000-0000-4000-8000-000000000003'), 'true:false',
  'the batch remembers a purge left steps, none of them after its last photo');
select is((select count(*) from public.photos where batch_id = 'a2000000-0000-4000-8000-000000000003' and after_purge),
  0::bigint, 'no photo has come or moved since');
select is((select count(*) from public.events where data::text ~ '(GGGGGGGGGGGGGGGGGGGG|IMG_2)'), 0::bigint,
  'no event names a card code or a filename');

-- Removing a child keeps "may be a card" flags (security review 3-4).
delete from public.children where id = 'c2000000-0000-4000-8000-000000000002';
select is(pg_temp.qplace(9), 'leftovers!unreadable_card/auto', 'a removed child''s photo that may be a card stays flagged');
select is(pg_temp.qplace(8), 'leftovers!after_purge/manual',
  'the photos a purged card gave the removed child go to Leftovers flagged: whose they are can''t be known (answer 13)');
select is(pg_temp.qbefore(5), 'true:-:after_unreadable', 'a purged card since removed is kept as a removed card');
select ok(pg_temp.qround() > (select tagged_round from public.upload_batches
                              where id = 'a2000000-0000-4000-8000-000000000003'),
  'and its batch is tagged again, so the photos after it are flagged');
select ok(not public.photo_parent_visible(pg_temp.q(8)), 'hidden from parents');

-- Purge edge cases (Seenu, answer 13): the last photo purged, then a photo that sorts after it appears.
select public.apply_batch_tags('a2000000-0000-4000-8000-000000000003', pg_temp.qround(), '[]'::jsonb);
select is(public.bin_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002',
  array[pg_temp.q(9)]), 1, 'the batch''s last photo, a photo that may be a card, goes to the bin');
update public.photos set binned_at = now() - interval '31 days', purge_started_at = now() where id = pg_temp.q(9);
select is(public.delete_purged_photos(array[pg_temp.q(9)]), 1, 'and is purged');
select is((select purge_tail from public.upload_batches where id = 'a2000000-0000-4000-8000-000000000003'), true,
  'with nothing after it to carry its step: the batch remembers it');
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  created_by)
select pg_temp.q(10), b.studio_id, b.job_id, b.id, b.seq, 'uploading', 'IMG_2010.JPG', 1,
  extensions.digest('a3-10', 'sha256'), b.created_by
from public.upload_batches b where b.id = 'a2000000-0000-4000-8000-000000000003';
select is((select after_purge from public.photos where id = pg_temp.q(10)), false, 'a photo still uploading isn''t in the order yet');
update public.photos set status = 'processing' where id = pg_temp.q(10);
select is((select after_purge from public.photos where id = pg_temp.q(10)), true,
  'once it comes into the order after the purge, it is marked');
select public.record_photo_result(pg_temp.q(10), 1, '{"status":"ready","width":10,"height":10,"qr":{"kind":"none"}}');
select is((select x ->> 'after_purge' from jsonb_array_elements(
             public.tagging_inputs('a2000000-0000-4000-8000-000000000003') -> 'photos') x
           where x ->> 'id' = pg_temp.q(10)::text), 'true', 'tagging reads the mark');
select is(public.tagging_inputs('a2000000-0000-4000-8000-000000000003') ->> 'purge_tail', 'true',
  'and the batch''s purge tail');
select is((select after_purge from public.photos where id = pg_temp.q(2)), false,
  'a photo that was already in place isn''t marked');
update public.photos set captured_at = '2026-10-01 09:00' where id = pg_temp.q(2);
select is((select after_purge from public.photos where id = pg_temp.q(2)), true,
  'but one that moves in the order after the purge is');
insert into public.job_tagging_reviews (job_id, studio_id, reviewed_by) values
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');
select is(public.apply_batch_tags('a2000000-0000-4000-8000-000000000003', pg_temp.qround(), jsonb_build_array(
  pg_temp.qw(10, 'child', child => 'c2000000-0000-4000-8000-000000000001', flag => 'after_purge'))), 1,
  'tagging flags the late photo (core''s tagBatch) instead of guessing');
select is(pg_temp.qplace(10), 'child:c2000000-0000-4000-8000-000000000001!after_purge/auto', 'flagged');
select ok(not public.photo_parent_visible(pg_temp.q(10)), 'hidden from parents until checked');
select is((select count(*) from public.job_tagging_reviews where job_id = 'a0000000-0000-4000-8000-000000000002'),
  0::bigint, 'and Review tagging reopens');

-- Closed jobs take no tagging changes (security review 9). A job closes after selling (step 8's status guard).
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000002';
update public.jobs set status = 'closed' where id = 'a0000000-0000-4000-8000-000000000002';
select throws_ok($$ select public.move_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', array[pg_temp.q(2)], '{"kind":"leftovers"}') $$, 'P0001', 'job_closed',
  'a closed job''s photos can''t be moved');
select throws_ok($$ select public.confirm_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', array[pg_temp.q(2)], false) $$, 'P0001', 'job_closed', 'nor confirmed');
select throws_ok($$ select public.claim_blank_card('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
  '{"id":"c2000000-0000-4000-8000-000000000009","first_name":"Zoe","last_name":"New","access_code_ciphertext":"v1.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"}') $$,
  'P0001', 'job_closed', 'nor its blank cards claimed');
select throws_ok($$ select public.mark_tagging_reviewed('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002') $$, 'P0001', 'job_closed', 'nor marked reviewed');
select throws_ok($$ select public.undo_card_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', array[pg_temp.q(2)]) $$, 'P0001', 'job_closed',
  'nor a card photo mark undone');

-- ── Events never hold card codes, names or filenames ─────────────────────────────────────────────────────────────
select is((select count(*) from public.events
           where data::text ~ '(AAAAAAAAAAAAAAAAAAAA|CCCCCCCCCCCCCCCCCCCC|DDDDDDDDDDDDDDDDDDDD|EEEEEEEEEEEEEEEEEEEE|Zoe|Maya|Liam|IMG_|v1\.)'),
  0::bigint, 'no event holds a card code, a name, a filename or an encrypted code');

select * from finish();
rollback;
