-- Bell notifications (D143, D96, D113; Claude's call 4 and Q3; ADR 0021): made from the event log in the studio's own
-- database, one per person in the kind's audience (the person who did it isn't told), once per event and once per
-- upload batch, with ids and counts only; each person reads and marks read only their own, in a studio they still
-- belong to; read_at is set once by the database's clock; another member, another studio, a removed member and anon
-- see nothing; leaving a studio or changing role drops what they may no longer hear about; old ones are pruned; making
-- and reading them writes no event (Q3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin-a@example.test'),
  ('77777777-7777-4777-8777-777777777777', 'outsider@example.test'),
  ('88888888-8888-4888-8888-888888888888', 'leaving-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 'staff');

-- Fixtures as the database owner: two jobs in A (the first selling), one in B; an upload of job 1 with a failed photo.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Spring', 'school', '2026-10-01', 'JOB00002'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000001';
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('a2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   '33333333-3333-4333-8333-333333333333'),
  ('a2000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   '33333333-3333-4333-8333-333333333333');
insert into public.photos (studio_id, job_id, batch_id, batch_seq, status, failure_reason, original_filename,
  byte_size, sha256, created_by)
select b.studio_id, b.job_id, b.id, b.seq, v.status::public.photo_status, v.reason, v.name, 1,
  extensions.digest(b.id::text || v.name, 'sha256'), b.created_by
from public.upload_batches b,
  (values ('ready', null, 'ok.jpg'), ('failed', 'unreadable', 'Maya Johnson.jpg')) v (status, reason, name)
where b.id = 'a2000000-0000-4000-8000-000000000001';

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
create function pg_temp.mine(p_user uuid) returns text language sql as $$
  select coalesce(string_agg(kind::text, ',' order by kind::text, created_at), '')
  from public.notifications where user_id = p_user $$;
create temp table counts (k text primary key, n bigint);
grant execute on all functions in schema pg_temp to authenticated, anon;
grant select, insert on counts to authenticated;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'notifications', 'notifications exists');
select ok((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  'with row-level security');
select is(enum_range(null::public.notification_kind)::text[],
  array['job_selling', 'job_closed', 'payouts_active', 'payouts_restricted', 'photos_failed', 'tagging_ready'],
  'six kinds');
select is((select count(*) from unnest(array['insert', 'delete', 'truncate']) p
  where has_table_privilege('authenticated', 'public.notifications', p)
     or has_table_privilege('anon', 'public.notifications', p)), 0::bigint,
  'nobody signed in (or out) inserts, deletes or truncates them');
select ok(has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update')
  and not has_column_privilege('authenticated', 'public.notifications', 'kind', 'update')
  and not has_column_privilege('authenticated', 'public.notifications', 'user_id', 'update'),
  'signed-in people may update read_at only');
select ok(not has_table_privilege('anon', 'public.notifications', 'select'), 'logged-out visitors read nothing');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where proname in ('notify_from_event', 'notify', 'prune_notifications', 'on_member_change_notifications')),
  'the functions that write them are SECURITY DEFINER with an empty search_path');
select ok(not has_function_privilege('authenticated', 'public.prune_notifications(int)', 'execute')
  and not has_function_privilege('anon', 'public.prune_notifications(int)', 'execute')
  and has_function_privilege('service_role', 'public.prune_notifications(int)', 'execute'),
  'only the service role prunes');
select is((select count(*) from unnest(array['app.notify_from_event()', 'app.on_member_change_notifications()',
    'app.notify(bigint, uuid, uuid, public.notification_kind, uuid, uuid, jsonb, boolean)',
    'app.guard_notification_read()']) f where has_function_privilege('authenticated', f, 'execute')), 0::bigint,
  'browsers can run no notification helper');

-- ── Who hears about what (call 4) ─────────────────────────────────────────────────────────────────────────────────
insert into counts select 'events', count(*) from public.events;
-- 1. The owner closes A's shop: everyone else hears; the owner doesn't hear about their own action.
select lives_ok($$ select public.close_job('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001') $$, 'the owner closes job 1''s shop');
select results_eq($$ select user_id::text, job_id::text, data from public.notifications where kind = 'job_closed'
  order by user_id $$,
  $$ values ('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001', '{"scheduled": false}'::jsonb),
    ('44444444-4444-4444-8444-444444444444', 'a0000000-0000-4000-8000-000000000001', '{"scheduled": false}'::jsonb),
    ('55555555-5555-4555-8555-555555555555', 'a0000000-0000-4000-8000-000000000001', '{"scheduled": false}'::jsonb),
    ('88888888-8888-4888-8888-888888888888', 'a0000000-0000-4000-8000-000000000001', '{"scheduled": false}'::jsonb) $$,
  'job_closed goes to the admin, photographer and staff, with the job id and "not scheduled"');
-- 2. The admin reopens it.
insert into public.events (studio_id, type, actor_id, subject_id, data) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'job.selling', '55555555-5555-4555-8555-555555555555', 'a0000000-0000-4000-8000-000000000001', '{"from": "closed"}');
select results_eq($$ select user_id::text, data from public.notifications where kind = 'job_selling' order by user_id $$,
  $$ values ('11111111-1111-4111-8111-111111111111', '{"from": "closed"}'::jsonb),
    ('33333333-3333-4333-8333-333333333333', '{"from": "closed"}'::jsonb),
    ('44444444-4444-4444-8444-444444444444', '{"from": "closed"}'::jsonb),
    ('88888888-8888-4888-8888-888888888888', '{"from": "closed"}'::jsonb) $$,
  'job_selling goes to everyone but the admin who did it');
-- 3. A closing date passes (nobody did it): everyone hears.
insert into public.events (studio_id, type, actor_id, subject_id, data) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'job.closed', null, 'a0000000-0000-4000-8000-000000000002', '{"scheduled": true}');
select is((select count(*) from public.notifications where kind = 'job_closed'
  and job_id = 'a0000000-0000-4000-8000-000000000002' and data = '{"scheduled": true}'), 5::bigint,
  'a scheduled close tells all five members');
