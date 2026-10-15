-- Checkout (D59, D96, D97, D98, D104, D106, D24, D113; Seenu's answers 1–4, Claude's calls 1–20; ADR 0023): the bag
-- becomes an order priced from the job's current list, never the browser; every refusal is named; the same bag reuses
-- its checkout and a changed bag replaces it; Daybell's fee rate is a setting copied into each order, never changed
-- afterwards; Stripe's answer is checked against the snapshot and paid once; the ledger is written once, balanced, in
-- CAD; checkout events are recorded once; parents see an order only from the session that paid or with its children
-- (their lines only, no amounts, otherwise); downloads only for paid digital lines a session may see; owners and admins
-- read orders, nobody else, and another studio sees nothing; tax registrations are the owner's; nothing personal goes
-- in an event. Review fixes: a replaced checkout stays in the list to close at Stripe until Stripe says it is closed
-- (code M2); the recipient's text is cleaned so it can't fail its check (security M3); the cron backs off and never
-- retries a problem (S1/M4); Pay asks Stripe at most every 3 seconds (S2); an event for another checkout is recorded as
-- a permanent mismatch (S3); downloads are asked for at most every 5 minutes and 3 times (S4/S5); only the database
-- owner changes the fee, and who did is kept (S1); the merchant of record is checked (N5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(194);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Maple Lane Photography', 'studio-a', 'ca'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'ca');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'admin');

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
grant execute on function pg_temp.as_user(uuid) to authenticated, anon;

-- Studio A: job 1 selling (delivers to school), job 2 a draft. Studio B: job 1 selling.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall 2026', 'school', '2026-10-13', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Draft', 'school', '2026-10-14', 'JOB00002'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-13', 'JOB00001');
update public.jobs set deliver_to_school = true where id = 'a0000000-0000-4000-8000-000000000001';
-- c1 Ava and c2 Noah (job 1), c3 Mia (the draft), cb Bea (studio B).
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Ava', 'Patel', pg_temp.h('c1'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Noah', 'Patel', pg_temp.h('c2'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 'Mia', 'Lee', pg_temp.h('c3'), 'v1.' || repeat('A', 48)),
  ('cb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 'Bea', 'Brown', pg_temp.h('cb1'), 'v1.' || repeat('A', 48));
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('e1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111'),
  ('eb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222');
-- Photos 1–3 of Ava, 4 of Noah, 5 of Mia, 6 of Bea; all ready and tagged.
create temp table fx (n int, batch text, child text) on commit drop;
insert into fx values
  (1, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  (2, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  (3, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  (4, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002'),
  (5, 'e1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003'),
  (6, 'eb000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001');
create function pg_temp.pid(n int) returns uuid language sql as $$
  select ('f0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, created_by)
select pg_temp.pid(f.n), b.studio_id, b.job_id, b.id, b.seq, 'ready', 'IMG_' || f.n || '.JPG', 1,
  extensions.digest(f.n::text, 'sha256'), 1200, 1500, 'none', b.created_by
from fx f join public.upload_batches b on b.id = f.batch::uuid;
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, source)
select pg_temp.pid(f.n), p.studio_id, p.job_id, 'child', f.child::uuid, 'auto'
from fx f join public.photos p on p.id = pg_temp.pid(f.n);
-- Photo 70: a group photo Ava sees through her group (ADR 0030); part of her all digitals, after her portraits (D156
-- C5, ADR 0033 N6).
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, created_by)
select pg_temp.pid(70), b.studio_id, b.job_id, b.id, b.seq, 'ready', 'IMG_70.JPG', 1, extensions.digest('70', 'sha256'),
  1200, 1500, 'none', b.created_by
from public.upload_batches b where b.id = 'e1000000-0000-4000-8000-000000000001';
insert into public.photo_tags (photo_id, studio_id, job_id, place, source) values
  (pg_temp.pid(70), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'group_photo', 'auto');
insert into public.photo_groups (id, studio_id, job_id, name) values
  ('99000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Choir');
insert into public.photo_group_members (studio_id, job_id, group_id, child_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   '99000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
insert into public.photo_group_photos (studio_id, job_id, group_id, photo_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   '99000000-0000-4000-8000-000000000001', pg_temp.pid(70));
update public.upload_batches set tagged_round = tag_round;
update public.jobs set status = 'selling'
where id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001');

-- Active payouts for both studios (ADR 0020), as Stripe's webhook would copy them.
select public.create_payout_account(o.owner, o.studio, o.acct, false,
  '{"details_submitted": true, "charges_enabled": true, "payouts_enabled": true}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'active')
from (values ('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'acct_A1'),
             ('22222222-2222-4222-8222-222222222222'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'acct_B1'))
  o (owner, studio, acct);

-- Shop sessions: S1 holds Ava and Noah (the payer); S2 holds Ava only (the other parent, with Ava's card); S3 holds
-- both (a third device); SB is studio B's with Bea.
insert into public.shop_sessions (id, studio_id, token_hash) values
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s1')),
  ('d1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s2')),
  ('d1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s3')),
  ('db000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_temp.h('sb'));
insert into public.shop_session_children (session_id, studio_id, job_id, child_id)
select s.id::uuid, s.studio::uuid, c.job_id, c.id
from (values ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-000000000001'),
             ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-000000000002'),
             ('d1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-000000000001'),
             ('d1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-000000000001'),
             ('d1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-000000000002'),
             ('db000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cb000000-0000-4000-8000-000000000001'))
  s (id, studio, child)
join public.children c on c.id = s.child::uuid;

create function pg_temp.item(p_job uuid, p_kind text, p_name text default null) returns uuid language sql as $$
  select i.id from public.price_list_items i join public.jobs j on j.price_list_id = i.price_list_id
  where j.id = p_job and i.kind::text = p_kind and (p_name is null or i.name = p_name) order by i.position limit 1 $$;
-- Adds to a bag as separate requests would: each line a moment after the last (the bag's order).
create function pg_temp.add(p_session text, p_child uuid, p_kind text, p_name text, p_photo int, p_qty int)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  select public.shop_cart_add(pg_temp.h(p_session), p_child, pg_temp.item(c.job_id, p_kind, p_name),
    case when p_photo is null then null else pg_temp.pid(p_photo) end, p_qty)
  into v_id from public.children c where c.id = p_child;
  update public.shop_cart_lines set created_at = clock_timestamp() where id = v_id;
  return v_id;
end;
$$;
create function pg_temp.begin_(p_session text) returns jsonb language sql as $$
  select public.shop_checkout_begin(pg_temp.h(p_session)) $$;
-- Stripe's facts for an order as its checkout would report them, with `over` replacing any of them.
create function pg_temp.facts(p_order uuid, p_tax bigint, p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('checkout_session_id', o.checkout_session_id, 'payment_intent_id', 'pi_' || md5(o.id::text),
    'charge_id', 'ch_' || md5(o.id::text), 'transfer_id', 'tr_' || md5(o.id::text), 'livemode', false,
    'currency', 'cad', 'amount_subtotal', o.products_cents, 'amount_shipping', o.shipping_cents, 'amount_tax', p_tax,
    'amount_total', o.products_cents + o.shipping_cents + p_tax, 'destination', o.stripe_account_id,
    'on_behalf_of', o.stripe_account_id, 'application_fee_amount', o.daybell_fee_cents,
    'shipping', jsonb_build_object('name', 'Priya Patel', 'line1', '12 Maple Lane', 'line2', null,
      'city', 'Toronto', 'state', 'ON', 'postal_code', 'M5V 2T6', 'country', 'CA')) || p_over
  from public.orders o where o.id = p_order $$;
create temp table t (name text primary key, id uuid, txt text) on commit drop;
grant all on t to authenticated;
create function pg_temp.v(p_name text) returns uuid language sql as $$ select id from t where name = p_name $$;
grant execute on function pg_temp.v(text) to authenticated;
create function pg_temp.events(p_type text) returns bigint language sql as $$
  select count(*) from public.events where type = p_type $$;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relrowsecurity and c.relname in ('orders', 'order_lines', 'order_line_contents',
    'order_line_photos', 'order_shipping_addresses', 'ledger_transactions', 'studio_tax_registrations',
    'studio_tax_settings', 'photo_download_requests')), 9::bigint, 'every new table has row-level security on');
select is((select count(*) from pg_policies where tablename in ('orders', 'order_lines', 'order_line_contents',
    'order_line_photos', 'order_shipping_addresses', 'ledger_transactions', 'studio_tax_registrations',
    'studio_tax_settings') and cmd <> 'SELECT'), 0::bigint, 'with read policies only: nobody signed in writes');
select is((select count(*) from unnest(array['public.orders', 'public.order_lines', 'public.order_line_contents',
    'public.order_line_photos', 'public.order_shipping_addresses', 'public.ledger_transactions',
    'public.studio_tax_registrations', 'public.studio_tax_settings', 'public.photo_download_requests']) tb,
  unnest(array['anon', 'authenticated']) r
  where has_table_privilege(r, tb, 'insert') or has_table_privilege(r, tb, 'update')
     or has_table_privilege(r, tb, 'delete')), 0::bigint, 'browsers can''t insert, update or delete any of them');
select ok(not has_table_privilege('authenticated', 'public.photo_download_requests', 'select')
  and not has_table_privilege('anon', 'public.photo_download_requests', 'select'),
  'nor read which photos'' downloads were asked for');
select ok(not has_column_privilege('authenticated', 'public.orders', 'shop_session_id', 'select'),
  'nobody signed in reads which shop session paid');
select is((select count(*) from unnest(array['app.platform_settings', 'app.platform_settings_changes']) tb,
  unnest(array['anon', 'authenticated', 'service_role']) r
  where has_table_privilege(r, tb, 'select') or has_table_privilege(r, tb, 'update')), 0::bigint,
  'the platform settings are reachable through their functions only');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where proname in ('shop_checkout_begin', 'shop_checkout_attach', 'shop_pending_checkouts', 'complete_order',
    'expire_order', 'settle_order_fees', 'record_order_stripe_event', 'shop_orders', 'shop_order',
    'shop_order_verify', 'shop_download_photo', 'stale_checkouts', 'unsettled_orders', 'set_platform_fee',
    'set_card_fee_recovery', 'platform_fee_settings', 'set_tax_head_office', 'add_tax_registration',
    'end_tax_registration', 'mark_card_prefix_set', 'shop_order_view', 'shop_order_lines', 'order_line_downloads',
    'guard_order', 'new_order_reference', 'note_checkout_failure', 'shop_download_request',
    'order_downloads_to_make', 'claim_download_request')),
  'every checkout function is SECURITY DEFINER with an empty search_path');
create temp table system_fns on commit drop as select unnest(array[
  'public.shop_checkout_begin(text)', 'public.shop_checkout_attach(text, uuid, text, timestamptz)',
  'public.shop_pending_checkouts(text)', 'public.complete_order(uuid, jsonb)', 'public.expire_order(uuid)',
  'public.settle_order_fees(uuid, text, bigint, text, text, text)',
  'public.record_order_stripe_event(text, text, uuid, text, boolean, timestamptz)', 'public.shop_orders(text)',
  'public.shop_order(text, uuid)', 'public.shop_order_verify(text, uuid)',
  'public.shop_download_photo(text, uuid, uuid)', 'public.stale_checkouts(integer)',
  'public.unsettled_orders(integer)', 'public.set_tax_head_office(uuid, uuid, text)',
  'public.add_tax_registration(uuid, uuid, public.tax_registration_kind, text, text, text)',
  'public.end_tax_registration(uuid, uuid, uuid)', 'public.mark_card_prefix_set(text)',
  'public.note_checkout_failure(uuid, text, boolean)', 'public.shop_download_request(text, uuid, uuid)',
  'public.order_downloads_to_make(uuid)']) as f;
select is((select count(*) from system_fns, unnest(array['anon', 'authenticated']) r
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'browsers and logged-out visitors run none of them');
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')) from system_fns),
  'the service role (the API) runs them all');
select is((select count(*) from unnest(array['public.set_platform_fee(integer, text)',
    'public.set_card_fee_recovery(public.card_fee_recovery, text)']) f,
  unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, f, 'execute')), 0::bigint,
  'only the database owner changes Daybell''s fee or its recovery: not even the service role (security S1)');
select ok(has_function_privilege('authenticated', 'public.job_orders(uuid, uuid, integer, uuid)', 'execute')
  and not (select prosecdef from pg_proc where proname = 'job_orders')
  and not (select prosecdef from pg_proc where proname = 'studio_order'),
  'the studio''s order reads are SECURITY INVOKER: row-level security decides');
select is((select count(*) from information_schema.columns where table_schema = 'public'
  and table_name in ('orders', 'order_lines', 'order_line_contents', 'order_line_photos', 'ledger_transactions')
  and column_name ~ '(email|first_name|last_name|address|access_code|phone|card_number|last4)'), 0::bigint,
  'orders keep no email, name, address, code or card (the recipient is in its own table)');
select is((select data_type from information_schema.columns where table_name = 'orders' and column_name = 'total_cents'),
  'bigint', 'money is whole cents');

-- ── Platform settings (Seenu, answer 1) ───────────────────────────────────────────────────────────────────────────
select is(public.platform_fee_settings(), '{"daybell_fee_bps": 300, "card_fee_recovery": "per_sale"}'::jsonb,
  'Daybell''s fee starts at 3%, recovered per sale');
select is(pg_temp.try($$ select public.set_platform_fee(2001, 'too much') $$), '22023 The fee is 0 to 2000 basis points',
  'the fee is at most 20% (call 16)');
select is(pg_temp.try($$ select public.set_platform_fee(300, '') $$),
  '22023 Say why in a note of 1 to 200 characters', 'a change needs a note');
select ok(pg_temp.try($$ select public.set_card_fee_recovery('monthly', 'later') $$) like '23514%',
  'monthly card fee recovery isn''t built yet, so it is refused');

-- ── Taxes (answer 2; calls 3, 6) ──────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.try($$ select public.add_tax_registration('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gst_hst', null, '123456789RT0001', 'taxreg_A1') $$),
  'P0001 head_office_required', 'a registration needs the business address first (call 3)');
select is(pg_temp.try($$ select public.set_tax_head_office('55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ON') $$), '42501 Owners only', 'an admin can''t set it (call 6)');
select is(pg_temp.try($$ select public.set_tax_head_office('22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ON') $$), '42501 Owners, admins and photographers only',
  'nor another studio''s owner');
select lives_ok($$ select public.set_tax_head_office('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'on') $$, 'the owner sets the head office');
select ok(pg_temp.try($$ select public.add_tax_registration('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gst_hst', null, '12345678RT0001', 'taxreg_A0') $$) like '23514%',
  'a GST/HST number is 9 digits, RT and 4 digits');
insert into t (name, id) select 'gst', public.add_tax_registration('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gst_hst', null, '123456789RT0001', 'taxreg_A1');
select is(pg_temp.try($$ select public.add_tax_registration('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gst_hst', null, '987654321RT0001', 'taxreg_A2') $$),
  'P0001 already_registered', 'one active GST/HST registration at a time');
select is(pg_temp.try($$ select public.add_tax_registration('55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pst', 'BC', 'PST-1234-5678', 'taxreg_A3') $$), '42501 Owners only',
  'an admin can''t add one');
select ok(pg_temp.try($$ select public.add_tax_registration('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pst', null, 'PST-1234-5678', 'taxreg_A3') $$) like '23514%',
  'a PST registration names its province');
select lives_ok($$ select public.add_tax_registration('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pst', 'bc', 'PST-1234-5678', 'taxreg_A3') $$, 'BC PST is added');
select lives_ok($$ select public.end_tax_registration('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from public.studio_tax_registrations
  where stripe_registration_id = 'taxreg_A3')) $$, 'and ended');
select is(pg_temp.try($$ select public.end_tax_registration('22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_temp.v('gst')) $$), 'P0002 not_found',
  'another studio''s owner can''t end A''s registration');
select ok(pg_temp.try($$ update public.studio_tax_registrations set number = '111111111RT0001' $$) like '23514%',
  'a registration''s number never changes');
select is((select count(*) from public.events where type like 'tax_%'
  and (data::text ~ '[0-9]{9}' or data::text like '%PST-%')), 0::bigint, 'tax events never carry a number');
select is((select array_agg(type order by id)::text from public.events where type like 'tax_%'),
  '{tax_settings.updated,tax_registration.added,tax_registration.added,tax_registration.ended}',
  'each tax change writes an event');

-- ── Starting checkout: refusals ───────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.try($$ select pg_temp.begin_('s1') $$), 'P0001 bag_empty', 'an empty bag can''t be paid for');
-- S1's bag: Package A (Ava, photo 1), two 4×6 prints (Noah, photo 4), a download (Ava, photo 2), all of Ava's digitals.
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'package', 'Package A', 1, 1);
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000002', 'print', '4×6 print', 4, 2);
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'digital_single', null, 2, 1);
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'digital_all', null, null, 1);
select is(pg_temp.try($$ select pg_temp.begin_('s1') $$), 'P0001 choose_delivery',
  'prints with school delivery offered: the parent chooses first');
select public.shop_set_shipping(pg_temp.h('s1'), 'home');
update public.payout_accounts set status = 'restricted' where stripe_account_id = 'acct_A1';
select is(pg_temp.try($$ select pg_temp.begin_('s1') $$), 'P0001 not_accepting',
  'a studio whose payouts aren''t Active takes no payments');
update public.payout_accounts set status = 'active' where stripe_account_id = 'acct_A1';
update public.photos set binned_at = now(), binned_by = created_by where id = pg_temp.pid(2);
select is(pg_temp.try($$ select pg_temp.begin_('s1') $$), 'P0001 line_unavailable',
  'a line that can''t be bought any more must be removed first');
update public.photos set binned_at = null, binned_by = null where id = pg_temp.pid(2);
-- The bin re-queues the batch's tagging (ADR 0018); tagged again, the photo shows.
update public.upload_batches set tagged_round = tag_round;
update public.jobs set closes_at = null, status = 'closed' where id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$ select pg_temp.begin_('s1') $$), 'P0001 shop_closed', 'a closed shop takes no payments');
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$ select pg_temp.begin_('sb') $$), 'P0001 bag_empty', 'studio B''s session sees none of A''s bag');
select is(pg_temp.try($$ select public.shop_checkout_begin(repeat('0', 64)) $$), 'P0001 session_required',
  'an unknown session is refused');

