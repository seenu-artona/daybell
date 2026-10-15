-- Selling at each job's own prices, and selling group photos (D157, D156 C5; ADR 0033): the shop offers what the job
-- sells (its list's items at its own prices, not the ones switched off, then its own products); a member of a group
-- buys its photos as a package, a print or a single download, a non-member and another studio can't; leaving a group
-- makes a bag line unavailable, never deletes it; the shop's prices, the bag and checkout agree to the cent for every
-- bag here; an order line names a list item or a job's product, with the contents of either; All digitals holds the
-- child's portraits, then their group photos; a sold group photo can't be binned, downloads and print files find it,
-- and its group counts the order; a child with group photos but no portrait stays unavailable (N7). Canadian studios:
-- money in CAD.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

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
create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.pid(n int) returns uuid language sql as $$
  select ('f0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
grant execute on all functions in schema pg_temp to authenticated;

-- Studio A: job 1 selling, home delivery only. Ava and Leo sing in the Choir (group photo 70); Noah plays in the Band
-- (group photo 71). Studio B: Bea, in B's group (group photo 76).
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall 2026', 'school', '2026-10-13', 'JOB00001'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-13', 'JOB00001');
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Ava', 'Patel', pg_temp.h('c1'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Noah', 'Patel', pg_temp.h('c2'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Leo', 'Chen', pg_temp.h('c4'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Zoe', 'Grey', pg_temp.h('c5'), 'v1.' || repeat('A', 48)),
  ('cb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 'Bea', 'Brown', pg_temp.h('cb1'), 'v1.' || repeat('A', 48));
insert into public.upload_batches (id, studio_id, job_id, created_by, kind) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'individual'),
  ('e1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'group'),
  ('eb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'individual'),
  ('eb000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'group');
-- Photos 1–2 of Ava, 3 of Noah, 4 of Leo, 6 of Bea; group photos 70 (Choir), 71 (Band), 76 (B's). Zoe has none of her
-- own.
create temp table fx (n int, batch text, child text) on commit drop;
insert into fx values
  (1, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  (2, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  (3, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002'),
  (4, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004'),
  (6, 'eb000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001'),
  (70, 'e1000000-0000-4000-8000-000000000002', null),
  (71, 'e1000000-0000-4000-8000-000000000002', null),
  (76, 'eb000000-0000-4000-8000-000000000002', null);
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, created_by)
select pg_temp.pid(f.n), b.studio_id, b.job_id, b.id, b.seq, 'ready', 'IMG_' || f.n || '.JPG', 1,
  extensions.digest(f.n::text, 'sha256'), 1200, 1500, 'none', b.created_by
from fx f join public.upload_batches b on b.id = f.batch::uuid;
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, source)
select pg_temp.pid(f.n), p.studio_id, p.job_id, case when f.child is null then 'group_photo' else 'child' end::public.photo_place,
  f.child::uuid, 'auto'
from fx f join public.photos p on p.id = pg_temp.pid(f.n);
insert into public.photo_groups (id, studio_id, job_id, name) values
  ('99000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Choir'),
  ('99000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Band'),
  ('99000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 'B group');
insert into public.photo_group_members (studio_id, job_id, group_id, child_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000005'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-0000000000b1', 'cb000000-0000-4000-8000-000000000001');
insert into public.photo_group_photos (studio_id, job_id, group_id, photo_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', pg_temp.pid(70)),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002', pg_temp.pid(71)),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-0000000000b1', pg_temp.pid(76));
update public.upload_batches set tagged_round = tag_round;

-- Job 1's own shop: Package A at $70 (the list says $85), the 8×10 print switched off, and two products of its own: a
-- Panorama print and a Sibling package (an 8×10 and the pose's download).
insert into public.job_price_overrides (studio_id, job_id, price_list_id, price_list_item_id, price_cents, sold)
select i.studio_id, j.id, i.price_list_id, i.id,
  case i.name when 'Package A' then 7000 end, i.name <> '8×10 print'
from public.price_list_items i join public.jobs j on j.price_list_id = i.price_list_id
where j.id = 'a0000000-0000-4000-8000-000000000001' and i.name in ('Package A', '8×10 print');
insert into public.job_shop_items (id, studio_id, job_id, kind, name, print_size, price_cents) values
  ('a5000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'print', 'Panorama', '11x14', 4500),
  ('a5000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'package', 'Sibling package', null, 9900);
insert into public.job_shop_package_lines (studio_id, job_id, job_item_id, line_kind, print_size, quantity, position)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000002', 'print', '8x10', 1, 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000002', 'digital', null, 1, 2);
update public.jobs set status = 'selling'
where id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001');

-- Active payouts for both studios (ADR 0020).
select public.create_payout_account(o.owner, o.studio, o.acct, false,
  '{"details_submitted": true, "charges_enabled": true, "payouts_enabled": true}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'active')
from (values ('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'acct_A1'),
             ('22222222-2222-4222-8222-222222222222'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'acct_B1'))
  o (owner, studio, acct);

-- Sessions: S1 holds Ava, S2 holds Noah, SB holds Bea.
insert into public.shop_sessions (id, studio_id, token_hash) values
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s1')),
  ('d1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s2')),
  ('db000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_temp.h('sb'));
insert into public.shop_session_children (session_id, studio_id, job_id, child_id)
select s.id::uuid, c.studio_id, c.job_id, c.id
from (values ('d1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
             ('d1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002'),
             ('db000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001')) s (id, child)
join public.children c on c.id = s.child::uuid;

-- What a job sells, by name: a list item's or the job's own product's id.
create function pg_temp.item(p_job uuid, p_name text) returns uuid language sql as $$
  select coalesce(
    (select o.item_id from app.job_offer(p_job) o where o.name = p_name),
    (select i.id from public.price_list_items i join public.jobs j on j.price_list_id = i.price_list_id
     where j.id = p_job and i.name = p_name)) $$;
create function pg_temp.add(p_session text, p_child uuid, p_name text, p_photo int, p_qty int default 1)
returns text language sql as $$
  select pg_temp.try(format('select public.shop_cart_add(%L, %L, %L, %L, %s)', pg_temp.h(p_session), p_child,
    pg_temp.item(c.job_id, p_name), case when p_photo is null then null else pg_temp.pid(p_photo) end, p_qty))
  from public.children c where c.id = p_child $$;
-- A bag's products total three ways: the shop's prices for each line's item, the bag's own lines, and checkout.
create function pg_temp.totals(p_session text) returns bigint[] language plpgsql as $$
declare
  v_cart jsonb := public.shop_cart(pg_temp.h(p_session));
  v_list bigint;
  v_bag bigint;
  v_checkout bigint;
begin
  select sum((p.item ->> 'price_cents')::bigint * (l ->> 'quantity')::int) into v_list
  from jsonb_array_elements(v_cart -> 'lines') l
  cross join lateral (select x as item from jsonb_array_elements(
    public.shop_price_list(pg_temp.h(p_session), (l ->> 'child_id')::uuid) -> 'items') x
    where x ->> 'id' = l ->> 'item_id') p;
  select sum((l ->> 'price_cents')::bigint * (l ->> 'quantity')::int) into v_bag
  from jsonb_array_elements(v_cart -> 'lines') l where (l ->> 'available')::boolean;
  v_checkout := (public.shop_checkout_begin(pg_temp.h(p_session)) ->> 'products_cents')::bigint;
  return array[v_list, v_bag, v_checkout];
end;
$$;
create function pg_temp.line_ok(p_session text, p_photo int) returns boolean[] language sql as $$
  select array_agg((l ->> 'available')::boolean order by l ->> 'id')
  from jsonb_array_elements(public.shop_cart(pg_temp.h(p_session)) -> 'lines') l
  where l ->> 'photo_id' = pg_temp.pid(p_photo)::text $$;
create temp table t (name text primary key, id uuid) on commit drop;

-- ── What the shop offers: the job's own prices and products ──────────────────────────────────────────────────────
select is((select array_agg(x ->> 'name') from jsonb_array_elements(
    public.shop_price_list(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001') -> 'items') x),
  array['Package A', 'Package B', 'Package C', 'Sibling package', '4×6 print', '5×7 print', '11×14 print',
    'Wallets (sheet of 8)', 'Panorama', 'Digital download', 'All digitals'],
  'the list''s items without the one switched off, the job''s own after the list''s in each group (N5)');
select is((select (x ->> 'price_cents')::int from jsonb_array_elements(
    public.shop_price_list(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001') -> 'items') x
  where x ->> 'name' = 'Package A'), 7000, 'Package A at the job''s price, not the list''s');
select is((select x -> 'contents' from jsonb_array_elements(
    public.shop_price_list(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001') -> 'items') x
  where x ->> 'name' = 'Sibling package'),
  '[{"kind": "print", "quantity": 1, "print_size": "8x10"}, {"kind": "digital", "quantity": 1, "print_size": null}]'::jsonb,
  'the job''s own package with its own contents');

-- ── Group photos as poses (D156 C5) ───────────────────────────────────────────────────────────────────────────────
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'Package A', 70), 'ok',
  'Ava buys Package A with her Choir''s group photo');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', '5×7 print', 70, 2), 'ok',
  'two 5×7 prints of it');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'Digital download', 70), 'ok',
  'and its single download');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'Panorama', 1), 'ok',
  'the job''s own print with her portrait');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'Sibling package', 2), 'ok',
  'and its own package');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'Package A', 70), 'ok', 'Package A again');
select is((select quantity from public.shop_cart_lines l where l.kind = 'package' and l.photo_id = pg_temp.pid(70)), 2,
  'is one line of 2');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'Panorama', 1), 'ok', 'the Panorama again');
select is((select quantity from public.shop_cart_lines l where l.job_item_id = 'a5000000-0000-4000-8000-000000000001'),
  2, 'is one line of 2 too');
select is((select (item_id is null, price_list_id is null, job_item_id)::text from public.shop_cart_lines l
           where l.job_item_id is not null and l.kind = 'print'),
  (true, true, 'a5000000-0000-4000-8000-000000000001'::uuid)::text, 'a job''s product is named by its own id only');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', '8×10 print', 1), 'P0001 item_unavailable',
  'an item switched off for the job can''t be bought');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', '5×7 print', 71), 'P0001 photo_unavailable',
  'nor another group''s photo');
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', '5×7 print', 3), 'P0001 photo_unavailable',
  'nor her schoolmate''s portrait');
select is(pg_temp.add('s2', 'c0000000-0000-4000-8000-000000000002', '5×7 print', 70), 'P0001 photo_unavailable',
  'Noah isn''t in the Choir, so he can''t buy its photo');
select is(pg_temp.add('s2', 'c0000000-0000-4000-8000-000000000002', '5×7 print', 71), 'ok', 'but his Band''s, yes');
select is(pg_temp.add('sb', 'cb000000-0000-4000-8000-000000000001', '5×7 print', 70), 'P0001 photo_unavailable',
  'another studio''s bag can''t take A''s group photo');
select is(pg_temp.try(format('select public.shop_cart_add(%L, %L, %L, %L, 1)', pg_temp.h('sb'),
  'cb000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', pg_temp.pid(6))),
  'P0001 item_unavailable', 'nor A''s job''s own product');
select is(pg_temp.add('sb', 'cb000000-0000-4000-8000-000000000001', '5×7 print', 76), 'ok',
  'Bea buys her own group''s photo');

-- ── The bag, priced through the resolver ──────────────────────────────────────────────────────────────────────────
select is((select jsonb_build_object('item', x ->> 'item_id', 'price', x -> 'price_cents', 'currency', x ->> 'currency',
    'physical', x -> 'physical') from jsonb_array_elements(public.shop_cart(pg_temp.h('s1')) -> 'lines') x
  where x ->> 'name' = 'Panorama'),
  '{"item": "a5000000-0000-4000-8000-000000000001", "price": 4500, "currency": "CAD", "physical": true}'::jsonb,
  'the job''s print in the bag: its own id and price, in CAD');
select is((select (x -> 'physical')::boolean from jsonb_array_elements(public.shop_cart(pg_temp.h('s1')) -> 'lines') x
  where x ->> 'name' = 'Sibling package'), true, 'the job''s package needs delivery (its own contents)');
select is((select (x -> 'price_cents')::int from jsonb_array_elements(public.shop_cart(pg_temp.h('s1')) -> 'lines') x
  where x ->> 'name' = 'Package A'), 7000, 'Package A at the job''s price');

-- The shop's prices, the bag and checkout agree to the cent, for every bag here.
select is(pg_temp.totals('s1'), array[40000, 40000, 40000]::bigint[],
  'Ava''s bag: 2 × 7000 + 2 × 1900 + 3300 + 2 × 4500 + 9900, the same three ways');
select is(pg_temp.totals('s2'), array[1900, 1900, 1900]::bigint[], 'Noah''s bag, the same three ways');
select is(pg_temp.totals('sb'), array[1900, 1900, 1900]::bigint[], 'Bea''s bag (studio B), the same three ways');

-- ── Leaving a group, or a product switched off, makes a line unavailable, never deleted ───────────────────────────
delete from public.photo_group_members
where group_id = '99000000-0000-4000-8000-000000000001' and child_id = 'c0000000-0000-4000-8000-000000000001';
select is(pg_temp.line_ok('s1', 70), array[false, false, false],
  'Ava left the Choir: her three lines with its photo can''t be bought');
select is((select count(*) from public.shop_cart_lines where session_id = 'd1000000-0000-4000-8000-000000000001'),
  5::bigint, 'and are still in her bag');
select is(pg_temp.try(format('select public.shop_cart_set_quantity(%L, %L, 3)', pg_temp.h('s1'),
  (select id from public.shop_cart_lines where kind = 'package' and photo_id = pg_temp.pid(70)))),
  'P0001 photo_unavailable', 'their quantities are fixed');
select is(pg_temp.try($$ select public.shop_checkout_begin(pg_temp.h('s1')) $$), 'P0001 line_unavailable',
  'and checkout asks her to remove them first');
insert into public.photo_group_members (studio_id, job_id, group_id, child_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
select is(pg_temp.line_ok('s1', 70), array[true, true, true], 'back in the Choir, they can be bought again');
update public.job_shop_items set sold = false where id = 'a5000000-0000-4000-8000-000000000001';
select is(pg_temp.try(format('select public.shop_cart_set_quantity(%L, %L, 3)', pg_temp.h('s1'),
  (select id from public.shop_cart_lines where job_item_id = 'a5000000-0000-4000-8000-000000000001'))),
  'P0001 item_unavailable', 'a job''s product switched off can''t be bought from the bag');
update public.job_shop_items set sold = true where id = 'a5000000-0000-4000-8000-000000000001';

-- ── Paying: order lines as sold, All digitals with group photos ───────────────────────────────────────────────────
select is(pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'All digitals', null), 'ok',
  'Ava adds All digitals');
insert into t values ('o1', (public.shop_checkout_begin(pg_temp.h('s1')) ->> 'order_id')::uuid);
select is((select (unit_price_cents, price_list_item_id is null, job_item_id)::text from public.order_lines
           where order_id = (select id from t where name = 'o1') and name = 'Panorama'),
  (4500, true, 'a5000000-0000-4000-8000-000000000001'::uuid)::text,
  'the order line copies the job''s print: its price and its own id, no list item');
select is((select unit_price_cents from public.order_lines
           where order_id = (select id from t where name = 'o1') and name = 'Package A'), 7000::bigint,
  'Package A at the job''s price');
select is((select count(*) from public.order_lines ol join public.order_line_contents c on c.order_line_id = ol.id
           where ol.order_id = (select id from t where name = 'o1') and ol.name = 'Sibling package'), 2::bigint,
  'the job''s package with its own contents');
select is((select count(*) from public.order_lines ol join public.order_line_contents c on c.order_line_id = ol.id
           where ol.order_id = (select id from t where name = 'o1') and ol.name = 'Package A'), 4::bigint,
  'and the list''s package with the list''s');
select lives_ok($$ select public.shop_checkout_attach(pg_temp.h('s1'), (select id from t where name = 'o1'),
  'cs_test_group_1', now() + interval '30 minutes') $$, 'Stripe''s checkout is attached');
select is(public.complete_order((select id from t where name = 'o1'), (select jsonb_build_object(
    'checkout_session_id', o.checkout_session_id, 'payment_intent_id', 'pi_' || md5(o.id::text),
    'charge_id', 'ch_' || md5(o.id::text), 'transfer_id', 'tr_' || md5(o.id::text), 'livemode', false,
    'currency', 'cad', 'amount_subtotal', o.products_cents, 'amount_shipping', o.shipping_cents, 'amount_tax', 0,
    'amount_total', o.products_cents + o.shipping_cents, 'destination', o.stripe_account_id,
    'on_behalf_of', o.stripe_account_id, 'application_fee_amount', o.daybell_fee_cents,
    'shipping', jsonb_build_object('name', 'Priya Patel', 'line1', '12 Maple Lane', 'line2', null,
      'city', 'Toronto', 'state', 'ON', 'postal_code', 'M5V 2T6', 'country', 'CA'))
  from public.orders o where o.id = (select id from t where name = 'o1'))), 'paid', 'Stripe took the money');
select is((select array_agg(lp.photo_id order by lp.position) from public.order_line_photos lp
           join public.order_lines ol on ol.id = lp.order_line_id
           where ol.order_id = (select id from t where name = 'o1')),
  array[pg_temp.pid(1), pg_temp.pid(2), pg_temp.pid(70)],
  'All digitals is fixed to her portraits, then her group''s photo (N6)');
select is((select count(*) from public.shop_cart_lines where session_id = 'd1000000-0000-4000-8000-000000000001'),
  0::bigint, 'what was bought leaves the bag, the job''s products too');
select isnt((select sold_at from public.photos where id = pg_temp.pid(70)), null, 'the group photo is sold');
select is(pg_temp.try($$ select public.bin_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.pid(70)]) $$), 'P0001 photo_sold',
  'so it can''t be binned');
select ok(public.order_downloads_to_make((select id from t where name = 'o1')) @> jsonb_build_array(pg_temp.pid(70)),
  'its download file is asked for');
select is(public.shop_download_photo(pg_temp.h('s1'), (select id from t where name = 'o1'), pg_temp.pid(70)) ->> 'photo_id',
  pg_temp.pid(70)::text, 'the parent can download it, by photo id as before');
select is((select count(*) from jsonb_array_elements(public.order_print_files('11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t where name = 'o1')) -> 'files') f
  where f ->> 'photo_id' = pg_temp.pid(70)::text), 2::bigint,
  'the studio''s print files hold it for Package A and the 5×7 prints');
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select is((select x ->> 'ordered' from jsonb_array_elements(
    public.list_photo_groups('a0000000-0000-4000-8000-000000000001') -> 'groups') x where x ->> 'name' = 'Choir'),
  '1', 'the Choir counts the paid order (ADR 0030 C16)');
reset role;

-- ── N7: group photos alone don't open a gallery ───────────────────────────────────────────────────────────────────
select is(app.shop_child_state('c0000000-0000-4000-8000-000000000005'), 'unavailable',
  'Zoe is in the Choir but has no portrait: her gallery stays unavailable (N7)');

select * from finish();
rollback;
