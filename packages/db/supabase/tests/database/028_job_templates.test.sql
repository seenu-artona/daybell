-- Job templates and a job's Progress (D151–D154; ADR 0029): templates have row-level security (the team reads, owners
-- and admins write), one default per studio (seeded, never cleared or deleted), events with ids and field names only;
-- a new job copies its template's rules and keeps a snapshot nobody can change, so template changes reach new jobs
-- only; opening the shop sets the closing date from the job's own rule; the Progress facts, the job's numbers, a
-- person's card and photo dates and their orders are the caller's studio's only, with who-did-it for owners and
-- admins only and the numbers for owners and admins only; Subjects' new saved chips.
begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'ca'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'ca');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'admin');

create function pg_temp.h(p text) returns text language sql as $$
  select encode(extensions.digest(p, 'sha256'), 'hex') $$;
create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
grant execute on function pg_temp.as_user(uuid) to authenticated;
create temp table ids (k text primary key, id uuid not null);
grant all on ids to authenticated;
create function pg_temp.v(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'job_templates', 'job_templates exists');
select ok((select relrowsecurity from pg_class where oid = 'public.job_templates'::regclass),
  'row-level security is on');
select ok(not has_table_privilege('anon', 'public.job_templates', 'select')
  and not has_column_privilege('authenticated', 'public.job_templates', 'studio_id', 'update')
  and not has_column_privilege('authenticated', 'public.jobs', 'template_rules', 'update')
  and not has_column_privilege('authenticated', 'public.jobs', 'template_rules', 'insert')
  and not has_column_privilege('authenticated', 'public.jobs', 'opened_at', 'update')
  and not has_column_privilege('authenticated', 'public.jobs', 'template_id', 'update')
  and has_column_privilege('authenticated', 'public.jobs', 'shop_closes_days', 'update'),
  'templates never move studio; a job''s snapshot, template and opening moment are the database''s');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid = 'public.job_progress_facts(uuid, uuid)'::regprocedure),
  'job_progress_facts is SECURITY DEFINER with an empty search_path');
select ok(not has_function_privilege('anon', 'public.job_progress_facts(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.job_sales(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_job_templates(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.child_record_facts(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.seed_job_template(uuid)', 'execute'),
  'the new functions are for signed-in people only, and nobody seeds templates by hand');
select is((select count(*) from pg_proc where prosecdef and oid in (
    'public.job_sales(uuid, uuid)'::regprocedure, 'public.list_job_templates(uuid)'::regprocedure,
    'public.child_record_facts(uuid, uuid)'::regprocedure)), 0::bigint,
  'job_sales, list_job_templates and child_record_facts are SECURITY INVOKER: row-level security decides');

-- ── Seeding: one default template per studio, from today's defaults, with no events ───────────────────────────────
select results_eq($$ select s.slug, t.name, t.qr_cards_days_before, t.shop_opens::text, t.shop_closes_days,
    t.price_list_id, t.deliver_to_school
  from public.studios s join public.job_templates t on t.id = s.default_job_template_id order by s.slug $$,
  $$ values ('studio-a'::text, 'Standard'::text, null::smallint, 'photos_checked'::text, null::smallint, null::uuid,
             false), ('studio-b', 'Standard', null, 'photos_checked', null, null, false) $$,
  'every new studio gets one default template that keeps today''s behaviour');
select is((select count(*) from public.events where type like 'job_template.%'), 0::bigint,
  'seeding writes no events');
insert into ids select 'stdA', default_job_template_id from public.studios where slug = 'studio-a';
insert into ids select 'stdB', default_job_template_id from public.studios where slug = 'studio-b';

-- ── Templates as studio A's owner ─────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select lives_ok($$
  with r as (
    insert into public.job_templates (studio_id, name, qr_cards_days_before, shop_opens, shop_closes_days)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'School Fall', 5, 'photos_checked', 10) returning id)
  insert into ids select 'fall', id from r $$,
  'the owner adds a template');
select throws_ok($$
  insert into public.job_templates (studio_id, name, shop_opens)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Broken', 'after_picture_day') $$,
  '23514', null, '"days after picture day" needs its days');
select throws_ok($$
  insert into public.job_templates (studio_id, name, shop_closes_days)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Too long', 400) $$,
  '23514', null, 'a shop closes at most 365 days after it opens');
select throws_ok($$
  insert into public.job_templates (studio_id, name) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Sneaky') $$,
  '42501', null, 'studio A''s owner can''t add a template to studio B');
