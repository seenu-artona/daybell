-- Orders and refunds (D25, D59, D127, D96, D113; answers 1–4, Q1–Q6; ADR 0024): fulfilment moves Paid → Printed →
-- Shipped (home, with tracking) or Delivered to school, one step back only with a reason, by owners, admins and staff
-- (never photographers); a digital-only order is Complete; refunds by line, custom amount or a parent's cancel give back
-- tax and Daybell's fee pro rata, the last one taking the exact remainders, never more than was paid, and each one
-- Stripe accepts writes one balanced ledger transaction; a failed refund is mirrored; refunded lines lose their
-- downloads, and what the studio gave back for a refund that then failed is sent back; shortfalls are recovered from a
-- later sale or absorbed after 180 days without one; the bell rings for the right people, a refund made outside
-- Daybell too (and stops fulfilment until checked); staff read orders but never refunds, the ledger or Home's money;
-- another studio and another session see nothing (the tracking is the paying session's only); addresses and tracking
-- numbers go 90 days after shipping (365 at most); zips are limited per session and per order; events hold no
-- amounts, names or tracking numbers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(232);

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
grant execute on function pg_temp.try(text) to authenticated;
create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
grant execute on function pg_temp.as_user(uuid) to authenticated, anon;

-- Studio A's job 1 sells and delivers to school; studio B's job sells.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall 2026', 'school', '2026-10-13', 'JOB00001'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-13', 'JOB00001');
update public.jobs set deliver_to_school = true where id = 'a0000000-0000-4000-8000-000000000001';
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Ava', 'Patel', pg_temp.h('c1'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Noah', 'Patel', pg_temp.h('c2'), 'v1.' || repeat('A', 48)),
  ('cb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 'Bea', 'Brown', pg_temp.h('cb1'), 'v1.' || repeat('A', 48));
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('eb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222');
-- Photos 1–3 of Ava, 4 of Noah, 6 of Bea.
create temp table fx (n int, batch text, child text) on commit drop;
insert into fx values
  (1, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  (2, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  (3, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  (4, 'e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002'),
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
update public.upload_batches set tagged_round = tag_round;
update public.jobs set status = 'selling';

select public.create_payout_account(o.owner, o.studio, o.acct, false,
  '{"details_submitted": true, "charges_enabled": true, "payouts_enabled": true}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'active')
from (values ('11111111-1111-4111-8111-111111111111'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'acct_A1'),
             ('22222222-2222-4222-8222-222222222222'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'acct_B1'))
  o (owner, studio, acct);
-- Studio A charges tax (a head office and a GST/HST number); B doesn't.
select public.set_tax_head_office('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ON');
select public.add_tax_registration('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'gst_hst', null, '123456789RT0001', 'taxreg_A1');

-- S1 holds Ava and Noah (pays oH, home); S2 holds Ava (pays oD, downloads only, and oU, never settled); S3 holds both
-- (pays oP, home, and oS, school); SB is studio B's.
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
create function pg_temp.facts(p_order uuid, p_tax bigint, p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('checkout_session_id', o.checkout_session_id, 'payment_intent_id', 'pi_' || md5(o.id::text),
    'charge_id', 'ch_' || md5(o.id::text), 'transfer_id', 'tr_' || md5(o.id::text), 'livemode', false,
    'currency', 'cad', 'amount_subtotal', o.products_cents, 'amount_shipping', o.shipping_cents, 'amount_tax', p_tax,
    'amount_total', o.products_cents + o.shipping_cents + p_tax, 'destination', o.stripe_account_id,
    'on_behalf_of', o.stripe_account_id, 'application_fee_amount', o.daybell_fee_cents,
    'shipping', case when o.shipping_method = 'home' then jsonb_build_object('name', 'Priya Patel',
      'line1', '12 Maple Lane', 'line2', null, 'city', 'Toronto', 'state', 'ON', 'postal_code', 'M5V 2T6',
      'country', 'CA') end) || p_over
  from public.orders o where o.id = p_order $$;
-- Pays the session's bag at Stripe (tax as given) and, unless told not to, settles Stripe's fee.
create function pg_temp.buy(p_session text, p_tax bigint, p_fee bigint, p_settle boolean default true)
returns uuid language plpgsql as $$
declare
  v_order uuid := (pg_temp.begin_(p_session) ->> 'order_id')::uuid;
begin
  perform public.shop_checkout_attach(pg_temp.h(p_session), v_order, 'cs_test_' || md5(v_order::text),
    now() + interval '30 minutes');
  perform public.complete_order(v_order, pg_temp.facts(v_order, p_tax));
  if p_settle then
    perform public.settle_order_fees(v_order, 'tr_' || md5(v_order::text), p_fee, 'cad', 'txn_' || md5(v_order::text),
      'trr_' || md5(v_order::text));
  end if;
  return v_order;
end;
$$;
create temp table t (name text primary key, id uuid, txt text) on commit drop;
grant all on t to authenticated;
create function pg_temp.v(p_name text) returns uuid language sql as $$ select id from t where name = p_name $$;
grant execute on function pg_temp.v(text) to authenticated;
create function pg_temp.line(p_order uuid, p_kind text) returns uuid language sql as $$
  select id from public.order_lines where order_id = p_order and kind::text = p_kind order by position limit 1 $$;
create function pg_temp.ledger(p_refund uuid, p_kind text) returns text language sql as $$
  select string_agg(e.account || ' ' || e.amount_cents, ', ' order by e.id) from public.ledger_entries e
  join public.ledger_transactions x on x.id = e.transaction_id where x.refund_id = p_refund and x.kind::text = p_kind $$;

-- oH (S1, home): Package A for Ava (photo 1), two 4×6 prints for Noah (photo 4), a download of Ava (photo 2).
-- Products 14,400, shipping 1,195, tax 2,027, total 17,622; Daybell's 3% 432; Stripe's fee 541.
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'package', 'Package A', 1, 1);
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000002', 'print', '4×6 print', 4, 2);
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000001', 'digital_single', null, 2, 1);
select public.shop_set_shipping(pg_temp.h('s1'), 'home');
insert into t (name, id) select 'oH', pg_temp.buy('s1', 2027, 541);
-- oD (S2): a download of Ava (photo 1) only. oU (S2): a 4×6 of Ava to school, paid but its fee not yet settled.
select pg_temp.add('s2', 'c0000000-0000-4000-8000-000000000001', 'digital_single', null, 1, 1);
insert into t (name, id) select 'oD', pg_temp.buy('s2', 429, 127);
select pg_temp.add('s2', 'c0000000-0000-4000-8000-000000000001', 'print', '4×6 print', 3, 1);
select public.shop_set_shipping(pg_temp.h('s2'), 'school');
insert into t (name, id) select 'oU', pg_temp.buy('s2', 169, 68, false);
-- oP (S3, home): a 4×6 of Ava (photo 3). oS (S3, school): a 4×6 of Noah (photo 4).
select pg_temp.add('s3', 'c0000000-0000-4000-8000-000000000001', 'print', '4×6 print', 3, 1);
select public.shop_set_shipping(pg_temp.h('s3'), 'home');
insert into t (name, id) select 'oP', pg_temp.buy('s3', 325, 98);
select pg_temp.add('s3', 'c0000000-0000-4000-8000-000000000002', 'print', '4×6 print', 4, 1);
select public.shop_set_shipping(pg_temp.h('s3'), 'school');
insert into t (name, id) select 'oS', pg_temp.buy('s3', 169, 68);
-- oB: studio B's download of Bea.
select public.shop_cart_add(pg_temp.h('sb'), 'cb000000-0000-4000-8000-000000000001',
  pg_temp.item('b0000000-0000-4000-8000-000000000001', 'digital_single'), pg_temp.pid(6), 1);
insert into t (name, id) select 'oB', pg_temp.buy('sb', 0, 126);

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relrowsecurity and c.relname in ('order_refunds', 'order_refund_lines',
    'order_refund_recoveries', 'order_action_attempts')), 4::bigint, 'every new table has row-level security on');
select is((select count(*) from pg_policies where tablename in ('order_refunds', 'order_refund_lines',
    'order_refund_recoveries', 'order_action_attempts', 'orders', 'order_lines', 'order_shipping_addresses')
    and cmd <> 'SELECT'), 0::bigint, 'with read policies only: nobody signed in writes');
select is((select count(*) from unnest(array['public.order_refunds', 'public.order_refund_lines',
    'public.order_refund_recoveries', 'public.order_action_attempts', 'public.orders']) tb,
  unnest(array['anon', 'authenticated']) r
  where has_table_privilege(r, tb, 'insert') or has_table_privilege(r, tb, 'update')
     or has_table_privilege(r, tb, 'delete')), 0::bigint, 'browsers can''t insert, update or delete any of them');
select ok(not has_table_privilege('authenticated', 'public.order_action_attempts', 'select'),
  'nobody signed in reads who cancelled or zipped');
select ok(not has_column_privilege('authenticated', 'public.orders', 'shop_session_id', 'select')
  and has_column_privilege('authenticated', 'public.orders', 'fulfilment_status', 'select'),
  'the new order columns are readable, the shop session still isn''t');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where proname in ('mark_order_status', 'mark_orders_status', 'set_order_tracking', 'undo_order_status',
    'begin_refund', 'shop_order_cancel_begin', 'refund_for_stripe', 'refund_accepted', 'refund_recovered',
    'refund_settled', 'refund_failed', 'refund_abandoned', 'note_refund_failure', 'refunds_to_retry',
    'refund_shortfalls_for_sale', 'refund_shortfall_recovered', 'refund_shortfalls_due', 'absorb_refund_shortfalls',
    'record_payment_stripe_event', 'refund_by_stripe', 'order_disputed', 'shop_order_download_all',
    'shop_download_all_request', 'order_print_files', 'order_print_files_to_make', 'purge_shipping_addresses',
    'act_for_roles', 'refund_split', 'write_refund', 'write_refund_ledger', 'studio_order_refund_state',
    'take_order_action', 'emit_as', 'refund_share_returned', 'order_external_refund', 'check_external_refund',
    'shop_zip_take', 'order_zip_take', 'order_line_physical', 'order_physical', 'on_order_paid', 'notify_order',
    'order_refunded', 'order_line_refunded_quantity', 'order_refund_badge', 'order_fully_refunded', 'shop_can_cancel',
    'guard_order_refund_insert')),
  'every new SECURITY DEFINER function has an empty search_path');
create temp table system_fns on commit drop as select unnest(array[
  'public.mark_order_status(uuid, uuid, uuid, public.order_fulfilment, public.shipping_carrier, text, text)',
  'public.mark_orders_status(uuid, uuid, uuid[], public.order_fulfilment)',
  'public.set_order_tracking(uuid, uuid, uuid, public.shipping_carrier, text, text)',
  'public.undo_order_status(uuid, uuid, uuid, public.status_undo_reason)',
  'public.begin_refund(uuid, uuid, uuid, uuid, public.refund_kind, jsonb, bigint, boolean, public.refund_reason)',
  'public.shop_order_cancel_begin(text, uuid)', 'public.refund_for_stripe(uuid)',
  'public.refund_accepted(uuid, text, text)', 'public.refund_recovered(uuid, text, bigint)',
  'public.refund_settled(uuid)', 'public.refund_failed(uuid, text)', 'public.refund_abandoned(uuid, text)',
  'public.note_refund_failure(uuid, text, boolean)', 'public.refunds_to_retry(integer)',
  'public.refund_shortfalls_for_sale(uuid)', 'public.refund_shortfall_recovered(uuid, uuid, bigint, text)',
  'public.refund_shortfalls_due(integer)', 'public.absorb_refund_shortfalls(integer)',
  'public.record_payment_stripe_event(text, text, uuid, text, boolean, timestamptz)',
  'public.refund_by_stripe(uuid, uuid, text)', 'public.order_disputed(uuid)',
  'public.shop_order_download_all(text, uuid)', 'public.shop_download_all_request(text, uuid, uuid[])',
  'public.order_print_files(uuid, uuid, uuid)', 'public.order_print_files_to_make(uuid, uuid, uuid, uuid[])',
  'public.purge_shipping_addresses(integer)', 'public.refund_share_returned(uuid, text, bigint)',
  'public.order_external_refund(uuid)', 'public.check_external_refund(uuid, uuid, uuid)',
  'public.shop_zip_take(text, uuid)', 'public.order_zip_take(uuid, uuid, uuid)']) as f;
select is((select count(*) from system_fns, unnest(array['anon', 'authenticated']) r
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'browsers and logged-out visitors run none of them');
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')) from system_fns),
  'the service role (the API) runs them all');
select ok(has_function_privilege('authenticated', 'public.studio_orders(uuid, uuid, public.order_fulfilment[], text, integer, uuid, public.shop_shipping_method)', 'execute')
  and not (select prosecdef from pg_proc where proname = 'studio_orders')
  and not (select prosecdef from pg_proc where proname = 'studio_sales')
  and not (select prosecdef from pg_proc where proname = 'studio_order_todo'),
  'the studio''s reads are SECURITY INVOKER: row-level security decides');
select is((select count(*) from information_schema.columns where table_schema = 'public'
  and table_name in ('order_refunds', 'order_refund_lines', 'order_refund_recoveries', 'order_action_attempts')
  and column_name ~ '(email|first_name|last_name|address|access_code|phone|note|comment|text)'), 0::bigint,
  'refunds keep no email, name, address or free text (Claude''s call: a fixed list of reasons)');
select is((select data_type from information_schema.columns where table_name = 'order_refunds'
  and column_name = 'amount_cents'), 'bigint', 'money is whole cents');

-- ── Fulfilment (answer 4) ─────────────────────────────────────────────────────────────────────────────────────────
select is((select fulfilment_status::text from public.orders where id = pg_temp.v('oH')), 'paid',
  'an order with prints is Paid at payment');
select is((select fulfilment_status::text from public.orders where id = pg_temp.v('oD')), 'complete',
  'a download-only order is Complete (Claude''s call)');
select is((select fulfilment_status from public.orders where id = pg_temp.v('oB')), 'complete',
  'in every studio');
select is(pg_temp.try(format($$ select public.mark_order_status('33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'printed') $$, pg_temp.v('oP'))), '42501 Not allowed for your role',
  'a photographer can''t mark an order (answer 4)');
select is(pg_temp.try(format($$ select public.mark_order_status('22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'printed') $$, pg_temp.v('oP'))), '42501 Not allowed for your role',
  'nor another studio''s owner');
select is(pg_temp.try(format($$ select public.mark_order_status('22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', %L, 'printed') $$, pg_temp.v('oP'))), 'P0002 Order not found',
  'who finds A''s order not found in their own studio');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'shipped', 'ups', '1Z999AA10123456784') $$, pg_temp.v('oP'))),
  'P0001 status_invalid', 'an order is printed before it ships');
select is(public.mark_order_status('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('oP'), 'printed')::text, 'printed', 'staff mark it Printed');
select results_eq($$ select actor_id, data from public.events where type = 'order.printed' $$,
  $$ values ('44444444-4444-4444-8444-444444444444'::uuid, '{}'::jsonb) $$, 'order.printed, by the staff member');
select ok((select printed_at is not null from public.orders where id = pg_temp.v('oP')), 'and when');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'delivered') $$, pg_temp.v('oP'))), 'P0001 wrong_delivery',
  'a home order isn''t delivered to school');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'shipped') $$, pg_temp.v('oP'))), 'P0001 tracking_required',
  'shipping needs a carrier and a tracking number');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'shipped', 'ups', '1Z999', 'https://example.test/t') $$,
  pg_temp.v('oP'))), '22023 Check the tracking details', 'a link only with "other"');
