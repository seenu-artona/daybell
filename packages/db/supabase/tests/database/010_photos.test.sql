-- Photos (D39, D60, D96, D100, D113, D142; Seenu's answers of Oct 11 2026; ADR 0016): studio separation, writes only
-- through server functions that re-check the acting person's role, duplicates by content, resume, the 50,000 limit,
-- the bin and its purge, closed jobs, tagging order, and events with ids and counts only (never filenames).
begin;
create extension if not exists pgtap with schema extensions;
select plan(103);

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
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'seniors', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Big', 'seniors', '2026-10-01', 'JOB00002'),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Closed', 'seniors', '2026-10-01', 'JOB00003'),
  ('a0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Retry', 'seniors', '2026-10-01', 'JOB00004'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'seniors', '2026-10-01', 'JOB00001');
update public.jobs set status = 'closed' where id = 'a0000000-0000-4000-8000-000000000003';

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.as_server() returns boolean language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) is not null $$;
-- A file for register_photos: a name, a size and the SHA-256 of a seed.
create function pg_temp.f(p_name text, p_seed text) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'size', 1000, 'sha256', encode(extensions.digest(p_seed, 'sha256'), 'hex')) $$;
create temp table out (k text primary key, v jsonb not null);
grant all on out to authenticated, service_role;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'photos', 'photos exists');
select has_table('public', 'upload_batches', 'upload_batches exists');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.photos'::regclass, 'public.upload_batches'::regclass)),
  'both have row-level security');
select ok(exists (select 1 from pg_indexes where indexname = 'photos_tagging_order_idx'
                  and indexdef like '%(job_id, batch_seq, COALESCE(captured_at%'),
  'the tagging-order index leads with the batch (D142 answer 7)');

-- ── As the owner of studio A, from a browser session ──────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$
  insert into public.upload_batches (studio_id, job_id, created_by)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
          '11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'owners cannot make batches directly');
select throws_ok($$ select upload_id from public.photos $$, '42501', null,
  'nobody signed in can read a photo''s storage upload id');
select throws_ok($$ select public.create_upload_batch('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null,
  'owners cannot run create_upload_batch from a browser session');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1, '{"status":"failed","failure_reason":"unreadable"}') $$,
  '42501', null, 'nobody signed in can record a worker result');