-- ── Starting checkout: the order ──────────────────────────────────────────────────────────────────────────────────
insert into t (name, id) select 'o1', (pg_temp.begin_('s1') ->> 'order_id')::uuid;
select results_eq($$ select status::text, currency::text, shipping_method::text, products_cents, shipping_cents,
    daybell_fee_bps, daybell_fee_cents, tax_enabled, stripe_account_id from public.orders where id = pg_temp.v('o1') $$,
  $$ values ('pending', 'CAD', 'home', 22300::bigint, 1195::bigint, 300, 669::bigint, true, 'acct_A1') $$,
  'the order: priced from the job''s list (85 + 2 × 13 + 33 + 79), home shipping, 3% of products only, tax on');
select results_eq($$ select position, kind::text, name, unit_price_cents, quantity, line_total_cents, child_id,
    photo_id from public.order_lines where order_id = pg_temp.v('o1') order by position $$,
  $$ values (1, 'package', 'Package A', 8500::bigint, 1, 8500::bigint, 'c0000000-0000-4000-8000-000000000001'::uuid, pg_temp.pid(1)),
            (2, 'digital_single', 'Digital download', 3300::bigint, 1, 3300::bigint, 'c0000000-0000-4000-8000-000000000001'::uuid, pg_temp.pid(2)),
            (3, 'digital_all', 'All digitals', 7900::bigint, 1, 7900::bigint, 'c0000000-0000-4000-8000-000000000001'::uuid, null::uuid),
            (4, 'print', '4×6 print', 1300::bigint, 2, 2600::bigint, 'c0000000-0000-4000-8000-000000000002'::uuid, pg_temp.pid(4)) $$,
  'each line is copied as sold, by child as in the bag');