select is(public.mark_order_status('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('oP'), 'shipped', 'canada_post', '7023 4567 8901 2345')::text, 'shipped', 'the owner ships it');
select results_eq($$ select carrier::text, tracking_number, shipped_at is not null from public.orders
    where id = pg_temp.v('oP') $$, $$ values ('canada_post', '7023 4567 8901 2345', true) $$,
  'with its carrier and tracking number');
select is((select data from public.events where type = 'order.shipped'), '{"carrier": "canada_post"}'::jsonb,
  'order.shipped names the carrier, never the tracking number');
select lives_ok(format($$ select public.set_order_tracking('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'other', 'TRK-4455', 'https://tracking.example.test/TRK-4455') $$,
  pg_temp.v('oP')), 'staff correct the tracking to another carrier with a link');
select is((select data from public.events where type = 'order.tracking_changed'), '{"carrier": "other"}'::jsonb,
  'order.tracking_changed, the carrier only');
select is(pg_temp.try(format($$ select public.undo_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'wrong_tracking') $$, pg_temp.v('oP'))),
  '42501 Not allowed for your role', 'staff can''t undo a step');
select is(public.undo_order_status('55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('oP'), 'wrong_tracking')::text, 'printed', 'an admin takes it back one step, with a reason');
select results_eq($$ select fulfilment_status::text, shipped_at is null, printed_at is not null from public.orders
    where id = pg_temp.v('oP') $$, $$ values ('printed', true, true) $$, 'Printed again, no longer shipped');
select is((select data from public.events where type = 'order.status_reverted'),
  '{"to": "printed", "from": "shipped", "reason": "wrong_tracking"}'::jsonb, 'order.status_reverted with the reason');
select ok(pg_temp.try(format($$ update public.orders set fulfilment_status = 'paid' where id = %L $$,
  pg_temp.v('oP'))) like '23514%', 'nobody moves a status back without undo');
select ok(pg_temp.try(format($$ update public.orders set fulfilment_status = 'delivered' where id = %L $$,
  pg_temp.v('oP'))) like '23514%', 'nor skips the rules');
update public.orders set printed_at = now() - interval '9 days' where id = pg_temp.v('oP');
select ok((select printed_at > now() - interval '1 minute' from public.orders where id = pg_temp.v('oP')),
  'and the times are the database''s own');
select lives_ok(format($$ select public.mark_order_status('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'shipped', 'ups', '1Z999AA10123456784') $$, pg_temp.v('oP')),
  'shipped again');
select is(public.shop_order(pg_temp.h('s3'), pg_temp.v('oP')) -> 'tracking',
  '{"url": null, "number": "1Z999AA10123456784", "carrier": "ups"}'::jsonb, 'the session that paid sees the tracking');
select is(public.shop_order(pg_temp.h('s1'), pg_temp.v('oP')) ->> 'view', 'full',
  'another session holding the same child sees the order in full');
select is(public.shop_order(pg_temp.h('s1'), pg_temp.v('oP')) -> 'tracking', 'null'::jsonb,
  'but never its tracking (security review B1: it leads to the paying household)');
select is(pg_temp.try(format($$ select public.undo_order_status('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'other') $$, pg_temp.v('oD'))), 'P0001 status_invalid',
  'a complete order has no step to undo');

-- Bulk (Claude's call): Mark printed for oS (fine), oD (complete) and an unknown order.
select is(public.mark_orders_status('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array[pg_temp.v('oS'), pg_temp.v('oD'), '00000000-0000-4000-8000-000000000000'::uuid, pg_temp.v('oB')], 'printed'),
  jsonb_build_array(jsonb_build_object('order_id', pg_temp.v('oS'), 'outcome', 'ok'),
    jsonb_build_object('order_id', pg_temp.v('oD'), 'outcome', 'status_invalid'),
    jsonb_build_object('order_id', '00000000-0000-4000-8000-000000000000', 'outcome', 'not_found'),
    jsonb_build_object('order_id', pg_temp.v('oB'), 'outcome', 'not_found')),
  'bulk marks each on its own: one printed, a complete one refused, unknown and other studios'' not found');
select is(pg_temp.try(format($$ select public.mark_orders_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array[%L::uuid], 'shipped') $$, pg_temp.v('oS'))),
  '22023 Send 1 to 100 orders, printed or delivered', 'bulk is Mark printed or Mark delivered to school only');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'shipped', 'ups', '1Z999AA1') $$, pg_temp.v('oS'))),
  'P0001 wrong_delivery', 'a school order isn''t shipped');
select is((public.mark_orders_status('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array[pg_temp.v('oS')], 'delivered') -> 0 ->> 'outcome'), 'ok', 'it is delivered to school');
select ok((select delivered_at is not null and fulfilment_status = 'delivered' from public.orders
  where id = pg_temp.v('oS')), 'Delivered, with when');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'printed') $$, pg_temp.v('oU'))), 'ok',
  'a paid order whose fee is pending can still be printed');
select public.undo_order_status('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('oU'), 'marked_by_mistake');

-- A refund made outside Daybell (security review S5): flagged once, the bell rings, fulfilment stops until checked.
select is(public.order_external_refund(pg_temp.v('oU')), true, 'a refund made outside Daybell flags the order');
select is(public.order_external_refund(pg_temp.v('oU')), false, 'once');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'printed') $$, pg_temp.v('oU'))), 'P0001 external_refund',
  'and it can''t be printed until checked');
select is((select array_agg(m.role::text order by m.role) from public.notifications n
  join public.studio_members m on m.user_id = n.user_id and m.studio_id = n.studio_id
  where n.kind = 'refund_external' and n.order_id = pg_temp.v('oU')), array['owner', 'admin'],
  'it rings owners'' and admins'' bell');
select is(pg_temp.try(format($$ select public.check_external_refund('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L) $$, pg_temp.v('oU'))), '42501 Not allowed for your role',
  'staff can''t mark it checked');
select lives_ok(format($$ select public.check_external_refund('55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L) $$, pg_temp.v('oU')), 'an admin marks it checked');
select is(pg_temp.try(format($$ select public.check_external_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L) $$, pg_temp.v('oU'))), 'P0001 status_invalid', 'once');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'printed') $$, pg_temp.v('oU'))), 'ok', 'then it can be printed');
select public.undo_order_status('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('oU'), 'marked_by_mistake');

-- ── Refunds: who, and when (answers 1, 3) ─────────────────────────────────────────────────────────────────────────
select is(pg_temp.try(format($$ select public.begin_refund('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'custom', null, 100, false, null) $$,
  pg_temp.v('oH'))), '42501 Not allowed for your role', 'staff can''t refund (answer 3)');
select is(pg_temp.try(format($$ select public.begin_refund('33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'custom', null, 100, false, null) $$,
  pg_temp.v('oH'))), '42501 Not allowed for your role', 'nor photographers');
select is(pg_temp.try(format($$ select public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'custom', null, 100, false, null) $$,
  pg_temp.v('oU'))), 'P0001 fees_pending', 'refunds wait until the order''s fees are settled');
select is(pg_temp.try(format($$ select public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'cancel', null, null, true, null) $$,
  pg_temp.v('oH'))), '22023 A request id, and lines or a custom amount', 'a cancel is the parent''s');
select is(pg_temp.try(format($$ select public.begin_refund('22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', %L, gen_random_uuid(), 'custom', null, 100, false, null) $$,
  pg_temp.v('oH'))), 'P0002 Order not found', 'another studio''s owner finds the order not found');
select is(pg_temp.try(format($$ select public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, %L, 'custom', null, 100, false, null) $$,
  pg_temp.v('oH'), pg_temp.v('oD'))), '22023 A request id, and lines or a custom amount',
  'a request id that is an order''s id is refused (security review note 4)');

-- r1: one of Noah's two 4×6 prints. Tax 2,027 × 1,300 / 15,595 = 168.97 → 169; Daybell's 3% of 1,300 = 39.
insert into t (name, id) select 'req1', gen_random_uuid();
insert into t (name, id) select 'r1', (public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH'), pg_temp.v('req1'), 'lines',
  jsonb_build_array(jsonb_build_object('line_id', pg_temp.line(pg_temp.v('oH'), 'print'), 'quantity', 1)), null,
  false, 'damaged') ->> 'refund_id')::uuid;
select results_eq($$ select kind::text, status::text, products_cents, shipping_cents, tax_cents, amount_cents,
    daybell_fee_cents, currency::text, actor_id from public.order_refunds where id = pg_temp.v('r1') $$,
  $$ values ('lines', 'requested', 1300::bigint, 0::bigint, 169::bigint, 1469::bigint, 39::bigint, 'CAD',
    '11111111-1111-4111-8111-111111111111'::uuid) $$,
  'a line refund: products, tax and Daybell''s fee pro rata, half up, in CAD');
select is((select quantity from public.order_refund_lines where refund_id = pg_temp.v('r1')), 1, 'one print given back');
select is(public.begin_refund('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('oH'), pg_temp.v('req1'), 'lines',
  jsonb_build_array(jsonb_build_object('line_id', pg_temp.line(pg_temp.v('oH'), 'print'), 'quantity', 1)), null,
  false, 'damaged'), jsonb_build_object('refund_id', pg_temp.v('r1'), 'created', false),
  'the same request again is the same refund (idempotent)');
select is((select count(*) from public.order_refunds), 1::bigint, 'and makes no other');
select is(pg_temp.try(format($$ select public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'lines', %L, null, false, null) $$,
  pg_temp.v('oH'), jsonb_build_array(jsonb_build_object('line_id', pg_temp.line(pg_temp.v('oH'), 'print'),
  'quantity', 2)))), 'P0001 over_refund', 'never more of a line than is left');
select is(pg_temp.try(format($$ select public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'custom', null, 13101, false, null) $$,
  pg_temp.v('oH'))), 'P0001 over_refund', 'nor more products than are left (14,400 − 1,300)');
