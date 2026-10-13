-- The parent gallery (D24, D60, D116, D119, F17, D113, D96; Seenu's answers 1–4, Claude's calls 1–13; ADR 0022):
-- shop tables and functions are the service role's only; codes are looked up by HMAC among children only, after the
-- lock is checked; 5 wrong codes per device (or per network without one) and 30, 100 and 300 per network, /56 and /48
-- lock for 15 minutes, a known device keeps its own allowance, new devices are capped and issued only to requests that
-- aren't locked, the region's breaker (summed over 16 rows) tightens networks that keep coming back; a right code never
-- resets the count; a session holds up to 5 children of one studio for a fixed 30 days, a device up to 3 sessions, a
-- child at most 10 (sparing bags) and 10 new a day, 3 new known devices a day; closed children show no name; parents
-- see exactly the photos
-- photo_parent_visible allows, a child's own portraits and their own class's set, nothing for closed, draft or
-- unavailable children; the bag is priced from the job's current list and refuses what parents may not buy; another
-- studio's session reads or changes nothing of this one's; nothing writes events or stores a code, name or address.
begin;
create extension if not exists pgtap with schema extensions;
select plan(198);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Maple Lane Photography', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner');

create function pg_temp.h(p text) returns text language sql as $$
  select case when p is null then null else encode(extensions.digest(p, 'sha256'), 'hex') end $$;

-- Fixtures, as the database owner. Studio A: job 1 selling (a client, two classes), job 2 a draft, job 3 selling.
-- Studio B: job 1 selling.
insert into public.clients (id, studio_id, name) values
  ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Maple Grove Elementary');
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number, client_id) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall 2026', 'school', '2026-10-13', 'JOB00001', 'c1000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Draft Job', 'school', '2026-10-14', 'JOB00002', null),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Soccer', 'sports', '2026-10-15', 'JOB00003', null),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-13', 'JOB00001', null);
insert into public.job_groups (id, studio_id, job_id, name) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Room 1'),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Room 2');
-- c1 Ava (Room 1), c2 her brother (Room 1), c3 in the draft, c4 Do not publish, c5 in job 3, c6 (Room 2), c7 extra.
insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, do_not_publish,
  access_code_hash, access_code_ciphertext)
select v.id::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v.job::uuid, v.grp::uuid, v.first, 'Patel', v.dnp,
  pg_temp.h('code-' || v.n), 'v1.' || repeat('A', 48)
