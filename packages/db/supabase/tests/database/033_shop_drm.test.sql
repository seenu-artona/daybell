-- DRM in the parent shop's large view (D158; ADR 0034): the key and token-count tables are reachable through their
-- functions only; the large view's entitlement is exactly app.parent_visible_photos (a member of a group yes, anyone
-- else no; another child, a sibling not in the session, another group, binned, flagged, card and closed photos and
-- another studio's are all "not found"); the token budget's minute and day windows; the kill switch off by default,
-- owner-only and kept in the history; a stale worker result ignored; reprocessing resets the clip; a purge takes the
-- key with it; the cron's retries, give-ups and backfill; no events; the wrapped key nowhere but its own table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Maple Lane Photography', 'studio-a', 'ca'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'ca');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner');

create function pg_temp.h(p text) returns text language sql as $$
  select encode(extensions.digest(p, 'sha256'), 'hex') $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
create function pg_temp.pid(n int) returns uuid language sql as $$
  select ('f0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.kid(n int) returns uuid language sql as $$
  select ('0d000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- A stand-in for KMS's CiphertextBlob: recognisable bytes, never a real key.
create function pg_temp.wrapped(n int) returns bytea language sql as $$
  select extensions.digest('wrapped-' || n, 'sha256') || extensions.digest('more-' || n, 'sha256') $$;
create function pg_temp.arn() returns text language sql as $$
  select 'arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab' $$;
-- Packages a photo as the worker would: request, then its result.
create function pg_temp.package(n int) returns boolean language sql as $$
  select public.record_photo_drm_result(pg_temp.pid(n), public.photo_drm_requested(pg_temp.pid(n)), pg_temp.kid(n),
    pg_temp.wrapped(n), pg_temp.arn(), 1600, 1066, 60000) $$;
create function pg_temp.drm(p_session text, p_child text, n int) returns text language sql as $$
  select pg_temp.try(format('select public.shop_drm_photo(%L, %L, %L)', pg_temp.h(p_session), p_child::uuid,
    pg_temp.pid(n))) $$;

-- Studio A: job 1 selling (Ava, her brother Noah, Leo, and Zoe in the Choir with Ava and Leo; Noah in the Band), job 2
-- closed (Mia). Studio B: Bea.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall 2026', 'school', '2026-10-13', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Spring 2026', 'school', '2026-04-13', 'JOB00002'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-13', 'JOB00001');
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Ava', 'Patel', pg_temp.h('c1'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Noah', 'Patel', pg_temp.h('c2'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'Mia', 'Chen', pg_temp.h('c3'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Leo', 'Chen', pg_temp.h('c4'), 'v1.' || repeat('A', 48)),
  ('cb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 'Bea', 'Brown', pg_temp.h('cb1'), 'v1.' || repeat('A', 48));
insert into public.upload_batches (id, studio_id, job_id, created_by, kind) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'individual'),
  ('e1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'group'),
  ('e1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'individual'),
  ('eb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'individual');
-- n, batch, status, qr_kind, binned, place, child, flag. 1–2 Ava's; 3 Noah's; 4 Leo's; 5 Ava's binned; 6 Ava's
-- flagged; 7 Ava's but another job's card; 8 Ava's still processing; 9 Mia's (closed job); 10 Bea's (studio B);
-- 70 the Choir's group photo (Ava, Leo), 71 the Band's (Noah); 72 a group photo in no group.
create temp table fx (n int, batch text, status text, qr text, binned boolean, place text, child text, flag text)
  on commit drop;
insert into fx values
  (1, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000001', null),
  (2, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000001', null),
  (3, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000002', null),
  (4, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000004', null),
  (5, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', true, 'child', 'c0000000-0000-4000-8000-000000000001', null),
  (6, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000001', 'after_unreadable'),
  (7, 'e1000000-0000-4000-8000-000000000001', 'ready', 'other_card', false, 'child', 'c0000000-0000-4000-8000-000000000001', 'other_card'),
  (8, 'e1000000-0000-4000-8000-000000000001', 'processing', null, false, 'child', 'c0000000-0000-4000-8000-000000000001', null),
  (9, 'e1000000-0000-4000-8000-000000000003', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000003', null),
  (10, 'eb000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'cb000000-0000-4000-8000-000000000001', null),
  (70, 'e1000000-0000-4000-8000-000000000002', 'ready', 'none', false, 'group_photo', null, null),
  (71, 'e1000000-0000-4000-8000-000000000002', 'ready', 'none', false, 'group_photo', null, null),
  (72, 'e1000000-0000-4000-8000-000000000002', 'ready', 'none', false, 'group_photo', null, null);
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, binned_at, binned_by, created_by)
select pg_temp.pid(f.n), b.studio_id, b.job_id, b.id, b.seq, f.status::public.photo_status, 'IMG_' || f.n || '.JPG',
  1, extensions.digest(f.n::text, 'sha256'), case when f.status = 'ready' then 1600 end,
  case when f.status = 'ready' then 1067 end, f.qr, case when f.binned then now() end,
  case when f.binned then b.created_by end, b.created_by
from fx f join public.upload_batches b on b.id = f.batch::uuid;
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, flag, source)
select pg_temp.pid(f.n), p.studio_id, p.job_id, f.place::public.photo_place, f.child::uuid,
  f.flag::public.photo_flag, 'auto'
from fx f join public.photos p on p.id = pg_temp.pid(f.n);
insert into public.photo_groups (id, studio_id, job_id, name) values
  ('99000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Choir'),
  ('99000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Band');
insert into public.photo_group_members (studio_id, job_id, group_id, child_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002');
insert into public.photo_group_photos (studio_id, job_id, group_id, photo_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', pg_temp.pid(70)),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002', pg_temp.pid(71));
update public.upload_batches set tagged_round = tag_round;
update public.jobs set status = 'selling'
where id in ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
             'b0000000-0000-4000-8000-000000000001');
update public.jobs set status = 'closed' where id = 'a0000000-0000-4000-8000-000000000002';

-- Sessions: S1 holds Ava, S2 holds Noah, S3 holds Mia (closed), SB holds Bea.
insert into public.shop_sessions (id, studio_id, token_hash) values
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s1')),
  ('d1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s2')),
  ('d1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s3')),
  ('db000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_temp.h('sb'));
insert into public.shop_session_children (session_id, studio_id, job_id, child_id)
select s.id::uuid, c.studio_id, c.job_id, c.id
from (values ('d1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
             ('d1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002'),
             ('d1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003'),
             ('db000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001')) s (id, child)
join public.children c on c.id = s.child::uuid;

create temp table counts as select (select count(*) from public.events) as events;

-- ── 1. Reachable through the functions only ───────────────────────────────────────────────────────────────────────
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname in ('photo_drm_keys', 'shop_drm_rate') and c.relrowsecurity), 2,
  'the key and token-count tables have row-level security on');
select is((select count(*)::int from pg_policies where schemaname = 'app'
           and tablename in ('photo_drm_keys', 'shop_drm_rate')), 0, '…and no policies');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
           unnest(array['app.photo_drm_keys', 'app.shop_drm_rate']) t
           where has_table_privilege(r, t, 'select') or has_table_privilege(r, t, 'insert')
              or has_table_privilege(r, t, 'update') or has_table_privilege(r, t, 'delete')), 0,
  'no role may read or write them directly, the service role included');
select is((select count(*)::int from unnest(array['drm_status', 'drm_key_id', 'drm_attempt', 'drm_requested_at',
           'drm_requests']) col where has_column_privilege('authenticated', 'public.photos', col, 'select')), 0,
  'studio members don''t read the photos'' DRM columns');
select is((select count(*)::int from unnest(array['anon', 'authenticated']) r,
           unnest(array['public.shop_drm_enabled()', 'public.set_shop_drm(boolean, text)',
             'public.photo_drm_requested(uuid)',
             'public.record_photo_drm_result(uuid, integer, uuid, bytea, text, integer, integer, bigint)',
             'public.record_photo_drm_failed(uuid, integer)', 'public.photos_drm_due(integer)',
             'public.shop_drm_photo(text, uuid, uuid)', 'public.shop_drm_key(text, uuid, uuid)',
             'app.photo_drm_eligible(public.photos)', 'app.shop_drm_photo_row(text, uuid, uuid)']) f
           where has_function_privilege(r, f, 'execute')), 0, 'browsers can run none of the functions');
select is((select count(*)::int from unnest(array['public.shop_drm_enabled()', 'public.photo_drm_requested(uuid)',
             'public.record_photo_drm_result(uuid, integer, uuid, bytea, text, integer, integer, bigint)',
             'public.record_photo_drm_failed(uuid, integer)', 'public.photos_drm_due(integer)',
             'public.shop_drm_photo(text, uuid, uuid)', 'public.shop_drm_key(text, uuid, uuid)']) f
           where has_function_privilege('service_role', f, 'execute')), 7, 'the API runs the rest');
select ok(not has_function_privilege('service_role', 'public.set_shop_drm(boolean, text)', 'execute'),
  'the switch is the database owner''s alone: not the API''s');

-- ── 2. The kill switch (C6) ───────────────────────────────────────────────────────────────────────────────────────
select is(public.shop_drm_enabled(), false, 'DRM is off by default');
savepoint no_settings;
alter table app.platform_settings disable trigger platform_settings_no_delete;
delete from app.platform_settings;
select is(public.shop_drm_enabled(), false, 'missing settings also mean off');
select is(pg_temp.try($$ select public.set_shop_drm(true, 'on') $$), 'P0001 platform_settings_missing',
  'and the switch can''t be turned without them');
rollback to savepoint no_settings;
select is(pg_temp.try($$ select public.set_shop_drm(true, '') $$),
  '22023 Say why in a note of 1 to 200 characters', 'a change needs a note');
select is(pg_temp.try($$ select public.set_shop_drm(null, 'x') $$), '22023 Say on or off', 'and on or off');
select lives_ok($$ select public.set_shop_drm(true, 'Test: on for staging') $$, 'the owner turns it on');
select is(public.shop_drm_enabled(), true, 'it is on');
select is((select (old_value, new_value, note) from app.platform_settings_changes where setting = 'shop_drm_enabled'),
  ('false'::text, 'true'::text, 'Test: on for staging'::text), 'the change is kept in the history');

-- ── 3. Packaging requests and results (B6) ────────────────────────────────────────────────────────────────────────
select is(public.photo_drm_requested(pg_temp.pid(1)), 1, 'a ready photo is requested (attempt 1)');
select is((select (drm_status::text, drm_requests, drm_requested_at is not null) from public.photos
           where id = pg_temp.pid(1)), ('requested'::text, 1::smallint, true), '…and waits');
select is(public.photo_for_worker(pg_temp.pid(1)) - array['id', 'studio_id', 'job_id', 'sha256', 'byte_size',
  'studio_name'], '{"status": "ready", "attempt": 1, "drm_status": "requested", "drm_attempt": 1}'::jsonb,
  'the worker reads the request and its attempt');
select is(array[public.photo_drm_requested(pg_temp.pid(5)), public.photo_drm_requested(pg_temp.pid(7)),
  public.photo_drm_requested(pg_temp.pid(8)), public.photo_drm_requested(gen_random_uuid())],
  array[null, null, null, null]::integer[], 'binned, card, unprocessed and missing photos are never requested');
select ok(not public.record_photo_drm_result(pg_temp.pid(1), 2, pg_temp.kid(1), pg_temp.wrapped(1), pg_temp.arn(),
  1600, 1066, 60000), 'a result for another attempt is ignored');
select is(pg_temp.try(format('select public.record_photo_drm_result(%L, 1, %L, %L, %L, 1600, 1066, 60000)',
  pg_temp.pid(1), pg_temp.kid(1), pg_temp.wrapped(1), 'arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab')),
  '22023 A clip has a key, its wrapped key, a KMS key in ca-central-1 and its size',
  'a key outside ca-central-1 is refused (D113), without values in the error');
select is(pg_temp.try(format('select public.record_photo_drm_result(%L, 1, %L, %L, %L, 1601, 1066, 60000)',
  pg_temp.pid(1), pg_temp.kid(1), pg_temp.wrapped(1), pg_temp.arn())), '22023 A clip has a key, its wrapped key, a KMS key in ca-central-1 and its size',
  'an odd width is refused');
select is(pg_temp.try(format('select public.record_photo_drm_result(%L, 1, %L, %L, %L, 1600, 1066, 60000)',
  pg_temp.pid(1), '0d000000-0000-1000-8000-000000000001', pg_temp.wrapped(1), pg_temp.arn())),
  '22023 A clip has a key, its wrapped key, a KMS key in ca-central-1 and its size', 'a key ID that isn''t random is refused');
select ok(public.record_photo_drm_result(pg_temp.pid(1), 1, pg_temp.kid(1), pg_temp.wrapped(1), pg_temp.arn(),
  1600, 1066, 60000), 'the worker''s clip is recorded');
select is((select (drm_status::text, drm_key_id) from public.photos where id = pg_temp.pid(1)),
  ('ready'::text, pg_temp.kid(1)), 'the photo is ready with its key');
select is((select (k.studio_id, k.job_id, k.wrapped_key, k.photo_attempt) from app.photo_drm_keys k
           where k.photo_id = pg_temp.pid(1)),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, pg_temp.wrapped(1), 1),
  'the wrapped key is kept with its studio and the processing round it was made from');
select ok(not public.record_photo_drm_result(pg_temp.pid(1), 1, pg_temp.kid(91), pg_temp.wrapped(91), pg_temp.arn(),
  1600, 1066, 60000), 'a replayed result changes nothing');
-- A stale result: a new request (attempt 2) starts before attempt 1's answer arrives.
select is(public.photo_drm_requested(pg_temp.pid(2)), 1, 'photo 2 requested');
select is(public.photo_drm_requested(pg_temp.pid(2)), 2, 'photo 2 requested again (attempt 2)');
select ok(not public.record_photo_drm_result(pg_temp.pid(2), 1, pg_temp.kid(92), pg_temp.wrapped(92), pg_temp.arn(),
  1600, 1066, 60000), 'the stale attempt''s clip is ignored');
select ok(public.record_photo_drm_result(pg_temp.pid(2), 2, pg_temp.kid(2), pg_temp.wrapped(2), pg_temp.arn(),
  1600, 1066, 60000), 'the current attempt''s is recorded');
select ok(public.photo_drm_requested(pg_temp.pid(3)) = 1 and not public.record_photo_drm_failed(pg_temp.pid(3), 7)
  and public.record_photo_drm_failed(pg_temp.pid(3), 1), 'a permanent failure is recorded for its attempt only');
select is((select drm_status::text from public.photos where id = pg_temp.pid(3)), 'failed', '…and kept');
select ok(pg_temp.package(3) and pg_temp.package(4) and pg_temp.package(6) and pg_temp.package(9)
  and pg_temp.package(10) and pg_temp.package(70) and pg_temp.package(71) and pg_temp.package(72),
  'the other visible-kind photos are packaged too (a failed one can be requested again)');

-- ── 4. The gallery says which large views are protected ───────────────────────────────────────────────────────────
select is((select jsonb_agg(p -> 'drm' order by p ->> 'id')
           from jsonb_array_elements(public.shop_gallery(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001') -> 'portraits') p),
  '[true, true]'::jsonb, 'Ava''s two portraits are protected');
select is((select jsonb_agg(p -> 'drm') from jsonb_array_elements(public.shop_gallery(pg_temp.h('s1'),
  'c0000000-0000-4000-8000-000000000001') -> 'group_photos') p), '[true]'::jsonb, 'and her group''s photo');

-- ── 5. The entitlement is exactly parent_visible_photos ───────────────────────────────────────────────────────────
select is(pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 1), 'ok', 'Ava''s parent opens her portrait');
select is(public.shop_drm_photo(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)),
  jsonb_build_object('studio_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_id', 'a0000000-0000-4000-8000-000000000001',
    'photo_id', pg_temp.pid(1)), 'the manifest route learns where the clip is, and nothing else');
select is(pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 70), 'ok', 'a member of the Choir opens its photo');
select is(pg_temp.drm('s2', 'c0000000-0000-4000-8000-000000000002', 70), 'P0002 Photo not found',
  'a non-member (Noah) doesn''t');
select is(array[pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 3),
  pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 4),
  pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 71),
  pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 72),
  pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 5),
  pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 6),
  pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 7),
  pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 8),
  pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 10)],
  array_fill('P0002 Photo not found'::text, array[9]),
  'not found: a sibling''s, another child''s, another group''s, a group photo in no group, binned, flagged, card, unprocessed and another studio''s photo');
