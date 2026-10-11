-- Event log and money ledger (D96).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.test', now()),
  ('22222222-2222-4222-8222-222222222222', 'staff@example.test', now()),
  ('33333333-3333-4333-8333-333333333333', 'other-owner@example.test', now());

create temp table t (a uuid, b uuid, token text);
grant all on t to authenticated;
insert into t default values;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true) is not null as signed_in;
update t set a = public.create_studio('Studio A', 'studio-a');
update t set token = public.invite_member((select a from t), 'staff@example.test', 'staff');
update public.studios set name = 'Studio A Photo' where id = (select a from t);

select results_eq(
  $$ select type from public.events order by id $$,
  array['studio.created', 'member.joined', 'invite.created', 'studio.updated'],
  'each change writes an event, in order'
);
select is((select actor_id from public.events where type = 'invite.created'),
  '11111111-1111-4111-8111-111111111111'::uuid, 'events record who did it');
select is(
  (select count(*) from public.events where data::text ilike '%@%'), 0::bigint,
  'events never contain email addresses'
);
select throws_ok($$ insert into public.events (studio_id, type) values ((select a from t), 'fake.event') $$,
  '42501', null, 'browsers cannot write events');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true) is not null as signed_in;
select is(public.accept_invite((select token from t)), (select a from t), 'staff joins');
select is((select count(*) from public.events), 0::bigint, 'staff cannot read the activity log');

select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true) is not null as signed_in;
update t set b = public.create_studio('Studio B', 'studio-b');
select is((select count(*) from public.events where studio_id = (select a from t)), 0::bigint,
  'another studio sees none of studio A''s events');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true) is not null as signed_in;
select ok((select count(*) from public.events where type in ('invite.accepted', 'member.joined')) >= 3,
  'the owner sees the staff member join');

-- Ledger, as the database owner (the server writes it in Phase 3).
reset role;
select throws_ok($$ update public.events set data = '{"x":1}' where type = 'studio.created' $$,
  '23514', null, 'events cannot be edited');
select lives_ok($$ update public.events set published_at = now() where type = 'studio.created' $$,
  'the publisher can mark events sent');

select lives_ok($$
  with txn as (select gen_random_uuid() as id)
  insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency)
  select (select a from t), txn.id, x.account::public.ledger_account, x.amount, 'CAD'
  from txn, (values ('parent_payments', -7800), ('studio_payable', 7566), ('daybell_fees', 234)) as x(account, amount);
  set constraints all immediate;
$$, 'a balanced transaction in whole cents is accepted');

select throws_ok($$
  insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency) values
    ((select a from t), '99999999-9999-4999-8999-999999999999', 'parent_payments', -1000, 'CAD'),
    ((select a from t), '99999999-9999-4999-8999-999999999999', 'studio_payable', 999, 'CAD');
  set constraints all immediate;
$$, '23514', null, 'an unbalanced transaction is refused');

select throws_ok($$
  insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency) values
    ((select a from t), '88888888-8888-4888-8888-888888888888', 'parent_payments', -1000, 'CAD'),
    ((select a from t), '88888888-8888-4888-8888-888888888888', 'studio_payable', 1000, 'USD');
  set constraints all immediate;
$$, '23514', null, 'a transaction cannot mix currencies');

select throws_ok($$ update public.ledger_entries set amount_cents = 1 $$, '23514', null, 'the ledger is append-only');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true) is not null as signed_in;
select is((select count(*) from public.ledger_entries), 0::bigint, 'another studio cannot see the ledger');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true) is not null as signed_in;
select is((select sum(amount_cents) from public.ledger_entries), 0::numeric, 'the owner sees a ledger that balances');

reset role;
select throws_ok($$
  insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency)
  select (select a from t), transaction_id, x.account::public.ledger_account, x.amount, 'CAD'
  from (select distinct transaction_id from public.ledger_entries limit 1) txn,
       (values ('parent_payments', -100), ('studio_payable', 100)) as x(account, amount);
  set constraints all immediate;
$$, '23514', null, 'a recorded money transaction can never be extended later');

select throws_ok($$
  insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency) values
    ((select a from t), '77777777-7777-4777-8777-777777777777', 'parent_payments', -1000, 'USD'),
    ((select a from t), '77777777-7777-4777-8777-777777777777', 'studio_payable', 1000, 'USD');
  set constraints all immediate;
$$, '23514', null, 'a Canadian studio''s money is always in CAD');

select throws_ok($$ delete from public.events $$, '23514', null, 'events cannot be deleted');
select throws_ok($$ truncate public.events $$, '23514', null, 'events cannot be truncated');
select lives_ok($$ delete from auth.users where id = '22222222-2222-4222-8222-222222222222' $$,
  'a person can still be erased even though the log mentions them');
select lives_ok($$ delete from public.studios where id = (select b from t) $$,
  'a studio with no money records can be deleted, with its events');

select * from finish();
rollback;
