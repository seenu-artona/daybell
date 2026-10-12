-- Payouts with Stripe Connect (D56, D98, D106, D143, D96, D113; Seenu's answers 1–4 and Q1–Q6, Claude's calls of Oct
-- 12 2026; ADR 0020): only the owner connects and changes the schedule; owners and admins read; photographers, staff,
-- outsiders, removed members and anon read nothing; nobody signed in writes; another studio sees and changes nothing
-- (accounts, payouts, the inbox, the functions); Stripe events are recorded once and finished only by the delivery
-- holding the lease; permanent failures aren't retried; an older answer from Stripe never overwrites a newer copy;
-- syncs that change nothing write no event; calls to Stripe are budgeted per studio per minute; events carry ids and
-- status words only; a studio with a Stripe account can't be deleted.
begin;
create extension if not exists pgtap with schema extensions;
select plan(121);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin-a@example.test'),
  ('66666666-6666-4666-8666-666666666666', 'owner-c@example.test'),
  ('77777777-7777-4777-8777-777777777777', 'outsider@example.test'),
  ('88888888-8888-4888-8888-888888888888', 'removed-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Studio C', 'studio-c', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'admin'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '66666666-6666-4666-8666-666666666666', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 'staff');
delete from public.studio_members where user_id = '88888888-8888-4888-8888-888888888888';

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
grant execute on function pg_temp.as_user(uuid) to authenticated, anon;

create temp table facts as select
  '{"details_submitted": false, "charges_enabled": false, "payouts_enabled": false, "disabled_reason": "requirements.past_due", "currently_due_count": 6, "past_due_count": 6, "pending_verification_count": 0, "requirements_deadline": null}'::jsonb as fresh,
  '{"details_submitted": true, "charges_enabled": true, "payouts_enabled": true, "disabled_reason": null, "currently_due_count": 0, "past_due_count": 0, "pending_verification_count": 0, "requirements_deadline": null}'::jsonb as active,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "monthly_anchor": null, "delay_days": 2}'::jsonb as weekly,
  '{"payout_interval": "monthly", "weekly_anchor": null, "monthly_anchor": 15, "delay_days": 2}'::jsonb as monthly;
grant select on facts to authenticated, anon;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'payout_accounts', 'payout_accounts exists');
select has_table('public', 'payouts', 'payouts exists');
select has_table('public', 'stripe_events', 'stripe_events exists');
select is((select data_type from information_schema.columns
  where table_name = 'payouts' and column_name = 'amount_cents'), 'bigint', 'payout amounts are whole cents (bigint)');
select hasnt_column('public', 'payout_accounts', 'external_account', 'no bank details are kept');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where proname in ('create_payout_account', 'set_payout_schedule', 'record_stripe_event', 'finish_stripe_event',
    'sync_payout_account', 'sync_payout', 'take_stripe_call', 'act_for_owner', 'guard_payout_account',
    'guard_payout')),
  'the functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from unnest(array[
    'public.create_payout_account(uuid, uuid, text, boolean, jsonb, jsonb, public.payout_account_status, timestamptz)',
    'public.set_payout_schedule(uuid, uuid, jsonb, timestamptz)',
    'public.record_stripe_event(text, text, text, boolean, timestamptz)',
    'public.finish_stripe_event(bigint, uuid, text, boolean)',
    'public.sync_payout_account(text, jsonb, jsonb, public.payout_account_status, timestamptz)',
    'public.sync_payout(text, jsonb, timestamptz)',
    'public.take_stripe_call(uuid, integer)']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  0::bigint, 'browsers and logged-out visitors can run none of the write functions');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
  where p.proname in ('create_payout_account', 'set_payout_schedule', 'record_stripe_event', 'finish_stripe_event',
    'sync_payout_account', 'sync_payout', 'take_stripe_call') and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC can run none of them');
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')) from unnest(array[
    'public.create_payout_account(uuid, uuid, text, boolean, jsonb, jsonb, public.payout_account_status, timestamptz)',
    'public.sync_payout(text, jsonb, timestamptz)', 'public.record_stripe_event(text, text, text, boolean, timestamptz)',
    'public.finish_stripe_event(bigint, uuid, text, boolean)', 'public.take_stripe_call(uuid, integer)']) f),
  'the service role runs them');