select is(pg_temp.try(format($$ select public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'custom', null, 0, false, null) $$,
  pg_temp.v('oH'))), 'P0001 nothing_to_refund', 'a refund of nothing is refused');
select is(pg_temp.try(format($$ select public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'lines', '[]', null, false, null) $$,
  pg_temp.v('oH'))), '22023 Choose 1 to 100 lines', 'no lines and no shipping is nothing');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'printed') $$, pg_temp.v('oH'))), 'P0001 refund_in_flight',
  'a refund Stripe hasn''t accepted yet stops printing');
select is((public.shop_order(pg_temp.h('s1'), pg_temp.v('oH')) ->> 'can_cancel')::boolean, false,
  'and the parent''s Cancel while it is in flight');
select is(pg_temp.ledger(pg_temp.v('r1'), 'order_refunded'), null, 'nothing in the ledger before Stripe accepts it');

-- Stripe accepts r1.
select is(public.refund_accepted(pg_temp.v('r1'), 're_r1', 'pending'), 'pending', 'Stripe accepts it (pending)');
set constraints all immediate;
select is(pg_temp.ledger(pg_temp.v('r1'), 'order_refunded'),
  'refunds -1469, tax_payable 169, daybell_fees 39, studio_payable 1261',
  'one balanced transaction: the refund, tax and Daybell''s fee given back, the studio''s share');