select is(pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000002', 3), 'P0002 Child not found',
  'a sibling not in the session is not found');
select is(pg_temp.drm('s3', 'c0000000-0000-4000-8000-000000000003', 9), 'P0002 Photo not found',
  'a closed shop''s photo is not found');
select is(pg_temp.drm('sb', 'c0000000-0000-4000-8000-000000000001', 1), 'P0002 Child not found',
  'another studio''s session can''t reach Studio A''s child');
select is(pg_temp.drm('nope', 'c0000000-0000-4000-8000-000000000001', 1), 'P0001 session_required',
  'no session, no clip');
select is((select count(*)::int from public.children c
           join public.shop_session_children sc on sc.child_id = c.id
           join public.shop_sessions s on s.id = sc.session_id
           cross join public.photos p
           where s.token_hash in (pg_temp.h('s1'), pg_temp.h('s2'))
             and (pg_temp.try(format('select public.shop_drm_photo(%L, %L, %L)', s.token_hash, c.id, p.id)) = 'ok')
                 <> exists (select 1 from app.parent_visible_photos(c.job_id, c.id, true) v where v.id = p.id)), 0,
  'for every photo and every child of both sessions, a clip is served exactly when parent_visible_photos shows it');

-- ── 6. Switch off, or not packaged: the WebP ──────────────────────────────────────────────────────────────────────
select is(pg_temp.drm('s2', 'c0000000-0000-4000-8000-000000000002', 3), 'ok', 'Noah''s photo is packaged');
update public.photos set drm_status = 'failed', drm_key_id = null where id = pg_temp.pid(3);
select is(pg_temp.drm('s2', 'c0000000-0000-4000-8000-000000000002', 3), 'P0001 drm_unavailable',
  'a photo without a clip is drm_unavailable');