select results_eq($$ select c.line_kind::text, c.print_size::text, c.quantity from public.order_line_contents c
    join public.order_lines l on l.id = c.order_line_id where l.order_id = pg_temp.v('o1') order by c.position $$,
  $$ values ('print', '8x10', 1), ('print', '5x7', 2), ('print', 'wallets_8', 1), ('digital', null, 1) $$,
  'with the package''s contents as sold');
select ok((select reference ~ '^[0-9A-HJKMNP-TV-Z]{8}$' from public.orders where id = pg_temp.v('o1')),
  'a reference of 8 Crockford base32 characters');
select is((pg_temp.begin_('s1') ->> 'order_id')::uuid, pg_temp.v('o1'), 'the same bag again reuses the order');
select is((select count(*) from public.orders), 1::bigint, 'and makes no other');
update public.price_list_items set price_cents = 9999 where id = pg_temp.item('a0000000-0000-4000-8000-000000000001',
  'package', 'Package A');
select is((select unit_price_cents from public.order_lines where order_id = pg_temp.v('o1') and position = 1),
  8500::bigint, 'a later price change leaves the order alone');
update public.price_list_items set price_cents = 8500 where id = pg_temp.item('a0000000-0000-4000-8000-000000000001',
  'package', 'Package A');
select is(pg_temp.try($$ select pg_temp.begin_('s1') $$), 'ok', 'the price back, the bag is the same again');
select is((select count(*) from public.orders), 1::bigint, 'so the same order is reused');