from (values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Ava', false, 'c1'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Noah', false, 'c2'),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', null, 'Mia', false, 'c3'),
  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Leo', true, 'c4'),
  ('c0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000003', null, 'Zoe', false, 'c5'),
  ('c0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'Eli', false, 'c6'),
  ('c0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', null, 'Ivy', false, 'c7')
) v (id, job, grp, first, dnp, n);
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
values ('cb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'b0000000-0000-4000-8000-000000000001', 'Bea', 'Brown', pg_temp.h('code-b1'), 'v1.' || repeat('A', 48));
-- A blank card of job 1 carrying a code of its own (not yet named: call 5).
insert into public.qr_cards (id, studio_id, job_id, card_code, access_code_hash, access_code_ciphertext) values
  ('d0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a0000000-0000-4000-8000-000000000001', 'ABCDEFGHJKMNPQRSTVWX', pg_temp.h('code-blank'), 'v1.' || repeat('A', 48));

-- Photos: batch 1 of job 1 is tagged; batch 2 is due to be tagged again. Every kind of photo parents must never see.
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('e1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('e1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111'),
  ('eb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222');
-- n, batch, status, qr_kind, binned, place, child, group, card, flag, source.
create temp table fx (n int, batch text, status text, qr text, binned boolean, place text, child text, grp text,
  card text, flag text, source text) on commit drop;
insert into fx values
  (1,  'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, null, 'auto'),
  (2,  'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, null, 'auto'),
  (3,  'e1000000-0000-4000-8000-000000000001', 'ready', 'other_card', false, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, 'other_card', 'auto'),
  (4,  'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, 'after_unreadable', 'auto'),
  (5,  'e1000000-0000-4000-8000-000000000001', 'ready', 'none', true, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, null, 'auto'),
  (6,  'e1000000-0000-4000-8000-000000000001', 'processing', null, false, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, null, 'auto'),
  (7,  'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'leftovers', null, null, null, null, 'auto'),
  (8,  'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'class_set', null, 'a1000000-0000-4000-8000-000000000001', null, null, 'auto'),
  (9,  'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'class_set', null, 'a1000000-0000-4000-8000-000000000002', null, null, 'auto'),
  (10, 'e1000000-0000-4000-8000-000000000001', 'ready', 'unreadable', false, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, null, 'auto'),
  (11, 'e1000000-0000-4000-8000-000000000001', 'ready', 'unreadable', false, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, null, 'manual'),
  (12, 'e1000000-0000-4000-8000-000000000002', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000001', null, null, null, 'auto'),
  (13, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000004', null, null, null, 'auto'),
  (14, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000002', null, null, null, 'auto'),
  (15, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'blank_card', null, null, 'd0000000-0000-4000-8000-000000000001', null, 'auto'),
  (16, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000006', null, null, null, 'auto'),
  (17, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'card', null, null, null, null, 'manual'),
  (18, 'e1000000-0000-4000-8000-000000000003', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000005', null, null, null, 'auto'),
  (19, 'eb000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'cb000000-0000-4000-8000-000000000001', null, null, null, 'auto'),
  (20, 'e1000000-0000-4000-8000-000000000001', 'ready', 'none', false, 'child', 'c0000000-0000-4000-8000-000000000007', null, null, null, 'auto');
create function pg_temp.pid(n int) returns uuid language sql as $$
  select ('f0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, binned_at, binned_by, created_by)
select pg_temp.pid(f.n), b.studio_id, b.job_id, b.id, b.seq, f.status::public.photo_status,
  'IMG_' || lpad(f.n::text, 4, '0') || '.JPG', 1, extensions.digest(f.n::text, 'sha256'),
  case when f.status = 'ready' then 1200 end, case when f.status = 'ready' then 1500 end, f.qr,
  case when f.binned then now() end, case when f.binned then b.created_by end, b.created_by
from fx f join public.upload_batches b on b.id = f.batch::uuid;
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, group_id, card_id, flag, source, tagged_by)
select pg_temp.pid(f.n), p.studio_id, p.job_id, f.place::public.photo_place, f.child::uuid, f.grp::uuid,
  f.card::uuid, f.flag::public.photo_flag, f.source,
  case when f.source = 'manual' then '11111111-1111-4111-8111-111111111111'::uuid end
from fx f join public.photos p on p.id = pg_temp.pid(f.n);
update public.upload_batches set tagged_round = tag_round;
update public.upload_batches set tag_round = tag_round + 1 where id = 'e1000000-0000-4000-8000-000000000002';
update public.jobs set status = 'selling' where id in ('a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001');

-- Studios C and D, a child each, for the device's limit of 3 studios (code review S6).
insert into public.studios (id, name, slug, data_region) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Studio C', 'studio-c', 'us'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Studio D', 'studio-d', 'us');
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('c9000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'C Fall', 'school', '2026-10-13', 'JOB00001'),
  ('d9000000-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'D Fall', 'school', '2026-10-13', 'JOB00001');
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
values
  ('cc000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'c9000000-0000-4000-8000-000000000001', 'Cal', 'Cole', pg_temp.h('code-cc1'), 'v1.' || repeat('A', 48)),
  ('cd000000-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'd9000000-0000-4000-8000-000000000001', 'Dot', 'Dunn', pg_temp.h('code-cd1'), 'v1.' || repeat('A', 48));

create function pg_temp.item(p_job uuid, p_kind text, p_name text default null) returns uuid language sql as $$
  select i.id from public.price_list_items i join public.jobs j on j.price_list_id = i.price_list_id
  where j.id = p_job and i.kind::text = p_kind and (p_name is null or i.name = p_name) order by i.position limit 1 $$;
-- A code typed: the API's HMACs, here SHA-256 of names. enter_raw takes every key; enter is a device the API issued
-- (null: none) on a network whose /56 and /48 are its own, with the device's sessions (tokens) and a new token.
create function pg_temp.enter_raw(p_code text, p_device text, p_new_device text, p_net text, p_wide text,
  p_wider text, p_sessions text[], p_new text) returns jsonb
language sql as $$
  select public.shop_enter_code(pg_temp.h(p_code), pg_temp.h(p_device), pg_temp.h(p_new_device), pg_temp.h(p_net),
    pg_temp.h(p_wide), pg_temp.h(p_wider), (select coalesce(array_agg(pg_temp.h(x)), '{}') from unnest(p_sessions) x),
    pg_temp.h(p_new)) $$;
create function pg_temp.enter(p_code text, p_device text, p_net text, p_sessions text[], p_new text) returns jsonb
language sql as $$
  select pg_temp.enter_raw(p_code, p_device, null, p_net, p_net || '/56', p_net || '/48', p_sessions, p_new) $$;
create function pg_temp.outcome(p_code text, p_device text, p_net text, p_sessions text[], p_new text) returns text
language sql as $$ select pg_temp.enter(p_code, p_device, p_net, p_sessions, p_new) ->> 'outcome' $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
create function pg_temp.events() returns bigint language sql as $$ select count(*) from public.events $$;
create function pg_temp.attempt_rows() returns bigint language sql as $$
  select count(*) from app.shop_code_attempts $$;
create function pg_temp.sessions_of(p_child uuid) returns bigint language sql as $$
  select count(*) from public.shop_session_children where child_id = p_child $$;
create temp table before_events (n bigint) on commit drop;
create temp table before_rows (n bigint) on commit drop;

-- ── Shape: the service role's only ────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('shop_sessions', 'shop_session_children', 'shop_cart_lines')
    and c.relrowsecurity), 3::bigint, 'the shop tables have row-level security on');
select is((select count(*) from pg_policies where tablename in ('shop_sessions', 'shop_session_children',
  'shop_cart_lines')), 0::bigint, 'with no policies at all');
select is((select count(*) from unnest(array['public.shop_sessions', 'public.shop_session_children',
    'public.shop_cart_lines', 'app.shop_code_attempts', 'app.shop_rate']) t, unnest(array['anon', 'authenticated']) r
  where has_table_privilege(r, t, 'select') or has_table_privilege(r, t, 'insert')
     or has_table_privilege(r, t, 'update') or has_table_privilege(r, t, 'delete')), 0::bigint,
  'browsers and logged-out visitors can''t touch the tables');
select ok(not has_table_privilege('service_role', 'app.shop_code_attempts', 'select')
  and not has_table_privilege('service_role', 'app.shop_rate', 'select'),
  'nor the service role the attempt and request counts (only the functions)');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where proname in ('shop_enter_code', 'shop_session', 'shop_gallery', 'shop_price_list', 'shop_cart',
    'shop_cart_add', 'shop_cart_set_quantity', 'shop_cart_remove', 'shop_set_shipping', 'shop_forget',
    'take_shop_request', 'prune_shop', 'parent_visible_photos', 'shop_child_state', 'shop_session_row',
    'shop_session_child', 'shop_code_failed', 'shop_breaker_failed', 'shop_issue_device', 'shop_line_available',
    'shop_line_physical', 'shop_trim_child_sessions', 'shop_mark_known', 'shop_forget_device')),
  'every shop function is SECURITY DEFINER with an empty search_path');
create temp table shop_fns on commit drop as select unnest(array[
  'public.shop_enter_code(text, text, text, text, text, text, text[], text)', 'public.shop_session(text)',
  'public.shop_gallery(text, uuid)', 'public.shop_price_list(text, uuid)', 'public.shop_cart(text)',
  'public.shop_cart_add(text, uuid, uuid, uuid, integer)', 'public.shop_cart_set_quantity(text, uuid, integer)',
  'public.shop_cart_remove(text, uuid)', 'public.shop_set_shipping(text, public.shop_shipping_method)',
  'public.shop_forget(text)', 'public.shop_forget_device(text)',
  'public.take_shop_request(text, integer, text, integer)', 'public.prune_shop(integer)']) as f;
select is((select count(*) from shop_fns, unnest(array['anon', 'authenticated']) r
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'browsers and logged-out visitors can run none');
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')) from shop_fns),
  'the service role runs them all');
select is((select count(*) from unnest(array['app.parent_visible_photos(uuid, uuid, uuid)',
    'app.shop_child_state(uuid)', 'app.shop_code_failed(text, text, integer, interval, integer)',
    'app.shop_session_row(text, boolean)', 'app.shop_breaker_failed(integer)',
    'app.shop_issue_device(text, text, text)', 'app.shop_mark_known(text, uuid)',
    'app.shop_line_available(public.shop_cart_lines)', 'app.shop_trim_child_sessions(uuid, uuid, uuid)']) f,
    unnest(array['anon', 'authenticated', 'service_role']) r
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'nobody runs the app helpers directly');
set local role anon;
select throws_ok($$ select public.shop_session('0000000000000000000000000000000000000000000000000000000000000000') $$,
  '42501', null, 'a logged-out visitor can''t read a session');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true) is not null as signed_in;
select throws_ok($$ select public.shop_enter_code(null, null, null, null, null, null, null, null) $$, '42501', null,
  'nor a signed-in studio owner enter a code');
select throws_ok($$ select * from public.shop_sessions $$, '42501', null, 'or read sessions');
reset role;

-- ── Codes: by HMAC among children only, the lock checked first (answer 2; calls 4, 5) ─────────────────────────────
select throws_ok($$ select public.shop_enter_code(null, 'nope', null, 'nope', 'nope', null, null, null) $$, '22023',
  null, 'keys must be HMACs, and a new session named');
select throws_ok($$ select pg_temp.enter('x', 'p', 'n', array['a', 'b', 'c', 'd'], 'x') $$, '22023', null,
  'and a device holds at most 3 sessions');
select is(pg_temp.outcome('code-blank', 'phone1', 'school-wifi', null, 'tok-x'), 'not_found',
  'a blank card''s code counts as a wrong code (call 5)');
select is(pg_temp.outcome('ABCDEFGHJKMNPQRSTVWX', 'phone1', 'school-wifi', null, 'tok-x'), 'not_found',
  'so does a card code');
select is(pg_temp.outcome(null, 'phone1', 'school-wifi', null, 'tok-x'), 'not_found',
  'and a code of a region not set up here (no hash)');
select is(pg_temp.outcome('code-nope', 'phone1', 'school-wifi', null, 'tok-x'), 'not_found', 'a 4th wrong code');
select is(pg_temp.enter('code-nope2', 'phone1', 'school-wifi', null, 'tok-x'),
  '{"outcome": "locked", "retry_after": 900, "device_issued": false, "alert": false}'::jsonb,
  'the 5th locks the phone for 15 minutes');
select is(pg_temp.outcome('code-c1', 'phone1', 'school-wifi', null, 'tok-x'), 'locked',
  'a locked caller gets locked even with a right code');
select is((select count(*) from public.shop_sessions), 0::bigint, 'and no session is made');
select is((select hits from app.shop_code_attempts where kind = 'device' and key_hash = pg_temp.h('phone1')), 5,
  'nor is anything counted while locked');
select is(pg_temp.outcome('code-nope', 'phone1', 'other-wifi', null, 'tok-x'), 'locked',
  'a device''s lock follows it to another network');
select is(pg_temp.outcome('code-c1', 'phone2', 'school-wifi', null, 'tok-a'), 'opened',
  'another phone on the same network opens the gallery');
update app.shop_code_attempts set locked_until = now() - interval '1 second'
  where kind = 'device' and key_hash = pg_temp.h('phone1');
select is(pg_temp.outcome('code-nope', 'phone1', 'school-wifi', null, 'tok-x'), 'not_found',
  'once the 15 minutes are over, a wrong code is just wrong');
select is((select (hits, locked_until) from app.shop_code_attempts
  where kind = 'device' and key_hash = pg_temp.h('phone1')), (1, null::timestamptz), 'and the count starts again');
-- A right code never resets the count: 4 wrong, 1 right, 1 wrong locks.
select is((select array_agg(pg_temp.outcome(c, 'phone3', 'home-net', null, 'tok-y') order by o)
  from unnest(array['w1', 'w2', 'w3', 'w4', 'code-c7', 'w5']) with ordinality u (c, o)),
  array['not_found', 'not_found', 'not_found', 'not_found', 'opened', 'locked'],
  'a right code between wrong ones doesn''t reset the count');
-- The network's ceiling: 30 wrong codes from 30 devices in 15 minutes lock the whole network (call 4).
select is((select count(*) from generate_series(1, 29) g
  where pg_temp.outcome('wrong', 'device-' || g, 'library', null, 'tok-z') = 'not_found'), 29::bigint,
  '29 wrong codes from 29 phones on one network are each just wrong');
select is(pg_temp.outcome('wrong', 'device-30', 'library', null, 'tok-z'), 'locked',
  'the 30th locks the network');
select is(pg_temp.outcome('code-c1', 'device-31', 'library', null, 'tok-z'), 'locked',
  'so a new phone on it gets locked too, even with a right code');
select is((select count(*) from app.shop_code_attempts where key_hash !~ '^[0-9a-f]{64}$'), 0::bigint,
  'attempts are kept as HMACs only, never a code or an address');

-- ── Devices the server issued, and wider networks (security review H1) ────────────────────────────────────────────
select is((select array_agg(pg_temp.enter_raw('wrong', null, null, 'cafe', 'cafe/56', 'cafe/48', null, 'tok-z')
    ->> 'outcome' order by g) from generate_series(1, 5) g),
  array['not_found', 'not_found', 'not_found', 'not_found', 'locked'],
  'requests without a device share one bucket per network: the 5th wrong code locks it');
select is(pg_temp.enter_raw('code-c1', null, null, 'cafe', 'cafe/56', 'cafe/48', null, 'tok-z') ->> 'outcome', 'locked',
  'for every device-less request there, even with a right code');
select is(pg_temp.outcome('wrong', 'cafe-phone', 'cafe', null, 'tok-z'), 'not_found',
  'while a device of its own on that network is just wrong');
select is(pg_temp.enter_raw('wrong', null, 'fresh-1', 'new-net', 'new-net/56', null, null, 'tok-z'),
  '{"outcome": "not_found", "device_issued": true, "alert": false}'::jsonb,
  'a request without a device gets a new one');
select is((select (kind, hits) from app.shop_code_attempts where key_hash = pg_temp.h('fresh-1')), ('device'::text, 1),
  'and its wrong code counts on that device');
update app.shop_code_attempts set hits = 499 where kind = 'issue_net' and key_hash = pg_temp.h('new-net');
select is(pg_temp.enter_raw('wrong', null, 'fresh-1b', 'new-net', 'new-net/56', null, null, 'tok-z') ->> 'device_issued',
  'true', 'an IPv4 address gets up to 500 new devices a day (R1: a carrier''s shared address)');
select is(pg_temp.enter_raw('wrong', null, 'fresh-2', 'new-net', 'new-net/56', null, null, 'tok-z') ->> 'device_issued',
  'false', 'but no more');
select is((select hits from app.shop_code_attempts where kind = 'nodevice' and key_hash = pg_temp.h('new-net')), 1,
  'beyond that, its requests share the network''s no-device bucket');
select is((select count(*) from app.shop_code_attempts where key_hash = pg_temp.h('fresh-2')), 0::bigint,
  'and a device not issued is never counted');
insert into app.shop_code_attempts (kind, key_hash, hits, window_start) values
  ('issue_wide', pg_temp.h('carrier/24'), 5000, now()), ('issue_net', pg_temp.h('v6-net'), 50, now());
select is(pg_temp.enter_raw('wrong', null, 'fresh-v4', 'carrier-1', 'carrier/24', null, null, 'tok-z')
  ->> 'device_issued', 'false', 'an IPv4 /24 gets 5,000 a day');
select is(pg_temp.enter_raw('wrong', null, 'fresh-v6', 'v6-net', 'v6-net/56', 'v6-net/48', null, 'tok-z')
  ->> 'device_issued', 'false', 'an IPv6 /64 50');
select is((select count(*) from generate_series(1, 99) g
  where pg_temp.enter_raw('wrong', 'cd-' || g, null, 'campus-' || g, 'campus/56', 'campus/48', null, 'tok-z')
    ->> 'outcome' = 'not_found'), 99::bigint, '99 wrong codes from 99 networks of one IPv6 /56 are each just wrong');
select is(pg_temp.enter_raw('wrong', 'cd-100', null, 'campus-100', 'campus/56', 'campus/48', null, 'tok-z')
  ->> 'outcome', 'locked', 'the 100th locks the /56 (or IPv4 /24)');
select is(pg_temp.enter_raw('code-c1', 'cd-101', null, 'campus-101', 'campus/56', 'campus/48', null, 'tok-z')
  ->> 'outcome', 'locked', 'for every network in it');
update app.shop_code_attempts set hits = 299 where kind = 'wider' and key_hash = pg_temp.h('campus/48');
select is(pg_temp.enter_raw('wrong', 'isp-1', null, 'isp-a', 'isp-a/56', 'campus/48', null, 'tok-z') ->> 'outcome',
  'locked', 'the 300th wrong code in an IPv6 /48 locks the /48');

-- A known device: one that has opened a gallery keeps its own allowance on a locked network (M3).
update app.shop_code_attempts set locked_until = now() + interval '15 minutes'
  where kind = 'net' and key_hash = pg_temp.h('school-wifi');
delete from before_rows;
insert into before_rows select pg_temp.attempt_rows();
select is(pg_temp.outcome('code-c1', 'stranger', 'school-wifi', null, 'tok-s'), 'locked',
  'a new phone on a locked network is locked, even with a right code');
select is(pg_temp.attempt_rows() - (select n from before_rows), 0::bigint,
  'and a locked request writes no row (M2)');
select is(pg_temp.enter_raw('code-c1', null, 'fresh-locked', 'school-wifi', 'school-wifi/56', 'school-wifi/48', null,
    'tok-s'), '{"outcome": "locked", "retry_after": 900, "device_issued": false}'::jsonb,
  'a request without a device on a locked network is locked, and issued no device (R1)');
select is(pg_temp.attempt_rows() - (select n from before_rows), 0::bigint,
  'nor counted one: it writes no row either (R1)');
select is((select count(*) from app.shop_code_attempts where kind like 'issue%'
  and key_hash in (pg_temp.h('school-wifi'), pg_temp.h('school-wifi/56'), pg_temp.h('school-wifi/48'))), 0::bigint,
  'the network''s new devices are untouched');
insert into app.shop_code_attempts (kind, key_hash, hits, window_start) values ('net', pg_temp.h('edge-net'), 29, now());
select is(pg_temp.enter_raw('wrong', null, 'fresh-edge', 'edge-net', 'edge-net/56', null, null, 'tok-z'),
  '{"outcome": "locked", "retry_after": 900, "device_issued": false, "alert": false}'::jsonb,
  'a wrong code that locks the network gets no device either (R1)');
select is(pg_temp.outcome('code-c1', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused'), 'already',
  'a phone that opened a gallery there still gets in (M3)');
select is(pg_temp.outcome('code-wrong', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused'), 'not_found',
  'and its wrong code is just wrong, counted on the phone');
update app.shop_code_attempts set locked_at = now() - interval '1 hour'
  where kind = 'device' and key_hash = pg_temp.h('phone2');
select is(pg_temp.outcome('code-c1', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused'), 'locked',
  'but not if the phone itself was locked in the last 24 hours');
update app.shop_code_attempts set locked_at = null, hits = 0 where kind = 'device' and key_hash = pg_temp.h('phone2');
update app.shop_code_attempts set locked_until = null, hits = 0
  where kind = 'net' and key_hash = pg_temp.h('school-wifi');

-- The region's circuit breaker: 600 wrong codes in a minute, summed over its 16 rows (R9), trip it and raise one alert;
-- while it is tripped, only networks that keep coming back are tightened (R2), devices are still issued and known
-- devices keep their allowance.
create function pg_temp.shard(p_net text) returns text language sql as $$
  select lpad(to_hex((hashtextextended(pg_temp.h(p_net), 1) & 15)::integer), 64, '0') $$;
delete from app.shop_code_attempts where kind in ('region', 'region_shard');
-- 598 already counted in another row than br-net's, so the trip proves the rows are summed.
insert into app.shop_code_attempts (kind, key_hash, hits, window_start)
  values ('region_shard', lpad(to_hex(((hashtextextended(pg_temp.h('br-net'), 1) & 15)::integer + 1) & 15), 64, '0'),
    598, now());
select is(pg_temp.enter('wrong', 'br-1', 'br-net', null, 'tok-z') ->> 'alert', 'false', 'the 599th: no alert');
select is(pg_temp.enter('wrong', 'br-2', 'br-net', null, 'tok-z') ->> 'alert', 'true',
  'the 600th wrong code in a minute, across the breaker''s rows, trips it, with an alert');
select is(pg_temp.enter('wrong', 'br-3', 'br-net', null, 'tok-z') ->> 'alert', 'false', 'once');
select is((select array[count(*), sum(hits)] from app.shop_code_attempts where kind = 'region_shard'),
  array[2::bigint, 601::bigint], 'the count is spread over rows, each wrong code in its network''s');
select is((select count(*) from generate_series(4, 12) g
  where pg_temp.outcome('wrong', 'br-' || g, 'br-net', null, 'tok-z') = 'not_found'), 9::bigint,
  'while it is tripped, a network with no wrong code before this count keeps its 30 (R2)');
-- br-back guessed in an earlier window, 5 minutes ago: its new count is tightened to 10.
insert into app.shop_code_attempts (kind, key_hash, hits, window_start, updated_at)
  values ('net', pg_temp.h('br-back'), 7, now() - interval '20 minutes', now() - interval '5 minutes');
select is((select count(*) from generate_series(1, 9) g
  where pg_temp.outcome('wrong', 'br-b' || g, 'br-back', null, 'tok-z') = 'not_found'), 9::bigint,
  'a network that keeps coming back: 9 wrong codes are each just wrong');
select is(pg_temp.outcome('wrong', 'br-b10', 'br-back', null, 'tok-z'), 'locked', 'the 10th locks it, not the 30th');
select is(pg_temp.enter_raw('wrong', null, 'fresh-3', 'br-net-2', 'br-net-2/56', null, null, 'tok-z')
  ->> 'device_issued', 'true', 'new devices are still issued (R2)');
update app.shop_code_attempts set locked_until = now() + interval '15 minutes'
  where kind = 'net' and key_hash = pg_temp.h('school-wifi');
select is(pg_temp.outcome('code-c1', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused'), 'already',
  'and a known phone keeps its allowance on a locked network (R2)');
delete from app.shop_code_attempts where kind in ('region', 'region_shard');
update app.shop_code_attempts set locked_until = null, hits = 0
  where kind = 'net' and key_hash = pg_temp.h('school-wifi');

-- ── Sessions: one studio each, up to 5 children, 30 days, 3 studios a device (answers 1, 3; calls 1, 11; S6) ──────
select is((select count(*) from public.shop_sessions), 2::bigint, 'two right codes made two sessions');
select is((select expires_at - created_at from public.shop_sessions where token_hash = pg_temp.h('tok-a')),
  interval '30 days', 'a session lasts 30 days');
select is((select token_hash ~ '^[0-9a-f]{64}$' from public.shop_sessions where token_hash = pg_temp.h('tok-a')),
  true, 'and only its token''s hash is kept');
select is(public.shop_session(pg_temp.h('tok-a')) - 'expires_at', jsonb_build_object(
  'studio_name', 'Maple Lane Photography', 'shipping_method', null, 'bag_count', 0,
  'children', jsonb_build_array(jsonb_build_object('id', 'c0000000-0000-4000-8000-000000000001', 'first_name', 'Ava',
    'last_initial', 'P', 'job_id', 'a0000000-0000-4000-8000-000000000001', 'school', 'Maple Grove Elementary',
    'picture_day', '2026-10-13', 'closes_at', null, 'deliver_to_school', false, 'state', 'open'))),
  'the session: the studio''s name and the child''s first name and last initial only (call 2), the school, the day');
select is(pg_temp.enter('code-c2', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused') - 'live',
  jsonb_build_object('outcome', 'added', 'child_id', 'c0000000-0000-4000-8000-000000000002',
    'session_hash', pg_temp.h('tok-a'), 'device_issued', false),
  'a brother is added to the studio''s session on this device (S5: never a new session)');
select is(pg_temp.outcome('code-c2', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused'), 'already', 'only once');
select is(pg_temp.outcome('code-c5', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused'), 'added',
  'a sibling in another of the studio''s jobs too (call 1)');
select is(pg_temp.enter('code-b1', 'phone2', 'school-wifi', array['tok-a'], 'tok-ab') ->> 'outcome', 'opened',
  'another studio''s code opens a gallery of its own on the device (S6)');
select is((select array[(select count(*) from public.shop_session_children sc join public.shop_sessions s
    on s.id = sc.session_id where s.token_hash = pg_temp.h('tok-a')),
  (select count(*) from public.shop_session_children sc join public.shop_sessions s
    on s.id = sc.session_id where s.token_hash = pg_temp.h('tok-ab'))]), array[3::bigint, 1::bigint],
  'leaving the first studio''s untouched');
create function pg_temp.live(p jsonb) returns text[] language sql as $$
  select array_agg(x order by x) from jsonb_array_elements_text(p -> 'live') x $$;
select is(pg_temp.live(pg_temp.enter('code-cc1', 'phone2', 'school-wifi', array['tok-a', 'tok-ab', 'tok-dead'],
    'tok-ac')),
  (select array_agg(x order by x) from unnest(array[pg_temp.h('tok-a'), pg_temp.h('tok-ab'), pg_temp.h('tok-ac')]) x),
  'a third studio''s too; sessions that no longer last are left out of the device''s list');
create temp table limit_answer on commit drop as
  select pg_temp.enter('code-cd1', 'phone2', 'school-wifi', array['tok-a', 'tok-ab', 'tok-ac'], 'tok-ad') as a;
select is((select a - 'live' from limit_answer), '{"outcome": "gallery_limit", "device_issued": false}'::jsonb,
  'but never a fourth');
select is((select pg_temp.live(a) from limit_answer),
  (select array_agg(x order by x) from unnest(array[pg_temp.h('tok-a'), pg_temp.h('tok-ab'), pg_temp.h('tok-ac')]) x),
  'and the device keeps its three');
select is((select count(*) from public.shop_sessions where token_hash = pg_temp.h('tok-ad')), 0::bigint,
  'so no session is made');
select is(pg_temp.outcome('code-c3', 'phone2', 'school-wifi', array['tok-a', 'tok-ab', 'tok-ac'], 'tok-unused'),
  'added', 'a 4th child');
select is(pg_temp.outcome('code-c6', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused'), 'added', 'a 5th');
select is(pg_temp.outcome('code-c4', 'phone2', 'school-wifi', array['tok-a'], 'tok-unused'), 'limit', 'never a 6th');
select is(pg_temp.try($$ insert into public.shop_session_children (session_id, studio_id, job_id, child_id)
  select s.id, s.studio_id, 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004'
  from public.shop_sessions s where s.token_hash = pg_temp.h('tok-a') $$), 'P0001 sibling_limit',
  'whoever writes');
select is(pg_temp.try($$ insert into public.shop_session_children (session_id, studio_id, job_id, child_id)
  select s.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
    'cb000000-0000-4000-8000-000000000001' from public.shop_sessions s where s.token_hash = pg_temp.h('tok-y') $$),
  '23503 insert or update on table "shop_session_children" violates foreign key constraint "shop_session_children_session_fk"',
  'a session never holds another studio''s child, whoever writes');
select is((select expires_at - created_at from public.shop_sessions where token_hash = pg_temp.h('tok-a')),
  interval '30 days', 'adding siblings doesn''t extend the session (call 11)');
select is(pg_temp.enter('code-c7', 'phone3b', 'home-net-2', array['tok-y'], 'tok-y2') ->> 'session_hash',
  pg_temp.h('tok-y'), 'entering a code already in the device''s session keeps that session (S5)');
update public.shop_sessions set created_at = now() - interval '31 days', expires_at = now() - interval '1 day'
  where token_hash = pg_temp.h('tok-y');
select is(pg_temp.try($$ select public.shop_session(pg_temp.h('tok-y')) $$), 'P0001 session_required',
  'an expired session is like no session');
select is(pg_temp.enter('code-c7', 'phone3b', 'home-net-2', array['tok-y'], 'tok-y2') ->> 'outcome', 'opened',
  'so the code opens a new one');

-- ── What a closed or unavailable child shows (security review M1) ─────────────────────────────────────────────────
select is((select x from jsonb_array_elements(public.shop_session(pg_temp.h('tok-a')) -> 'children') x
  where x ->> 'id' = 'c0000000-0000-4000-8000-000000000003'),
  '{"id": "c0000000-0000-4000-8000-000000000003", "state": "closed"}'::jsonb,
  'a draft job''s child: the id and state only');
select ok(public.shop_session(pg_temp.h('tok-a'))::text !~ '(Mia|Draft Job|2026-10-14)',
  'never a closed or draft child''s name, school or picture day');

-- ── The gallery (D60; calls 3, 6, 8, 12) ──────────────────────────────────────────────────────────────────────────
select is(public.shop_gallery(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000001'),
  jsonb_build_object('state', 'open', 'studio_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'job_id', 'a0000000-0000-4000-8000-000000000001',
    'portraits', jsonb_build_array(
      jsonb_build_object('id', pg_temp.pid(1), 'width', 1200, 'height', 1500),
      jsonb_build_object('id', pg_temp.pid(2), 'width', 1200, 'height', 1500),
      jsonb_build_object('id', pg_temp.pid(11), 'width', 1200, 'height', 1500)),
    'class_photos', jsonb_build_array(jsonb_build_object('id', pg_temp.pid(8), 'width', 1200, 'height', 1500))),
  'Ava sees her own visible portraits in tagging order and her class''s set; no card, other-card, flagged, binned, processing, Leftovers, blank-card, unconfirmed or stale photo');
select is((select jsonb_agg(x -> 'id') from jsonb_array_elements(
    public.shop_gallery(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000006') -> 'class_photos') x),
  jsonb_build_array(pg_temp.pid(9)), 'a child of Room 2 sees Room 2''s set, not Room 1''s');
select is((select jsonb_agg(x -> 'id') from jsonb_array_elements(
    public.shop_gallery(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000002') -> 'portraits') x),
  jsonb_build_array(pg_temp.pid(14)), 'her brother sees only his own portraits');
select is((select count(*) from public.photos p left join public.photo_tags t on t.photo_id = p.id
  where public.photo_parent_visible(p.id) is distinct from exists (
    select 1 from app.parent_visible_photos(p.job_id, t.child_id, t.group_id) v where v.id = p.id)), 0::bigint,
  'parent_visible_photos agrees with photo_parent_visible on every photo');
select is((select count(*) from public.photos p where public.photo_parent_visible(p.id)), 11::bigint,
  '(11 of the 20 photos are visible to someone)');
select is(public.shop_gallery(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000003'),
  '{"state": "closed"}'::jsonb, 'a draft job''s child: closed, no photos, nothing else (answer 4)');
select is(pg_temp.outcome('code-c4', 'phone4', 'net-4', null, 'tok-dnp'), 'opened',
  'a Do not publish child''s code opens');
select is(public.shop_gallery(pg_temp.h('tok-dnp'), 'c0000000-0000-4000-8000-000000000004'),
  '{"state": "unavailable"}'::jsonb, 'to "not available yet", with no photos (call 6)');
select is(public.shop_session(pg_temp.h('tok-dnp')) -> 'children',
  '[{"id": "c0000000-0000-4000-8000-000000000004", "state": "unavailable"}]'::jsonb,
  'and no name (M1)');
select is(pg_temp.try($$ select public.shop_gallery(pg_temp.h('tok-dnp'), 'c0000000-0000-4000-8000-000000000001') $$),
  'P0002 Child not found', 'a child not in the session is not found');
select is(pg_temp.outcome('code-b1', 'phone5', 'net-5', null, 'tok-b'), 'opened', 'studio B''s parent opens B''s');
select is(pg_temp.try($$ select public.shop_gallery(pg_temp.h('tok-b'), 'c0000000-0000-4000-8000-000000000001') $$),
  'P0002 Child not found', 'and can''t read A''s child, even with its id');
select is(pg_temp.try($$ select public.shop_price_list(pg_temp.h('tok-b'), 'c0000000-0000-4000-8000-000000000001') $$),
  'P0002 Child not found', 'nor A''s prices');
select is(pg_temp.try($$ select public.shop_gallery(pg_temp.h('tok-ab'), 'c0000000-0000-4000-8000-000000000001') $$),
  'P0002 Child not found', 'nor can the same device''s studio B gallery');
alter table public.jobs disable trigger jobs_guard_closes_at;
update public.jobs set closes_at = now() - interval '1 minute' where id = 'a0000000-0000-4000-8000-000000000003';
alter table public.jobs enable trigger jobs_guard_closes_at;
select is(public.shop_gallery(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000005') ->> 'state', 'closed',
  'a passed closing date is closed at once, before the cron runs (call 12)');

-- ── Prices ────────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select (p ->> 'currency', p ->> 'home_shipping_cents', jsonb_array_length(p -> 'items'))
  from public.shop_price_list(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000001') p),
  ('USD'::text, '895'::text, 10), 'the job''s current list: currency, home shipping and every item');
select is((select x -> 'contents' from jsonb_array_elements(
    public.shop_price_list(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000001') -> 'items') x
  where x ->> 'name' = 'Package C'),
  '[{"kind": "print", "quantity": 1, "print_size": "5x7"}, {"kind": "print", "quantity": 1, "print_size": "wallets_8"}]'::jsonb,
  'with package contents');
select is(public.shop_price_list(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000003'),
  '{"state": "closed"}'::jsonb, 'nothing for a closed shop');

-- ── The bag (calls 8, 9) ──────────────────────────────────────────────────────────────────────────────────────────
create temp table ids (name text primary key, id uuid) on commit drop;
insert into ids values
  ('pkg', pg_temp.item('a0000000-0000-4000-8000-000000000001', 'package', 'Package A')),
  ('pkgC', pg_temp.item('a0000000-0000-4000-8000-000000000001', 'package', 'Package C')),
  ('print', pg_temp.item('a0000000-0000-4000-8000-000000000001', 'print')),
  ('single', pg_temp.item('a0000000-0000-4000-8000-000000000001', 'digital_single')),
  ('all', pg_temp.item('a0000000-0000-4000-8000-000000000001', 'digital_all')),
  ('print3', pg_temp.item('a0000000-0000-4000-8000-000000000003', 'print')),
  ('b_pkg', pg_temp.item('b0000000-0000-4000-8000-000000000001', 'package'));
create function pg_temp.add(p_tok text, p_child text, p_item text, p_photo int, p_qty int) returns text
language sql as $$
  select pg_temp.try(format('select public.shop_cart_add(%L, %L, %L, %L, %s)', pg_temp.h(p_tok), p_child,
    (select id from ids where name = p_item), pg_temp.pid(p_photo), coalesce(p_qty::text, 'null'))) $$;
create function pg_temp.set_qty(p_tok text, p_kind text, p_qty int) returns text language sql as $$
  select pg_temp.try(format('select public.shop_cart_set_quantity(%L, %L, %s)', pg_temp.h(p_tok),
    (select l.id from public.shop_cart_lines l join public.shop_sessions s on s.id = l.session_id
     where s.token_hash = pg_temp.h(p_tok) and l.kind::text = p_kind order by l.created_at limit 1), p_qty)) $$;
create function pg_temp.ship(p_tok text, p_method text) returns text language sql as $$
  select pg_temp.try(format('select public.shop_set_shipping(%L, %L)', pg_temp.h(p_tok), p_method)) $$;
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'pkg', 1, 1), 'ok',
  'Package A with Ava''s first pose');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'pkg', 1, 2), 'ok', 'and again, two more');
select is((select quantity from public.shop_cart_lines where photo_id = pg_temp.pid(1)), 3,
  'the same package and pose is one line of 3');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'pkg', 8, 1), 'P0001 photo_unavailable',
  'a class photo can''t be a pose (call 8)');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'pkg', 14, 1), 'P0001 photo_unavailable',
  'nor her brother''s photo');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'pkg', 4, 1), 'P0001 photo_unavailable',
  'nor a hidden photo of hers');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'b_pkg', 1, 1), 'P0001 item_unavailable',
  'nor another studio''s item');
select is(pg_temp.try(format('select public.shop_cart_add(%L, %L, %L, null, 1)', pg_temp.h('tok-a'),
  'c0000000-0000-4000-8000-000000000001', (select id from ids where name = 'pkg'))), '22023 A pose for everything but all digitals; digital downloads once',
  'a package needs a pose');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'all', 1, 1), '22023 A pose for everything but all digitals; digital downloads once',
  'all digitals has none');
select is(pg_temp.try(format('select public.shop_cart_add(%L, %L, %L, null, 1)', pg_temp.h('tok-a'),
  'c0000000-0000-4000-8000-000000000001', (select id from ids where name = 'all'))), 'ok', 'all digitals is added');
select is(pg_temp.try(format('select public.shop_cart_add(%L, %L, %L, null, 1)', pg_temp.h('tok-a'),
  'c0000000-0000-4000-8000-000000000001', (select id from ids where name = 'all'))), 'ok', 'again');
select is((select quantity from public.shop_cart_lines where kind = 'digital_all'), 1, 'and stays one');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'single', 2, 2), '22023 A pose for everything but all digitals; digital downloads once',
  'a single digital is bought once');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'single', 2, 1), 'ok', 'once is fine');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'print', 11, 0), '22023 A quantity is 1 to 99',
  'a quantity is at least 1');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000003', 'print', 1, 1), 'P0001 shop_closed',
  'nothing for a closed shop''s child');
select is(pg_temp.add('tok-dnp', 'c0000000-0000-4000-8000-000000000004', 'print', 13, 1), 'P0001 photo_unavailable',
  'nor an unavailable child');
select is(public.shop_session(pg_temp.h('tok-a')) -> 'bag_count', '5'::jsonb, 'the bag holds 5 things');
select is((select jsonb_agg(jsonb_build_object('kind', x ->> 'kind', 'price', x -> 'price_cents',
    'available', x -> 'available', 'physical', x -> 'physical') order by x ->> 'kind')
  from jsonb_array_elements(public.shop_cart(pg_temp.h('tok-a')) -> 'lines') x),
  '[{"kind": "digital_all", "price": 5900, "available": true, "physical": false},
    {"kind": "digital_single", "price": 2500, "available": true, "physical": false},
    {"kind": "package", "price": 6400, "available": true, "physical": true}]'::jsonb,
  'the bag, priced from the job''s list now, with what needs delivery');
select is(public.shop_cart(pg_temp.h('tok-a')) -> 'jobs',
  '[{"job_id": "a0000000-0000-4000-8000-000000000001", "currency": "USD", "deliver_to_school": false, "home_shipping_cents": 895}]'::jsonb,
  'with each job''s home fee and school delivery');
select is(public.shop_cart(pg_temp.h('tok-a')) ->> 'currency', 'USD',
  'and the studio''s currency, even for an empty bag (N4)');
select is(pg_temp.ship('tok-a', 'school'), 'P0001 school_delivery_off',
  'school delivery only when the job allows it (call 9)');
update public.jobs set deliver_to_school = true where id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.ship('tok-a', 'school'), 'ok', 'now it does');
select is(public.shop_session(pg_temp.h('tok-a')) ->> 'shipping_method', 'school', 'and the bag remembers');
update public.price_list_items set price_cents = 7000 where id = (select id from ids where name = 'pkg');
select is((select (x -> 'price_cents')::int from jsonb_array_elements(public.shop_cart(pg_temp.h('tok-a')) -> 'lines') x
  where x ->> 'kind' = 'package'), 7000, 'a price change shows at once: nothing is stored on the line');
select is(pg_temp.set_qty('tok-a', 'digital_single', 5),
  '22023 A quantity is 1 to 99; a digital download once', 'a download''s quantity stays 1');
select is(pg_temp.set_qty('tok-a', 'package', 4), 'ok', 'a package''s can change');
select is(pg_temp.try(format('select public.shop_cart_set_quantity(%L, %L, 4)', pg_temp.h('tok-b'),
  (select id from public.shop_cart_lines where kind = 'package'))), 'P0002 Line not found',
  'but not from another studio''s session');
select is(pg_temp.try(format('select public.shop_cart_remove(%L, %L)', pg_temp.h('tok-b'),
  (select id from public.shop_cart_lines where kind = 'package'))), 'P0002 Line not found', 'nor removed');
select is((public.shop_cart(pg_temp.h('tok-b')) -> 'lines'), '[]'::jsonb, 'B''s bag shows nothing of A''s');
-- The job moves to another list: the lines can't be bought any more, and the old items can't be added.
insert into public.price_lists (id, studio_id, name) values
  ('e9000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Spring');
insert into public.price_list_items (studio_id, price_list_id, kind, name, price_cents)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e9000000-0000-4000-8000-000000000001', 'digital_all', 'All', 100);
update public.jobs set price_list_id = 'e9000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000001';
select is((select bool_or((x ->> 'available')::boolean) from jsonb_array_elements(
  public.shop_cart(pg_temp.h('tok-a')) -> 'lines') x), false, 'a list switch makes every line unavailable');
select is(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'print', 2, 1), 'P0001 item_unavailable',
  'and the old list''s items can''t be added');
select is(pg_temp.set_qty('tok-a', 'package', 2), 'P0001 item_unavailable',
  'nor can their quantities change (N2)');
select is(pg_temp.ship('tok-a', 'school'), 'P0001 school_delivery_off',
  'and with nothing left to deliver, school delivery is refused');
update public.jobs set price_list_id = (select default_price_list_id from public.studios
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where id = 'a0000000-0000-4000-8000-000000000001';
update public.photo_tags set flag = 'after_unreadable' where photo_id = pg_temp.pid(2);
select is((select (x ->> 'available')::boolean from jsonb_array_elements(public.shop_cart(pg_temp.h('tok-a')) -> 'lines') x
  where x ->> 'kind' = 'digital_single'), false, 'a pose that is hidden again makes its line unavailable');
select is(pg_temp.set_qty('tok-a', 'digital_single', 1), 'P0001 photo_unavailable', 'and its quantity fixed');
delete from public.price_list_items where id = (select id from ids where name = 'all');
select is((select count(*) from public.shop_cart_lines where kind = 'digital_all'), 0::bigint,
  'deleting an item removes its lines');
delete from public.photo_tags where photo_id = pg_temp.pid(2);
delete from public.photos where id = pg_temp.pid(2);
select is((select count(*) from public.shop_cart_lines where photo_id = pg_temp.pid(2)), 0::bigint,
  'and purging a photo removes its lines');
select is(public.shop_gallery(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000001'),
  '{"state": "unavailable"}'::jsonb, 'until its batch is tagged again, none of the batch''s photos show');
update public.upload_batches set tagged_round = tag_round where id = 'e1000000-0000-4000-8000-000000000001';
select is(pg_temp.try(format('select public.shop_cart_remove(%L, %L)', pg_temp.h('tok-a'),
  (select id from public.shop_cart_lines where kind = 'package'))), 'ok', 'the parent removes a line');
select is((select count(*) from public.shop_cart_lines), 0::bigint, 'the bag is empty');

-- School delivery looks only at lines that can still be bought (code review M2): Ava's job delivers to school,
-- Zoe's doesn't; once Zoe's print can't be bought, school delivery is offered and accepted.
alter table public.jobs disable trigger jobs_guard_closes_at;
update public.jobs set closes_at = null where id = 'a0000000-0000-4000-8000-000000000003';
alter table public.jobs enable trigger jobs_guard_closes_at;
select is(pg_temp.outcome('code-c1', 'm2-phone', 'm2-net', null, 'tok-m2'), 'opened', 'a parent opens Ava''s gallery');
select is(pg_temp.outcome('code-c5', 'm2-phone', 'm2-net', array['tok-m2'], 'tok-unused'), 'added',
  'and adds Zoe, of a job without school delivery');
select is(pg_temp.add('tok-m2', 'c0000000-0000-4000-8000-000000000001', 'print', 1, 1) ||
  pg_temp.add('tok-m2', 'c0000000-0000-4000-8000-000000000005', 'print3', 18, 1), 'okok', 'a print for each');
select is(pg_temp.ship('tok-m2', 'school'), 'P0001 school_delivery_off', 'so school delivery is refused');
alter table public.jobs disable trigger jobs_guard_closes_at;
update public.jobs set closes_at = now() - interval '1 minute' where id = 'a0000000-0000-4000-8000-000000000003';
alter table public.jobs enable trigger jobs_guard_closes_at;
select is((select jsonb_agg(x -> 'available' order by x ->> 'child_id') from jsonb_array_elements(
  public.shop_cart(pg_temp.h('tok-m2')) -> 'lines') x), '[true, false]'::jsonb,
  'Zoe''s shop closes: her print can''t be bought');
select is(pg_temp.ship('tok-m2', 'school'), 'ok', 'and school delivery, offered for Ava''s print, is accepted');
create function pg_temp.m2_qty(p_child uuid) returns text language sql as $$
  select pg_temp.try(format('select public.shop_cart_set_quantity(%L, %L, 3)', pg_temp.h('tok-m2'),
    (select l.id from public.shop_cart_lines l join public.shop_sessions s on s.id = l.session_id
     where s.token_hash = pg_temp.h('tok-m2') and l.child_id = p_child))) $$;
select is(pg_temp.m2_qty('c0000000-0000-4000-8000-000000000001') || '/' ||
  pg_temp.m2_qty('c0000000-0000-4000-8000-000000000005'),
  'ok/P0001 shop_closed', 'Ava''s print''s quantity can change; Zoe''s can''t (N2)');
select is(pg_temp.try(format('select public.shop_cart_remove(%L, %L)', pg_temp.h('tok-m2'),
  (select id from public.shop_cart_lines where child_id = 'c0000000-0000-4000-8000-000000000001'))), 'ok',
  'with Ava''s print removed');
select is(pg_temp.ship('tok-m2', 'school'), 'P0001 school_delivery_off',
  'nothing left needs delivery, so school delivery is refused');

-- ── One code's reach (security review R3) ─────────────────────────────────────────────────────────────────────────
delete from app.shop_code_attempts where kind in ('known_child', 'child_sessions');
select is((select count(*) from generate_series(1, 4) g
  where pg_temp.outcome('code-c6', 'kn-' || g, 'kn-net-' || g, null, 'kn-tok-' || g) = 'opened'), 4::bigint,
  'Eli''s code opens his gallery on 4 new phones');
select is((select count(*) from app.shop_code_attempts where kind = 'device' and known
  and key_hash in (select pg_temp.h('kn-' || g) from generate_series(1, 4) g)), 3::bigint,
  'but only 3 of them become known in a day');
select is((select count(*) from app.shop_code_attempts where key_hash = pg_temp.h('kn-4')), 0::bigint,
  'the 4th is not');
select ok((select bool_and(key_hash ~ '^[0-9a-f]{64}$' and key_hash <> replace('c0000000-0000-4000-8000-000000000006', '-', ''))
  from app.shop_code_attempts where kind in ('known_child', 'child_sessions')), 'children are counted by a hash only');
-- Ivy: tok-y (expired) and tok-y2 show her; a parent has her print in tok-y2's bag.
select is(pg_temp.add('tok-y2', 'c0000000-0000-4000-8000-000000000007', 'print', 20, 1), 'ok',
  'a parent puts Ivy''s print in the bag');
select is((select count(*) from generate_series(1, 8) g
  where pg_temp.outcome('code-c7', 'cap-' || g, 'cap-net-' || g, null, 'cap-tok-' || g) = 'opened'), 8::bigint,
  'Ivy''s code opens on 8 more phones');
select is(pg_temp.sessions_of('c0000000-0000-4000-8000-000000000007'), 10::bigint, '10 sessions show her');
update public.shop_session_children sc set added_at = now() - make_interval(mins => t.age)
from public.shop_sessions s,
  (select 'tok-y' tok, 100 age union all select 'tok-y2', 99
   union all select 'cap-tok-' || g, 91 - g from generate_series(1, 8) g) t
where s.id = sc.session_id and s.token_hash = pg_temp.h(t.tok) and sc.child_id = 'c0000000-0000-4000-8000-000000000007';
select is(pg_temp.outcome('code-c7', 'cap-9', 'cap-net-9', null, 'cap-tok-9'), 'opened', 'an 11th opens');
select is(pg_temp.sessions_of('c0000000-0000-4000-8000-000000000007'), 10::bigint, 'still only 10 show her');
select is((select count(*) from public.shop_sessions where token_hash = pg_temp.h('tok-y')), 0::bigint,
  'the oldest, with an empty bag, is forgotten');
select is(pg_temp.outcome('code-c7', 'cap-10', 'cap-net-10', null, 'cap-tok-10'), 'opened', 'a 12th');
select is((select array[(select count(*) from public.shop_sessions where token_hash = pg_temp.h('tok-y2')),
  (select count(*) from public.shop_sessions where token_hash = pg_temp.h('cap-tok-1'))]), array[1::bigint, 0::bigint],
  'the session with a bag is spared; the oldest without one goes instead');
delete from before_rows;
insert into before_rows select pg_temp.attempt_rows();
create temp table rate_answer on commit drop as
  select pg_temp.enter('code-c7', 'cap-11', 'cap-net-11', null, 'cap-tok-11') as a;
select is((select (a ->> 'outcome', a ->> 'device_issued', (a ->> 'retry_after')::int > 86000) from rate_answer),
  ('locked'::text, 'false'::text, true),
  'a 13th phone, the 11th new session for her in a day, is refused as locked until the day is over');
select is((select count(*) from public.shop_sessions where token_hash = pg_temp.h('cap-tok-11')) +
  (pg_temp.attempt_rows() - (select n from before_rows)), 0::bigint, 'with no session made and no row written');
select is(public.shop_forget(pg_temp.h('cap-tok-10')), true, 'forgetting one of her sessions');
select is(pg_temp.outcome('code-c7', 'cap-11', 'cap-net-11', null, 'cap-tok-11'), 'locked',
  'doesn''t give the allowance back');
select is(pg_temp.outcome('code-c7', 'phone3b', 'home-net-2', array['tok-y2'], 'tok-unused'), 'already',
  'while a phone already showing her still gets in');

-- ── Forgetting, requests, tidy-up ─────────────────────────────────────────────────────────────────────────────────
select ok(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'print', 1, 2) = 'ok', 'a print in the bag');
select is(public.shop_forget(pg_temp.h('tok-a')), true, '"Forget this device"');
select is((select count(*) from public.shop_sessions where token_hash = pg_temp.h('tok-a')) +
  (select count(*) from public.shop_cart_lines l where not exists (
    select 1 from public.shop_sessions s where s.id = l.session_id)) +
  (select count(*) from public.shop_session_children sc where not exists (
    select 1 from public.shop_sessions s where s.id = sc.session_id)), 0::bigint,
  'deletes the session, its children and its bag (call 11)');
select is((select count(*) from public.shop_sessions where token_hash in (pg_temp.h('tok-ab'), pg_temp.h('tok-ac'))),
  2::bigint, 'forgetting one gallery leaves the device''s others');
select is(public.shop_forget('nope'), false, 'a bad token forgets nothing');
select is((select (known, hits) from app.shop_code_attempts where kind = 'device' and key_hash = pg_temp.h('phone1')),
  (false, 1), 'phone1 has a wrong code counted');
update app.shop_code_attempts set known = true where kind = 'device' and key_hash = pg_temp.h('phone1');
select lives_ok($$ select public.shop_forget_device(pg_temp.h('phone1')) $$, 'forgetting every gallery (R7)');
select is((select (known, hits) from app.shop_code_attempts where kind = 'device' and key_hash = pg_temp.h('phone1')),
  (false, 1), 'makes the device unknown, keeping its count');
select throws_ok($$ select public.shop_forget_device('nope') $$, '22023', null, 'a device key is an HMAC');
select is(array[public.take_shop_request(pg_temp.h('net'), 2, pg_temp.h('wide'), 4),
  public.take_shop_request(pg_temp.h('net'), 2, pg_temp.h('wide'), 4),
  public.take_shop_request(pg_temp.h('net'), 2, pg_temp.h('wide'), 4)], array[true, true, false],
  'requests per network are counted');
select is(array[public.take_shop_request(pg_temp.h('net-2'), 2, pg_temp.h('wide'), 4),
  public.take_shop_request(pg_temp.h('net-3'), 2, pg_temp.h('wide'), 4)], array[true, false],
  'and per wider network, across its networks (R4)');
select is((select count(*) from app.shop_rate where key_hash = pg_temp.h('net-3')), 0::bigint,
  'a network over its wider network''s budget writes no row of its own');
select throws_ok($$ select public.take_shop_request(pg_temp.h('net'), 2, null, 4) $$, '22023', null,
  'the wider network is required');
update app.shop_code_attempts set updated_at = now() - interval '25 hours'
  where (kind = 'device' and key_hash in (pg_temp.h('phone4'), pg_temp.h('phone5'))) or kind in ('issue_net', 'issue_wide');
update app.shop_code_attempts set updated_at = now() - interval '31 days'
  where kind = 'device' and key_hash = pg_temp.h('cap-1');
update app.shop_rate set window_start = now() - interval '2 hours';
select ok(public.prune_shop(1) between 1 and 3, 'the tidy-up removes a page at a time (the cron calls it again)');
select ok(public.prune_shop(1000) > 0, 'and then the rest');
select is((select count(*) from public.shop_sessions where expires_at <= now()), 0::bigint, 'no expired session left');
select is((select count(*) from app.shop_rate), 0::bigint, 'no old request count');
select is((select count(*) from app.shop_code_attempts where kind = 'issue_net' and updated_at < now() - interval '24 hours'),
  0::bigint, 'no day-old count');
select is((select array_agg(key_hash = pg_temp.h('phone4') order by key_hash = pg_temp.h('phone4'))
  from app.shop_code_attempts where kind = 'device' and key_hash in (pg_temp.h('phone4'), pg_temp.h('cap-1'))),
  array[true], 'a known device is kept 30 days, then goes');

-- ── No events, no personal data ───────────────────────────────────────────────────────────────────────────────────
delete from before_events;
insert into before_events select pg_temp.events();
select is(pg_temp.outcome('code-c1', 'phone9', 'net-9', null, 'tok-e'), 'opened', 'a parent opens a gallery');
select is(pg_temp.add('tok-e', 'c0000000-0000-4000-8000-000000000001', 'print', 1, 1), 'ok', 'adds to the bag');
select is(pg_temp.ship('tok-e', 'home'), 'ok', 'chooses delivery');
select is(pg_temp.set_qty('tok-e', 'print', 2), 'ok', 'changes a quantity');
select is(public.shop_forget(pg_temp.h('tok-e')), true, 'and forgets the device');
select is(pg_temp.events() - (select n from before_events), 0::bigint,
  'none of which writes an event (call 10)');
select is((select count(*) from public.shop_sessions s where to_jsonb(s)::text ~ '(Ava|Patel|code-)'), 0::bigint,
  'sessions hold no names or codes');

select * from finish();
rollback;
