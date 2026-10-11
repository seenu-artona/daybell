-- Studio sign-up and staff invites (D96, D113).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.test', now()),
  ('22222222-2222-4222-8222-222222222222', 'Photographer@Example.test', now()),
  ('33333333-3333-4333-8333-333333333333', 'someone-else@example.test', now()),
  ('44444444-4444-4444-8444-444444444444', 'photographer@example.test', null),
  ('55555555-5555-4555-8555-555555555555', null, null);

create temp table t (studio uuid, token text, token2 text);
grant all on t to authenticated;
insert into t default values;

-- Owner signs up.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true) is not null as signed_in;
update t set studio = public.create_studio('  North Peak Photo ', 'North-Peak');
select is((select data_region::text from public.studios where id = (select studio from t)), 'ca',
  'a new studio takes this database''s region');
select is((select slug from public.studios where id = (select studio from t)), 'north-peak', 'slugs are stored lower case');
select is((select role::text from public.studio_members where user_id = '11111111-1111-4111-8111-111111111111'), 'owner',
  'the creator becomes owner');
select throws_ok($$ select public.create_studio('Second', 'second-studio') $$, '23505', null,
  'one new studio per person');
select throws_ok($$ select public.create_studio('Dup slug', 'north-peak') $$, '23505', null, 'slugs are unique');

-- Owner invites a photographer.
update t set token = public.invite_member((select studio from t), ' Photographer@Example.TEST ', 'photographer');
select is(length((select token from t)), 64, 'the invite returns a 64-character token');
select is((select count(*) from public.studio_invites), 1::bigint, 'the owner sees the invite');
select throws_ok($$ select token_hash from public.studio_invites $$, '42501', null, 'token hashes are never readable');
select throws_ok($$ select public.invite_member((select studio from t), 'x@example.test', 'owner') $$, '23514', null,
  'nobody can be invited as owner');
select throws_ok(
  $$ insert into public.studio_invites (studio_id, email, role, token_hash) values ((select studio from t), 'a@b.co', 'staff', 'x') $$,
  '42501', null, 'invites cannot be written directly');

-- Someone else, signed in, tries the link.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true) is not null as signed_in;
select throws_ok($$ select public.accept_invite((select token from t)) $$, '42501', null,
  'an invite only works for the invited email');
select throws_ok($$ select public.invite_member((select studio from t), 'me@example.test', 'admin') $$, '42501', null,
  'outsiders cannot invite people');
select is((select count(*) from public.studio_invites), 0::bigint, 'outsiders see no invites');

-- An unconfirmed account with the invited email, and an account with no email, are both refused.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444"}', true) is not null as signed_in;
select throws_ok($$ select public.accept_invite((select token from t)) $$, '42501', null,
  'an unconfirmed email cannot accept an invite');
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555"}', true) is not null as signed_in;
select throws_ok($$ select public.accept_invite((select token from t)) $$, '42501', null,
  'an account without an email cannot accept an invite');

-- The invited photographer accepts (email match is case-insensitive).
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true) is not null as signed_in;
select is(public.accept_invite((select token from t)), (select studio from t), 'the invited person joins the studio');
select is((select role::text from public.studio_members where user_id = '22222222-2222-4222-8222-222222222222'),
  'photographer', 'with the invited role');
select throws_ok($$ select public.accept_invite((select token from t)) $$, '42501', null, 'an invite works only once');
select throws_ok($$ select public.invite_member((select studio from t), 'z@example.test', 'staff') $$, '42501', null,
  'photographers cannot invite people');

select is((select count(*) from public.studio_team((select studio from t))), 2::bigint, 'members see their team');
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true) is not null as signed_in;
select is((select count(*) from public.studio_team((select studio from t))), 0::bigint, 'outsiders see no team');

reset role;
set local role anon;
select is(public.slug_available('NORTH-PEAK'), false, 'a taken web address shows as taken, any case');
select is(public.slug_available('free-slug'), true, 'a free web address shows as free');

select * from finish();
rollback;