-- Attaching Stripe's checkout.
select lives_ok($$ select public.shop_checkout_attach(pg_temp.h('s1'), pg_temp.v('o1'), 'cs_test_O1',
  now() + interval '30 minutes') $$, 'the checkout is attached');
select lives_ok($$ select public.shop_checkout_attach(pg_temp.h('s1'), pg_temp.v('o1'), 'cs_test_O1',
  now() + interval '30 minutes') $$, 'the same one again is fine');
select is(pg_temp.try($$ select public.shop_checkout_attach(pg_temp.h('s1'), pg_temp.v('o1'), 'cs_test_OTHER',
  now() + interval '30 minutes') $$), 'P0001 checkout_attached', 'another is refused');
select is(pg_temp.try($$ select public.shop_checkout_attach(pg_temp.h('s2'), pg_temp.v('o1'), 'cs_test_O1',
  now() + interval '30 minutes') $$), 'P0002 Order not found', 'another session can''t attach to it');
select is(pg_temp.begin_('s1') ->> 'checkout_session_id', 'cs_test_O1', 'a reused order brings its open checkout');

-- A changed bag replaces the order: the old one expires and its checkout is named for the API to expire at Stripe.
select public.shop_cart_set_quantity(pg_temp.h('s1'), (select id from public.shop_cart_lines
  where session_id = 'd1000000-0000-4000-8000-000000000001' and kind = 'print'), 1);
insert into t (name, txt) select 'begin2', pg_temp.begin_('s1')::text;
insert into t (name, id) select 'o2', ((select txt from t where name = 'begin2')::jsonb ->> 'order_id')::uuid;
select isnt(pg_temp.v('o2'), pg_temp.v('o1'), 'a changed bag makes a new order');
select is((select status::text from public.orders where id = pg_temp.v('o1')), 'expired', 'the old one expires');
select is((select txt from t where name = 'begin2')::jsonb -> 'superseded',
  jsonb_build_array(jsonb_build_object('order_id', pg_temp.v('o1'), 'checkout_session_id', 'cs_test_O1')),
  'and its checkout is handed back to be closed at Stripe');
select is((select stripe_closed_at from public.orders where id = pg_temp.v('o1')), null,
  'it isn''t closed at Stripe until Stripe says so');
-- Stripe failed to close it (code M2): a second Pay of the same bag reuses the new order and hands the old one back again.
insert into t (name, txt) select 'begin3', pg_temp.begin_('s1')::text;
select is(((select txt from t where name = 'begin3')::jsonb ->> 'order_id')::uuid, pg_temp.v('o2'),
  'a retried Pay reuses the order not yet sent to Stripe');
select is((select txt from t where name = 'begin3')::jsonb -> 'superseded',
  jsonb_build_array(jsonb_build_object('order_id', pg_temp.v('o1'), 'checkout_session_id', 'cs_test_O1')),
  'and still hands back the checkout Stripe hasn''t closed, so it is never left payable');
select is(((select txt from t where name = 'begin3')::jsonb ->> 'stripe_check')::boolean, true,
  'the first reuse may ask Stripe');
select is((pg_temp.begin_('s1') ->> 'stripe_check')::boolean, false,
  'another within 3 seconds may not: one code can''t use up Stripe''s rate limit (security S2)');
select is((select jsonb_agg(x ->> 'order_id' order by x ->> 'order_id') from jsonb_array_elements(
  public.shop_pending_checkouts(pg_temp.h('s1'))) x),
  (select jsonb_agg(id::text order by id::text) from public.orders where id in (pg_temp.v('o1'), pg_temp.v('o2'))),
  '"Payment canceled" closes it too, with the pending one');
select is(public.expire_order(pg_temp.v('o1')), false, 'once Stripe has closed it, it stays expired');
select ok((select stripe_closed_at is not null from public.orders where id = pg_temp.v('o1')),
  'and is marked closed at Stripe');
select is(pg_temp.begin_('s1') -> 'superseded', '[]'::jsonb, 'so it is never handed back again');
select ok(pg_temp.try(format($$ update public.orders set stripe_closed_at = now() - interval '1 day' where id = %L $$,
  pg_temp.v('o1'))) like '23514%', 'and when it was closed never changes');
select is((select products_cents from public.orders where id = pg_temp.v('o2')), 21000::bigint,
  'the new order has the new quantity');
select is(pg_temp.try($$ select public.shop_checkout_attach(pg_temp.h('s1'), pg_temp.v('o1'), 'cs_test_O9',
  now() + interval '30 minutes') $$), 'P0002 Order not found', 'an expired order takes no checkout');

-- The fee setting applies to new orders only.
select lives_ok($$ select public.set_platform_fee(350, 'Test: 3.5%') $$, 'the fee is changed to 3.5%');
select is((select count(*) from app.platform_settings_changes where setting = 'daybell_fee_bps'
  and old_value = '300' and new_value = '350'), 1::bigint, 'and the change is kept');
select is((select changed_by from app.platform_settings_changes where setting = 'daybell_fee_bps'
  and new_value = '350'), session_user::text, 'with the database role that made it (security S1)');
select public.shop_cart_set_quantity(pg_temp.h('s1'), (select id from public.shop_cart_lines
  where session_id = 'd1000000-0000-4000-8000-000000000001' and kind = 'print'), 2);
insert into t (name, id) select 'o3', (pg_temp.begin_('s1') ->> 'order_id')::uuid;
select results_eq($$ select daybell_fee_bps, daybell_fee_cents from public.orders where id = pg_temp.v('o3') $$,
  $$ values (350, 781::bigint) $$, 'a new order uses 3.5%, half up (22,300 × 3.5% = 780.5 → 781)');
select is((select daybell_fee_bps from public.orders where id = pg_temp.v('o1')), 300,
  'and an earlier order keeps the rate it was made with');
select ok(pg_temp.try($$ update public.orders set daybell_fee_bps = 350 where id = pg_temp.v('o1') $$) like '23514%',
  'which nobody can change');
select public.set_platform_fee(300, 'Test: back to 3%');

