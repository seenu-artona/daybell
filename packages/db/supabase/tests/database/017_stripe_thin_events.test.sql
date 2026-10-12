-- Stripe Accounts v2 thin events in the webhook inbox (D106, D96, D113; ADR 0020 amendment): v2 event types and ids
-- are recorded once like v1 ones, still for the account's own studio only; anything that isn't an event type or id
-- shape (free text, personal data, injection) is still refused; v1 types keep working.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'ca'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'ca');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner');
select public.create_payout_account('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'acct_A1', false, '{"details_submitted": false}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'needs_info');
select public.create_payout_account('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'acct_B1', false, '{"details_submitted": false}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'needs_info');

select ok((public.record_stripe_event('evt_test_65R1', 'v2.core.account[requirements].updated', 'acct_A1', false,
  now()) ->> 'claimed')::boolean, 'a v2 requirements event is recorded and claimed');
select ok((public.record_stripe_event('evt_test_65R2',
  'v2.core.account[configuration.merchant].capability_status_updated', 'acct_A1', false, now()) ->> 'claimed')::boolean,
  'a v2 capability event is recorded');
select ok((public.record_stripe_event('evt_test_65R3', 'v2.core.account.updated', 'acct_A1', false, now())
  ->> 'claimed')::boolean, 'v2.core.account.updated is recorded');
select ok((public.record_stripe_event('evt_A9', 'account.updated', 'acct_A1', false, now()) ->> 'claimed')::boolean,
  'v1 types and ids still fit');
select is((public.record_stripe_event('evt_test_65R1', 'v2.core.account[requirements].updated', 'acct_A1', false,
  now()) ->> 'claimed')::boolean, false, 'a duplicate v2 delivery is not claimed again');
select is((select count(*) from public.stripe_events where stripe_event_id = 'evt_test_65R1'), 1::bigint,
  'and is stored once');
select is((select studio_id from public.stripe_events where stripe_event_id = 'evt_test_65R2'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'the v2 event is A''s, by the account');
select throws_ok($$ select public.record_stripe_event('evt_test_65R1', 'v2.core.account.updated', 'acct_B1', false,
  now()) $$, '22023', 'event_mismatch', 'a v2 event id never moves to another studio''s account');
select throws_ok($$ select public.record_stripe_event('evt_test_65R4', 'v2.core.account[Maya Johnson].updated',
  'acct_A1', false, now()) $$, '23514', null, 'free text in a bracketed type is refused');
select throws_ok($$ select public.record_stripe_event('evt_test_65R5', 'v2.core.account[requirements].updated; drop',
  'acct_A1', false, now()) $$, '23514', null, 'anything after the type is refused');
select throws_ok($$ select public.record_stripe_event('evt_test-65R6', 'v2.core.account.updated', 'acct_A1', false,
  now()) $$, '23514', null, 'event ids are still checked');
select throws_ok($$ select public.record_stripe_event('evt_test_65R7', 'v2', 'acct_A1', false, now()) $$, '23514',
  null, 'a type needs at least two parts');

select * from finish();
rollback;
