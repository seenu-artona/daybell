-- The class field's label (Seenu's answer to ADR 0030 call 29): a template says what its jobs call the roster's class
-- field, "Class" unless changed, free text of 1 to 30 characters; a new job copies it (the chosen template's, else the
-- studio's default) and it never changes afterwards; owners and admins change it, others can't; another studio sees
-- none of it; job_template.updated names the field, never its value.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into app.config (key, value) values ('data_region', 'ca') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'photographer-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'ca'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'ca');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'photographer');

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
grant execute on function pg_temp.as_user(uuid) to authenticated;
create temp table ids (k text primary key, id uuid not null);
grant all on ids to authenticated;
create function pg_temp.v(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated;

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select class_label from public.job_templates t join public.studios s on s.default_job_template_id = t.id
           where s.slug = 'studio-a'), 'Class', 'a studio''s first template calls the class field "Class"');
select ok(has_column_privilege('authenticated', 'public.job_templates', 'class_label', 'update')
  and has_column_privilege('authenticated', 'public.job_templates', 'class_label', 'insert')
  and not has_column_privilege('authenticated', 'public.jobs', 'class_label', 'update')
  and not has_column_privilege('authenticated', 'public.jobs', 'class_label', 'insert'),
  'templates set the label; a job''s is the database''s');

-- ── Templates ─────────────────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select lives_ok($$
  with r as (
    insert into public.job_templates (studio_id, name, class_label)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sports', 'Team') returning id)
  insert into ids select 'sports', id from r $$,
  'the owner adds a template whose jobs say Team');
select throws_ok($$
  insert into public.job_templates (studio_id, name, class_label)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Blank', '') $$, '23514', null, 'a label is never blank');
select throws_ok($$
  insert into public.job_templates (studio_id, name, class_label)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Long', repeat('x', 31)) $$, '23514', null,
  'a label is at most 30 characters');
select throws_ok($$
  insert into public.job_templates (studio_id, name, class_label)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Spaces', ' Room ') $$, '23514', null, 'a label is trimmed');
update public.job_templates set class_label = 'Homeroom'
  where studio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Standard';
select is((select data from public.events where type = 'job_template.updated'),
  '{"fields": ["class_label"]}'::jsonb, 'a label change names the field, never the label');
select is((select class_label from public.list_job_templates('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
           where name = 'Standard'), 'Homeroom', 'Settings › Templates reads it');

-- ── Jobs copy it when they are made ───────────────────────────────────────────────────────────────────────────────
select lives_ok($$
  with r as (
    insert into public.jobs (studio_id, name, type, picture_day, internal_number, template_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'U10', 'school', '2026-11-02', 'JOB00001', pg_temp.v('sports'))
    returning id)
  insert into ids select 'u10', id from r $$, 'a job made from Sports');
select is((select class_label from public.jobs where id = pg_temp.v('u10')), 'Team',
  'it copies the template''s label, whatever the job''s type');
select lives_ok($$
  with r as (
    insert into public.jobs (studio_id, name, type, picture_day, internal_number)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Seniors', 'seniors', '2026-11-02', 'JOB00002') returning id)
  insert into ids select 'seniors', id from r $$, 'a seniors job made without a template');
select is((select class_label from public.jobs where id = pg_temp.v('seniors')), 'Homeroom',
  'gets the default template''s label, never "Group"');
update public.job_templates set class_label = 'Section' where id = pg_temp.v('sports');
select is((select class_label from public.jobs where id = pg_temp.v('u10')), 'Team',
  'a template change never reaches a job made from it');
select throws_ok($$ update public.jobs set class_label = 'Mine' where id = pg_temp.v('u10') $$, '42501', null,
  'nobody signed in changes a job''s label');

-- ── Another studio ────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
update public.job_templates set class_label = 'Stolen' where id = pg_temp.v('sports');
reset role;
select is((select class_label from public.job_templates where id = pg_temp.v('sports')), 'Section',
  'another studio''s owner changes none of studio A''s templates');
select throws_ok($$ update public.jobs set class_label = 'Mine' where id = pg_temp.v('u10') $$, '23514',
  'job_class_label_fixed', 'not even the server changes a job''s label afterwards');

select * from finish();
rollback;