select lives_ok($$ select public.set_shop_drm(false, 'Test: off') $$, 'the switch goes off');
select is(pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 1), 'P0001 drm_unavailable',
  'with the switch off, every clip is drm_unavailable');
select is((select jsonb_agg(p -> 'drm') from jsonb_array_elements(public.shop_gallery(pg_temp.h('s1'),
  'c0000000-0000-4000-8000-000000000001') -> 'portraits') p), '[false, false]'::jsonb,
  'and the gallery protects nothing');
select is(pg_temp.drm('s1', 'c0000000-0000-4000-8000-000000000001', 4), 'P0002 Photo not found',
  'with the switch off, a photo the parent may not see is still not found (never drm_unavailable)');
select lives_ok($$ select public.set_shop_drm(true, 'Test: on again') $$, 'on again');
select is((select count(*)::int from app.platform_settings_changes where setting = 'shop_drm_enabled'), 3,
  'every switch is in the history');

-- ── 7. Keys and the token budget (C3) ─────────────────────────────────────────────────────────────────────────────
select is(public.shop_drm_key(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)),
  jsonb_build_object('studio_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'photo_id', pg_temp.pid(1),
    'key_id', pg_temp.kid(1), 'wrapped_key', encode(pg_temp.wrapped(1), 'base64'), 'kms_key_arn', pg_temp.arn()),
  'a token''s key: still wrapped, with what KMS needs for its encryption context');
