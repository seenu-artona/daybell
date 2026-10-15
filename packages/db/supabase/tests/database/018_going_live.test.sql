-- Going live (D75, D127, D143, D96; Claude's calls 1–2, A1–A3; ADR 0021): only owners and admins open, close and
-- reopen a shop, through the service-role functions that re-check their role before anything is read; the server
-- refuses Start selling unless the roster, a ready photo, reviewed tagging, something sold (ADR 0033 N3) and Active
-- payouts are all there, naming what is missing by key; a job never goes back to Draft, whoever writes; a closing date
-- is in the future, at most 400 days away and never on a closed job, and a draft whose date has passed can't start
-- selling until it is changed; the cron closes due selling jobs of every studio and nothing else; events carry ids only, and a status change writes no job.updated; another studio can do nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin-a@example.test'),
  ('77777777-7777-4777-8777-777777777777', 'outsider@example.test'),
  ('88888888-8888-4888-8888-888888888888', 'removed-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 'admin');
delete from public.studio_members where user_id = '88888888-8888-4888-8888-888888888888';

-- Fixtures as the database owner. Studio A: job 1 ready to sell but for payouts (a child, a ready photo tagged to
-- them, tagging reviewed, the starter list); job 2 empty; job 3 ready but on a price list with no items. Studio B: a
-- job. A's payout account needs info.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Ready', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Empty', 'school', '2026-10-01', 'JOB00002'),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Bare List', 'school', '2026-10-01', 'JOB00003'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
insert into public.price_lists (id, studio_id, name) values
  ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Nothing yet');
update public.jobs set price_list_id = 'e0000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000003';
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
select ('c0000000-0000-4000-8000-00000000000' || n)::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ('a0000000-0000-4000-8000-00000000000' || n)::uuid, 'Maya', 'Johnson', repeat(n::text, 64), 'v1.' || repeat('A', 48)
from (values (1), (3)) v (n);
insert into public.upload_batches (id, studio_id, job_id, created_by)
select ('a2000000-0000-4000-8000-00000000000' || n)::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ('a0000000-0000-4000-8000-00000000000' || n)::uuid, '33333333-3333-4333-8333-333333333333'
from (values (1), (3)) v (n);
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  created_by)
select ('9a000000-0000-4000-8000-00000000000' || right(b.job_id::text, 1))::uuid, b.studio_id, b.job_id, b.id, b.seq,
  'ready', 'IMG_0001.JPG', 1, extensions.digest(b.id::text, 'sha256'), b.created_by
from public.upload_batches b where b.studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.upload_batches set tagged_round = tag_round;
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, source)
select p.id, p.studio_id, p.job_id, 'child', c.id, 'auto'
from public.photos p join public.children c on c.job_id = p.job_id;
insert into public.job_tagging_reviews (job_id, studio_id, reviewed_by)
select j.id, j.studio_id, '33333333-3333-4333-8333-333333333333' from public.jobs j
where j.id in ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003');
insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, status, payout_interval,
  weekly_anchor, delay_days)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'acct_A1', 'US', false, 'needs_info', 'weekly', 'friday', 2);

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
-- What Start selling (or Reopen) answers: started, or the error's code, message and detail (the blockers' keys).
create function pg_temp.try_sell(p_actor uuid, p_job uuid, p_reopen boolean default false) returns text
language plpgsql as $$
declare
  v_detail text;
begin
  if p_reopen then
    perform public.reopen_job(p_actor, p_job);
  else
    perform public.start_selling(p_actor, p_job);
  end if;
  return 'started';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || ' ' || sqlerrm || coalesce(' ' || nullif(v_detail, ''), '');
end;
$$;
create function pg_temp.status(p_job uuid) returns text language sql as $$
  select status::text from public.jobs where id = p_job $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_column('public', 'jobs', 'closes_at', 'jobs have a closing date');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where proname in ('start_selling', 'reopen_job', 'close_job', 'close_due_jobs', 'act_for_manager', 'sell_blockers',
    'go_live')),
  'the going-live functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from unnest(array['public.start_selling(uuid, uuid)', 'public.reopen_job(uuid, uuid)',
    'public.close_job(uuid, uuid)', 'public.close_due_jobs(int)']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  0::bigint, 'browsers and logged-out visitors can run none of them');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
  where p.proname in ('start_selling', 'reopen_job', 'close_job', 'close_due_jobs') and a.grantee = 0
    and a.privilege_type = 'EXECUTE'), 'PUBLIC can run none of them');
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')) from unnest(array[
    'public.start_selling(uuid, uuid)', 'public.reopen_job(uuid, uuid)', 'public.close_job(uuid, uuid)',
    'public.close_due_jobs(int)']) f), 'the service role runs them');
