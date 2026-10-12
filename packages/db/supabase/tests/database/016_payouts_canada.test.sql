-- Payouts in a Canadian database (D106, D113; ADR 0020): a Canadian studio's Stripe account is CA and its payouts
-- are in CAD; a US country or USD payouts are refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email) values ('99999999-9999-4999-8999-999999999999', 'owner-c@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Studio C', 'studio-c', 'ca');
insert into public.studio_members (studio_id, user_id, role) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '99999999-9999-4999-8999-999999999999', 'owner');

select lives_ok($$ select public.create_payout_account('99999999-9999-4999-8999-999999999999',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'acct_C1', false, '{"details_submitted": false}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'needs_info') $$,
  'a Canadian owner connects');
select is((select country::text from public.payout_accounts where stripe_account_id = 'acct_C1'), 'CA',
  'the account is Canadian');
select throws_ok($$ update public.payout_accounts set country = 'US' where stripe_account_id = 'acct_C1' $$,
  '23514', 'payout_country', 'and never becomes a US account');
select lives_ok($$ select public.sync_payout('acct_C1', '{"stripe_payout_id": "po_C1", "amount_cents": 12345,
  "currency": "cad", "status": "paid", "method": "standard", "automatic": true, "arrival_date": "2026-10-16",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}') $$, 'a CAD payout is copied');
select throws_ok($$ select public.sync_payout('acct_C1', '{"stripe_payout_id": "po_C2", "amount_cents": 100,
  "currency": "usd", "status": "paid", "method": "standard", "automatic": true, "arrival_date": "2026-10-16",
  "failure_code": null, "stripe_created_at": "2026-10-12T12:00:00Z"}') $$, '23514', 'payout_currency',
  'a USD payout is refused for a Canadian studio (D106)');

select * from finish();
rollback;