select is((select count(*) from unnest(array['app.act_for_owner(uuid, uuid)', 'app.guard_payout_account()',
    'app.on_payout_change()']) f where has_function_privilege('authenticated', f, 'execute')), 0::bigint,
  'browsers can run no app helper');
select is((select count(*) from (values ('payout_accounts'), ('payouts'), ('stripe_events'), ('stripe_call_budget')) t (n),
    unnest(array['insert', 'update', 'delete', 'truncate']) p
  where has_table_privilege('authenticated', 'public.' || n, p)), 0::bigint,
  'signed-in people can''t insert, update, delete or truncate any of the four tables');
select ok(not has_table_privilege('authenticated', 'public.stripe_events', 'select'),
  'signed-in people can''t read the webhook inbox');
select ok(not has_table_privilege('authenticated', 'public.stripe_call_budget', 'select'),
  'nor the Stripe call budget');

-- ── The owner connects (acted for by the API as the service role) ─────────────────────────────────────────────────
select lives_ok($$ select public.create_payout_account('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A1', false, (select fresh from facts), (select weekly from facts),
  'needs_info') $$, 'the owner records their studio''s Stripe account');
select results_eq($$ select country::text, status::text, payout_interval::text, weekly_anchor::text, currently_due_count
  from public.payout_accounts where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  $$ values ('US', 'needs_info', 'weekly', 'friday', 6) $$,
  'with the region''s country, the status, a weekly Friday schedule and counts');
select results_eq($$ select actor_id, data from public.events where type = 'payout_account.created' $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid, '{"country": "US"}'::jsonb) $$,
  'payout_account.created is attributed to the owner and carries the country only');
select is(public.create_payout_account('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'acct_A1', false, (select fresh from facts), (select weekly from facts), 'needs_info'),
  (select id from public.payout_accounts where stripe_account_id = 'acct_A1'), 'calling again with the same account is harmless');
select is((select count(*) from public.events where type = 'payout_account.created'), 1::bigint,
  'and writes no second event');
select throws_ok($$ select public.create_payout_account('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A2', false, (select fresh from facts), (select weekly from facts),
  'needs_info') $$, 'P0001', 'already_connected', 'a second account for the studio is refused (Q16)');
select throws_ok($$ select public.create_payout_account('55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A1', false, (select fresh from facts), (select weekly from facts),
  'needs_info') $$, '42501', 'Owners only', 'an admin can''t connect (Seenu, answer 1)');
select throws_ok($$ select public.create_payout_account('33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A1', false, (select fresh from facts), (select weekly from facts),
  'needs_info') $$, '42501', 'Owners only', 'nor a photographer');
select throws_ok($$ select public.create_payout_account('44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A9', false, (select fresh from facts), (select weekly from facts),
  'needs_info') $$, '42501', null, 'nor staff, before anything is read');
select throws_ok($$ select public.create_payout_account('22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_B9', false, (select fresh from facts), (select weekly from facts),
  'needs_info') $$, '42501', null, 'nor another studio''s owner');
select throws_ok($$ select public.create_payout_account(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A9', false,
  (select fresh from facts), (select weekly from facts), 'needs_info') $$, '42501', null, 'nor nobody');
select throws_ok($$ select public.create_payout_account('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A1', false, '[]'::jsonb, (select weekly from facts), 'needs_info') $$,
  '22023', null, 'facts must be an object');
select lives_ok($$ select public.create_payout_account('22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'acct_B1', false, (select active from facts), (select weekly from facts),
  'active') $$, 'studio B''s owner connects B');
select throws_ok($$ select public.create_payout_account('66666666-6666-4666-8666-666666666666',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'acct_A1', false, (select fresh from facts), (select weekly from facts),
  'needs_info') $$, '23505', null, 'one Stripe account never belongs to two studios');

-- ── Checks ────────────────────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, status,
  payout_interval, weekly_anchor, delay_days) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'acct-bad', 'US', false,
  'needs_info', 'weekly', 'friday', 2) $$, '23514', null, 'Stripe account ids are checked');
