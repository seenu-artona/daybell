-- One checklist (D143, D96; Seenu's answers of Oct 12 2026; ADR 0017): the checklist facts function counts only the
-- caller's own studio, and studios.onboarded_at is written once, by owners and admins of that studio only, with one
-- event that carries ids only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin-a@example.test'),
  ('66666666-6666-4666-8666-666666666666', 'outsider@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'admin');

-- Fixtures as the database owner. Studio A: job 1 with three children (one Do not photograph, one with a card), one
-- ready photo, two failed photos and a failed photo in the bin; job 2 empty. Studio B: a job with a child, a card and
-- photos, which A must never count.
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Fall', 'school', '2026-10-01', 'JOB00001'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Spring', 'school', '2027-04-01', 'JOB00002'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-01', 'JOB00001');
insert into public.children (id, studio_id, job_id, first_name, last_name, do_not_photograph, access_code_hash,
  access_code_ciphertext) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'Maya', 'Johnson', false, repeat('1', 64), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'Liam', 'Chen', false, repeat('2', 64), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'Zoe', 'Optout', true, repeat('3', 64), 'v1.' || repeat('A', 48)),
  ('d0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   'Bianca', 'Secret', false, repeat('b', 64), 'v1.' || repeat('B', 48));
insert into public.qr_cards (studio_id, job_id, child_id, card_code) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'AAAAAAAAAAAAAAAAAAAA'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'BBBBBBBBBBBBBBBBBBBB');
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('a2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111'),
  ('b2000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222');
insert into public.photos (studio_id, job_id, batch_id, batch_seq, status, failure_reason, original_filename,
  byte_size, sha256, created_by, binned_at, binned_by)
select b.studio_id, b.job_id, b.id, b.seq, v.status::public.photo_status, v.reason, v.name, 1,
  extensions.digest(b.id::text || v.name, 'sha256'), b.created_by,
  case when v.binned then now() end, case when v.binned then b.created_by end
from public.upload_batches b,
  (values ('ready', null, 'ok.jpg', false), ('failed', 'unreadable', 'bad1.jpg', false),
          ('failed', 'not_jpeg', 'bad2.jpg', false), ('failed', 'unreadable', 'binned.jpg', true)) v (status, reason, name, binned);

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_column('public', 'studios', 'onboarded_at', 'studios have onboarded_at');
select col_is_null('public', 'studios', 'onboarded_at', 'onboarded_at is nullable (no backfill)');
select is((select count(*) from public.studios where onboarded_at is not null), 0::bigint, 'no studio starts onboarded');
select ok((select proconfig @> array['search_path=""'] from pg_proc where proname = 'job_checklist_facts'),
  'job_checklist_facts (SECURITY DEFINER) runs with an empty search_path');
select ok((select prosecdef from pg_proc where proname = 'job_checklist_facts'),
  'job_checklist_facts is SECURITY DEFINER (it checks membership itself)');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
  where p.proname = 'job_checklist_facts' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC cannot execute job_checklist_facts');
select ok(not has_function_privilege('anon', 'public.job_checklist_facts(uuid, uuid[])', 'execute'),
  'logged-out visitors cannot run job_checklist_facts');
select is((select count(*) from unnest(array['app.guard_studio_onboarded()', 'app.on_studio_onboarded()']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  0::bigint, 'no new app function is executable by browsers');

-- ── Checklist facts, as A's photographer ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select results_eq($$
  select job_id, children, qr_eligible, qr_with_card, has_ready_photo, failed_photos
  from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002']::uuid[])
  order by job_id $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid, 3, 2, 1, true, 2),
            ('a0000000-0000-4000-8000-000000000002'::uuid, 0, 0, 0, false, 0) $$,
  'counts children, cards, a ready photo and failed photos not in the bin, per job');
select is_empty($$
  select * from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['b0000000-0000-4000-8000-000000000001']::uuid[]) $$,
  'another studio''s job id passed with my studio returns nothing');
select is_empty($$
  select * from public.job_checklist_facts('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    array['b0000000-0000-4000-8000-000000000001']::uuid[]) $$,
  'asking for studio B, which I am not a member of, returns nothing');
select is_empty($$
  select * from public.job_checklist_facts('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    array['a0000000-0000-4000-8000-000000000001']::uuid[]) $$,
  'my own job asked for under another studio returns nothing');
select is_empty($$ select * from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}') $$,
  'no job ids, no rows');
select is_empty($$ select * from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) $$,
  'a null list of job ids, no rows');