select results_eq($$ select actor_id, data from public.events where type = 'order.refunded' $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid,
    '{"full": false, "kind": "lines", "reason": "damaged", "line_count": 1}'::jsonb) $$,
  'order.refunded by the owner: kind, reason, lines and whether it''s full, never an amount');
select is(public.refund_accepted(pg_temp.v('r1'), 're_r1', 'succeeded'), 'pending',
  'the same acceptance again changes nothing');
select is(pg_temp.try(format($$ select public.refund_accepted(%L, 're_other', 'pending') $$, pg_temp.v('r1'))),
  'P0001 refund_mismatch', 'another Stripe refund for it is a mismatch');
select is((select count(*) from public.ledger_transactions where refund_id = pg_temp.v('r1')), 1::bigint,
  'still one transaction');
select is(pg_temp.try(format($$ select public.refund_recovered(%L, 'trr_r1', 1431) $$, pg_temp.v('r1'))),
  '22023 The reversal is 0 to what the studio gives back', 'the reversal is at most the refund less Daybell''s fee');
select is(public.refund_recovered(pg_temp.v('r1'), 'trr_r1', 1430), 0::bigint,
  'the studio gives back 1,430 (1,469 − 39): nothing owed');
select is(public.refund_recovered(pg_temp.v('r1'), 'trr_other', 10), 0::bigint, 'once');
select is(public.refund_settled(pg_temp.v('r1')), 'succeeded', 'Stripe finishes it');
select is(public.shop_order(pg_temp.h('s1'), pg_temp.v('oH')) ->> 'refund', 'partly_refunded',
  'the parent sees Partly refunded');
select ok(pg_temp.try(format($$ update public.order_refunds set amount_cents = 1 where id = %L $$, pg_temp.v('r1')))
  like '23514%', 'a refund''s amounts never change');
select ok(pg_temp.try(format($$ update public.order_refunds set status = 'requested' where id = %L $$, pg_temp.v('r1')))
  like '23514%', 'nor does its status go back');
select ok(pg_temp.try($$ delete from public.order_refunds $$) like '23514%', 'refunds are never deleted');

-- r2: a custom 10.00 of products (Q3), by the admin. Tax 2,027 × 1,000 / 15,595 = 129.98 → 130; fee 30. Stripe
-- succeeds at once; the transfer only had 1,000 of the 1,100 the studio gives back: a shortfall of 100 (Q2).
insert into t (name, id) select 'r2', (public.begin_refund('55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH'), gen_random_uuid(), 'custom', null, 1000, false,
  'quality') ->> 'refund_id')::uuid;
select results_eq($$ select products_cents, tax_cents, amount_cents, daybell_fee_cents from public.order_refunds
    where id = pg_temp.v('r2') $$, $$ values (1000::bigint, 130::bigint, 1130::bigint, 30::bigint) $$,
  'a custom amount is products before tax; tax is added pro rata');
select is((select count(*) from public.order_refund_lines where refund_id = pg_temp.v('r2')), 0::bigint,
  'and gives back no items');
select is(public.refund_accepted(pg_temp.v('r2'), 're_r2', 'succeeded'), 'succeeded', 'Stripe succeeds at once');
select is(public.refund_recovered(pg_temp.v('r2'), 'trr_r2', 1000), 100::bigint, 'the studio still owes 100');
-- r3: Ava's download. Tax 429, fee 99.
insert into t (name, id) select 'r3', (public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH'), gen_random_uuid(), 'lines',
  jsonb_build_array(jsonb_build_object('line_id', pg_temp.line(pg_temp.v('oH'), 'digital_single'), 'quantity', 1)),
  null, false, 'wrong_item') ->> 'refund_id')::uuid;
select results_eq($$ select tax_cents, amount_cents, daybell_fee_cents from public.order_refunds
    where id = pg_temp.v('r3') $$, $$ values (429::bigint, 3729::bigint, 99::bigint) $$, 'the download''s refund');
select public.refund_accepted(pg_temp.v('r3'), 're_r3', 'succeeded');
select public.refund_recovered(pg_temp.v('r3'), 'trr_r3', 3630);
select is(pg_temp.try(format($$ select public.shop_download_photo(pg_temp.h('s1'), %L, %L) $$, pg_temp.v('oH'),
  pg_temp.pid(2))), 'P0002 Download not found', 'a refunded download loses its link');
select ok((public.shop_download_photo(pg_temp.h('s1'), pg_temp.v('oH'), pg_temp.pid(1)) ->> 'photo_id') is not null,
  'the package''s download stays (a custom refund touches no quantities)');

-- ── The parent's cancel (answer 2; Q5, Q6) ────────────────────────────────────────────────────────────────────────
select is(pg_temp.try(format($$ select public.shop_order_cancel_begin(pg_temp.h('s2'), %L) $$, pg_temp.v('oH'))),
  'P0001 cannot_cancel', 'only the session that paid cancels (Q5)');
select is(pg_temp.try(format($$ select public.shop_order_cancel_begin(pg_temp.h('sb'), %L) $$, pg_temp.v('oH'))),
  'P0002 Order not found', 'another studio''s session finds nothing');
select is(pg_temp.try(format($$ select public.shop_order_cancel_begin(pg_temp.h('s2'), %L) $$, pg_temp.v('oD'))),
  'P0001 cannot_cancel', 'a digital-only order can''t be cancelled by the parent (Q6)');
select is(pg_temp.try(format($$ select public.shop_order_cancel_begin(pg_temp.h('s3'), %L) $$, pg_temp.v('oP'))),
  'P0001 cannot_cancel', 'nor one already printed (answer 2)');