select results_eq($$ select type, subject_id, data from public.events where type like 'job_template.%' $$,
  $$ values ('job_template.created'::text, pg_temp.v('fall'), '{}'::jsonb) $$,
  'adding one writes job_template.created with its id only');
update public.job_templates set name = 'School Fall 2026', shop_opens = 'after_picture_day', shop_opens_days = 7
  where id = pg_temp.v('fall');
select is((select data from public.events where type = 'job_template.updated'),
  '{"fields": ["name", "shop_opens", "shop_opens_days"]}'::jsonb, 'a change names its fields, never their values');
update public.job_templates set shop_opens = 'photos_checked', shop_opens_days = null where id = pg_temp.v('fall');
select is((select name from public.job_templates where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), null,
  'studio A''s owner reads none of studio B''s templates');

-- A new job copies its template; without one, the studio's default.
select lives_ok($$
  with r as (
    insert into public.jobs (studio_id, name, type, picture_day, internal_number, template_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Fall', 'school', '2026-11-02', 'JOB00001',
            pg_temp.v('fall')) returning id)
  insert into ids select 'lincoln', id from r $$,
  'the owner makes a job from School Fall');
select results_eq($$ select template_id, qr_cards_days_before, shop_opens::text, shop_opens_days, shop_closes_days,
    template_rules, opened_at from public.jobs where id = pg_temp.v('lincoln') $$,
  $$ values (pg_temp.v('fall'), 5::smallint, 'photos_checked'::text, null::smallint, 10::smallint,
    '{"qr_cards_days_before": 5, "shop_opens": "photos_checked", "shop_opens_days": null, "shop_closes_days": 10}'::jsonb,
    null::timestamptz) $$,
  'it copies the template''s rules and keeps what it was given');
select is((select data from public.events where type = 'job.created' and subject_id = pg_temp.v('lincoln')),
  '{"type": "school", "status": "draft"}'::jsonb, 'job.created is unchanged: the template is on the job');