-- ── Paying ────────────────────────────────────────────────────────────────────────────────────────────────────────
select public.shop_checkout_attach(pg_temp.h('s1'), pg_temp.v('o3'), 'cs_test_O3', now() + interval '30 minutes');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"amount_subtotal": 100}'))), 'P0001 checkout_mismatch',
  'Stripe''s subtotal must be the order''s');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"application_fee_amount": 1}'))), 'P0001 checkout_mismatch',
  'and Daybell''s fee');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"destination": "acct_B1"}'))), 'P0001 checkout_mismatch',
  'and the destination');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"on_behalf_of": null}'))), 'P0001 checkout_mismatch',
  'and the studio as merchant of record (on_behalf_of; security N5)');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"shipping": {"name": "\u202e\u0007", "line1": "12 Maple Lane",
    "city": "Toronto", "postal_code": "M5V 2T6", "country": "CA"}}'))), 'P0001 checkout_mismatch',
  'a recipient with nothing left once cleaned is a mismatch, never a failing row');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"checkout_session_id": "cs_test_O1"}'))), 'P0001 checkout_mismatch',
  'and the checkout');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"livemode": true}'))), 'P0001 checkout_mismatch', 'and the mode');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"shipping": null}'))), 'P0001 checkout_mismatch',
  'home delivery needs the recipient''s address');
select is(pg_temp.try(format($$ select public.complete_order(%L, %L) $$, pg_temp.v('o3'),
  pg_temp.facts(pg_temp.v('o3'), 3054, '{"currency": "usd"}'))), 'P0001 checkout_mismatch', 'and CAD');
select is((select status::text from public.orders where id = pg_temp.v('o3')), 'pending',
  'a mismatch changes nothing');
-- The parent typed control and bidi characters at Stripe (security M3): cleaned, never a failed check that would put
-- the row in Postgres's log, and the order is paid.
select is(public.complete_order(pg_temp.v('o3'), pg_temp.facts(pg_temp.v('o3'), 3054,
  '{"shipping": {"name": "Pri\u202eya Patel\u0007", "line1": "12 Maple\nLane", "line2": "\u2066\u2069",
    "city": "Toronto", "state": "ON", "postal_code": "M5V 2T6", "country": "CA"}}')), 'paid',
  'Stripe''s answer pays it');
select ok((select stripe_closed_at is not null from public.orders where id = pg_temp.v('o3')),
  'and its checkout is closed at Stripe');
select results_eq($$ select status::text, tax_cents, total_cents, payment_intent_id is not null, paid_at is not null
    from public.orders where id = pg_temp.v('o3') $$,
  $$ values ('paid', 3054::bigint, 26549::bigint, true, true) $$, 'paid, with tax and the total');
select is(public.complete_order(pg_temp.v('o3'), pg_temp.facts(pg_temp.v('o3'), 3054)), 'already_paid',
  'a second delivery changes nothing');
select is(pg_temp.events('order.paid'), 1::bigint, 'one order.paid event');
select results_eq($$ select actor_id, subject_id, data from public.events where type = 'order.paid' $$,
  $$ values (null::uuid, pg_temp.v('o3'), '{"line_count": 4, "shipping_method": "home"}'::jsonb) $$,
  'with no actor, ids and kinds only: no amount, name or address (call 14)');
select results_eq($$ select recipient_name, line1, line2, city, country::text from public.order_shipping_addresses
    where order_id = pg_temp.v('o3') $$, $$ values ('Priya Patel', '12 Maple Lane', null::text, 'Toronto', 'CA') $$,
  'the recipient is kept for home delivery (call 2), cleaned of control and bidi characters');
select is((select count(*) from public.photos where sold_at is not null and id in (pg_temp.pid(1), pg_temp.pid(2),
  pg_temp.pid(3), pg_temp.pid(4))), 4::bigint, 'every photo sold is marked: poses and all of Ava''s digitals');
select is(pg_temp.try($$ select public.bin_photos('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001', array[pg_temp.pid(3)]) $$), 'P0001 photo_sold',
  'so a photo bought as part of all digitals can''t be binned');
select is((select count(*) from public.order_line_photos lp join public.order_lines l on l.id = lp.order_line_id
  where l.order_id = pg_temp.v('o3')), 4::bigint,
  'all digitals is fixed to Ava''s 3 visible portraits (call 9) and her group''s photo (D156 C5)');
select is((select array_agg(lp.photo_id order by lp.position) from public.order_line_photos lp
  join public.order_lines l on l.id = lp.order_line_id where l.order_id = pg_temp.v('o3')),
  array[pg_temp.pid(1), pg_temp.pid(2), pg_temp.pid(3), pg_temp.pid(70)],
  'portraits first, then group photos (ADR 0033 N6)');
select isnt((select sold_at from public.photos where id = pg_temp.pid(70)), null,
  'her group photo is sold with them, so it can''t be binned');
select is((select count(*) from public.shop_cart_lines where session_id = 'd1000000-0000-4000-8000-000000000001'),
  0::bigint, 'what was bought leaves the bag');
select ok(pg_temp.try($$ update public.order_lines set quantity = 5 $$) like '23514%', 'lines never change');
select ok(pg_temp.try($$ delete from public.orders $$) like '23514%', 'orders are never deleted');
select ok(pg_temp.try(format($$ update public.orders set tax_cents = 0 where id = %L $$, pg_temp.v('o3'))) like '23514%',
  'a paid amount never changes');
select ok(pg_temp.try(format($$ update public.orders set status = 'pending' where id = %L $$, pg_temp.v('o3')))
  like '23514%', 'nor goes back to pending');

-- ── Stripe's fee and the ledger (call 1; ADR 0006) ────────────────────────────────────────────────────────────────
select is(pg_temp.try(format($$ select public.settle_order_fees(%L, 'tr_x', 800, 'usd', 'txn_1', 'trr_1') $$,
  pg_temp.v('o3'))), 'P0001 fee_currency', 'Stripe''s fee must be in the order''s currency');
select is(pg_temp.try(format($$ select public.settle_order_fees(%L, 'tr_other', 800, 'cad', 'txn_1', 'trr_1') $$,
  pg_temp.v('o3'))), 'P0001 checkout_mismatch', 'and on the order''s own transfer');
select is(public.settle_order_fees(pg_temp.v('o3'), 'tr_' || md5(pg_temp.v('o3')::text), 800, 'cad', 'txn_O3',
  'trr_O3'), 'settled', 'the fee is settled');
set constraints all immediate;
select results_eq($$ select e.account::text, e.amount_cents, e.currency::text from public.ledger_entries e
    join public.ledger_transactions x on x.id = e.transaction_id where x.order_id = pg_temp.v('o3') order by e.id $$,
  $$ values ('parent_payments', 26549::bigint, 'CAD'), ('tax_payable', -3054::bigint, 'CAD'),
            ('daybell_fees', -781::bigint, 'CAD'), ('payment_fees', -800::bigint, 'CAD'),
            ('studio_payable', -21914::bigint, 'CAD') $$,
  'one balanced transaction: the payment, tax, Daybell''s 3.5%, Stripe''s fee and the studio''s share');