select is((public.shop_order(pg_temp.h('s1'), pg_temp.v('oH')) ->> 'can_cancel')::boolean, true,
  'the payer of a Paid order may cancel it');
select is((public.shop_order(pg_temp.h('s2'), pg_temp.v('oH')) ->> 'can_cancel')::boolean, false,
  'the other parent may not');
insert into t (name, id) select 'r5', (public.shop_order_cancel_begin(pg_temp.h('s1'), pg_temp.v('oH')) ->> 'refund_id')::uuid;
-- Everything left: products 14,400 − 5,600 = 8,800, shipping 1,195, tax 2,027 − 728 = 1,299, fee 432 − 168 = 264.
select results_eq($$ select kind::text, reason::text, actor_id, products_cents, shipping_cents, tax_cents,
    amount_cents, daybell_fee_cents from public.order_refunds where id = pg_temp.v('r5') $$,
  $$ values ('cancel', 'parent_asked', null::uuid, 8800::bigint, 1195::bigint, 1299::bigint, 11294::bigint,
    264::bigint) $$, 'a cancel refunds everything left, shipping included, taking the exact remainders');
select is((select sum(quantity) from public.order_refund_lines where refund_id = pg_temp.v('r5')), 2::bigint,
  'every item left: the package and Noah''s other print');
select is(public.shop_order_cancel_begin(pg_temp.h('s1'), pg_temp.v('oH')),
  jsonb_build_object('refund_id', pg_temp.v('r5'), 'created', false, 'status', 'requested', 'stale', false),
  'a second tap is the same cancel, not yet worth asking Stripe again');
select isnt((select request_id from public.order_refunds where id = pg_temp.v('r5')), pg_temp.v('oH'),
  'a cancel has its own request id, never the order''s (code review S1)');
select is((select count(*) from public.order_action_attempts
  where subject_id = 'd1000000-0000-4000-8000-000000000001' and action = 'cancel'), 2::bigint,
  'and both taps count against the limit (security review S3)');
select is(public.refund_accepted(pg_temp.v('r5'), 're_r5', 'pending'), 'pending', 'Stripe accepts it');
select results_eq($$ select fulfilment_status::text, canceled_at is not null from public.orders
    where id = pg_temp.v('oH') $$, $$ values ('canceled', true) $$, 'the order is Canceled');
select is((select actor_id from public.events where type = 'order.canceled'), null::uuid,
  'order.canceled, with no actor (a parent did it)');
select is((select data ->> 'full' from public.events where type = 'order.refunded' and subject_id = pg_temp.v('oH')
  order by id desc limit 1), 'true', 'and the refund is full');
select is((select sum(amount_cents) from public.order_refunds where order_id = pg_temp.v('oH')), 17622::numeric,
  'the refunds add up to exactly what was paid');
select is((select sum(daybell_fee_cents) from public.order_refunds where order_id = pg_temp.v('oH')), 432::numeric,
  'and give back exactly Daybell''s fee');
select is((select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions x
  on x.id = e.transaction_id where x.order_id = pg_temp.v('oH') and e.account = 'studio_payable'), 541::numeric,
  'across the order, the studio bears exactly Stripe''s card fee (answer 1)');
select is((select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions x
  on x.id = e.transaction_id where x.order_id = pg_temp.v('oH')), 0::numeric, 'and every transaction balances');
select is(public.shop_order(pg_temp.h('s1'), pg_temp.v('oH')) ->> 'refund', 'refunded', 'Refunded');
select is(public.shop_order(pg_temp.h('s1'), pg_temp.v('oH')) -> 'lines' -> 0 -> 'downloads', '[]'::jsonb,
  'even a download already opened is gone (the package''s too)');