select lives_ok($$
  with r as (
    insert into public.jobs (studio_id, name, type, picture_day, internal_number)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hillcrest', 'school', '2026-11-05', 'JOB00002') returning id)
  insert into ids select 'hill', id from r $$,
  'a job made without a template');
select results_eq($$ select template_id, template_rules ->> 'shop_opens', shop_closes_days
  from public.jobs where id = pg_temp.v('hill') $$,
  $$ values (pg_temp.v('stdA'), 'photos_checked'::text, null::smallint) $$, 'gets the studio''s default template');
select throws_ok($$
  insert into public.jobs (studio_id, name, type, picture_day, internal_number, template_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cross', 'school', '2026-11-05', 'JOB00003', pg_temp.v('stdB')) $$,
  '23503', null, 'a job can''t use another studio''s template');

-- The job's own changes; the snapshot never changes.
update public.jobs set shop_closes_days = 14 where id = pg_temp.v('lincoln');
select is((select data from public.events where type = 'job.updated' and subject_id = pg_temp.v('lincoln')),
  '{"fields": ["shop_closes_days"]}'::jsonb, 'a job''s own rule change writes job.updated with the field''s name');
select throws_ok($$ update public.jobs set template_rules = '{}' where id = pg_temp.v('lincoln') $$,
  '42501', null, 'nobody signed in changes the snapshot');
update public.job_templates set shop_closes_days = 21, qr_cards_days_before = 3 where id = pg_temp.v('fall');
select results_eq($$ select qr_cards_days_before, shop_closes_days, (template_rules ->> 'shop_closes_days')::int
  from public.jobs where id = pg_temp.v('lincoln') $$,
  $$ values (5::smallint, 14::smallint, 10) $$, 'a template change never reaches a job made from it');

-- The default: switched with one update, never cleared, never deleted.
select is((select count(*) from public.list_job_templates('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')), 2::bigint,
  'the list has the studio''s two templates');
select results_eq($$ select name, is_default, used_by from public.list_job_templates('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  $$ values ('Standard'::text, true, 1::bigint), ('School Fall 2026', false, 1) $$,
  'the default first, each with how many jobs use it');
update public.studios set default_job_template_id = pg_temp.v('fall') where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select results_eq($$ select type, subject_id, data from public.events where type = 'job_template.made_default' $$,
  $$ values ('job_template.made_default'::text, pg_temp.v('fall'), '{}'::jsonb) $$,
  'making it the default writes job_template.made_default with its id');
select throws_ok($$ update public.studios set default_job_template_id = null
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$, '23514', null, 'the default is never cleared');
select throws_ok($$ delete from public.job_templates where id = pg_temp.v('fall') $$,
  '23503', null, 'the default template can''t be deleted');
select throws_ok($$ update public.studios set default_job_template_id = pg_temp.v('stdB')
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$, '23503', null,
  'another studio''s template can''t be the default');

-- ── Other people ──────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as photographer;
select is((select count(*) from public.job_templates), 2::bigint, 'a photographer reads the studio''s templates');
select throws_ok($$ insert into public.job_templates (studio_id, name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mine') $$, '42501', null, 'but can''t add one');
update public.job_templates set name = 'Renamed' where id = pg_temp.v('stdA');
delete from public.job_templates where id = pg_temp.v('stdA');
select is((select name from public.job_templates where id = pg_temp.v('stdA')), 'Standard',
  'nor change or delete one');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as owner_b;
select is((select count(*) from public.job_templates), 1::bigint, 'studio B''s owner reads only studio B''s template');
select is((select count(*) from public.list_job_templates('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')), 0::bigint,
  'and gets nothing listing studio A''s');
update public.job_templates set name = 'Hacked' where id = pg_temp.v('fall');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select is((select name from public.job_templates where id = pg_temp.v('fall')), 'School Fall 2026',
  'nor change one of them');

-- Deleting a template its jobs used leaves them their own copy.
update public.studios set default_job_template_id = pg_temp.v('stdA') where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
delete from public.job_templates where id = pg_temp.v('fall');
select results_eq($$ select template_id, shop_closes_days, (template_rules ->> 'shop_closes_days')::int
  from public.jobs where id = pg_temp.v('lincoln') $$,
  $$ values (null::uuid, 14::smallint, 10) $$, 'a deleted template''s jobs keep their rules and snapshot');
select is((select count(*) from public.events where type = 'job_template.deleted' and subject_id = pg_temp.v('fall')
  and data = '{}'), 1::bigint, 'and the deletion writes job_template.deleted with its id only');

-- ── Opening the shop (as the database: status changes go through go_live, ADR 0021) ───────────────────────────────
reset role;
select throws_ok($$ update public.jobs set template_rules = '{}' where id = pg_temp.v('lincoln') $$, '23514', null,
  'even the database refuses to change a job''s snapshot');
update public.jobs set status = 'selling' where id = pg_temp.v('lincoln');
select ok((select opened_at is not null and closes_at = opened_at + interval '14 days' from public.jobs
  where id = pg_temp.v('lincoln')), 'the shop''s first opening is kept, and closes 14 days later by the job''s rule');
select is((select count(*) from public.events where type = 'job.updated' and subject_id = pg_temp.v('lincoln')
  and data -> 'fields' ? 'closes_at'), 0::bigint, 'the rule''s closing date writes no job.updated (job.selling says it)');
update public.jobs set status = 'closed', closes_at = null where id = pg_temp.v('lincoln');
create temp table first_open as select opened_at from public.jobs where id = pg_temp.v('lincoln');
update public.jobs set status = 'selling' where id = pg_temp.v('lincoln');
select ok((select j.opened_at = f.opened_at and j.closes_at is null from public.jobs j, first_open f
  where j.id = pg_temp.v('lincoln')), 'reopening keeps the first opening and sets no closing date');
update public.jobs set status = 'selling' where id = pg_temp.v('hill');
select is((select closes_at from public.jobs where id = pg_temp.v('hill')), null,
  'a job whose rule is "by hand" opens with no closing date');

-- ── Progress facts ────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number) values
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-13',
   'JOB00001');
insert into public.children (id, studio_id, job_id, first_name, last_name, access_code_hash, access_code_ciphertext)
values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln'), 'Ava', 'Patel',
   pg_temp.h('c1'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln'), 'Noah', 'Patel',
   pg_temp.h('c2'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln'), 'Liam', 'Chen',
   pg_temp.h('c3'), 'v1.' || repeat('A', 48)),
  ('cb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   'Bea', 'Brown', pg_temp.h('cb1'), 'v1.' || repeat('A', 48));
-- Two prints by the admin, the later one wins; an upload by the photographer; another job's print never counts.
insert into public.events (studio_id, type, actor_id, subject_id, data, occurred_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'qr_cards.printed', '55555555-5555-4555-8555-555555555555',
   pg_temp.v('lincoln'), '{}', '2026-10-01T10:00:00Z'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'qr_cards.printed', '55555555-5555-4555-8555-555555555555',
   pg_temp.v('lincoln'), '{}', '2026-10-03T10:00:00Z'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'photos.uploaded', '33333333-3333-4333-8333-333333333333',
   pg_temp.v('lincoln'), '{}', '2026-11-03T10:00:00Z'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job.selling', '11111111-1111-4111-8111-111111111111',
   pg_temp.v('lincoln'), '{"from": "draft"}', '2026-11-04T10:00:00Z'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'qr_cards.printed', '55555555-5555-4555-8555-555555555555',
   pg_temp.v('hill'), '{}', '2026-10-09T10:00:00Z');

set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select results_eq($$ select step, actor_id from public.job_progress_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    pg_temp.v('lincoln')) order by step $$,
  $$ values ('addRoster'::text, '11111111-1111-4111-8111-111111111111'::uuid),
            ('createJob', '11111111-1111-4111-8111-111111111111'),
            ('printQrCards', '55555555-5555-4555-8555-555555555555'),
            ('startSelling', '11111111-1111-4111-8111-111111111111'),
            ('uploadPhotos', '33333333-3333-4333-8333-333333333333') $$,
  'the steps that happened (none that didn''t), with who did them, for the owner');
select is((select happened_at from public.job_progress_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    pg_temp.v('lincoln')) where step = 'printQrCards'), '2026-10-03T10:00:00Z'::timestamptz,
  'the last QR card print of this job, never another job''s');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as photographer;
select results_eq($$ select count(*), count(actor_id) from public.job_progress_facts(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln')) $$,
  $$ values (5::bigint, 0::bigint) $$, 'a photographer gets the dates but never who did it');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as owner_b;
select is((select count(*) from public.job_progress_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln'))),
  0::bigint, 'studio B''s owner gets nothing for studio A''s job');
select is((select count(*) from public.job_progress_facts('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_temp.v('lincoln'))),
  0::bigint, 'nor for studio A''s job under studio B''s own id');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select is((select count(*) from public.job_progress_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b0000000-0000-4000-8000-000000000001')), 0::bigint, 'nor does A''s owner get B''s job under A''s id');
select is((select count(*) from public.job_progress_facts(null, pg_temp.v('lincoln'))) +
  (select count(*) from public.job_progress_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null)), 0::bigint,
  'a null studio or job gets nothing');

-- ── The job's numbers ─────────────────────────────────────────────────────────────────────────────────────────────
-- A paid order for Ava (as 024_orders_refunds makes them): one photo, a payout account, a shop session.
reset role;
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln'),
   '11111111-1111-4111-8111-111111111111');
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, captured_at, created_by)
select 'f0000000-0000-4000-8000-000000000001', b.studio_id, b.job_id, b.id, b.seq, 'ready', 'IMG_1.JPG', 1,
  extensions.digest('1', 'sha256'), 1200, 1500, 'none', '2026-11-02 09:15:00', b.created_by
from public.upload_batches b where b.id = 'e1000000-0000-4000-8000-000000000001';
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, source)
values ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln'), 'child',
  'c0000000-0000-4000-8000-000000000001', 'auto');
update public.upload_batches set tagged_round = tag_round;
insert into public.qr_cards (studio_id, job_id, child_id, card_code, created_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln'), 'c0000000-0000-4000-8000-000000000001',
  'ABCDEFGHJKMNPQRSTVWX', '2026-10-03T10:00:00Z');
select public.create_payout_account('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'acct_A1', false, '{"details_submitted": true, "charges_enabled": true, "payouts_enabled": true}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'active');
insert into public.shop_sessions (id, studio_id, token_hash) values
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s1'));
insert into public.shop_session_children (session_id, studio_id, job_id, child_id) values
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln'),
   'c0000000-0000-4000-8000-000000000001');
select public.shop_cart_add(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001',
  (select i.id from public.price_list_items i join public.jobs j on j.price_list_id = i.price_list_id
   where j.id = pg_temp.v('lincoln') and i.kind = 'digital_single' limit 1),
  'f0000000-0000-4000-8000-000000000001', 1);
insert into ids select 'order', (public.shop_checkout_begin(pg_temp.h('s1')) ->> 'order_id')::uuid;
select public.shop_checkout_attach(pg_temp.h('s1'), pg_temp.v('order'), 'cs_test_' || md5(pg_temp.v('order')::text),
  now() + interval '30 minutes');
select public.complete_order(pg_temp.v('order'), jsonb_build_object('checkout_session_id', o.checkout_session_id,
    'payment_intent_id', 'pi_' || md5(o.id::text), 'charge_id', 'ch_' || md5(o.id::text),
    'transfer_id', 'tr_' || md5(o.id::text), 'livemode', false, 'currency', 'cad',
    'amount_subtotal', o.products_cents, 'amount_shipping', o.shipping_cents, 'amount_tax', 0,
    'amount_total', o.products_cents + o.shipping_cents, 'destination', o.stripe_account_id,
    'on_behalf_of', o.stripe_account_id, 'application_fee_amount', o.daybell_fee_cents, 'shipping', null))
from public.orders o where o.id = pg_temp.v('order');
-- Stripe's fee settles: the ledger has the sale (Home's rule counts sales from the ledger).
select public.settle_order_fees(pg_temp.v('order'), 'tr_' || md5(pg_temp.v('order')::text), 98, 'cad',
  'txn_' || md5(pg_temp.v('order')::text), 'trr_' || md5(pg_temp.v('order')::text));

set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select results_eq($$ select (s ->> 'currency'), (s ->> 'sales_cents')::bigint, (s ->> 'orders')::int,
    (s ->> 'subjects')::int, (s ->> 'subjects_ordered')::int, (s ->> 'first_paid_at') is not null
  from public.job_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln')) s $$,
  $$ select 'CAD'::text, o.total_cents, 1, 3, 1, true from public.orders o where o.id = pg_temp.v('order') $$,
  'the owner gets the job''s sales by Home''s rule, its orders, and 1 of 3 subjects ordered');
select is((select (s ->> 'orders')::int + (s ->> 'sales_cents')::int + (s ->> 'subjects')::int
  from public.job_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b0000000-0000-4000-8000-000000000001') s), 0,
  'studio B''s job under studio A''s id is all zeros');
select pg_temp.as_user('55555555-5555-4555-8555-555555555555') as admin_a;
select is((select (s ->> 'orders')::int from public.job_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pg_temp.v('lincoln')) s), 1, 'an admin gets them too');
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as staff;
select throws_ok($$ select public.job_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln')) $$,
  '42501', null, 'staff don''t get the job''s numbers (owners and admins only, D152)');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as photographer;
select throws_ok($$ select public.job_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln')) $$,
  '42501', null, 'nor do photographers');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as owner_b;
select throws_ok($$ select public.job_sales('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.v('lincoln')) $$,
  '42501', null, 'nor does another studio''s owner');

-- ── A person's card, photos and orders on Subjects ────────────────────────────────────────────────────────────────
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as photographer;
select results_eq($$ select card_printed_at, photographed_on from public.child_record_facts(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-000000000001') $$,
  $$ values ('2026-10-03T10:00:00Z'::timestamptz, '2026-11-02'::date) $$,
  'a person''s first card print and the camera''s day of their first photo');
select results_eq($$ select card_printed_at, photographed_on from public.child_record_facts(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-000000000003') $$,
  $$ values (null::timestamptz, null::date) $$, 'nothing yet for someone without a card or photos');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as owner_b;
select is((select count(*) from public.child_record_facts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c0000000-0000-4000-8000-000000000001')), 0::bigint, 'studio B''s owner gets nothing about studio A''s person');
select is(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_child_id =>
  'c0000000-0000-4000-8000-000000000001'), '[]'::jsonb, 'nor their orders');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as owner_a;
select is(jsonb_array_length(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_child_id =>
  'c0000000-0000-4000-8000-000000000001')), 1, 'the owner gets the orders with a line for that person');
select is(public.studio_orders('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_child_id =>
  'c0000000-0000-4000-8000-000000000002'), '[]'::jsonb, 'and none for someone who hasn''t ordered');
select is(public.studio_orders('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', p_child_id =>
  'c0000000-0000-4000-8000-000000000001'), '[]'::jsonb, 'nor for studio A''s person under studio B''s id');

-- ── Subjects' chips ───────────────────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_subjects',
  pg_temp.v('lincoln'), '[{"key": "duplicates"}, {"key": "noPhotos"}]') $$,
  'Possible duplicates and No photos can be saved as Subjects chips (D153)');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job_orders',
  pg_temp.v('lincoln'), '[{"key": "duplicates"}]') $$, '22023', null, 'but only on Subjects');

-- No names anywhere in the new events.
reset role;
select is((select count(*) from public.events where (type like 'job_template.%' or type = 'job.created')
  and (data::text ilike '%fall%' or data::text ilike '%standard%' or data::text ilike '%lincoln%')), 0::bigint,
  'template and job events carry ids and field names only');

select * from finish();
rollback;