select is(pg_temp.try($$ select public.shop_drm_key(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(4)) $$),
  'P0002 Photo not found', 'no key for a photo the parent may not see');
select is(pg_temp.try($$ select public.shop_drm_key(pg_temp.h('sb'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)) $$),
  'P0002 Child not found', 'nor across studios');
select is((select (minute_hits, day_hits) from app.shop_drm_rate where session_id = 'd1000000-0000-4000-8000-000000000001'),
  (1, 1), 'a token is counted, refusals aren''t');
select is((select count(*)::int from generate_series(2, 60) n
           where public.shop_drm_key(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)) ? 'key_id'), 59,
  '60 tokens a minute');
select is(public.shop_drm_key(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)) - 'retry_after',
  '{"rate_limited": true}'::jsonb, 'the 61st is refused…');
select ok((public.shop_drm_key(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)) ->> 'retry_after')::int
  between 1 and 60, '…until the minute is over');
select is((select minute_hits from app.shop_drm_rate where session_id = 'd1000000-0000-4000-8000-000000000001'), 60,
  'refused requests aren''t counted');
select ok(public.shop_drm_key(pg_temp.h('s2'), 'c0000000-0000-4000-8000-000000000002', pg_temp.pid(71)) ? 'key_id',
  'another session has its own budget');