select is(pg_temp.try(format($$ select public.mark_order_status('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'printed') $$, pg_temp.v('oH'))), 'P0001 order_canceled',
  'a cancelled order can''t be printed');
select is(pg_temp.try(format($$ select public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, gen_random_uuid(), 'custom', null, 1, false, null) $$,
  pg_temp.v('oH'))), 'P0001 over_refund', 'nor refunded again');
select is(pg_temp.try(format($$ select public.shop_order_cancel_begin(pg_temp.h('s3'), %L) $$, pg_temp.v('oS'))),
  'P0001 cannot_cancel', 'a delivered order can''t be cancelled');

-- ── A failed refund (refund_failed) ───────────────────────────────────────────────────────────────────────────────
insert into t (name, id) select 'r4', (public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oD'), gen_random_uuid(), 'lines',
  jsonb_build_array(jsonb_build_object('line_id', pg_temp.line(pg_temp.v('oD'), 'digital_single'), 'quantity', 1)),
  null, false, 'parent_asked') ->> 'refund_id')::uuid;
select public.refund_accepted(pg_temp.v('r4'), 're_r4', 'pending');
select is(pg_temp.try(format($$ select public.shop_download_photo(pg_temp.h('s2'), %L, %L) $$, pg_temp.v('oD'),
  pg_temp.pid(1))), 'P0002 Download not found', 'the refunded download is gone');
select is(public.refund_failed(pg_temp.v('r4'), 'expired_or_canceled_card'), 'failed', 'then Stripe says it failed');
select is(pg_temp.ledger(pg_temp.v('r4'), 'refund_failed'),
  'refunds 3729, tax_payable -429, daybell_fees -99, studio_payable -3201', 'its mirror in the ledger');
select is((select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions x
  on x.id = e.transaction_id where x.refund_id = pg_temp.v('r4') and e.account = 'refunds'), 0::numeric,
  'so the failed refund nets to nothing');
select ok((public.shop_download_photo(pg_temp.h('s2'), pg_temp.v('oD'), pg_temp.pid(1)) ->> 'photo_id') is not null,
  'and the download comes back');
select is(public.refund_failed(pg_temp.v('r4'), 'expired_or_canceled_card'), 'failed', 'once');
insert into t (name, id) select 'r9', (public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oD'), gen_random_uuid(), 'custom', null, 100, false, null)
  ->> 'refund_id')::uuid;
select public.refund_accepted(pg_temp.v('r9'), 're_r9', 'succeeded');
select public.refund_recovered(pg_temp.v('r9'), 'trr_r9', 50);
select is(pg_temp.try(format($$ select public.refund_failed(%L, 'lost_or_stolen_card') $$, pg_temp.v('r9'))), 'ok',
  'a succeeded refund can still fail at Stripe');
select is((select status::text from public.order_refunds where id = pg_temp.v('r9')), 'failed', 'and does');
select is((public.refund_for_stripe(pg_temp.v('r9')) ->> 'return_needed_cents')::bigint, 50::bigint,
  'what the studio gave back for it is to be sent back (Q7)');
select is(public.refunds_to_retry(10), jsonb_build_array(jsonb_build_object('refund_id', pg_temp.v('r9'))),
  'the cron sends it back if the API didn''t');
select lives_ok(format($$ select public.refund_share_returned(%L, 'tr_ret9', 50) $$, pg_temp.v('r9')),
  'sent back by a transfer');
select lives_ok(format($$ select public.refund_share_returned(%L, 'tr_other', 50) $$, pg_temp.v('r9')), 'once');
select results_eq($$ select returned_cents, stripe_return_transfer_id,
    (public.refund_for_stripe(id) ->> 'return_needed_cents')::bigint from public.order_refunds
    where id = pg_temp.v('r9') $$, $$ values (50::bigint, 'tr_ret9', 0::bigint) $$, 'recorded, nothing more to send');
select is(public.refunds_to_retry(10), '[]'::jsonb, 'nor retried');
-- A shipping-only refund in By item mode (code review S5): no lines, the shipping left; abandoned here.
insert into t (name, id) select 'rShip', (public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oP'), gen_random_uuid(), 'lines', '[]', null, true, null)
  ->> 'refund_id')::uuid;
select results_eq($$ select products_cents, shipping_cents, (select count(*) from public.order_refund_lines rl
    where rl.refund_id = r.id) from public.order_refunds r where r.id = pg_temp.v('rShip') $$,
  $$ values (0::bigint, 1195::bigint, 0::bigint) $$, 'a shipping-only refund gives back the shipping and no items');
select public.refund_abandoned(pg_temp.v('rShip'), 'stripe_refused');
-- A refund that fails after the studio's share was taken back sends that share back (Q7).
select is(pg_temp.try(format($$ select public.refund_share_returned(%L, 'tr_ret9', 50) $$, pg_temp.v('r1'))),
  'P0001 not_failed', 'only a failed refund''s share is sent back');
-- A refund Stripe refused outright never happened.
insert into t (name, id) select 'r6', (public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oD'), gen_random_uuid(), 'custom', null, 500, false, null)
  ->> 'refund_id')::uuid;
select public.refund_abandoned(pg_temp.v('r6'), 'amount_too_large');
select results_eq($$ select status::text, failure_code from public.order_refunds where id = pg_temp.v('r6') $$,
  $$ values ('canceled', 'amount_too_large') $$, 'a refund Stripe refused is canceled, with its code');
select is((select count(*) from public.ledger_transactions where refund_id = pg_temp.v('r6')), 0::bigint,
  'and writes nothing to the ledger');

-- ── Shortfalls (Q2) ───────────────────────────────────────────────────────────────────────────────────────────────
-- r1's reversal took all it needed; say instead r5's transfer fell short by 97 (the card fee already reversed).
select public.refund_recovered(pg_temp.v('r5'), 'trr_r5', 10933);
select public.refund_settled(pg_temp.v('r5'));
select is((select unrecovered_cents from public.order_refunds where id = pg_temp.v('r5')), 97::bigint,
  'a shortfall of 97 is owed by the studio');
-- The studio's next settled sale (oP) pays it back; r5 accepted before oP was paid.
alter table public.order_refunds disable trigger order_refunds_guard;
update public.order_refunds set accepted_at = now() - interval '1 day' where id = pg_temp.v('r5');
alter table public.order_refunds enable trigger order_refunds_guard;
select is(public.refund_shortfalls_for_sale(pg_temp.v('oP')),
  jsonb_build_array(jsonb_build_object('refund_id', pg_temp.v('r5'), 'unrecovered_cents', 97)),
  'the next settled sale lists what is owed');
select is(public.refund_shortfalls_due(10), (select jsonb_build_array(jsonb_build_object('refund_id', pg_temp.v('r5'),
  'order_id', o.id, 'transfer_id', o.transfer_id)) from public.orders o
  where o.studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and o.fees_settled_at is not null
    and o.id <> pg_temp.v('oH') order by o.paid_at desc, o.id limit 1),
  'and the cron finds it too, with the sale''s transfer');
select is(public.refund_shortfall_recovered(pg_temp.v('r5'), pg_temp.v('oP'), 97, 'trr_short'), 0::bigint,
  'recovered from that sale''s transfer');
select is(public.refund_shortfall_recovered(pg_temp.v('r5'), pg_temp.v('oP'), 97, 'trr_short'), 0::bigint, 'once');
select is(public.refund_shortfalls_for_sale(pg_temp.v('oP')), '[]'::jsonb, 'nothing more is owed');
select is(pg_temp.try(format($$ select public.refund_shortfall_recovered(%L, %L, 1, 'trr_x') $$, pg_temp.v('r5'),
  pg_temp.v('oB'))), 'P0002 Refund not found', 'never from another studio''s sale');
-- A shortfall 180 days old is absorbed by Daybell.
insert into t (name, id) select 'r7', (public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oP'), gen_random_uuid(), 'custom', null, 100, false, null)
  ->> 'refund_id')::uuid;
select public.refund_accepted(pg_temp.v('r7'), 're_r7', 'succeeded');
select public.refund_recovered(pg_temp.v('r7'), 'trr_r7', 50);
select is(public.absorb_refund_shortfalls(10), 0, 'a recent shortfall waits for a sale');
alter table public.order_refunds disable trigger order_refunds_guard;
update public.order_refunds set accepted_at = now() - interval '400 days' where id = pg_temp.v('r7');
alter table public.order_refunds enable trigger order_refunds_guard;
select is(public.absorb_refund_shortfalls(10), 0,
  'a studio that sold within 180 days still owes it, however old the refund (Q2; code review S2)');
-- The studio's other sales, 100 then 200 days ago (put back after).
create temp table paid_was on commit drop as select id, paid_at from public.orders
  where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and id <> pg_temp.v('oP');
alter table public.orders disable trigger orders_guard;
update public.orders set paid_at = now() - interval '100 days' where id in (select id from paid_was);
select is(public.absorb_refund_shortfalls(10), 0, 'a sale 100 days ago starts the 180 days again');
update public.order_refunds set problem = 'refund_mismatch', problem_at = now() where id = pg_temp.v('r7');
update public.orders set paid_at = now() - interval '200 days' where id in (select id from paid_was);
select is(public.absorb_refund_shortfalls(10), 0, 'never one with a problem (support looks first)');
update public.order_refunds set problem = null, problem_at = null where id = pg_temp.v('r7');
select is(public.absorb_refund_shortfalls(10), 1, 'after 180 days without a settled sale it is absorbed');
update public.orders o set paid_at = w.paid_at from paid_was w where o.id = w.id;
alter table public.orders enable trigger orders_guard;
select is(pg_temp.ledger(pg_temp.v('r7'), 'refund_shortfall'), 'studio_payable -' ||
  (select absorbed_cents from public.order_refunds where id = pg_temp.v('r7')) || ', daybell_fees ' ||
  (select absorbed_cents from public.order_refunds where id = pg_temp.v('r7')),
  'a balanced refund_shortfall: the studio owes nothing, Daybell bears it');
select results_eq($$ select unrecovered_cents, absorbed_at is not null from public.order_refunds
    where id = pg_temp.v('r7') $$, $$ values (0::bigint, true) $$, 'once');
select is(public.absorb_refund_shortfalls(10), 0, 'and never twice');

-- ── The cron's refund backstop ────────────────────────────────────────────────────────────────────────────────────
insert into t (name, id) select 'r8', (public.begin_refund('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oP'), gen_random_uuid(), 'custom', null, 100, false, null)
  ->> 'refund_id')::uuid;
select is(public.refunds_to_retry(10), '[]'::jsonb, 'a refund just asked for isn''t retried yet');
alter table public.order_refunds disable trigger order_refunds_guard;
update public.order_refunds set created_at = now() - interval '2 minutes' where id = pg_temp.v('r8');
alter table public.order_refunds enable trigger order_refunds_guard;
select is(public.refunds_to_retry(10), jsonb_build_array(jsonb_build_object('refund_id', pg_temp.v('r8'))),
  'one Stripe hasn''t accepted after a minute is');
select public.note_refund_failure(pg_temp.v('r8'), 'stripe_unavailable', false);
select is(public.refunds_to_retry(10), '[]'::jsonb, 'backing off after a failure');
update public.order_refunds set backstop_next_at = now() - interval '1 second' where id = pg_temp.v('r8');
select public.note_refund_failure(pg_temp.v('r8'), 'refund_mismatch', true);
update public.order_refunds set backstop_next_at = now() - interval '1 second' where id = pg_temp.v('r8');
select is(public.refunds_to_retry(10), '[]'::jsonb, 'and a problem no retry can fix is never retried');

-- ── Stripe's payment events ───────────────────────────────────────────────────────────────────────────────────────
select is((public.record_payment_stripe_event('evt_R1', 'refund.updated', pg_temp.v('oH'),
  'pi_' || md5(pg_temp.v('oH')::text), false, now()) ->> 'claimed')::boolean, true, 'a refund event is claimed');
select is((public.record_payment_stripe_event('evt_R1', 'refund.updated', pg_temp.v('oH'),
  'pi_' || md5(pg_temp.v('oH')::text), false, now()) ->> 'claimed')::boolean, false, 'once');
select is((public.record_payment_stripe_event('evt_R2', 'charge.refunded', pg_temp.v('oH'), 'pi_other', false,
  now()) ->> 'mismatch')::boolean, true, 'a payment that isn''t the order''s is a permanent mismatch');