select is((select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions x
  on x.id = e.transaction_id where x.order_id = pg_temp.v('o3')), 0::numeric, 'summing to zero');
select is(public.settle_order_fees(pg_temp.v('o3'), 'tr_' || md5(pg_temp.v('o3')::text), 800, 'cad', 'txn_O3',
  'trr_O3'), 'already_settled', 'a second settlement writes nothing');
select is(public.complete_order(pg_temp.v('o3'), pg_temp.facts(pg_temp.v('o3'), 3054)), 'already_settled',
  'and a late delivery of the payment says it is all done');
select is((select count(*) from public.ledger_entries), 5::bigint, 'still five lines');
select ok(pg_temp.try(format($$ insert into public.ledger_transactions (studio_id, kind, order_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'order_paid', %L) $$, pg_temp.v('o3'))) like '23505%',
  'an order is posted once, whoever writes (unique order and kind)');
select ok(pg_temp.try($$ update public.ledger_transactions set kind = 'order_paid' $$) like '23514%',
  'ledger transactions are append-only');
select results_eq($$ select stripe_fee_cents, fees_settled_at is not null, fee_reversal_id from public.orders
    where id = pg_temp.v('o3') $$, $$ values (800::bigint, true, 'trr_O3') $$, 'the order shows Stripe''s fee');

-- ── Expiry and the inbox ──────────────────────────────────────────────────────────────────────────────────────────
select is(public.expire_order(pg_temp.v('o3')), false, 'a paid order never expires');
select is(public.expire_order(pg_temp.v('o2')), false, 'an expired one stays expired');
select is((public.record_order_stripe_event('evt_C1', 'checkout.session.completed', pg_temp.v('o3'), 'cs_test_O3',
  false, now()) ->> 'claimed')::boolean, true, 'a checkout event is recorded and claimed');
select results_eq($$ select studio_id, stripe_account_id from public.stripe_events where stripe_event_id = 'evt_C1' $$,
  $$ values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'acct_A1') $$, 'for the order''s studio and destination');
select is((public.record_order_stripe_event('evt_C1', 'checkout.session.completed', pg_temp.v('o3'), 'cs_test_O3',
  false, now()) ->> 'claimed')::boolean, false, 'a duplicate delivery isn''t claimed again');
select is(public.record_order_stripe_event('evt_C2', 'checkout.session.completed',
  '00000000-0000-4000-8000-000000000000', 'cs_test_X', false, now()), null, 'an unknown order: null (404, Stripe retries)');
select is((public.record_order_stripe_event('evt_C3', 'checkout.session.completed', pg_temp.v('o3'), 'cs_test_OTHER',
  false, now()) ->> 'mismatch')::boolean, true, 'a checkout that isn''t the order''s is a mismatch');
select results_eq($$ select processed_at is not null, last_error from public.stripe_events
    where stripe_event_id = 'evt_C3' $$, $$ values (true, 'event_mismatch') $$,
  'recorded as done with its code, so Stripe doesn''t retry it for days (security S3)');
select is((public.record_order_stripe_event('evt_C3', 'checkout.session.expired', pg_temp.v('o3'), 'cs_test_O3',
  false, now()) ->> 'mismatch')::boolean, true, 'an event id already recorded as another type is a mismatch too');
select is(pg_temp.try(format($$ select public.record_order_stripe_event('evt_C4', 'payment_intent.succeeded', %L,
  'cs_test_O3', false, now()) $$, pg_temp.v('o3'))), '22023 Checkout events only', 'other types are refused');
-- An order whose checkout Stripe made but the API didn't save gets it from the event.
select public.shop_cart_add(pg_temp.h('s2'), 'c0000000-0000-4000-8000-000000000001',
  pg_temp.item('a0000000-0000-4000-8000-000000000001', 'digital_single'), pg_temp.pid(1), 1);
insert into t (name, id) select 'o4', (pg_temp.begin_('s2') ->> 'order_id')::uuid;
select is((select shipping_method from public.orders where id = pg_temp.v('o4')), null,
  'a downloads-only order needs no delivery');
select ok((public.record_order_stripe_event('evt_C5', 'checkout.session.expired', pg_temp.v('o4'), 'cs_test_O4',
  false, now()) ->> 'claimed')::boolean, 'an event for a checkout not yet saved is recorded');
select is((select checkout_session_id from public.orders where id = pg_temp.v('o4')), 'cs_test_O4',
  'and attaches it');
select is(public.expire_order(pg_temp.v('o4')), true, 'a pending order expires');
-- Stripe is the truth: an expired order Stripe reports paid is paid.
select is(public.complete_order(pg_temp.v('o4'), pg_temp.facts(pg_temp.v('o4'), 429, '{"shipping": null}')), 'paid',
  'an expired checkout that Stripe took the money for is paid');

-- ── What parents see (call 12) ────────────────────────────────────────────────────────────────────────────────────
select is((select jsonb_agg(x ->> 'view' order by x ->> 'reference') from jsonb_array_elements(
  public.shop_orders(pg_temp.h('s1'))) x where x ->> 'id' = pg_temp.v('o3')::text), '["full"]'::jsonb,
  'the session that paid sees its order in full');
select is((public.shop_order(pg_temp.h('s1'), pg_temp.v('o3')) -> 'totals' ->> 'total_cents')::bigint, 26549::bigint,
  'with its totals');
select is(public.shop_order(pg_temp.h('s1'), pg_temp.v('o3')) -> 'registrations',
  '[{"kind": "gst_hst", "number": "123456789RT0001", "province": null}]'::jsonb,
  'and the studio''s registration numbers at the time (call 5)');
select is(public.shop_order(pg_temp.h('s3'), pg_temp.v('o3')) ->> 'view', 'full',
  'a session holding every child in the order sees it in full');
select is(public.shop_order(pg_temp.h('s2'), pg_temp.v('o3')) ->> 'view', 'child',
  'a session holding only Ava sees Ava''s part');
select is((select count(*) from jsonb_array_elements(public.shop_order(pg_temp.h('s2'), pg_temp.v('o3')) -> 'lines') l
  where l ->> 'child_id' <> 'c0000000-0000-4000-8000-000000000001'), 0::bigint, 'never her brother''s lines');
select ok(public.shop_order(pg_temp.h('s2'), pg_temp.v('o3')) -> 'totals' = 'null'::jsonb
  and (select bool_and(l -> 'unit_price_cents' = 'null'::jsonb and l -> 'line_total_cents' = 'null'::jsonb)
       from jsonb_array_elements(public.shop_order(pg_temp.h('s2'), pg_temp.v('o3')) -> 'lines') l),
  'nor any amount');
select is(pg_temp.try(format($$ select public.shop_order(pg_temp.h('sb'), %L) $$, pg_temp.v('o3'))),
  'P0002 Order not found', 'another studio''s session sees nothing');
select is(public.shop_orders(pg_temp.h('sb')), '[]'::jsonb, 'and lists nothing');
select is(pg_temp.try(format($$ select public.shop_order(pg_temp.h('s2'), %L) $$, pg_temp.v('o2'))),
  'P0002 Order not found', 'another session never sees an unpaid order');