update app.shop_drm_rate set minute_start = minute_start - interval '1 minute'
where session_id = 'd1000000-0000-4000-8000-000000000001';
select ok(public.shop_drm_key(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)) ? 'key_id',
  'a new minute starts again');
update app.shop_drm_rate set day_hits = 1500, minute_hits = 0
where session_id = 'd1000000-0000-4000-8000-000000000001';
select ok((public.shop_drm_key(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)) ->> 'retry_after')::int
  between 1 and 86400, '1,500 a day, then refused until the day is over');
update app.shop_drm_rate set day_start = day_start - interval '1 day'
where session_id = 'd1000000-0000-4000-8000-000000000001';
select ok(public.shop_drm_key(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001', pg_temp.pid(1)) ? 'key_id',
  'a new day starts again');
update app.shop_drm_rate set day_start = day_start - interval '2 days'
where session_id = 'd1000000-0000-4000-8000-000000000002';
select ok(public.prune_shop(1000) >= 1, 'prune_shop runs');
select ok(not exists (select 1 from app.shop_drm_rate where session_id = 'd1000000-0000-4000-8000-000000000002')
  and exists (select 1 from app.shop_drm_rate where session_id = 'd1000000-0000-4000-8000-000000000001'),
  'and drops the counts whose day is over, only those');

-- ── 8. The cron: retries, give-ups and backfill (C8) ──────────────────────────────────────────────────────────────
update public.photos set drm_status = null, drm_key_id = null where id = pg_temp.pid(2);
delete from app.photo_drm_keys where photo_id = pg_temp.pid(2);
select is((select array_agg(outcome || ':' || right(id::text, 2) order by id) from public.photos_drm_due(10)),
  array['backfill:02'], 'the backfill takes ready photos never asked, never binned, card or unprocessed ones');
update public.photos set drm_requested_at = now() - interval '2 hours' where id = pg_temp.pid(2);
select is((select array_agg(outcome) from public.photos_drm_due(10)), array['retry'],
  'a request unanswered for an hour is queued again');
select is((select (drm_requests, drm_attempt) from public.photos where id = pg_temp.pid(2)), (2::smallint, 3),
  'counting the message, under the same attempt');
update public.photos set drm_requested_at = now() - interval '2 hours', drm_requests = 3 where id = pg_temp.pid(2);
select is((select array_agg(outcome) from public.photos_drm_due(10)), array['failed'],
  'after 3 messages it is given up (the cron logs drm_unavailable)');
select is((select drm_status::text from public.photos where id = pg_temp.pid(2)), 'failed', 'failed for good');
select is((select count(*)::int from public.photos_drm_due(0)), 0, 'nothing beyond the limit');

-- ── 9. Reprocessing and purging ───────────────────────────────────────────────────────────────────────────────────
update public.photos set status = 'processing', attempt = 2 where id = pg_temp.pid(1);
select ok(public.record_photo_result(pg_temp.pid(1), 2, '{"status":"ready","width":1600,"height":1067,"qr":{"kind":"none"}}'),
  'a new round of processing is recorded');
select is((select (drm_status, drm_key_id) from public.photos where id = pg_temp.pid(1)), (null::public.photo_drm_status, null::uuid),
  'it drops the stale clip (the API requests a new one)');
select ok(not exists (select 1 from app.photo_drm_keys where photo_id = pg_temp.pid(1)), '…and its key');
select ok(exists (select 1 from app.photo_drm_keys where photo_id = pg_temp.pid(4)), 'photo 4 has a key');
delete from public.photo_tags where photo_id = pg_temp.pid(4);
delete from public.photos where id = pg_temp.pid(4);
select ok(not exists (select 1 from app.photo_drm_keys where photo_id = pg_temp.pid(4)), 'a purged photo takes its key with it');

-- ── 10. No events; the wrapped key nowhere else ───────────────────────────────────────────────────────────────────
select is((select count(*) from public.events), (select events from counts),
  'packaging, tokens and the switch write no events (C5)');
create function pg_temp.tables_holding(p_needle text) returns text[] language plpgsql as $$
declare
  t record;
  found_in text[] := '{}';
  hit boolean;
begin
  for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('public', 'app') and c.relkind = 'r' loop
    execute format('select exists (select 1 from %I.%I x where x::text like %L)', t.nspname, t.relname,
      '%' || p_needle || '%') into hit;
    if hit then
      found_in := found_in || (t.nspname || '.' || t.relname);
    end if;
  end loop;
  return found_in;
end;
$$;
select is(pg_temp.tables_holding(encode(pg_temp.wrapped(70), 'hex')), array['app.photo_drm_keys'],
  'a wrapped key is in its own table and nowhere else');
select is(pg_temp.tables_holding(encode(pg_temp.wrapped(70), 'base64')), '{}'::text[],
  'not even as base64');

select * from finish();
rollback;