select is(public.record_payment_stripe_event('evt_R3', 'charge.refunded', '00000000-0000-4000-8000-000000000000',
  'pi_x', false, now()), null, 'an unknown order: null (404)');
select is(pg_temp.try(format($$ select public.record_payment_stripe_event('evt_R4', 'payment_intent.succeeded', %L,
  'pi_x', false, now()) $$, pg_temp.v('oH'))), '22023 Payment events only', 'other types are refused');
select is(public.refund_by_stripe(pg_temp.v('oH'), pg_temp.v('r1'), 're_r1'), pg_temp.v('r1'),
  'Daybell''s refund is found by its id and Stripe''s');
select is(public.refund_by_stripe(pg_temp.v('oD'), pg_temp.v('r1'), 're_r1'), null,
  'never on another order');
select is(public.order_disputed(pg_temp.v('oP')), true, 'a dispute is flagged');
select is(public.order_disputed(pg_temp.v('oP')), false, 'once');

-- ── The bell ──────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select array_agg(m.role::text order by m.role) from public.notifications n
  join public.studio_members m on m.user_id = n.user_id and m.studio_id = n.studio_id
  where n.kind = 'order_paid' and n.order_id = pg_temp.v('oH')), array['owner', 'admin', 'staff'],
  'a new order rings for owners, admins and staff, never photographers');
select is((select array_agg(x.role::text order by x.role) from (select distinct m.role from public.notifications n
  join public.studio_members m on m.user_id = n.user_id and m.studio_id = n.studio_id
  where n.kind = 'refund_failed' and n.order_id = pg_temp.v('oD')) x), array['owner', 'admin'],
  'a failed refund for owners and admins');
select is((select array_agg(m.role::text order by m.role) from public.notifications n
  join public.studio_members m on m.user_id = n.user_id and m.studio_id = n.studio_id
  where n.kind = 'dispute_opened'), array['owner', 'admin'], 'a dispute for owners and admins');
select is((select count(*) from public.notifications where kind = 'order_paid'
  and studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id <> '22222222-2222-4222-8222-222222222222'),
  0::bigint, 'and only for the order''s own studio');

-- ── Studio reads by role (Q4) and leak tests ──────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select is((select count(*) from public.orders), 5::bigint, 'staff read the studio''s paid orders');
select is((select count(*) from public.order_refunds) + (select count(*) from public.order_refund_lines)
  + (select count(*) from public.ledger_entries) + (select count(*) from public.events), 0::bigint,
  'but no refunds, refund lines, ledger or events (Q4)');
select ok(public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH')) -> 'refunds' = '[]'::jsonb
  and public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH')) -> 'ledger' = '[]'::jsonb,
  'the order page shows staff no refunds or ledger');
select is(public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH')) -> 'refund_state' ->> 'badge',
  'refunded', 'but does show the Refunded badge');
select is((public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH')) -> 'refund_state' -> 'lines'
  ->> pg_temp.line(pg_temp.v('oH'), 'print')::text)::int, 2, 'and how many of each line were given back');
select ok(public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oP')) -> 'ship_to' ->> 'name'
  = 'Priya Patel', 'and where a home order ships, to ship it');
select is((public.studio_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'America/Toronto') -> 'ranges' -> 'today'
  ->> 'sales_cents')::bigint, 0::bigint, 'Home''s money reads nothing for staff');
select is(public.studio_order_todo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '{"to_ship": 0, "to_print": 1, "to_deliver": 0}'::jsonb,
  'To do: oU to print (oH is cancelled, oP shipped, oS delivered)');
select is(jsonb_array_length(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')), 5, 'the list');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select is((select count(*) from public.order_refunds), 10::bigint, 'the owner reads every refund');
select is(jsonb_array_length(public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH')) -> 'refunds'),
  4, 'and the order''s refunds on its page');
select ok(jsonb_array_length(public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH')) -> 'ledger')
  = 5, 'and its ledger: the sale and four refunds');
select is(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, '{delivered}') -> 0 ->> 'id',
  pg_temp.v('oS')::text, 'filtered by status');
-- D147: Orders' Done chip asks for several statuses at once (shipped, delivered or complete).
select set_eq($$ select (e ->> 'id')::uuid from jsonb_array_elements(public.studio_orders(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, '{shipped,delivered,complete}')) e $$,
  $$ values (pg_temp.v('oP')), (pg_temp.v('oS')), (pg_temp.v('oD')) $$,
  'filtered by several statuses: Done is the shipped, delivered and complete orders (D147)');
select is(jsonb_array_length(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, '{paid,printed}')),
  1, 'and Paid with Printed together still leave out what was refunded in full (oU only)');
select is(jsonb_array_length(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null,
  lower(left((select reference from public.orders where id = pg_temp.v('oP')), 4)))) >= 1, true,
  'and by the start of a reference');
select is(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, '{canceled}') -> 0 -> 'children' -> 0,
  jsonb_build_object('id', 'c0000000-0000-4000-8000-000000000001', 'first_name', 'Ava', 'last_initial', 'P'),
  'children by first name and last initial');
select is((public.studio_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'America/Toronto') -> 'ranges' -> 'today'
  ->> 'sales_cents')::numeric, (select sum(amount_cents) from public.ledger_entries
    where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and account in ('parent_payments', 'refunds')),
  'Home''s sales: what parents paid less refunds, from the ledger');
select is((public.studio_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'America/Toronto') -> 'ranges' -> 'week'
  ->> 'orders')::int, 5, 'orders paid this week, counted when paid (oU''s fee isn''t settled yet; code review N5)');
select is(jsonb_array_length(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null, null, 50, null,
  'school')), 2, 'filtered by delivery: the two school orders');
select is((public.studio_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'America/Toronto') ->> 'currency'), 'CAD',
  'in the region''s currency');
select is(pg_temp.try($$ select public.studio_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mars/Olympus') $$),
  '22023 A time zone, e.g. America/Toronto', 'a real time zone only');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select is((select count(*) from public.orders) + (select count(*) from public.order_refunds), 0::bigint,
  'a photographer reads no orders or refunds');
select is(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), '[]'::jsonb, 'nor through the list');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select is((select count(*) from public.orders o where o.studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  + (select count(*) from public.order_refunds) + (select count(*) from public.order_refund_lines)
  + (select count(*) from public.order_refund_recoveries) + (select count(*) from public.order_shipping_addresses),
  0::bigint, 'studio B''s owner sees none of A''s orders, refunds, refund lines, recoveries or addresses');
select is(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), '[]'::jsonb, 'nor A''s list');
select is(public.studio_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oH')), null, 'nor an order of A''s');
select is(public.studio_order_todo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '{"to_ship": 0, "to_print": 0, "to_deliver": 0}'::jsonb, 'nor A''s to-do');
select is((public.studio_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'UTC') -> 'ranges' -> 'season'
  ->> 'sales_cents')::bigint, 0::bigint, 'nor A''s sales');
select is(app.studio_order_refund_state(pg_temp.v('oH')), null, 'nor its refund state');
set local role anon;
select throws_ok($$ select count(*) from public.order_refunds $$, '42501', null, 'logged-out visitors read nothing');
reset role;