select is((select count(*) from unnest(array['app.act_for_manager(uuid, uuid)', 'app.sell_blockers(uuid)',
    'app.go_live(uuid, uuid, public.job_status)', 'app.guard_job_status()', 'app.guard_job_closes_at()']) f
  where has_function_privilege('authenticated', f, 'execute')), 0::bigint, 'browsers can run no app helper');

-- ── What blocks selling, by key, in the dialog's order (A1, A2) ───────────────────────────────────────────────────
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002'),
  'P0001 not_ready roster,photos,tagging,payouts',
  'an empty job: no roster, no photos (zero photos fail), nothing reviewed, no payouts');
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001'),
  'P0001 not_ready payouts', 'a ready job is refused while payouts aren''t Active');
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000003'),
  'P0001 not_ready price_list,payouts', 'a price list with no items counts as no price list (A2)');
-- N3 (ADR 0033): the job must sell at least one item. Every list item switched off for the job is nothing to sell; a
-- product of the job's own is something.
insert into public.job_price_overrides (studio_id, job_id, price_list_id, price_list_item_id, sold)
select i.studio_id, j.id, i.price_list_id, i.id, false from public.price_list_items i
join public.jobs j on j.price_list_id = i.price_list_id and j.studio_id = i.studio_id
where j.id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001'),
  'P0001 not_ready price_list,payouts', 'every list item switched off for the job counts as nothing to sell (N3)');
delete from public.job_price_overrides where job_id = 'a0000000-0000-4000-8000-000000000001';
insert into public.job_shop_items (studio_id, job_id, kind, name, print_size, price_cents)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000003', 'print', 'Job print', '5x7', 1500);
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000003'),
  'P0001 not_ready payouts', 'a job''s own product is something to sell, even on an empty list (N3)');
delete from public.job_shop_items where job_id = 'a0000000-0000-4000-8000-000000000003';
update public.payout_accounts set status = 'active' where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
delete from public.job_tagging_reviews where job_id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001'),
  'P0001 not_ready tagging', 'tagging not marked reviewed blocks it');
insert into public.job_tagging_reviews (job_id, studio_id, reviewed_by)
values ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333');
update public.upload_batches set tag_round = tag_round + 1 where job_id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001'),
  'P0001 not_ready tagging', 'so does a batch waiting to be tagged, even if reviewed');
update public.upload_batches set tagged_round = tag_round where job_id = 'a0000000-0000-4000-8000-000000000001';
update public.photo_tags set place = 'leftovers', child_id = null
  where job_id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001'),
  'P0001 not_ready tagging', 'and photos in Leftovers');
update public.photo_tags set place = 'child', child_id = 'c0000000-0000-4000-8000-000000000001'
  where job_id = 'a0000000-0000-4000-8000-000000000001';
update public.photos set binned_at = now(), binned_by = '11111111-1111-4111-8111-111111111111' where job_id = 'a0000000-0000-4000-8000-000000000001';
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001'),
  'P0001 not_ready photos,tagging', 'a photo in the bin doesn''t count');
update public.photos set binned_at = null, binned_by = null where job_id = 'a0000000-0000-4000-8000-000000000001';
update public.upload_batches set tagged_round = tag_round where job_id = 'a0000000-0000-4000-8000-000000000001';
insert into public.job_tagging_reviews (job_id, studio_id, reviewed_by)
values ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333') on conflict do nothing;
select is((select count(*) from public.events where type in ('job.selling', 'job.closed')), 0::bigint,
  'a refusal changes nothing and writes no event');

