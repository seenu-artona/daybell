-- The parent gallery (D24, D60, D116, D119, F17, D113, D96; Seenu's answers 1–4, Claude's calls 1–13; ADR 0022):
-- shop tables and functions are the service role's only; codes are looked up by HMAC among children only, after the
-- lock is checked; 5 wrong codes per network+device and 30 per network lock for 15 minutes, a right code never
-- resets the count; a session holds up to 5 children of one studio for a fixed 30 days; parents see exactly the photos
-- photo_parent_visible allows, a child's own portraits and their own class's set, nothing for closed, draft or
-- unavailable children; the bag is priced from the job's current list and refuses what parents may not buy; another
-- studio's session reads or changes nothing of this one's; nothing writes events or stores a code, name or address.
begin;
create extension if not exists pgtap with schema extensions;
select plan(113);

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

create function pg_temp.item(p_job uuid, p_kind text, p_name text default null) returns uuid language sql as $$
  select i.id from public.price_list_items i join public.jobs j on j.price_list_id = i.price_list_id
  where j.id = p_job and i.kind::text = p_kind and (p_name is null or i.name = p_name) order by i.position limit 1 $$;
-- A code typed on a device (pair) on a network (ip): the API's HMACs, here SHA-256 of names.
create function pg_temp.enter(p_code text, p_pair text, p_ip text, p_session text, p_new text) returns jsonb
language sql as $$
  select public.shop_enter_code(pg_temp.h(p_code), pg_temp.h(p_pair), pg_temp.h(p_ip), pg_temp.h(p_session),
    pg_temp.h(p_new)) $$;
create function pg_temp.outcome(p_code text, p_pair text, p_ip text, p_session text, p_new text) returns text
language sql as $$ select pg_temp.enter(p_code, p_pair, p_ip, p_session, p_new) ->> 'outcome' $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
create function pg_temp.events() returns bigint language sql as $$ select count(*) from public.events $$;
create temp table before_events (n bigint) on commit drop;

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
    'shop_session_child', 'shop_code_failed')),
  'every shop function is SECURITY DEFINER with an empty search_path');
create temp table shop_fns on commit drop as select unnest(array[
  'public.shop_enter_code(text, text, text, text, text)', 'public.shop_session(text)',
  'public.shop_gallery(text, uuid)', 'public.shop_price_list(text, uuid)', 'public.shop_cart(text)',
  'public.shop_cart_add(text, uuid, uuid, uuid, integer)', 'public.shop_cart_set_quantity(text, uuid, integer)',
  'public.shop_cart_remove(text, uuid)', 'public.shop_set_shipping(text, public.shop_shipping_method)',
  'public.shop_forget(text)', 'public.take_shop_request(text, integer)', 'public.prune_shop(integer)']) as f;
select is((select count(*) from shop_fns, unnest(array['anon', 'authenticated']) r
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'browsers and logged-out visitors can run none');
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')) from shop_fns),
  'the service role runs them all');
select is((select count(*) from unnest(array['app.parent_visible_photos(uuid, uuid, uuid)',
    'app.shop_child_state(uuid)', 'app.shop_code_failed(text, text)', 'app.shop_session_row(text, boolean)']) f,
    unnest(array['anon', 'authenticated', 'service_role']) r
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'nobody runs the app helpers directly');
set local role anon;
select throws_ok($$ select public.shop_session('0000000000000000000000000000000000000000000000000000000000000000') $$,
  '42501', null, 'a logged-out visitor can''t read a session');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true) is not null as signed_in;
select throws_ok($$ select public.shop_enter_code(null, null, null, null, null) $$, '42501', null,
  'nor a signed-in studio owner enter a code');
select throws_ok($$ select * from public.shop_sessions $$, '42501', null, 'or read sessions');
reset role;

-- ── Codes: by HMAC among children only, the lock checked first (answer 2; calls 4, 5) ─────────────────────────────
select throws_ok($$ select public.shop_enter_code(null, 'nope', 'nope', null, null) $$, '22023', null,
  'keys must be HMACs, and a session must be named');
