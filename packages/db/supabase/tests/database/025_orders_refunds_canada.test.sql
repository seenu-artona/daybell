-- Refunds in a Canadian database (D106, D113, ADR 0006, ADR 0024): a Canadian studio's refunds, their ledger
-- transactions and Home's numbers are in CAD and never USD; a refund is always in its order's currency.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email) values ('99999999-9999-4999-8999-999999999999', 'owner-c@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Studio C', 'studio-c', 'ca');
insert into public.studio_members (studio_id, user_id, role) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '99999999-9999-4999-8999-999999999999', 'owner');
select public.create_payout_account('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'acct_C1', false, '{"details_submitted": true, "charges_enabled": true, "payouts_enabled": true}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'active');
insert into public.orders (id, studio_id, reference, currency, products_cents, shipping_cents, daybell_fee_bps,
  daybell_fee_cents, card_fee_recovery, tax_enabled, payout_account_id, stripe_account_id, bag_fingerprint,
  checkout_session_id)
select 'c1000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'C0000001', 'CAD', 1000, 0,
  300, 30, 'per_sale', false, a.id, a.stripe_account_id, repeat('a', 64), 'cs_test_C1'
from public.payout_accounts a where a.stripe_account_id = 'acct_C1';
select public.complete_order('c1000000-0000-4000-8000-000000000001', jsonb_build_object(
  'checkout_session_id', 'cs_test_C1', 'payment_intent_id', 'pi_C1', 'charge_id', 'ch_C1', 'transfer_id', 'tr_C1',
  'livemode', false, 'currency', 'cad', 'amount_subtotal', 1000, 'amount_shipping', 0, 'amount_tax', 0,
  'amount_total', 1000, 'destination', 'acct_C1', 'on_behalf_of', 'acct_C1', 'application_fee_amount', 30));
select public.settle_order_fees('c1000000-0000-4000-8000-000000000001', 'tr_C1', 59, 'cad', 'txn_C1', 'trr_C1');

select throws_ok($$ insert into public.order_refunds (studio_id, order_id, request_id, kind, products_cents,
  shipping_cents, tax_cents, amount_cents, daybell_fee_cents, currency) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'c1000000-0000-4000-8000-000000000001', gen_random_uuid(), 'custom', 100, 0, 0, 100, 3, 'USD') $$,
  '23514', 'refund_currency', 'a Canadian order''s refund in USD is refused');
select lives_ok($$ select public.begin_refund('99999999-9999-4999-8999-999999999999',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c1000000-0000-4000-8000-000000000001', gen_random_uuid(), 'custom', null,
  400, false, 'other') $$, 'a refund through the API''s function is taken');
select is((select currency::text from public.order_refunds), 'CAD', 'in CAD');
select public.refund_accepted((select id from public.order_refunds), 're_C1', 'succeeded');
set constraints all immediate;
select is((select array_agg(distinct e.currency::text) from public.ledger_entries e
  join public.ledger_transactions t on t.id = e.transaction_id where t.kind = 'order_refunded'), array['CAD'],
  'its ledger transaction is in CAD');
select throws_ok($$ insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '77777777-7777-4777-8777-777777777777', 'refunds', -100, 'USD'),
         ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '77777777-7777-4777-8777-777777777777', 'studio_payable', 100, 'USD');
  set constraints all immediate $$, '23514', null, 'and never in USD');
select is(public.studio_sales('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'America/Halifax') ->> 'currency', 'CAD',
  'Home''s numbers are in CAD');

select * from finish();
rollback;