-- ── Who may (call 1), refused before anything is read ─────────────────────────────────────────────────────────────
select throws_ok($$ select public.start_selling('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', 'Owners and admins only', 'a photographer can''t start selling');
select throws_ok($$ select public.start_selling('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'nor staff');
select throws_ok($$ select public.start_selling('77777777-7777-4777-8777-777777777777',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'nor someone in no studio');
select throws_ok($$ select public.start_selling('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'nor another studio''s owner');
select throws_ok($$ select public.start_selling('88888888-8888-4888-8888-888888888888',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'nor a removed admin');
select throws_ok($$ select public.start_selling(null, 'a0000000-0000-4000-8000-000000000001') $$, '42501', null,
  'nor nobody');
select is(pg_temp.try_sell('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-000000000002'),
  '42501 Owners, admins and photographers only',
  'another studio''s owner learns nothing about what blocks A''s job');
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-000000000009'),
  '42501 Owners, admins and photographers only',
  'an unknown job is refused exactly like another studio''s (nobody learns whether it exists)');
select throws_ok($$ select public.close_job('33333333-3333-4333-8333-333333333333',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'photographers can''t close a shop');
select throws_ok($$ select public.reopen_job('44444444-4444-4444-8444-444444444444',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'nor staff reopen one');
select is(pg_temp.status('a0000000-0000-4000-8000-000000000001'), 'draft', 'none of that changed the job');

-- ── Start selling ─────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.try_sell('55555555-5555-4555-8555-555555555555', 'a0000000-0000-4000-8000-000000000001'),
  'started', 'an admin starts selling a ready job');
select is(pg_temp.status('a0000000-0000-4000-8000-000000000001'), 'selling', 'it is selling');
select results_eq($$ select actor_id, subject_id, data from public.events where type = 'job.selling' $$,
  $$ values ('55555555-5555-4555-8555-555555555555'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid,
    '{"from": "draft"}'::jsonb) $$, 'one job.selling event, attributed to the admin, ids only');
select is((select count(*) from public.events where type = 'job.updated'
  and subject_id = 'a0000000-0000-4000-8000-000000000001'), 0::bigint, 'and no job.updated for the status (A3)');
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001'),
  'P0001 already_selling', 'starting again is refused');
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', true),
  'P0001 job_not_closed', 'and a selling shop can''t be reopened');
select throws_ok($$ select public.close_job('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000002') $$, 'P0001', 'job_not_selling', 'a draft can''t be closed');

-- ── Close and reopen (call 2) ─────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.close_job('22222222-2222-4222-8222-222222222222',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'another studio''s owner can''t close A''s shop');
select lives_ok($$ select public.close_job('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001') $$, 'the owner closes the shop');
select is(pg_temp.status('a0000000-0000-4000-8000-000000000001'), 'closed', 'it is closed');
select results_eq($$ select actor_id, data from public.events where type = 'job.closed' $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid, '{"scheduled": false}'::jsonb) $$,
  'one job.closed event, by the owner, not scheduled');
select throws_ok($$ select public.close_job('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001') $$, 'P0001', 'job_not_selling', 'closing again is refused');
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001'),
  'P0001 job_closed', 'Start selling on a closed job is refused: it is reopened instead');
update public.payout_accounts set status = 'restricted' where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', true),
  'P0001 not_ready payouts', 'reopening checks the same things (restricted payouts)');
update public.payout_accounts set status = 'active' where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', true),
  'started', 'the owner reopens the shop');
select results_eq($$ select actor_id, data from public.events where type = 'job.selling' order by id desc limit 1 $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid, '{"from": "closed"}'::jsonb) $$,
  'job.selling says it came from closed');

-- ── Never back to Draft, whoever writes ───────────────────────────────────────────────────────────────────────────
select throws_ok($$ update public.jobs set status = 'draft' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'P0001', 'job_status_invalid', 'selling → draft is refused even for the database owner (call 2)');
select throws_ok($$ update public.jobs set status = 'closed' where id = 'a0000000-0000-4000-8000-000000000002' $$,
  'P0001', 'job_status_invalid', 'and draft → closed');
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$ update public.jobs set status = 'closed' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'signed-in people still can''t write the status');
select throws_ok($$ select public.close_job('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'nor run the functions from a browser session');

-- ── The closing date ──────────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ update public.jobs set closes_at = now() - interval '1 hour'
  where id = 'a0000000-0000-4000-8000-000000000001' $$, 'P0001', 'closes_at_invalid', 'a closing date in the past is refused');
select throws_ok($$ update public.jobs set closes_at = now() + interval '401 days'
  where id = 'a0000000-0000-4000-8000-000000000001' $$, 'P0001', 'closes_at_invalid', 'as is one over 400 days away');
select lives_ok($$ update public.jobs set closes_at = now() + interval '1 day'
  where id = 'a0000000-0000-4000-8000-000000000001' $$, 'the owner sets a closing date tomorrow');
select lives_ok($$ update public.jobs set closes_at = now() + interval '3 days'
  where id = 'a0000000-0000-4000-8000-000000000002' $$, 'and one on a draft');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select is((select count(*) from public.jobs where closes_at is not null), 2::bigint,
  'the team sees the dates');
update public.jobs set closes_at = null where id = 'a0000000-0000-4000-8000-000000000001';
select isnt((select closes_at from public.jobs where id = 'a0000000-0000-4000-8000-000000000001'), null,
  'a photographer can''t change it (row-level security)');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select is((select count(*) from public.jobs where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'another studio sees none of A''s jobs or dates');
update public.jobs set closes_at = null where id = 'a0000000-0000-4000-8000-000000000001';
reset role;
select isnt((select closes_at from public.jobs where id = 'a0000000-0000-4000-8000-000000000001'), null,
  'nor changes them');
select results_eq($$ select data -> 'fields' from public.events where type = 'job.updated'
  and subject_id <> 'a0000000-0000-4000-8000-000000000003' order by id $$,
  $$ values ('["closes_at"]'::jsonb), ('["closes_at"]'::jsonb) $$, 'setting a date is a job.updated naming closes_at');
select lives_ok($$ select public.close_job('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001') $$, 'closing the shop');
select is((select closes_at from public.jobs where id = 'a0000000-0000-4000-8000-000000000001'), null,
  'clears its closing date');
select is((select count(*) from public.events where type = 'job.updated'
  and subject_id = 'a0000000-0000-4000-8000-000000000001'), 1::bigint, 'with no job.updated (job.closed says it)');
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$ update public.jobs set closes_at = now() + interval '1 day'
  where id = 'a0000000-0000-4000-8000-000000000001' $$, 'P0001', 'job_closed', 'a closed job''s date can''t be set');
reset role;

-- ── The cron closes due shops (any studio), and nothing else ──────────────────────────────────────────────────────
-- Dates in the past, as the database owner with the guard off (time doesn't pass inside a test).
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', true),
  'started', 'A''s job sells again');
update public.jobs set status = 'selling' where id = 'b0000000-0000-4000-8000-000000000001';
alter table public.jobs disable trigger jobs_guard_closes_at;
update public.jobs set closes_at = now() - interval '1 minute'
  where id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002');
alter table public.jobs enable trigger jobs_guard_closes_at;
update public.jobs set closes_at = now() + interval '1 day' where id = 'a0000000-0000-4000-8000-000000000003';
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000003';
select throws_ok($$ select public.close_due_jobs(0) $$, '22023', null, 'the limit is at least 1');
select throws_ok($$ select public.close_due_jobs(1001) $$, '22023', null, 'and at most 1000');
select throws_ok($$ select public.close_due_jobs(null) $$, '22023', null, 'and given');
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true) is not null as acting;
select is(public.close_due_jobs(1), 1, 'one at a time');
select is(public.close_due_jobs(500), 1, 'then the rest');
select is(current_setting('request.jwt.claim.sub', true), '55555555-5555-4555-8555-555555555555',
  'the caller''s identity is put back');