select is(pg_temp.outcome('code-blank', 'phone1', 'school-wifi', null, 'tok-x'), 'not_found',
  'a blank card''s code counts as a wrong code (call 5)');
select is(pg_temp.outcome('ABCDEFGHJKMNPQRSTVWX', 'phone1', 'school-wifi', null, 'tok-x'), 'not_found',
  'so does a card code');
select is(pg_temp.outcome(null, 'phone1', 'school-wifi', null, 'tok-x'), 'not_found',
  'and a code of a region not set up here (no hash)');
select is(pg_temp.outcome('code-nope', 'phone1', 'school-wifi', null, 'tok-x'), 'not_found', 'a 4th wrong code');
select is(pg_temp.enter('code-nope2', 'phone1', 'school-wifi', null, 'tok-x'),
  '{"outcome": "locked", "retry_after": 900}'::jsonb, 'the 5th locks the phone on that network for 15 minutes');
select is(pg_temp.outcome('code-c1', 'phone1', 'school-wifi', null, 'tok-x'), 'locked',
  'a locked caller gets locked even with a right code');
select is((select count(*) from public.shop_sessions), 0::bigint, 'and no session is made');
select is((select failures from app.shop_code_attempts where kind = 'pair' and key_hash = pg_temp.h('phone1')), 5,
  'nor is anything counted while locked');
select is(pg_temp.outcome('code-c1', 'phone2', 'school-wifi', null, 'tok-a'), 'opened',
  'another phone on the same network opens the gallery');
update app.shop_code_attempts set locked_until = now() - interval '1 second'
  where kind = 'pair' and key_hash = pg_temp.h('phone1');
select is(pg_temp.outcome('code-nope', 'phone1', 'school-wifi', null, 'tok-x'), 'not_found',
  'once the 15 minutes are over, a wrong code is just wrong');
select is((select (failures, locked_until) from app.shop_code_attempts
  where kind = 'pair' and key_hash = pg_temp.h('phone1')), (1, null::timestamptz), 'and the count starts again');
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

-- ── Sessions: one studio, up to 5 children, 30 days (answers 1, 3; calls 1, 11) ───────────────────────────────────
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
select is(pg_temp.enter('code-c2', 'phone2', 'school-wifi', 'tok-a', null),
  '{"outcome": "added", "child_id": "c0000000-0000-4000-8000-000000000002"}'::jsonb, 'a brother is added');
select is(pg_temp.outcome('code-c2', 'phone2', 'school-wifi', 'tok-a', null), 'already', 'only once');
select is(pg_temp.outcome('code-c5', 'phone2', 'school-wifi', 'tok-a', null), 'added',
  'a sibling in another of the studio''s jobs too (call 1)');
select is(pg_temp.outcome('code-b1', 'phone2', 'school-wifi', 'tok-a', null), 'other_studio',
  'another studio''s code is refused (call 1)');
select is(pg_temp.outcome('code-c3', 'phone2', 'school-wifi', 'tok-a', null), 'added', 'a 4th child');
select is(pg_temp.outcome('code-c6', 'phone2', 'school-wifi', 'tok-a', null), 'added', 'a 5th');
select is(pg_temp.outcome('code-c4', 'phone2', 'school-wifi', 'tok-a', null), 'limit', 'never a 6th');
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
select is(pg_temp.try($$ select public.shop_enter_code(pg_temp.h('code-c4'), pg_temp.h('p'), pg_temp.h('n'),
  pg_temp.h('tok-unknown'), null) $$), 'P0001 session_required', 'adding needs a live session');
select is(pg_temp.outcome('code-c7', 'phone3b', 'home-net-2', 'tok-y', 'tok-y2'), 'opened',
  'opening again on a device');
select is((select count(*) from public.shop_sessions where token_hash in (pg_temp.h('tok-y'), pg_temp.h('tok-y2'))),
  1::bigint, 'forgets the device''s old session');