select throws_ok($$ insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, status,
  payout_interval, delay_days) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'acct_C1', 'US', false, 'needs_info',
  'weekly', 2) $$, '23514', null, 'weekly needs a weekday');
select throws_ok($$ insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, status,
  payout_interval, monthly_anchor, delay_days) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'acct_C1', 'US', false,
  'needs_info', 'monthly', 32, 2) $$, '23514', null, 'monthly takes a date from 1 to 31');
select throws_ok($$ insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, status,
  payout_interval, weekly_anchor, delay_days) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'acct_C1', 'CA', false,
  'needs_info', 'weekly', 'friday', 2) $$, '23514', 'payout_country', 'the country is the studio''s region''s');
select throws_ok($$ insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, status,
  payout_interval, weekly_anchor, delay_days, disabled_reason) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'acct_C1', 'US', false, 'needs_info', 'weekly', 'friday', 2, 'Some free text') $$, '23514', null,
  'Stripe''s reason is a code, never free text');
select throws_ok($$ update public.payout_accounts set stripe_account_id = 'acct_A7'
  where stripe_account_id = 'acct_A1' $$, '23514', 'payout_account_fixed', 'an account''s Stripe id never changes');

-- ── The schedule (owner only, after Stripe accepts it) ────────────────────────────────────────────────────────────
select lives_ok($$ select public.set_payout_schedule('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select monthly from facts)) $$, 'the owner saves a monthly schedule');
select results_eq($$ select payout_interval::text, weekly_anchor::text, monthly_anchor::int from public.payout_accounts
  where stripe_account_id = 'acct_A1' $$, $$ values ('monthly', null::text, 15) $$, 'on the 15th');
select results_eq($$ select actor_id, data from public.events where type = 'payout_account.schedule_changed' $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid, '{"from": "weekly", "to": "monthly"}'::jsonb) $$,
  'payout_account.schedule_changed carries the intervals only, attributed to the owner');
select lives_ok($$ select public.set_payout_schedule('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select monthly from facts)) $$, 'the same schedule again');
select is((select count(*) from public.events where type = 'payout_account.schedule_changed'), 1::bigint,
  'writes no second event');
select throws_ok($$ select public.set_payout_schedule('55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select weekly from facts)) $$, '42501', 'Owners only',
  'admins can''t change the schedule');
select throws_ok($$ select public.set_payout_schedule('22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select weekly from facts)) $$, '42501', null,
  'nor another studio''s owner');
select throws_ok($$ select public.set_payout_schedule('66666666-6666-4666-8666-666666666666',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', (select weekly from facts)) $$, 'P0001', 'not_connected',
  'a studio without an account has no schedule to change');
select lives_ok($$ select public.set_payout_schedule('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select weekly from facts), now() - interval '1 minute') $$,
  'Stripe''s answer to an older schedule change arrives late');
select is((select payout_interval::text from public.payout_accounts where stripe_account_id = 'acct_A1'), 'monthly',
  'and doesn''t overwrite the newer copy');

-- ── Syncs from Stripe (webhooks and refresh) ──────────────────────────────────────────────────────────────────────
select is(public.sync_payout_account('acct_A1', (select active from facts), (select monthly from facts), 'active'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'a sync returns the account''s own studio');
select results_eq($$ select status::text, charges_enabled, payouts_enabled, currently_due_count from public.payout_accounts
  where stripe_account_id = 'acct_A1' $$, $$ values ('active', true, true, 0) $$, 'and copies the facts and status');
select results_eq($$ select actor_id, data from public.events where type = 'payout_account.status_changed' $$,
  $$ values (null::uuid, '{"from": "needs_info", "to": "active"}'::jsonb) $$,
  'payout_account.status_changed has no actor when Stripe caused it');
select is(public.sync_payout_account('acct_A1', (select active from facts), (select monthly from facts), 'active'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'the same facts again');
select is((select count(*) from public.events where type like 'payout_account.%'), 4::bigint,
  'write no event (created twice, schedule once, status once)');
select is(public.sync_payout_account('acct_A1', (select fresh from facts), (select weekly from facts), 'needs_info',
  now() - interval '1 minute'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'an older answer from Stripe (fetched before the saved copy) arrives late');
select results_eq($$ select status::text, payout_interval::text from public.payout_accounts
  where stripe_account_id = 'acct_A1' $$, $$ values ('active', 'monthly') $$,
  'and never overwrites the newer copy (concurrent webhooks finish in any order)');
select is(public.sync_payout_account('acct_Unknown', (select active from facts), (select weekly from facts), 'active'),
  null, 'an account this database doesn''t know syncs nothing');
select is((select status::text from public.payout_accounts where stripe_account_id = 'acct_B1'), 'active',
  'syncing A never touches B');

-- ── Payouts ───────────────────────────────────────────────────────────────────────────────────────────────────────
select isnt(public.sync_payout('acct_A1', '{"stripe_payout_id": "po_A1", "amount_cents": 12345, "currency": "usd",
  "status": "pending", "method": "standard", "automatic": true, "arrival_date": "2026-10-16",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}'), null, 'a payout is copied into the account''s studio');
select results_eq($$ select studio_id, amount_cents, currency::text, status::text from public.payouts
  where stripe_payout_id = 'po_A1' $$,
  $$ values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 12345::bigint, 'USD', 'pending') $$,
  'in whole cents and the studio''s currency');
select results_eq($$ select data from public.events where type = 'payout.created' $$,
  $$ values ('{"status": "pending", "method": "standard"}'::jsonb) $$, 'payout.created carries status and method');
select lives_ok($$ select public.sync_payout('acct_A1', '{"stripe_payout_id": "po_A1", "amount_cents": 12345,
  "currency": "usd", "status": "pending", "method": "standard", "automatic": true, "arrival_date": "2026-10-16",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}') $$, 'the same payout again');
select is((select count(*) from public.events where type like 'payout.%'), 1::bigint, 'writes no event');
select lives_ok($$ select public.sync_payout('acct_A1', '{"stripe_payout_id": "po_A1", "amount_cents": 12345,
  "currency": "usd", "status": "paid", "method": "standard", "automatic": true, "arrival_date": "2026-10-16",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}') $$, 'Stripe paid it');
select results_eq($$ select data from public.events where type = 'payout.status_changed' $$,
  $$ values ('{"from": "pending", "to": "paid"}'::jsonb) $$, 'payout.status_changed');
select lives_ok($$ select public.sync_payout('acct_A1', '{"stripe_payout_id": "po_A1", "amount_cents": 12345,
  "currency": "usd", "status": "in_transit", "method": "standard", "automatic": true, "arrival_date": "2026-10-16",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}', now() - interval '1 minute') $$,
  'an older in_transit answer arrives after paid');
select is((select status::text from public.payouts where stripe_payout_id = 'po_A1'), 'paid',
  'and is skipped: paid stays paid');
select throws_ok($$ select public.sync_payout('acct_B1', '{"stripe_payout_id": "po_A1", "amount_cents": 1,
  "currency": "usd", "status": "failed", "method": "standard", "automatic": true, "arrival_date": "2026-10-16",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}') $$, '22023', 'payout_mismatch',
  'B''s account can''t take over A''s payout');
select is((select status::text from public.payouts where stripe_payout_id = 'po_A1'), 'paid', 'which is unchanged');
select is(public.sync_payout('acct_Unknown', '{"stripe_payout_id": "po_X1"}'), null,
  'an unknown account''s payout is not copied');
select throws_ok($$ select public.sync_payout('acct_A1', '{"stripe_payout_id": "po_A2", "amount_cents": 100,
  "currency": "cad", "status": "pending", "method": "standard", "automatic": true, "arrival_date": "2026-10-16",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}') $$, '23514', 'payout_currency',
  'a US studio''s payout is in USD');
select throws_ok($$ insert into public.payouts (studio_id, payout_account_id, stripe_payout_id, amount_cents, currency,
  status, method, automatic, arrival_date, stripe_created_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  (select id from public.payout_accounts where stripe_account_id = 'acct_A1'), 'po_B9', 1, 'USD', 'paid', 'standard',
  true, '2026-10-16', now()) $$, '23503', null, 'a payout can''t point at another studio''s account');
select throws_ok($$ insert into public.payouts (studio_id, payout_account_id, stripe_payout_id, amount_cents, currency,
  status, method, automatic, arrival_date, stripe_created_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select id from public.payout_accounts where stripe_account_id = 'acct_A1'), 'tr_A9', 1, 'USD', 'paid', 'standard',
  true, '2026-10-16', now()) $$, '23514', null, 'Stripe payout ids are checked');
select throws_ok($$ insert into public.payouts (studio_id, payout_account_id, stripe_payout_id, amount_cents, currency,
  status, method, automatic, arrival_date, stripe_created_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select id from public.payout_accounts where stripe_account_id = 'acct_A1'), 'po_A9', -1, 'USD', 'paid', 'standard',
  true, '2026-10-16', now()) $$, '23514', null, 'amounts are never negative');
select isnt(public.sync_payout('acct_B1', '{"stripe_payout_id": "po_B1", "amount_cents": 500, "currency": "usd",
  "status": "in_transit", "method": "standard", "automatic": true, "arrival_date": "2026-10-14",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}'), null, 'B gets a payout of its own');

-- ── The webhook inbox ─────────────────────────────────────────────────────────────────────────────────────────────
create temp table claims (n int primary key, r jsonb);
create function pg_temp.lease(p_n int) returns uuid language sql as $$
  select (r ->> 'lease')::uuid from claims where n = p_n $$;
create function pg_temp.inbox(p_event text) returns bigint language sql as $$
  select id from public.stripe_events where stripe_event_id = p_event $$;
insert into claims select 1, public.record_stripe_event('evt_A1', 'account.updated', 'acct_A1', false, now());
select results_eq($$ select (r ->> 'studio_id')::uuid, (r ->> 'processed')::boolean, (r ->> 'claimed')::boolean,
  r ->> 'lease' is not null from claims where n = 1 $$,
  $$ values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, false, true, true) $$,
  'an event for A is recorded in A and claimed for processing, with a lease token');
insert into claims select 2, public.record_stripe_event('evt_A1', 'account.updated', 'acct_A1', false, now());
select results_eq($$ select (r ->> 'processed')::boolean, (r ->> 'claimed')::boolean, r ->> 'lease' from claims
  where n = 2 $$, $$ values (false, false, null::text) $$,
  'a second delivery during processing doesn''t claim it and gets no lease');
select is((select count(*) from public.stripe_events where stripe_event_id = 'evt_A1'), 1::bigint,
  'duplicates add no rows');
select is(public.finish_stripe_event(pg_temp.inbox('evt_A1'), gen_random_uuid(), null), false,
  'a delivery without the lease can''t finish the event');
select results_eq($$ select processed_at is null, processing_started_at is not null from public.stripe_events
  where stripe_event_id = 'evt_A1' $$, $$ values (true, true) $$, 'which stays unprocessed and leased');
select is(public.finish_stripe_event(pg_temp.inbox('evt_A1'), pg_temp.lease(1), 'stripe_unavailable'), true,
  'a failure is recorded by its code, by the lease holder');
select results_eq($$ select processed_at is null, last_error, processing_started_at is null, lease_token is null
  from public.stripe_events where stripe_event_id = 'evt_A1' $$, $$ values (true, 'stripe_unavailable', true, true) $$,
  'and frees the event for Stripe''s next try');
insert into claims select 3, public.record_stripe_event('evt_A1', 'account.updated', 'acct_A1', false, now());
select results_eq($$ select (r ->> 'claimed')::boolean, pg_temp.lease(3) is distinct from pg_temp.lease(1)
  from claims where n = 3 $$, $$ values (true, true) $$, 'the retry claims it again with a new lease');
select is(public.finish_stripe_event(pg_temp.inbox('evt_A1'), pg_temp.lease(1), null), false,
  'the earlier delivery''s lease can no longer finish it');
select is(public.finish_stripe_event(pg_temp.inbox('evt_A1'), pg_temp.lease(3), null), true, 'the retry finishes it');
select results_eq($$ select (r ->> 'processed')::boolean, (r ->> 'claimed')::boolean
  from public.record_stripe_event('evt_A1', 'account.updated', 'acct_A1', false, now()) r $$,
  $$ values (true, false) $$, 'a processed event is never processed again');
select results_eq($$ select attempts, last_error from public.stripe_events where stripe_event_id = 'evt_A1' $$,
  $$ values (2, null::text) $$, 'after two attempts, with the error cleared');
select is(public.finish_stripe_event(pg_temp.inbox('evt_A1'), pg_temp.lease(3), 'sync_failed'), false,
  'and a finished event can''t be finished again');
-- A delivery whose lease ran out (it took over two minutes) can't clear the lease of the delivery that took over.
insert into claims select 4, public.record_stripe_event('evt_A2', 'account.updated', 'acct_A1', false, now());
update public.stripe_events set processing_started_at = now() - interval '3 minutes' where stripe_event_id = 'evt_A2';
insert into claims select 5, public.record_stripe_event('evt_A2', 'account.updated', 'acct_A1', false, now());
select is((select (r ->> 'claimed')::boolean from claims where n = 5), true,
  'a lapsed lease is taken over by the next delivery');
select is(public.finish_stripe_event(pg_temp.inbox('evt_A2'), pg_temp.lease(4), 'sync_failed'), false,
  'the lapsed delivery can''t finish it or clear the new lease');
select results_eq($$ select processing_started_at is not null, lease_token = pg_temp.lease(5), last_error
  from public.stripe_events where stripe_event_id = 'evt_A2' $$, $$ values (true, true, null::text) $$,
  'which stays with the delivery that took over');
-- An object that can never be copied (e.g. a payout in the wrong currency) fails for good and isn't retried.
insert into claims select 6, public.record_stripe_event('evt_A3', 'payout.paid', 'acct_A1', false, now());
select is(public.finish_stripe_event(pg_temp.inbox('evt_A3'), pg_temp.lease(6), 'payout_currency', true), true,
  'a permanent failure is recorded by its code');
select results_eq($$ select processed_at is not null, last_error from public.stripe_events
  where stripe_event_id = 'evt_A3' $$, $$ values (true, 'payout_currency') $$, 'and marked processed');
select results_eq($$ select (r ->> 'processed')::boolean, (r ->> 'claimed')::boolean
  from public.record_stripe_event('evt_A3', 'payout.paid', 'acct_A1', false, now()) r $$,
  $$ values (true, false) $$, 'so Stripe''s retries are acknowledged, not processed again');
select is(public.record_stripe_event('evt_X1', 'account.updated', 'acct_Unknown', false, now()), null,
  'an unknown account''s event is not recorded');
select is((select count(*) from public.stripe_events where stripe_event_id = 'evt_X1'), 0::bigint, 'nothing is stored');
select throws_ok($$ select public.record_stripe_event('evt_A1', 'account.updated', 'acct_B1', false, now()) $$,
  '22023', 'event_mismatch', 'an event id never moves to another studio''s account');
select throws_ok($$ select public.record_stripe_event('event-1', 'account.updated', 'acct_A1', false, now()) $$,
  '23514', null, 'Stripe event ids are checked');
select throws_ok($$ select public.finish_stripe_event(pg_temp.inbox('evt_A2'), pg_temp.lease(5),
  'Something went wrong for maya@example.test') $$, '23514', null, 'errors are code names, never messages');
select is((select studio_id from public.stripe_events where stripe_event_id = 'evt_A1'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'the inbox row is A''s');

-- ── Stripe call budget (rate limit per studio per minute) ─────────────────────────────────────────────────────────
select is(public.take_stripe_call('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2), true, 'a studio''s first call this minute');
select is(public.take_stripe_call('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2), true, 'its second');
select is(public.take_stripe_call('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2), false,
  'a third over a limit of two is refused');
select is(public.take_stripe_call('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2), true,
  'another studio has a budget of its own');
update public.stripe_call_budget set window_start = window_start - interval '1 minute'
  where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(public.take_stripe_call('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2), true, 'a new minute starts again');
select throws_ok($$ select public.take_stripe_call('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0) $$, '22023', null,
  'the limit is checked');

-- ── Events carry ids and words only (D96) ─────────────────────────────────────────────────────────────────────────
select is((select count(*) from public.events where type like 'payout%'
  and (data::text ~ '(acct_|po_|evt_|12345|500)')), 0::bigint, 'no Stripe ids or amounts in events');

-- ── Reading, as each person (row-level security) ──────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select results_eq($$ select stripe_account_id from public.payout_accounts $$, $$ values ('acct_A1') $$,
  'the owner reads their own account only');
select results_eq($$ select stripe_payout_id from public.payouts $$, $$ values ('po_A1') $$,
  'and their own payouts only');
select throws_ok($$ select 1 from public.stripe_events $$, '42501', null, 'not the inbox');
select throws_ok($$ insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, status,
  payout_interval, weekly_anchor, delay_days) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'acct_C1', 'US', false,
  'active', 'weekly', 'friday', 2) $$, '42501', null, 'the owner can''t write an account from the browser');
select throws_ok($$ update public.payout_accounts set status = 'active' $$, '42501', null,
  'nor change a status');
select throws_ok($$ delete from public.payouts $$, '42501', null, 'nor delete payouts');
select throws_ok($$ select public.create_payout_account('11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A1', false, '{}'::jsonb, '{}'::jsonb, 'active') $$, '42501', null,
  'nor run the write functions');
select throws_ok($$ select public.sync_payout_account('acct_B1', '{}'::jsonb, '{}'::jsonb, 'restricted') $$, '42501', null,
  'nor the system sync, on anyone''s account');
select throws_ok($$ select public.take_stripe_call('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1000) $$, '42501', null,
  'nor spend or reset any studio''s Stripe budget');
select pg_temp.as_user('55555555-5555-4555-8555-555555555555') as signed_in;
select results_eq($$ select stripe_account_id from public.payout_accounts $$, $$ values ('acct_A1') $$,
  'an admin reads the account (read-only, answer 1)');
select is((select count(*) from public.payouts), 1::bigint, 'and the payouts');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select is((select count(*) from public.payout_accounts) + (select count(*) from public.payouts), 0::bigint,
  'a photographer reads nothing');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
select is((select count(*) from public.payout_accounts) + (select count(*) from public.payouts), 0::bigint,
  'staff read nothing');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select results_eq($$ select stripe_account_id from public.payout_accounts $$, $$ values ('acct_B1') $$,
  'another studio''s owner sees only their own account');
select results_eq($$ select stripe_payout_id from public.payouts $$, $$ values ('po_B1') $$,
  'and only their own payouts');
select pg_temp.as_user('77777777-7777-4777-8777-777777777777') as signed_in;
select is((select count(*) from public.payout_accounts) + (select count(*) from public.payouts), 0::bigint,
  'someone in no studio reads nothing');
select pg_temp.as_user('88888888-8888-4888-8888-888888888888') as signed_in;
select is((select count(*) from public.payout_accounts) + (select count(*) from public.payouts), 0::bigint,
  'a removed member reads nothing');
reset role;
set local role anon;
select throws_ok($$ select 1 from public.payout_accounts $$, '42501', null, 'anon can''t read accounts');
select throws_ok($$ select 1 from public.payouts $$, '42501', null, 'nor payouts');
reset role;

-- ── Closing, not deleting (D125, Q16) ─────────────────────────────────────────────────────────────────────────────
select throws_ok($$ delete from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$, '23503', null,
  'a studio with a Stripe account can''t be deleted');

select * from finish();
rollback;