select is((public.shop_order(pg_temp.h('s1'), pg_temp.v('o3')) -> 'children' -> 0 ->> 'first_name'), 'Ava',
  'children appear by first name');
select ok(public.shop_order(pg_temp.h('s1'), pg_temp.v('o3'))::text !~ '(Patel|Priya|12 Maple|Toronto|M5V|@)',
  'never a last name, the recipient or an address');

-- ── Downloads (calls 10, 11) ──────────────────────────────────────────────────────────────────────────────────────
select is((public.shop_download_photo(pg_temp.h('s1'), pg_temp.v('o3'), pg_temp.pid(2)) ->> 'job_id')::uuid,
  'a0000000-0000-4000-8000-000000000001'::uuid, 'the payer downloads the single download''s photo');
select is((public.shop_download_photo(pg_temp.h('s1'), pg_temp.v('o3'), pg_temp.pid(1)) ->> 'n')::int, 1,
  'and the package''s, numbered for a nameless file');
select ok((public.shop_download_photo(pg_temp.h('s2'), pg_temp.v('o3'), pg_temp.pid(3)) ->> 'photo_id') is not null,
  'Ava''s other parent downloads her all-digitals photos');
select is(pg_temp.try(format($$ select public.shop_download_photo(pg_temp.h('s1'), %L, %L) $$, pg_temp.v('o3'),
  pg_temp.pid(4))), 'P0002 Download not found', 'a print''s photo is never a download');
select is(pg_temp.try(format($$ select public.shop_download_photo(pg_temp.h('sb'), %L, %L) $$, pg_temp.v('o3'),
  pg_temp.pid(2))), 'P0002 Download not found', 'another studio''s session downloads nothing');
select is(pg_temp.try(format($$ select public.shop_download_photo(pg_temp.h('s1'), %L, %L) $$, pg_temp.v('o1'),
  pg_temp.pid(2))), 'P0002 Download not found', 'an unpaid order unlocks nothing');
update public.children set do_not_publish = true where id = 'c0000000-0000-4000-8000-000000000001';
select ok((public.shop_download_photo(pg_temp.h('s1'), pg_temp.v('o3'), pg_temp.pid(2)) ->> 'photo_id') is not null,
  'a later Do not publish doesn''t take back a paid download (call 11)');
select ok(public.shop_order(pg_temp.h('s1'), pg_temp.v('o3')) -> 'children' -> 0 -> 'first_name' is null,
  'but the child is no longer named to parents');
update public.children set do_not_publish = false where id = 'c0000000-0000-4000-8000-000000000001';
-- A photo of Ava tagged after payment isn't part of her all digitals.
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, created_by)
select pg_temp.pid(7), b.studio_id, b.job_id, b.id, b.seq, 'ready', 'IMG_7.JPG', 1, extensions.digest('7', 'sha256'),
  1200, 1500, 'none', b.created_by from public.upload_batches b where b.id = 'e1000000-0000-4000-8000-000000000001';
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, source)
values (pg_temp.pid(7), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'child',
  'c0000000-0000-4000-8000-000000000001', 'auto');
update public.upload_batches set tagged_round = tag_round;
select is(pg_temp.try(format($$ select public.shop_download_photo(pg_temp.h('s1'), %L, %L) $$, pg_temp.v('o3'),
  pg_temp.pid(7))), 'P0002 Download not found', 'a photo added after payment isn''t in all digitals');
select is(public.shop_order_verify(pg_temp.h('s1'), pg_temp.v('o3')), null,
  'a paid order isn''t checked with Stripe again');

-- download.jpg is made lazily, for sold photos only (security N1), and asked for at most every 5 minutes, 3 times
-- (code S4, security S5).
select is(public.order_downloads_to_make(pg_temp.v('o1')), '[]'::jsonb, 'an unpaid order asks for no download');
select is(public.order_downloads_to_make(pg_temp.v('o3')),
  jsonb_build_array(pg_temp.pid(1), pg_temp.pid(2), pg_temp.pid(3), pg_temp.pid(70)),
  'a paid order asks for its downloads'' files: the package''s, the single and all digitals with the group photo (never the print''s)');
select is(public.order_downloads_to_make(pg_temp.v('o3')), '[]'::jsonb, 'once');
select is(public.shop_download_request(pg_temp.h('s1'), pg_temp.v('o3'), pg_temp.pid(2)), 'waiting',
  'a download tapped while its file is being made isn''t queued again');
update public.photo_download_requests set requested_at = now() - interval '6 minutes' where photo_id = pg_temp.pid(2);
select is(public.shop_download_request(pg_temp.h('s1'), pg_temp.v('o3'), pg_temp.pid(2)), 'queued',
  'after 5 minutes without it, it is asked for again');
update public.photo_download_requests set requested_at = now() - interval '6 minutes' where photo_id = pg_temp.pid(2);
select is(public.shop_download_request(pg_temp.h('s2'), pg_temp.v('o3'), pg_temp.pid(2)), 'queued',
  'a third time (from Ava''s other parent)');
update public.photo_download_requests set requested_at = now() - interval '6 minutes' where photo_id = pg_temp.pid(2);
select is(public.shop_download_request(pg_temp.h('s1'), pg_temp.v('o3'), pg_temp.pid(2)), 'unavailable',
  'then never again: the download is unavailable (alerted), not "being prepared" forever');
select is((select requests from public.photo_download_requests where photo_id = pg_temp.pid(2)), 3,
  'three times in all');
select is(pg_temp.try(format($$ select public.shop_download_request(pg_temp.h('sb'), %L, %L) $$, pg_temp.v('o3'),
  pg_temp.pid(2))), 'P0002 Download not found', 'another studio''s session asks for nothing');
select is(pg_temp.try(format($$ select public.shop_download_request(pg_temp.h('s1'), %L, %L) $$, pg_temp.v('o3'),
  pg_temp.pid(4))), 'P0002 Download not found', 'nor for a print''s photo');
select is(app.claim_download_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
  pg_temp.pid(6)), 'unavailable', 'a photo that isn''t that studio''s and job''s ready photo is never asked for');