update public.shop_sessions set created_at = now() - interval '31 days', expires_at = now() - interval '1 day'
  where token_hash = pg_temp.h('tok-y2');
select is(pg_temp.try($$ select public.shop_session(pg_temp.h('tok-y2')) $$), 'P0001 session_required',
  'an expired session is like no session');

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
  '{"state": "closed", "studio_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "job_id": "a0000000-0000-4000-8000-000000000002", "portraits": [], "class_photos": []}'::jsonb,
  'a draft job''s child: closed, no photos (answer 4)');
select is(pg_temp.outcome('code-c4', 'phone4', 'net-4', null, 'tok-dnp'), 'opened',
  'a Do not publish child''s code opens');
select is(public.shop_gallery(pg_temp.h('tok-dnp'), 'c0000000-0000-4000-8000-000000000004') ->> 'state',
  'unavailable', 'to "not available yet", with no photos (call 6)');
select is(pg_temp.try($$ select public.shop_gallery(pg_temp.h('tok-dnp'), 'c0000000-0000-4000-8000-000000000001') $$),
  'P0002 Child not found', 'a child not in the session is not found');
select is(pg_temp.outcome('code-b1', 'phone5', 'net-5', null, 'tok-b'), 'opened', 'studio B''s parent opens B''s');
select is(pg_temp.try($$ select public.shop_gallery(pg_temp.h('tok-b'), 'c0000000-0000-4000-8000-000000000001') $$),
  'P0002 Child not found', 'and can''t read A''s child, even with its id');
select is(pg_temp.try($$ select public.shop_price_list(pg_temp.h('tok-b'), 'c0000000-0000-4000-8000-000000000001') $$),
  'P0002 Child not found', 'nor A''s prices');
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
  ('b_pkg', pg_temp.item('b0000000-0000-4000-8000-000000000001', 'package'));
create function pg_temp.add(p_tok text, p_child text, p_item text, p_photo int, p_qty int) returns text
language sql as $$
  select pg_temp.try(format('select public.shop_cart_add(%L, %L, %L, %L, %s)', pg_temp.h(p_tok), p_child,
    (select id from ids where name = p_item), pg_temp.pid(p_photo), coalesce(p_qty::text, 'null'))) $$;
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
select is(pg_temp.try(format('select public.shop_set_shipping(%L, %L)', pg_temp.h('tok-a'), 'school')),
  'P0001 school_delivery_off', 'school delivery only when the job allows it (call 9)');
update public.jobs set deliver_to_school = true where id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.try(format('select public.shop_set_shipping(%L, %L)', pg_temp.h('tok-a'), 'school')), 'ok',
  'now it does');
select is(public.shop_session(pg_temp.h('tok-a')) ->> 'shipping_method', 'school', 'and the bag remembers');
update public.price_list_items set price_cents = 7000 where id = (select id from ids where name = 'pkg');
select is((select (x -> 'price_cents')::int from jsonb_array_elements(public.shop_cart(pg_temp.h('tok-a')) -> 'lines') x
  where x ->> 'kind' = 'package'), 7000, 'a price change shows at once: nothing is stored on the line');
select is(pg_temp.try(format('select public.shop_cart_set_quantity(%L, %L, 5)', pg_temp.h('tok-a'),
  (select id from public.shop_cart_lines where kind = 'digital_single'))),
  '22023 A quantity is 1 to 99; a digital download once', 'a download''s quantity stays 1');