select results_eq($$ select id::text, status::text, closes_at from public.jobs order by id $$,
  $$ values ('a0000000-0000-4000-8000-000000000001', 'closed', null::timestamptz),
    ('a0000000-0000-4000-8000-000000000002', 'draft', now() - interval '1 minute'),
    ('a0000000-0000-4000-8000-000000000003', 'selling', now() + interval '1 day'),
    ('b0000000-0000-4000-8000-000000000001', 'closed', null::timestamptz) $$,
  'due selling shops in both studios closed; a draft and a shop not yet due didn''t');
select results_eq($$ select subject_id::text, actor_id, data from public.events
  where type = 'job.closed' and data = '{"scheduled": true}' order by subject_id $$,
  $$ values ('a0000000-0000-4000-8000-000000000001', null::uuid, '{"scheduled": true}'::jsonb),
    ('b0000000-0000-4000-8000-000000000001', null::uuid, '{"scheduled": true}'::jsonb) $$,
  'each wrote job.closed {scheduled: true} with no actor, in its own studio');
select is((select studio_id from public.events where type = 'job.closed'
  and subject_id = 'b0000000-0000-4000-8000-000000000001'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'B''s event is B''s');
select is(public.close_due_jobs(500), 0, 'nothing left to close');
-- A draft whose closing date has passed (M3): refused by name before anything else, so it can't go live only to be
-- closed by the next run.
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002'),
  'P0001 closes_at_passed', 'Start selling a draft whose closing date has passed is refused');
select is(pg_temp.status('a0000000-0000-4000-8000-000000000002'), 'draft', 'it stays a draft');
update public.jobs set closes_at = null where id = 'a0000000-0000-4000-8000-000000000002';
select is(pg_temp.try_sell('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002'),
  'P0001 not_ready roster,photos,tagging', 'once the date is removed, only the usual checks remain');
select set_config('request.jwt.claim.sub', '', true) is not null as done_acting;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$ select public.close_due_jobs(10) $$, '42501', null, 'browsers can''t run the cron''s work');
reset role;
set local role anon;
select throws_ok($$ select public.start_selling('11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000003') $$, '42501', null, 'nor can logged-out visitors start selling');
reset role;

-- ── Events carry ids only (D96) ───────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from public.events where type in ('job.selling', 'job.closed', 'job.updated')
  and data::text ~ '(A Ready|Maya|Johnson|example\.test|acct_)'), 0::bigint, 'no names, emails or Stripe ids');
select is((select count(*) from public.events where type = 'job.updated' and data -> 'fields' ? 'status'), 0::bigint,
  'job.updated never names the status');

select * from finish();
rollback;