-- 4. Payouts (Stripe, no actor): owners and admins only.
insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, status, payout_interval,
  weekly_anchor, delay_days)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A1', 'US', false, 'needs_info', 'weekly', 'friday', 2);
update public.payout_accounts set status = 'active' where stripe_account_id = 'acct_A1';
select results_eq($$ select user_id::text, job_id, data from public.notifications where kind = 'payouts_active'
  order by user_id $$,
  $$ values ('11111111-1111-4111-8111-111111111111', null::uuid, '{}'::jsonb),
    ('55555555-5555-4555-8555-555555555555', null::uuid, '{}'::jsonb) $$,
  'payouts_active goes to the owner and admin only');
update public.payout_accounts set status = 'restricted' where stripe_account_id = 'acct_A1';
select is((select count(*) from public.notifications where kind = 'payouts_restricted'), 2::bigint,
  'so does payouts_restricted');
update public.payout_accounts set status = 'pending_verification' where stripe_account_id = 'acct_A1';
select is((select count(*) from public.notifications where kind::text like 'payouts%'), 4::bigint,
  'other payout statuses tell nobody');
-- 5. A batch tagged with Leftovers and flags, and a failed photo: owners, admins and photographers, the uploader too.
insert into public.events (studio_id, type, actor_id, subject_id, data) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'photos.tagged', '33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  '{"batch_id": "a2000000-0000-4000-8000-000000000001", "round": 1, "photos": 2, "cards": 0, "leftovers": 2, "flagged": 1, "blank_cards": 0}');
select results_eq($$ select user_id::text, batch_id::text, data from public.notifications where kind = 'tagging_ready'
  order by user_id $$,
  $$ values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', '{"leftovers": 2, "flagged": 1}'::jsonb),
    ('33333333-3333-4333-8333-333333333333', 'a2000000-0000-4000-8000-000000000001', '{"leftovers": 2, "flagged": 1}'::jsonb),
    ('55555555-5555-4555-8555-555555555555', 'a2000000-0000-4000-8000-000000000001', '{"leftovers": 2, "flagged": 1}'::jsonb) $$,
  'tagging_ready: the owner, admin and photographer (who uploaded), with the batch''s counts');
select results_eq($$ select user_id::text, data from public.notifications where kind = 'photos_failed' order by user_id $$,
  $$ values ('11111111-1111-4111-8111-111111111111', '{"failed": 1}'::jsonb),
    ('33333333-3333-4333-8333-333333333333', '{"failed": 1}'::jsonb),
    ('55555555-5555-4555-8555-555555555555', '{"failed": 1}'::jsonb) $$,
  'photos_failed: the same people, with how many failed');
-- 6. The same batch tagged again: nothing new (once per batch).
insert into public.events (studio_id, type, actor_id, subject_id, data) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'photos.tagged', '33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-000000000001',
  '{"batch_id": "a2000000-0000-4000-8000-000000000001", "round": 2, "photos": 1, "cards": 0, "leftovers": 5, "flagged": 0, "blank_cards": 0}');
select is((select count(*) from public.notifications where batch_id is not null), 6::bigint,
  'tagging the same batch again adds nothing');