select is_empty($$ select * from public.job_checklist_facts(null,
  array['a0000000-0000-4000-8000-000000000001']::uuid[]) $$,
  'a null studio, no rows');
select throws_ok($$ select * from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select array_agg(gen_random_uuid()) from generate_series(1, 1001))) $$,
  '22023', 'At most 1000 jobs per call', 'more than 1000 job ids are refused, with no values in the message');

-- ── Checklist facts, as B's owner ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select results_eq($$
  select job_id, children, qr_eligible, qr_with_card, has_ready_photo, failed_photos
  from public.job_checklist_facts('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    array['b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001']::uuid[]) $$,
  $$ values ('b0000000-0000-4000-8000-000000000001'::uuid, 1, 1, 1, true, 2) $$,
  'B sees only its own job, with only its own counts');
select is_empty($$
  select * from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['a0000000-0000-4000-8000-000000000001']::uuid[]) $$,
  'B cannot read A''s facts by passing A''s studio id');

-- Someone signed in who belongs to no studio gets nothing for any studio.
select pg_temp.as_user('66666666-6666-4666-8666-666666666666') as signed_in;
select is_empty($$
  select * from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['a0000000-0000-4000-8000-000000000001']::uuid[]) $$,
  'an outsider gets no facts');

-- A member removed from studio A gets nothing any more.
reset role;
delete from public.studio_members where user_id = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
select is_empty($$
  select * from public.job_checklist_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['a0000000-0000-4000-8000-000000000001']::uuid[]) $$,
  'a removed member gets no facts');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;

-- ── onboarded_at ──────────────────────────────────────────────────────────────────────────────────────────────────
-- B's owner tries A's studio: RLS matches no rows.
update public.studios set onboarded_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
-- A's photographer can't update the studio either, nor can the removed staff member.
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
update public.studios set onboarded_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
update public.studios set onboarded_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
reset role;
select is((select onboarded_at from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), null,
  'another studio''s owner, a photographer and a removed member cannot mark studio A onboarded');

-- A's admin marks it, choosing a date in the past: the database's clock wins.
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555') as signed_in;
select lives_ok($$ update public.studios set onboarded_at = '2001-01-01'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and onboarded_at is null $$,
  'an admin of studio A marks it onboarded');
reset role;
select is((select onboarded_at from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), now(),
  'onboarded_at is the database''s time, not the caller''s');
select is((select count(*) from public.events where type = 'studio.onboarded'
  and studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and subject_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1::bigint, 'one studio.onboarded event, about the studio');
select is((select data from public.events where type = 'studio.onboarded'), '{}'::jsonb,
  'the event carries ids only, no data');
select is((select actor_id from public.events where type = 'studio.onboarded'),
  '55555555-5555-4555-8555-555555555555'::uuid, 'the event records who completed it');

-- Once set, it stays: neither cleared nor moved, and no second event. A known past value (written with triggers
-- off, as the table's owner) makes "moved" visible: now() would hide a move to now(). Rolled back with the test.
alter table public.studios disable trigger studios_guard_onboarded;
update public.studios set onboarded_at = '2001-01-01T00:00:00Z' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
alter table public.studios enable trigger studios_guard_onboarded;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
update public.studios set onboarded_at = null where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select onboarded_at from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '2001-01-01T00:00:00Z'::timestamptz, 'the owner cannot clear it');
update public.studios set onboarded_at = '2030-01-01' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.studios set onboarded_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select onboarded_at from public.studios where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '2001-01-01T00:00:00Z'::timestamptz, 'nor move it, to a chosen time or to now');
select lives_ok($$ update public.studios set name = 'Studio A Photo' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  'renaming the studio still works');
reset role;
select is((select count(*) from public.events where type = 'studio.onboarded'), 1::bigint,
  'still one studio.onboarded event');
select is((select onboarded_at from public.studios where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), null,
  'studio B is untouched');
select is((select count(*) from public.events where type = 'studio.onboarded'
  and studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0::bigint, 'and has no onboarding event');

-- B's owner can read only their own studio's flag.
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select results_eq($$ select id, onboarded_at from public.studios $$,
  $$ values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, null::timestamptz) $$,
  'B''s owner reads only studio B''s onboarded_at');

select * from finish();
rollback;