select is((select count(*) from unnest(array[
    'public.create_upload_batch(uuid, uuid, uuid)', 'public.register_photos(uuid, uuid, jsonb)',
    'public.set_photo_upload_id(uuid, uuid, text)', 'public.mark_photo_uploaded(uuid, uuid, text)',
    'public.cancel_photo_upload(uuid, uuid)', 'public.photos_uploading(uuid, uuid[])', 'public.finish_upload_batch(uuid, uuid, int, int)',
    'public.photo_for_worker(uuid)', 'public.record_photo_result(uuid, int, jsonb)', 'public.retry_photo(uuid, uuid)',
    'public.bin_photos(uuid, uuid, uuid[])', 'public.restore_photos(uuid, uuid, uuid[])',
    'public.begin_photo_purge(int)', 'public.delete_purged_photos(uuid[])', 'public.abandoned_uploads(int)',
    'public.delete_abandoned_uploads(uuid[])', 'public.finish_idle_batches()', 'app.assert_job_open(uuid)',
    'app.open_batch(uuid, uuid)', 'app.uploading_photo(uuid, uuid)', 'app.close_batch(uuid, int, int)',
    'app.check_bin_request(uuid, uuid[])', 'app.on_photos_bin_change()', 'app.on_photos_purged()']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  0::bigint, 'no photo write, worker or cron function is executable by browsers');

-- ── As the server ─────────────────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role service_role;
select pg_temp.as_server() as server;
select throws_ok($$ select public.create_upload_batch('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'staff cannot upload (Seenu, answer 6)');
select throws_ok($$ select public.create_upload_batch('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'another studio''s owner cannot upload to the job');
select throws_ok($$ select public.create_upload_batch(null, 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a missing actor is refused');
select throws_ok($$ select public.create_upload_batch('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000003') $$, 'P0001', 'job_closed', 'closed jobs refuse uploads (D142 answer 2)');

insert into out values ('b1', to_jsonb(public.create_upload_batch('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001')));
select is(auth.uid(), null, 'and stops acting for the photographer afterwards');

-- One drop: the same file twice under two names, and two more files.
insert into out values ('r1', public.register_photos('33333333-3333-4333-8333-333333333333',
  (select (v #>> '{}')::uuid from out where k = 'b1'),
  jsonb_build_array(pg_temp.f('IMG_0002.JPG', 'two'), pg_temp.f('Maya Johnson.jpg', 'one'),
    pg_temp.f('copy of IMG_0002.JPG', 'two'), pg_temp.f('IMG_0003.JPG', 'three'))));
select results_eq($$ select r ->> 'outcome' from out, jsonb_array_elements(v) r where k = 'r1' order by (r ->> 'index')::int $$,
  $$ values ('new'), ('new'), ('duplicate'), ('new') $$, 'new files are made; the same file twice in a drop is one');
select is((select count(*) from public.photos where job_id = 'a0000000-0000-4000-8000-000000000001'), 3::bigint,
  'three photos, uploading');
select ok((select bool_and(created_by = '33333333-3333-4333-8333-333333333333' and status = 'uploading')
           from public.photos where job_id = 'a0000000-0000-4000-8000-000000000001'),
  'attributed to the photographer, and uploading');

-- The same files dropped again (a reload): the one still uploading resumes with the same photo.
insert into out values ('r2', public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'), jsonb_build_array(pg_temp.f('IMG_0002.JPG', 'two'))));
select is((select v -> 0 ->> 'outcome' from out where k = 'r2'), 'resume', 'a file still uploading resumes');
select is((select v -> 0 ->> 'photo_id' from out where k = 'r2'), (select v -> 0 ->> 'photo_id' from out where k = 'r1'),
  'with the same photo');

-- Starting the upload: the first storage upload id is kept.
select is(public.set_photo_upload_id('33333333-3333-4333-8333-333333333333',
  (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), 'upload-1'), 'upload-1', 'the first upload id is kept');
select is(public.set_photo_upload_id('33333333-3333-4333-8333-333333333333',
  (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), 'upload-2'), 'upload-1',
  'a racing second one gets the first back');
select is((select jsonb_agg(e ->> 'upload_id') from jsonb_array_elements(public.photos_uploading(
  '33333333-3333-4333-8333-333333333333', array[(select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')])) e),
  '["upload-1"]'::jsonb, 'the server reads the upload id of a photo still uploading');
select throws_ok($$ select public.photos_uploading('44444444-4444-4444-8444-444444444444',
  array[(select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')]) $$, '42501', null,
  'staff can''t read upload state');
select throws_ok($$ select public.photos_uploading('22222222-2222-4222-8222-222222222222',
  array[(select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')]) $$, '42501', null,
  'nor can another studio''s owner');
-- Another studio's owner can't touch any of studio A's uploads or photos (review S5).
select throws_ok($$ select public.register_photos('22222222-2222-4222-8222-222222222222', (select (v #>> '{}')::uuid from out where k = 'b1'),
  jsonb_build_array(pg_temp.f('x.jpg', 'outsider'))) $$, '42501', null, 'nor register files in A''s batch');
select throws_ok($$ select public.finish_upload_batch('22222222-2222-4222-8222-222222222222', (select (v #>> '{}')::uuid from out where k = 'b1'), 0, 0) $$,
  '42501', null, 'nor finish it');
select throws_ok($$ select public.set_photo_upload_id('22222222-2222-4222-8222-222222222222', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), 'x') $$,
  '42501', null, 'nor start A''s uploads');
select throws_ok($$ select public.mark_photo_uploaded('22222222-2222-4222-8222-222222222222', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')) $$,
  '42501', null, 'nor complete them');
select throws_ok($$ select public.cancel_photo_upload('22222222-2222-4222-8222-222222222222', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')) $$,
  '42501', null, 'nor cancel them');
select throws_ok($$ select public.restore_photos('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001', array[(select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')]) $$, '42501', null, 'nor restore A''s photos');
select throws_ok($$ select public.retry_photo('22222222-2222-4222-8222-222222222222', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')) $$,
  '42501', null, 'nor retry them');
select throws_ok($$ select public.mark_photo_uploaded('33333333-3333-4333-8333-333333333333', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), 'other') $$,
  '22023', 'The only upload failure is incomplete', 'an unknown upload failure is refused, with no values');
select lives_ok($$ select public.mark_photo_uploaded('33333333-3333-4333-8333-333333333333',
  (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')) $$, 'a complete upload moves on');
select is((select status::text || coalesce(upload_id, '-') from public.photos
           where id = (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')), 'processing-',
  'to processing, with the upload id cleared');
select throws_ok($$ select public.mark_photo_uploaded('33333333-3333-4333-8333-333333333333',
  (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')) $$, 'P0001', 'not_uploading',
  'only once');
select throws_ok($$ select public.set_photo_upload_id('33333333-3333-4333-8333-333333333333', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), 'late') $$,
  'P0001', 'not_uploading', 'and no upload starts on a photo that is past uploading');
select throws_ok($$ select public.cancel_photo_upload('33333333-3333-4333-8333-333333333333', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')) $$,
  'P0001', 'not_uploading', 'nor is it cancelled');

-- The same file again, now processing: a duplicate, counted on the batch.
select is((public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'), jsonb_build_array(pg_temp.f('again.jpg', 'two'))) -> 0 ->> 'outcome'),
  'duplicate', 'a file the job already has is a duplicate (Seenu, answer 5)');
select is((select duplicates_skipped from public.upload_batches where id = (select (v #>> '{}')::uuid from out where k = 'b1')),
  2, 'and duplicates are counted on the batch');

-- The worker's result, idempotent.
select ok(not public.record_photo_result((select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), 2,
  '{"status":"ready","width":1,"height":1,"qr":{"kind":"none"}}'), 'a result for another round is ignored');
select ok(public.record_photo_result((select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), 1,
  '{"status":"ready","width":6000,"height":4000,"captured_at":"2026-10-01T09:30:05.47","qr":{"kind":"none"}}'),
  'the worker records a result');
select ok(not public.record_photo_result((select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), 1,
  '{"status":"failed","failure_reason":"unreadable"}'), 'a repeated message changes nothing');
select is((select status::text || ' ' || width || 'x' || height || ' ' || captured_at::text from public.photos
           where id = (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')),
  'ready 6000x4000 2026-10-01 09:30:05.47', 'ready, with its size and capture time to the hundredth');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1, '{"status":"ready"}') $$, '22023', null,
  'a ready result needs a size');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1,
  '{"status":"failed","failure_reason":"Maya Johnson.jpg"}') $$, '22023', 'A result is ready (with a size) or failed',
  'an unknown failure reason is refused, with no values');
select throws_ok($$ select public.record_photo_result(gen_random_uuid(), 1,
  '{"status":"ready","width":1,"height":1,"captured_at":"yesterday","qr":{"kind":"none"}}') $$, '22023', null,
  'and so is a capture time that isn''t one');
select ok(not public.record_photo_result((select (v -> 1 ->> 'photo_id')::uuid from out where k = 'r1'), 1,
  '{"status":"ready","width":1,"height":1,"qr":{"kind":"none"}}'), 'a photo still uploading takes no result');
select is((select public.photo_for_worker((select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')) - 'id'),
  jsonb_build_object('studio_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_id', 'a0000000-0000-4000-8000-000000000001',
    'status', 'ready', 'sha256', encode(extensions.digest('two', 'sha256'), 'hex'), 'byte_size', 1000,
    'attempt', 1, 'studio_name', 'Studio A'),
  'the worker reads ids, the hash, the size and the studio''s name for the watermark, never the filename');

-- Retry: only unreadable failures, or photos stuck processing.
select lives_ok($$ select public.mark_photo_uploaded('33333333-3333-4333-8333-333333333333',
  (select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1')) $$, 'another upload completes');
select public.record_photo_result((select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1'), 1,
  '{"status":"failed","failure_reason":"unreadable"}');
select ok(public.retry_photo('11111111-1111-4111-8111-111111111111',
  (select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1')), 'an unreadable photo can be tried again');
select is((select attempt from public.photos where id = (select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1')), 2, 'in a new round');
select ok(not public.record_photo_result((select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1'), 1, '{"status":"failed","failure_reason":"unreadable"}'),
  'so a replayed failure from the first round can''t fail it again (review S11)');
select throws_ok($$ select public.retry_photo('11111111-1111-4111-8111-111111111111',
  (select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1')) $$, 'P0001', 'not_retryable',
  'a photo just queued can''t be retried yet');
select throws_ok($$ select public.retry_photo('44444444-4444-4444-8444-444444444444',
  (select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1')) $$, '42501', null, 'staff can''t retry');

-- A failed upload frees its hash: the same file can be uploaded again.
select lives_ok($$ select public.mark_photo_uploaded('33333333-3333-4333-8333-333333333333',
  (select (v -> 1 ->> 'photo_id')::uuid from out where k = 'r1'), 'incomplete') $$, 'a wrong-sized upload fails');
select is((public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'), jsonb_build_array(pg_temp.f('Maya Johnson.jpg', 'one'))) -> 0 ->> 'outcome'),
  'new', 'and the same file can be dropped again');

-- Cancel.
insert into out values ('r3', public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'), jsonb_build_array(pg_temp.f('cancel.jpg', 'cancel'))));
select public.set_photo_upload_id('11111111-1111-4111-8111-111111111111',
  (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r3'), 'upload-c');
select is(public.cancel_photo_upload('11111111-1111-4111-8111-111111111111',
  (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r3')), 'upload-c', 'cancelling returns the upload to abort');
select is((select count(*) from public.photos where id = (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r3')),
  0::bigint, 'and the photo is gone');

-- Bad files are refused without echoing them.
select throws_ok($$ select public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'),
  jsonb_build_array(jsonb_build_object('name', 'a/b.jpg', 'size', 1, 'sha256', repeat('0', 64)))) $$,
  '22023', 'Every file needs a name, a size and a SHA-256', 'a name with a folder in it is refused, with no values');
select throws_ok($$ select public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'),
  jsonb_build_array(jsonb_build_object('name', 'big.jpg', 'size', 52428801, 'sha256', repeat('0', 64)))) $$,
  '22023', null, 'files over 50 MB are refused');
select throws_ok($$ select public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'), '[]') $$, '22023', null, 'an empty list is refused');

-- ── The bin ───────────────────────────────────────────────────────────────────────────────────────────────────────
select is(public.bin_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[(select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')]), 1, 'a photo goes in the bin');
select is((public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'), jsonb_build_array(pg_temp.f('x.jpg', 'two'))) -> 0 ->> 'outcome'),
  'duplicate_in_bin', 'a file in the bin is still a duplicate, and says so');
select is(public.restore_photos('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  array[(select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')]), 1, 'and comes back');
select throws_ok($$ select public.bin_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[gen_random_uuid()]) $$, '22023', null, 'only the job''s photos can be binned');
select throws_ok($$ select public.bin_photos('44444444-4444-4444-8444-444444444444', 'a0000000-0000-4000-8000-000000000001',
  array[(select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')]) $$, '42501', null, 'staff can''t bin');
reset role;
update public.photos set sold_at = now() where id = (select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1');
set local role service_role;
select pg_temp.as_server() as server;
select throws_ok($$ select public.bin_photos('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001',
  array[(select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1'), (select (v -> 3 ->> 'photo_id')::uuid from out where k = 'r1')]) $$,
  'P0001', 'photo_sold', 'a sold photo can''t be binned (Seenu, answer 7)');
select is((select count(*) from public.photos where binned_at is not null), 0::bigint, 'and nothing was binned');
select is((select count(*) from public.events where type = 'photos.binned'), 1::bigint, 'one event per bin action');
select is((select data from public.events where type = 'photos.binned'),
  jsonb_build_object('photo_ids', jsonb_build_array((select v -> 0 ->> 'photo_id' from out where k = 'r1')), 'count', 1),
  'with the photos'' ids and a count');
select is((select actor_id::text || ' ' || subject_id::text from public.events where type = 'photos.restored'),
  '33333333-3333-4333-8333-333333333333 a0000000-0000-4000-8000-000000000001',
  'restoring is attributed to the person, on the job');

-- ── Finishing a batch ─────────────────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ select public.finish_upload_batch('33333333-3333-4333-8333-333333333333',
  (select (v #>> '{}')::uuid from out where k = 'b1'), 2, 1) $$, 'the batch finishes');
select lives_ok($$ select public.finish_upload_batch('33333333-3333-4333-8333-333333333333',
  (select (v #>> '{}')::uuid from out where k = 'b1'), 2, 1) $$, 'twice, harmlessly');
select is((select count(*) from public.events where type = 'photos.uploaded'), 1::bigint, 'with one event');
select is((select data - 'batch_id' from public.events where type = 'photos.uploaded'),
  '{"added": 2, "failed": 1, "skipped": 2, "duplicates": 4, "unfinished": 1}'::jsonb,
  'counting what was added, failed, unfinished, duplicated (the browser''s in-drop duplicates too) and skipped');
select throws_ok($$ select public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b1'), jsonb_build_array(pg_temp.f('late.jpg', 'late'))) $$,
  'P0001', 'batch_finished', 'a finished batch takes no more files');
select is((select count(*) from public.events e where e.type like 'photos.%'
           and (e.data::text ~* 'IMG_|Maya|Johnson|\.jpg' or e.data ? 'sha256')),
  0::bigint, 'photo events never contain filenames or hashes');

-- ── Retrying a photo the job has again (review CR4) ───────────────────────────────────────────────────────────────
insert into out values ('b4', to_jsonb(public.create_upload_batch('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000004')));
insert into out values ('r4', public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b4'), jsonb_build_array(pg_temp.f('r.jpg', 'retry-me'))));
select public.mark_photo_uploaded('11111111-1111-4111-8111-111111111111', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r4'));
select public.record_photo_result((select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r4'), 1, '{"status":"failed","failure_reason":"unreadable"}');
insert into out values ('r5', public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b4'), jsonb_build_array(pg_temp.f('r again.jpg', 'retry-me'))));
select throws_ok($$ select public.retry_photo('11111111-1111-4111-8111-111111111111', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r4')) $$,
  'P0001', 'not_retryable', 'a failed photo whose file the job has again can''t be retried');
select public.cancel_photo_upload('11111111-1111-4111-8111-111111111111', (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r5'));

-- ── 50,000 photos per job, the bin included (Seenu, answer 1) ─────────────────────────────────────────────────────
insert into out values ('b2', to_jsonb(public.create_upload_batch('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002')));
reset role;
insert into public.photos (studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  created_by, binned_at, binned_by)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', b.id, b.seq, 'ready',
  'bulk.jpg', 1, extensions.digest('bulk' || i, 'sha256'), '11111111-1111-4111-8111-111111111111',
  case when i <= 10 then now() end, case when i <= 10 then '11111111-1111-4111-8111-111111111111'::uuid end
from generate_series(1, 49999) i, public.upload_batches b
where b.id = (select (v #>> '{}')::uuid from out where k = 'b2');
set local role service_role;
select pg_temp.as_server() as server;
select throws_ok($$ select public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b2'), jsonb_build_array(pg_temp.f('a.jpg', 'l1'), pg_temp.f('b.jpg', 'l2'))) $$,
  'P0001', 'photo_limit', 'the 50,001st photo is refused, counting the bin');
select is((public.register_photos('11111111-1111-4111-8111-111111111111',
  (select (v #>> '{}')::uuid from out where k = 'b2'), jsonb_build_array(pg_temp.f('a.jpg', 'l1'), pg_temp.f('dup.jpg', 'bulk7'))) -> 0 ->> 'outcome'),
  'new', 'the 50,000th is fine, and duplicates don''t count against it');

-- ── Purge and clean-up ────────────────────────────────────────────────────────────────────────────────────────────
reset role;
update public.photos set binned_at = now() - interval '31 days'
where job_id = 'a0000000-0000-4000-8000-000000000002' and original_filename = 'bulk.jpg' and binned_at is not null
  and sha256 in (select extensions.digest('bulk' || i, 'sha256') from generate_series(1, 4) i);
set local role service_role;
select pg_temp.as_server() as server;
select is((select count(*) from public.begin_photo_purge(100)), 4::bigint,
  'only photos more than 30 days in the bin are due, and are marked');
select throws_ok($$ select public.restore_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002', array(select id from public.photos where purge_started_at is not null)) $$,
  'P0001', 'photo_purging', 'a photo being purged can''t be restored (review CR7)');
select is(public.delete_purged_photos(array(select id from public.photos where purge_started_at is not null)
  || (select (v -> 0 ->> 'photo_id')::uuid from out where k = 'r1')), 4,
  'and only they are deleted, whatever ids are sent');
select is((select data ->> 'count' from public.events where type = 'photos.purged'), '4', 'one purge event, with a count');
select is((select count(*) from public.abandoned_uploads(10)), 0::bigint, 'no upload is abandoned yet');
reset role;
update public.photos set created_at = now() - interval '8 days' where status = 'uploading';
update public.upload_batches set created_at = now() - interval '2 days'
where id = (select (v #>> '{}')::uuid from out where k = 'b2');
update public.photos set created_at = now() - interval '2 days'
where batch_id = (select (v #>> '{}')::uuid from out where k = 'b2');
set local role service_role;
select pg_temp.as_server() as server;
select is(public.delete_abandoned_uploads(array(select id from public.abandoned_uploads(10))), 1,
  'uploads started more than 7 days ago are dropped');
select is((select count(*) from public.events where type = 'photos.purged'), 1::bigint, 'without a purge event');
select is(public.finish_idle_batches(), 1, 'a batch idle for a day is finished');
select is((select actor_id from public.events where type = 'photos.uploaded' order by id desc limit 1),
  '11111111-1111-4111-8111-111111111111'::uuid, 'attributed to whoever started it');
select is(auth.uid(), null, 'and the cron acts for nobody afterwards');

-- ── Studio B, signed in ───────────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in_b;
select is((select count(*) from public.photos), 0::bigint, 'another studio sees none of A''s photos');
select is((select count(*) from public.upload_batches), 0::bigint, 'nor its batches');
select is(public.job_photo_counts('a0000000-0000-4000-8000-000000000001') ->> 'photos', '0',
  'nor counts A''s job');
select is((select count(*) from public.job_photos_page('a0000000-0000-4000-8000-000000000001', null, 200, false, null)),
  0::bigint, 'nor pages through it');

-- ── Studio A's photographer, signed in: counts and tagging order ──────────────────────────────────────────────────
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in_a;
select is(public.job_photo_counts('a0000000-0000-4000-8000-000000000001'),
  '{"photos": 3, "ready": 1, "processing": 1, "failed": 1, "uploading": 0, "binned": 0, "uploads": 1, "duplicates_skipped": 4, "leftovers": 0, "flagged": 0}'::jsonb,
  'the Photos tab''s counts');
reset role;
-- Order: a second batch, untimed photos and a tie on time.
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('a2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111');
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  created_by, captured_at)
select v.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', b.seq, 'ready', v.name, 1, extensions.digest(v.name, 'sha256'),
  '11111111-1111-4111-8111-111111111111', v.at
from (values
  ('e0000000-0000-4000-8000-000000000001'::uuid, 'b.jpg', null::timestamp),
  ('e0000000-0000-4000-8000-000000000002'::uuid, 'a.jpg', null),
  ('e0000000-0000-4000-8000-000000000003'::uuid, 'z.jpg', '2026-10-01 09:00:00.5'),
  ('e0000000-0000-4000-8000-000000000004'::uuid, 'Y.jpg', '2026-10-01 09:00:00.5'),
  ('e0000000-0000-4000-8000-000000000005'::uuid, 'x.jpg', '2026-10-01 08:00:00')) v (id, name, at),
  public.upload_batches b where b.id = 'a2000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in_a;
select results_eq($$ select original_filename from public.job_photos_page('a0000000-0000-4000-8000-000000000001',
    (select (v -> 1 ->> 'photo_id')::uuid from out where k = 'r1'), 10, false, null) $$,
  $$ values ('x.jpg'), ('Y.jpg'), ('z.jpg'), ('a.jpg'), ('b.jpg') $$,
  'pages run by batch, then capture time, then filename (untimed last), after the cursor photo (the first batch''s last)');
select is((select count(*) from public.job_photos_page('a0000000-0000-4000-8000-000000000001', null, 200, false, 'failed')),
  1::bigint, 'and can show one status');
select is((select count(*) from public.job_photos_page('a0000000-0000-4000-8000-000000000002', null, 1000, false, null)),
  501::bigint, 'a page holds at most 501 photos: the API''s largest page and one more (review CR5)');

-- ── Integrity ─────────────────────────────────────────────────────────────────────────────────────────────────────
reset role;
select throws_ok($$
  insert into public.photos (studio_id, job_id, batch_id, batch_seq, original_filename, byte_size, sha256, created_by)
  select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', b.job_id, b.id, b.seq, 'x.jpg', 1, extensions.digest('x', 'sha256'),
    '22222222-2222-4222-8222-222222222222'
  from public.upload_batches b where b.id = 'a2000000-0000-4000-8000-000000000001' $$,
  '23503', null, 'a photo can''t belong to another studio''s job or batch');
select throws_ok($$
  insert into public.photos (studio_id, job_id, batch_id, batch_seq, original_filename, byte_size, sha256, created_by)
  select b.studio_id, b.job_id, b.id, b.seq + 1, 'x.jpg', 1, extensions.digest('x', 'sha256'), b.created_by
  from public.upload_batches b where b.id = 'a2000000-0000-4000-8000-000000000001' $$,
  '23503', null, 'a photo''s batch order is its batch''s');
select throws_ok($$ delete from public.jobs where id = 'a0000000-0000-4000-8000-000000000001' $$, '23503', null,
  'a job with photos can''t be deleted, so no stored photo is left without a row');
update public.photos set binned_at = now(), binned_by = created_by where job_id = 'a0000000-0000-4000-8000-000000000001'
  and status = 'ready';
select throws_ok($$ delete from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$, '23503', null,
  'a studio with photos can''t be deleted until its stored photos are purged (review S3)');
select ok((select count(*) from public.photos where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0,
  'and its photos stay');

select * from finish();
rollback;