-- 7. A clean batch with no failed photo, and events that aren't for the bell: nothing.
insert into public.events (studio_id, type, actor_id, subject_id, data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'photos.tagged', null, 'a0000000-0000-4000-8000-000000000001',
   '{"batch_id": "a2000000-0000-4000-8000-000000000002", "round": 1, "photos": 3, "cards": 1, "leftovers": 0, "flagged": 0, "blank_cards": 0}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job.updated', null, 'a0000000-0000-4000-8000-000000000001',
   '{"fields": ["name"]}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tagging.reviewed', null, 'a0000000-0000-4000-8000-000000000001', '{}');
select is((select count(*) from public.notifications where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  23::bigint, 'a clean batch, a job edit and a review tell nobody');
-- 8. Studio B's shop opens: only B's owner hears.
insert into public.events (studio_id, type, actor_id, subject_id, data) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'job.selling', null, 'b0000000-0000-4000-8000-000000000001', '{"from": "draft"}');
select results_eq($$ select user_id::text, studio_id::text from public.notifications
  where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  $$ values ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  'B''s event tells B''s owner only');
select is((select count(*) from public.notifications n join public.studio_members m
  on m.user_id = n.user_id and m.studio_id = n.studio_id), (select count(*) from public.notifications),
  'every notification is for a member of its own studio');
select is((select count(*) from public.events), (select n from counts where k = 'events') + 13,
  'making them writes no event of its own (Q3): only the 13 events above');
-- 9. An event whose subject isn't one of its studio's jobs (a future emitter's mistake) makes no notification and
-- doesn't fail the write that caused it.
select lives_ok($$ insert into public.events (studio_id, type, actor_id, subject_id, data)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'job.selling', null, 'a0000000-0000-4000-8000-000000000001',
  '{"from": "draft"}') $$, 'an event pointing at another studio''s job is still written');
select is((select count(*) from public.notifications where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1::bigint, 'and tells nobody');

-- ── Ids and counts only (D96) ─────────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from public.notifications where data::text ~ '(Maya|Johnson|example|A Fall|acct_)'),
  0::bigint, 'no names, emails, file names or Stripe ids');
select throws_ok($$ insert into public.notifications (studio_id, user_id, event_id, kind, data)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 1, 'job_selling',
  '{"name": "Maya Johnson"}') $$, '23514', null, 'data keys are whitelisted');
select throws_ok($$ insert into public.notifications (studio_id, user_id, event_id, kind, data)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 1, 'photos_failed',
  '{"failed": "Maya"}') $$, '23514', null, 'and their values are numbers, booleans or a known word');
select throws_ok($$ insert into public.notifications (studio_id, user_id, event_id, kind, data)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 1, 'job_selling',
  '{"from": "selling"}') $$, '23514', null, '"from" is draft or closed');
select throws_ok($$ insert into public.notifications (studio_id, user_id, event_id, kind, job_id)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 1, 'job_selling',
  'a0000000-0000-4000-8000-000000000001') $$, '23503', null, 'a notification can''t point at another studio''s job');

-- ── Reading, as each person (row-level security) ──────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select is(pg_temp.mine('11111111-1111-4111-8111-111111111111'),
  'job_closed,job_selling,payouts_active,payouts_restricted,photos_failed,tagging_ready',
  'the owner reads their own six');
select is((select count(*) from public.notifications), 6::bigint, 'and nobody else''s');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
select is(pg_temp.mine('44444444-4444-4444-8444-444444444444'), 'job_closed,job_closed,job_selling',
  'staff hear about the shop only');
select is((select count(*) from public.notifications), 3::bigint, 'and see no colleague''s');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select is((select count(*) from public.notifications where user_id <> '33333333-3333-4333-8333-333333333333'),
  0::bigint, 'a photographer sees no one else''s either');
-- Mark read: the database's clock, once; nothing else changes.
insert into counts select 'events2', count(*) from public.events;
update public.notifications set read_at = '2000-01-01T00:00:00Z' where kind = 'tagging_ready';
select is((select read_at from public.notifications where kind = 'tagging_ready'), now(),
  'marking read uses the database''s clock, whatever is sent');
update public.notifications set read_at = null where kind = 'tagging_ready';
select is((select read_at from public.notifications where kind = 'tagging_ready'), now(), 'it can''t be cleared');
update public.notifications set read_at = now() + interval '1 day' where kind = 'tagging_ready';
select is((select read_at from public.notifications where kind = 'tagging_ready'), now(), 'nor moved');
select throws_ok($$ update public.notifications set kind = 'job_closed' where kind = 'tagging_ready' $$, '42501', null,
  'no other column can be changed');
select throws_ok($$ update public.notifications set user_id = '11111111-1111-4111-8111-111111111111' $$, '42501', null,
  'nor the person it is for');
select throws_ok($$ insert into public.notifications (studio_id, user_id, event_id, kind)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 1, 'job_selling') $$,
  '42501', null, 'nobody signed in makes one');
