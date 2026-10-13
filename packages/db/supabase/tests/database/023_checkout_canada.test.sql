-- Checkout in a Canadian database (D106, D113, ADR 0006, ADR 0023): a Canadian studio's orders and their ledger are
-- in CAD and never USD; tax head offices are in Canada without Quebec (at launch); PST is registered in BC, SK and MB
-- only (GST/HST covers the rest); each region's database has its own fee setting, starting at 3%.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email) values ('99999999-9999-4999-8999-999999999999', 'owner-c@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Studio C', 'studio-c', 'ca');
insert into public.studio_members (studio_id, user_id, role) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '99999999-9999-4999-8999-999999999999', 'owner');
select public.create_payout_account('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'acct_C1', false, '{"details_submitted": true, "charges_enabled": true, "payouts_enabled": true}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'active');

create function pg_temp.order_in(p_currency text) returns void language sql as $$
  insert into public.orders (studio_id, reference, currency, products_cents, shipping_cents, daybell_fee_bps,
    daybell_fee_cents, card_fee_recovery, tax_enabled, payout_account_id, stripe_account_id, bag_fingerprint)
  select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', case p_currency when 'CAD' then 'C0000001' else 'U0000001' end,
    p_currency, 1000, 0, 300, 30, 'per_sale', false, a.id, a.stripe_account_id, repeat('a', 64)
  from public.payout_accounts a where a.stripe_account_id = 'acct_C1' $$;

select is(public.platform_fee_settings() ->> 'daybell_fee_bps', '300', 'Canada''s fee starts at 3%');
select throws_ok($$ select pg_temp.order_in('USD') $$, '23514', 'order_currency',
  'a Canadian studio''s order in USD is refused');
select lives_ok($$ select pg_temp.order_in('CAD') $$, 'in CAD it is taken');
select throws_ok($$ insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '77777777-7777-4777-8777-777777777777', 'parent_payments', 100, 'USD'),
         ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '77777777-7777-4777-8777-777777777777', 'studio_payable', -100, 'USD');
  set constraints all immediate $$, '23514', null, 'and its ledger is never in USD');
select throws_ok($$ select public.set_tax_head_office('99999999-9999-4999-8999-999999999999',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'QC') $$, '23514', null, 'Quebec isn''t offered at launch');
select lives_ok($$ select public.set_tax_head_office('99999999-9999-4999-8999-999999999999',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'NS') $$, 'Nova Scotia is');
select throws_ok($$ select public.add_tax_registration('99999999-9999-4999-8999-999999999999',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'pst', 'ON', 'ABC123', 'taxreg_C1') $$, '23514', null,
  'Ontario has no PST to register (HST)');
select lives_ok($$ select public.add_tax_registration('99999999-9999-4999-8999-999999999999',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'pst', 'MB', 'ABC123', 'taxreg_C2') $$, 'Manitoba RST/PST is');
select is((select currency::text from public.orders where reference = 'C0000001'), 'CAD', 'the order is in CAD');

select * from finish();
rollback;