select is((select count(*) from public.photo_download_requests
  where studio_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'and nothing was kept for another studio');

-- ── Studio reads and leak tests (call 15; D96) ────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select is((select count(*) from jsonb_array_elements(public.job_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'a0000000-0000-4000-8000-000000000001'))), 2::bigint, 'the owner sees the job''s two paid orders');
select ok((select bool_and(x ? 'daybell_fee_bps' and x ? 'stripe_fee_cents') from jsonb_array_elements(
  public.job_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001')) x),
  'with Daybell''s fee rate and Stripe''s fee (D98)');
select is(public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('o3')) -> 'ship_to' ->> 'name',
  'Priya Patel', 'and where a home order ships');
select throws_ok($$ select shop_session_id from public.orders $$, '42501', null,
  'but never which device''s session paid');
select throws_ok($$ insert into public.orders (studio_id, reference, currency, products_cents, shipping_cents,
  daybell_fee_bps, daybell_fee_cents, card_fee_recovery, tax_enabled, payout_account_id, stripe_account_id,
  bag_fingerprint) select studio_id, 'ABCDEFGH', 'CAD', 0, 0, 0, 0, 'per_sale', false, payout_account_id,
  stripe_account_id, bag_fingerprint from public.orders limit 1 $$, '42501', null, 'and writes no order');
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select is((select count(*) from public.orders), 4::bigint, 'an admin reads the studio''s orders');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select is((select count(*) from public.orders) + (select count(*) from public.order_lines)
  + (select count(*) from public.ledger_entries) + (select count(*) from public.order_shipping_addresses),
  0::bigint, 'a photographer reads no orders, lines, ledger or addresses (call 15)');
select is(public.job_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001'),
  '[]'::jsonb, 'nor through the job''s list');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select is((select count(*) from public.ledger_entries) + (select count(*) from public.studio_tax_registrations),
  0::bigint, 'staff read no ledger or taxes (since step 11 they read orders to fulfil them: ADR 0024, Q4)');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select is((select count(*) from public.orders) + (select count(*) from public.order_lines)
  + (select count(*) from public.order_line_contents) + (select count(*) from public.order_line_photos)
  + (select count(*) from public.order_shipping_addresses) + (select count(*) from public.ledger_transactions)
  + (select count(*) from public.ledger_entries) + (select count(*) from public.studio_tax_registrations)
  + (select count(*) from public.studio_tax_settings), 0::bigint,
  'studio B''s owner sees none of A''s orders, lines, contents, photos, addresses, ledger or taxes');
select is(public.job_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001'),
  '[]'::jsonb, 'nor A''s orders by asking for A''s job');
select is(public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('o3')), null,
  'nor one of them by its id');
select throws_ok($$ select count(*) from public.photo_download_requests $$, '42501', null,
  'nor which photos'' downloads were asked for');
set local role anon;
select throws_ok($$ select count(*) from public.orders $$, '42501', null, 'logged-out visitors read nothing');
reset role;

-- ── The cron's backstops ──────────────────────────────────────────────────────────────────────────────────────────
-- Back-dated with the guard off (a paid time never changes otherwise).
alter table public.orders disable trigger orders_guard;
update public.orders set paid_at = now() - interval '11 minutes' where id = pg_temp.v('o4');
alter table public.orders enable trigger orders_guard;
select is(public.unsettled_orders(10), jsonb_build_array(jsonb_build_object('order_id', pg_temp.v('o4'),
  'checkout_session_id', 'cs_test_O4')), 'a paid order unsettled after 10 minutes is retried');
select is(public.stale_checkouts(10), '[]'::jsonb, 'no checkout has run out yet');
-- Attempts and backoff (code S1, security M4).
select lives_ok(format($$ select public.note_checkout_failure(%L, 'stripe_unavailable', false) $$, pg_temp.v('o4')),
  'a failed try is noted');
select results_eq($$ select backstop_attempts, backstop_error, backstop_next_at > now(), problem from public.orders
    where id = pg_temp.v('o4') $$, $$ values (1, 'stripe_unavailable', true, null::text) $$,
  'with its code and when to try next');
select is(public.unsettled_orders(10), '[]'::jsonb, 'so the next run leaves it alone while it backs off');
update public.orders set backstop_next_at = now() - interval '1 second' where id = pg_temp.v('o4');
select is(jsonb_array_length(public.unsettled_orders(10)), 1, 'and tries again when it is due');
select public.note_checkout_failure(pg_temp.v('o4'), 'fee_currency', true);
update public.orders set backstop_next_at = now() - interval '1 second' where id = pg_temp.v('o4');
select results_eq($$ select backstop_attempts, problem from public.orders where id = pg_temp.v('o4') $$,
  $$ values (2, 'fee_currency') $$, 'a problem no retry can fix is kept for support');
select is(public.unsettled_orders(10), '[]'::jsonb,
  'and never retried, so problems can''t crowd newer orders out of the page');
select is(pg_temp.try(format($$ select public.note_checkout_failure(%L, 'Has a message', true) $$, pg_temp.v('o4'))),
  '22023 A code and whether it is permanent', 'codes only, never a message');
-- A replaced checkout that Stripe hasn't closed (code M2): the cron closes it.
update public.orders set checkout_session_id = 'cs_test_O2', checkout_expires_at = now() + interval '20 minutes'
where id = pg_temp.v('o2');
select is(public.stale_checkouts(10), jsonb_build_array(jsonb_build_object('order_id', pg_temp.v('o2'),
  'checkout_session_id', 'cs_test_O2')), 'a replaced checkout still open at Stripe is closed by the cron');
select public.note_checkout_failure(pg_temp.v('o2'), 'stripe_unavailable', false);
select is(public.stale_checkouts(10), '[]'::jsonb, 'backing off after a failure');
update public.orders set backstop_next_at = null where id = pg_temp.v('o2');
select is(public.expire_order(pg_temp.v('o2')), false, 'closed at Stripe at last');
select is(public.stale_checkouts(10), '[]'::jsonb, 'and never picked up again');

-- ── Siblings (security N6): a session with one child never gets the other child's download ─────────────────────────
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'digital_single', null, 3, 1);
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000002', 'digital_single', null, 4, 1);
insert into t (name, id) select 'o5', (pg_temp.begin_('s1') ->> 'order_id')::uuid;
select public.shop_checkout_attach(pg_temp.h('s1'), pg_temp.v('o5'), 'cs_test_O5', now() + interval '30 minutes');
select is(public.complete_order(pg_temp.v('o5'), pg_temp.facts(pg_temp.v('o5'), 858, '{"shipping": null}')), 'paid',
  'Ava''s and Noah''s downloads are paid for together');
select is(public.shop_order(pg_temp.h('s2'), pg_temp.v('o5')) ->> 'view', 'child', 'Ava''s other parent sees Ava''s part');
select ok((public.shop_download_photo(pg_temp.h('s2'), pg_temp.v('o5'), pg_temp.pid(3)) ->> 'photo_id') is not null,
  'and downloads Ava''s photo');
select is(pg_temp.try(format($$ select public.shop_download_photo(pg_temp.h('s2'), %L, %L) $$, pg_temp.v('o5'),
  pg_temp.pid(4))), 'P0002 Download not found', 'but never Noah''s');
select is(pg_temp.try(format($$ select public.shop_download_request(pg_temp.h('s2'), %L, %L) $$, pg_temp.v('o5'),
  pg_temp.pid(4))), 'P0002 Download not found', 'nor asks for his file to be made');

-- ── Privacy ───────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from public.events where data::text ~* '(@|patel|priya|maple|toronto|[0-9]{9}RT)'),
  0::bigint, 'no event holds an email, a name, an address or a tax number');
select is((select count(*) from public.stripe_events where stripe_event_id like 'evt_C%'), 3::bigint,
  'the inbox keeps ids and types only');

select * from finish();
rollback;