-- ── Zips (Claude's call) ──────────────────────────────────────────────────────────────────────────────────────────
select is(public.shop_order_download_all(pg_temp.h('s2'), pg_temp.v('oD')) -> 'files',
  jsonb_build_array(jsonb_build_object('job_id', 'a0000000-0000-4000-8000-000000000001', 'photo_id', pg_temp.pid(1),
    'n', 1)), 'Download all lists the order''s downloads, numbered');
select is(pg_temp.try(format($$ select public.shop_order_download_all(pg_temp.h('sb'), %L) $$, pg_temp.v('oD'))),
  'P0002 Order not found', 'never another studio''s');
select is(public.shop_order_download_all(pg_temp.h('s1'), pg_temp.v('oH')) -> 'files', '[]'::jsonb,
  'a fully refunded order has nothing to download');
select is(public.shop_download_all_request(pg_temp.h('s2'), pg_temp.v('oD'), array[pg_temp.pid(1), pg_temp.pid(6)]),
  jsonb_build_object('queued', jsonb_build_array(pg_temp.pid(1)), 'unavailable', 0),
  'a missing file is queued (another studio''s photo is ignored)');
select is((select count(*) from public.order_action_attempts where action like 'zip%'), 0::bigint,
  'listing the files counts nothing: a 409 while they are made never uses up the limit (code review N1)');
insert into public.order_action_attempts (studio_id, subject_id, action)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000002', 'zip' from generate_series(1, 9);
select is(pg_temp.try(format($$ select public.shop_zip_take(pg_temp.h('s2'), %L) $$, pg_temp.v('oD'))),
  'ok', 'the tenth zip in an hour is fine');
select is(pg_temp.try(format($$ select public.shop_zip_take(pg_temp.h('s2'), %L) $$, pg_temp.v('oD'))),
  'P0001 zip_limit', 'the eleventh is refused');
select is(pg_temp.try(format($$ select public.shop_zip_take(pg_temp.h('sb'), %L) $$, pg_temp.v('oD'))),
  'P0002 Order not found', 'never another studio''s order');
insert into public.order_action_attempts (studio_id, subject_id, action)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oP'), 'zip_order' from generate_series(1, 20);
select is(pg_temp.try(format($$ select public.shop_zip_take(pg_temp.h('s3'), %L) $$, pg_temp.v('oP'))),
  'P0001 zip_limit', 'an order gives at most 20 zips an hour, whatever the session (security review S4)');
select is(pg_temp.try(format($$ select public.order_zip_take('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L) $$, pg_temp.v('oP'))), 'P0001 zip_limit', 'or person');
select is(pg_temp.try(format($$ select public.order_zip_take('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L) $$, pg_temp.v('oS'))), 'ok', 'another order is fine');
select is(pg_temp.try(format($$ select public.order_zip_take('33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L) $$, pg_temp.v('oS'))), '42501 Not allowed for your role',
  'never photographers');
select is((public.order_print_files('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('oP')) -> 'files' -> 0 ->> 'quantity')::int, 1, 'staff get the print files of an order');
select is(public.order_print_files('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('oH')) -> 'files', '[]'::jsonb, 'none left to print on a fully refunded order');
select is(pg_temp.try(format($$ select public.order_print_files('33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L) $$, pg_temp.v('oP'))), '42501 Not allowed for your role',
  'never photographers');
select is(pg_temp.try(format($$ select public.order_print_files('22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', %L) $$, pg_temp.v('oP'))), 'P0002 Order not found',
  'nor another studio');
select is(public.order_print_files_to_make('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('oP'), array[pg_temp.pid(3), pg_temp.pid(6)]),
  jsonb_build_object('queued', jsonb_build_array(pg_temp.pid(3)), 'unavailable', 0),
  'a missing print file is queued (never another studio''s photo)');

-- ── The address purge (step 10's launch blocker) ──────────────────────────────────────────────────────────────────
alter table public.orders disable trigger orders_guard_fulfilment;
update public.orders set shipped_at = now() - interval '89 days' where id = pg_temp.v('oP');
alter table public.orders enable trigger orders_guard_fulfilment;
select is(public.purge_shipping_addresses(10), 0, 'not 89 days after shipping');
alter table public.orders disable trigger orders_guard_fulfilment;
update public.orders set shipped_at = now() - interval '91 days' where id = pg_temp.v('oP');
alter table public.orders enable trigger orders_guard_fulfilment;
select is(public.purge_shipping_addresses(10), 1, 'but 91 days after');
select results_eq($$ select ship_to_purged_at is not null, (select count(*) from public.order_shipping_addresses a
    where a.order_id = o.id) from public.orders o where o.id = pg_temp.v('oP') $$, $$ values (true, 0::bigint) $$,
  'the address is gone and the order says when');
select results_eq($$ select carrier::text, tracking_number, tracking_url from public.orders where id = pg_temp.v('oP') $$,
  $$ values ('ups', null::text, null::text) $$, 'the tracking number goes with it; the carrier stays (code review B2)');
select is(public.shop_order(pg_temp.h('s3'), pg_temp.v('oP')) -> 'tracking', 'null'::jsonb,
  'the parent no longer sees tracking');
select is(pg_temp.try(format($$ select public.set_order_tracking('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, 'ups', '1Z999AA10123456784') $$, pg_temp.v('oP'))),
  'P0001 status_invalid', 'and it can''t be put back');
select is((select count(*) from public.events where type = 'order.address_purged' and subject_id = pg_temp.v('oP')
  and actor_id is null and data = '{}'::jsonb), 1::bigint, 'one order.address_purged, with nothing in it');
-- oH, cancelled (never shipped): 91 days after payment.
alter table public.orders disable trigger orders_guard;
update public.orders set paid_at = now() - interval '91 days' where id = pg_temp.v('oH');
alter table public.orders enable trigger orders_guard;
select is(public.purge_shipping_addresses(10), 1, 'a cancelled order''s address goes 90 days after payment');
-- oC (S1, home): a 4×6 of Noah.
select pg_temp.add('s1', 'c0000000-0000-4000-8000-000000000002', 'print', '4×6 print', 4, 1);
select public.shop_set_shipping(pg_temp.h('s1'), 'home');
insert into t (name, id) select 'oC', pg_temp.buy('s1', 169, 68);
-- A cancel whose refund then failed can be tried again, as its own refund (code review S1).
insert into t (name, id) select 'rC1', (public.shop_order_cancel_begin(pg_temp.h('s1'), pg_temp.v('oC')) ->> 'refund_id')::uuid;
select public.refund_accepted(pg_temp.v('rC1'), 're_rC1', 'pending');
select public.refund_failed(pg_temp.v('rC1'), 'expired_or_canceled_card');
select is((select fulfilment_status::text from public.orders where id = pg_temp.v('oC')), 'paid',
  'a cancel whose refund failed puts the order back to Paid');
select is((public.shop_order(pg_temp.h('s1'), pg_temp.v('oC')) ->> 'can_cancel')::boolean, true,
  'and the parent may cancel again');
insert into t (name, id) select 'rC2', (public.shop_order_cancel_begin(pg_temp.h('s1'), pg_temp.v('oC')) ->> 'refund_id')::uuid;
select ok(pg_temp.v('rC2') is not null and pg_temp.v('rC2') <> pg_temp.v('rC1'), 'a new try is a new refund');
select public.refund_abandoned(pg_temp.v('rC2'), 'stripe_refused');
-- The cancel limit: 5 a session an hour (S1 tried four times already: oH twice, oC twice).
insert into public.order_action_attempts (studio_id, subject_id, action)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001', 'cancel');
select is(pg_temp.try(format($$ select public.shop_order_cancel_begin(pg_temp.h('s1'), %L) $$, pg_temp.v('oC'))),
  'P0001 cancel_limit', 'a sixth cancel in an hour is refused');
select is(pg_temp.try(format($$ select public.shop_order_cancel_begin(pg_temp.h('s1'), %L) $$, pg_temp.v('oH'))),
  'P0001 cancel_limit', 'even a repeat of a cancel already made (security review S3)');
-- The hard cap: 365 days after payment, whatever happened (Seenu).
alter table public.orders disable trigger orders_guard;
update public.orders set paid_at = now() - interval '364 days' where id = pg_temp.v('oC');
alter table public.orders enable trigger orders_guard;
select is(public.purge_shipping_addresses(10), 0, 'a paid order never shipped keeps its address up to 365 days');
alter table public.orders disable trigger orders_guard;
update public.orders set paid_at = now() - interval '366 days' where id = pg_temp.v('oC');
alter table public.orders enable trigger orders_guard;
select is(public.purge_shipping_addresses(10), 1, 'and not after');

-- ── Privacy ───────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from public.events where type like 'order.%'
  and (data::text ~* '(@|patel|priya|maple|toronto|m5v|cents|7023|1Z999|TRK|https)' or data ? 'amount')), 0::bigint,
  'no order event holds an amount, a name, an address, a tracking number or a link');
select is((select count(*) from public.events where type like 'order.%' and not (data - array['kind', 'reason',
  'line_count', 'full', 'carrier', 'from', 'to', 'shipping_method'] = '{}'::jsonb)), 0::bigint,
  'only fixed keys');

select * from finish();
rollback;