select is(pg_temp.try(format('select public.shop_cart_set_quantity(%L, %L, 4)', pg_temp.h('tok-a'),
  (select id from public.shop_cart_lines where kind = 'package'))), 'ok', 'a package''s can change');
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
update public.jobs set price_list_id = (select default_price_list_id from public.studios
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where id = 'a0000000-0000-4000-8000-000000000001';
update public.photo_tags set flag = 'after_unreadable' where photo_id = pg_temp.pid(2);
select is((select (x ->> 'available')::boolean from jsonb_array_elements(public.shop_cart(pg_temp.h('tok-a')) -> 'lines') x
  where x ->> 'kind' = 'digital_single'), false, 'a pose that is hidden again makes its line unavailable');
delete from public.price_list_items where id = (select id from ids where name = 'all');
select is((select count(*) from public.shop_cart_lines where kind = 'digital_all'), 0::bigint,
  'deleting an item removes its lines');
delete from public.photo_tags where photo_id = pg_temp.pid(2);
delete from public.photos where id = pg_temp.pid(2);
select is((select count(*) from public.shop_cart_lines where photo_id = pg_temp.pid(2)), 0::bigint,
  'and purging a photo removes its lines');
select is(public.shop_gallery(pg_temp.h('tok-a'), 'c0000000-0000-4000-8000-000000000001') -> 'portraits', '[]'::jsonb,
  'until its batch is tagged again, none of the batch''s photos show');
update public.upload_batches set tagged_round = tag_round where id = 'e1000000-0000-4000-8000-000000000001';
select is(pg_temp.try(format('select public.shop_cart_remove(%L, %L)', pg_temp.h('tok-a'),
  (select id from public.shop_cart_lines where kind = 'package'))), 'ok', 'the parent removes a line');
select is((select count(*) from public.shop_cart_lines), 0::bigint, 'the bag is empty');

-- ── Forgetting, requests, tidy-up ─────────────────────────────────────────────────────────────────────────────────
select ok(pg_temp.add('tok-a', 'c0000000-0000-4000-8000-000000000001', 'print', 1, 2) = 'ok', 'a print in the bag');
select is(public.shop_forget(pg_temp.h('tok-a')), true, '"Forget this device"');
select is((select count(*) from public.shop_sessions where token_hash = pg_temp.h('tok-a')) +
  (select count(*) from public.shop_cart_lines) +
  (select count(*) from public.shop_session_children sc where not exists (
    select 1 from public.shop_sessions s where s.id = sc.session_id)), 0::bigint,
  'deletes the session, its children and its bag (call 11)');
select is(public.shop_forget('nope'), false, 'a bad token forgets nothing');
select is(array[public.take_shop_request(pg_temp.h('net'), 2), public.take_shop_request(pg_temp.h('net'), 2),
  public.take_shop_request(pg_temp.h('net'), 2)], array[true, true, false], 'requests per network are counted');
update app.shop_code_attempts set updated_at = now() - interval '25 hours'
  where kind = 'pair' and key_hash = pg_temp.h('phone4');
update app.shop_rate set window_start = now() - interval '25 hours';
select is(public.prune_shop(1000), 3, 'the tidy-up removes the expired session, the old attempt and request count');
select is((select count(*) from public.shop_sessions where expires_at <= now()), 0::bigint, 'no expired session left');

-- ── No events, no personal data ───────────────────────────────────────────────────────────────────────────────────
delete from before_events;
insert into before_events select pg_temp.events();
select is(pg_temp.outcome('code-c1', 'phone9', 'net-9', null, 'tok-e'), 'opened', 'a parent opens a gallery');
select is(pg_temp.add('tok-e', 'c0000000-0000-4000-8000-000000000001', 'print', 1, 1), 'ok', 'adds to the bag');
select is(pg_temp.try(format('select public.shop_set_shipping(%L, %L)', pg_temp.h('tok-e'), 'home')), 'ok',
  'chooses delivery');
select is(pg_temp.try(format('select public.shop_cart_set_quantity(%L, %L, 2)', pg_temp.h('tok-e'),
  (select id from public.shop_cart_lines limit 1))), 'ok', 'changes a quantity');
select is(public.shop_forget(pg_temp.h('tok-e')), true, 'and forgets the device');
select is(pg_temp.events() - (select n from before_events), 0::bigint,
  'none of which writes an event (call 10)');
select is((select count(*) from public.shop_sessions s where to_jsonb(s)::text ~ '(Ava|Patel|code-)'), 0::bigint,
  'sessions hold no names or codes');

select * from finish();
rollback;