select throws_ok($$ delete from public.notifications $$, '42501', null, 'or deletes one');
-- Marking everything read touches only my own.
update public.notifications set read_at = now() where read_at is null;
select is((select count(*) from public.notifications where read_at is null), 0::bigint, 'all of mine are read');
select is((select n from counts where k = 'events2'), (select count(*) from public.events),
  'reading writes no event (Q3)');
select pg_temp.as_user('55555555-5555-4555-8555-555555555555') as signed_in;
select is((select count(*) from public.notifications where read_at is not null), 0::bigint,
  'the admin''s are untouched by the photographer''s "mark all read"');
update public.notifications set read_at = now() where user_id = '33333333-3333-4333-8333-333333333333';
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select results_eq($$ select studio_id::text, kind::text from public.notifications $$,
  $$ values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'job_selling') $$,
  'another studio''s owner sees only their own');
update public.notifications set read_at = now() where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.as_user('77777777-7777-4777-8777-777777777777') as signed_in;
select is((select count(*) from public.notifications), 0::bigint, 'someone in no studio sees nothing');
reset role;
select is((select count(*) from public.notifications where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and read_at is not null and user_id <> '33333333-3333-4333-8333-333333333333'), 0::bigint,
  'nobody marked anyone else''s read (the admin''s and B''s attempts changed nothing)');
set local role anon;
select throws_ok($$ select 1 from public.notifications $$, '42501', null, 'anon can''t read them');
reset role;
select throws_ok($$ update public.notifications set data = '{"failed": 9}' where kind = 'photos_failed' $$, '23514',
  'notification_fixed', 'even the database owner can''t change one, except to mark it read');

-- ── Leaving and changing role ─────────────────────────────────────────────────────────────────────────────────────
delete from public.studio_members where user_id = '88888888-8888-4888-8888-888888888888';
select is((select count(*) from public.notifications where user_id = '88888888-8888-4888-8888-888888888888'),
  0::bigint, 'someone removed from the studio loses its notifications');
set local role authenticated;
select pg_temp.as_user('88888888-8888-4888-8888-888888888888') as signed_in;
select is((select count(*) from public.notifications), 0::bigint, 'and sees none');
reset role;
-- A row left for someone who is no longer a member (it can't happen through the trigger) is still hidden.
insert into public.studio_members (studio_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 'staff');
alter table public.studio_members disable trigger studio_members_notifications;
insert into public.notifications (studio_id, user_id, event_id, kind)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 1, 'job_selling');
delete from public.studio_members where user_id = '88888888-8888-4888-8888-888888888888';
alter table public.studio_members enable trigger studio_members_notifications;
set local role authenticated;
select pg_temp.as_user('88888888-8888-4888-8888-888888888888') as signed_in;
select is((select count(*) from public.notifications), 0::bigint,
  'row-level security hides a removed member''s rows even if one were left');
reset role;
update public.studio_members set role = 'staff' where user_id = '33333333-3333-4333-8333-333333333333';
select is(pg_temp.mine('33333333-3333-4333-8333-333333333333'), 'job_closed,job_closed,job_selling',
  'a photographer made staff keeps only what staff hear about');

-- ── Pruning ───────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.notifications disable trigger notifications_guard_read;
update public.notifications set created_at = now() - interval '100 days'
  where user_id = '11111111-1111-4111-8111-111111111111' and kind in ('job_selling', 'job_closed');
update public.notifications set read_at = now() - interval '99 days'
  where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'job_selling';
update public.notifications set created_at = now() - interval '200 days'
  where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'payouts_active';
alter table public.notifications enable trigger notifications_guard_read;
select throws_ok($$ select public.prune_notifications(0) $$, '22023', null, 'the limit is at least 1');
select throws_ok($$ select public.prune_notifications(1001) $$, '22023', null, 'and at most 1000');
select is(public.prune_notifications(1000), 2, 'read ones over 90 days and any over 180 days go');
select is(pg_temp.mine('11111111-1111-4111-8111-111111111111'),
  'job_closed,payouts_restricted,photos_failed,tagging_ready',
  'an unread one of 100 days and newer ones stay');
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$ select public.prune_notifications(10) $$, '42501', null, 'browsers can''t prune');
reset role;

-- ── Erasure ───────────────────────────────────────────────────────────────────────────────────────────────────────
delete from public.studio_members where user_id = '44444444-4444-4444-8444-444444444444';
delete from auth.users where id = '44444444-4444-4444-8444-444444444444';
select is((select count(*) from public.notifications where user_id = '44444444-4444-4444-8444-444444444444'),
  0::bigint, 'erasing a person erases their notifications');

select * from finish();
rollback;
