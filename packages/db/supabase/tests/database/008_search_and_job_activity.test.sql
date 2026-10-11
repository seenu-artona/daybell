-- The menu search and the job activity index (D96, D137, D138; ADR 0013): a studio finds its own jobs and clients,
-- never another studio's (whichever studio id it passes), anonymous visitors can't search, wildcards stay literal,
-- short text returns nothing without raising, lists are capped, contact people and children are never searched, and
-- another studio's job activity stays hidden.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into app.config (key, value) values ('data_region', 'us') on conflict (key) do nothing;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'staff-a@example.test');
insert into public.studios (id, name, slug, data_region) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Studio A', 'studio-a', 'us'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Studio B', 'studio-b', 'us');
insert into public.studio_members (studio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'staff');

-- Fixtures written as the database owner.
insert into public.clients (id, studio_id, name, city, contact_first_name, contact_last_name) values
  ('a0000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Elementary', 'Toronto', 'Pat', 'Quill'),
  ('a0000000-0000-4000-8000-0000000000c2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Abe Lincoln Prep', null, null, null),
  ('b0000000-0000-4000-8000-0000000000c1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Lincoln Secret School', 'Ottawa', null, null);
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number, client_id) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall at Lincoln', 'school', '2026-10-14', 'JOB00001', 'a0000000-0000-4000-8000-0000000000c1'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Spring', 'school', '2027-04-01', 'JOB00002', null),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Promo 50% off', 'mini_session', '2026-11-01', 'JOB00003', null),
  ('a0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Promo 500 club', 'mini_session', '2026-11-02', 'JOB00004', null),
  ('a0000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 5_0 team', 'sports', '2026-11-03', 'JOB00005', null),
  ('a0000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Longname' || repeat('x', 102), 'sports', '2026-11-04', 'JOB00006', null),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Lincoln Secret Fall', 'school', '2026-10-14', 'JOB00001', null);
insert into public.jobs (studio_id, name, type, picture_day, internal_number)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bulk ' || i, 'seniors', '2026-12-01', 'BULK' || i
from generate_series(1, 12) i;
insert into public.clients (studio_id, name)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bulk client ' || i from generate_series(1, 12) i;
-- A child named like a job: children are never searched.
insert into public.job_groups (id, studio_id, job_id, name) values
  ('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '4C');
insert into public.children (studio_id, job_id, group_id, first_name, last_name, access_code_hash, access_code_ciphertext) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a1',
   'Zebulon', 'Xylophone', repeat('a', 64), 'v1.' || repeat('A', 48));

create function pg_temp.as_user(p_user uuid) returns boolean language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
    is not null $$;
-- Names found, in order, for one list of a search.
create function pg_temp.names(p_studio uuid, p_query text, p_list text, p_limit int default 10) returns text[]
language sql as $$
  select coalesce(array_agg(x ->> 'name' order by ord), '{}')
  from jsonb_array_elements(public.search_studio(p_studio, p_query, p_limit) -> p_list) with ordinality as e(x, ord) $$;
grant execute on function pg_temp.names(uuid, text, text, int) to authenticated, anon;

-- The job's creation is logged by the jobs trigger: the one event the leak tests below look for.
select is((select count(*) from public.events
  where subject_id = 'a0000000-0000-4000-8000-000000000001' and type = 'job.created'), 1::bigint,
  'job A1 has exactly one job.created event (fixture for the activity leak test)');

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_index('public', 'events', 'events_studio_subject_idx', array['studio_id', 'subject_id', 'id'],
  'events have a (studio_id, subject_id, id) index for job activity');
select is((select prosecdef from pg_proc where oid = 'public.search_studio(uuid, text, int)'::regprocedure), false,
  'search_studio is SECURITY INVOKER, so row-level security applies');
select ok(not has_function_privilege('anon', 'public.search_studio(uuid, text, int)', 'execute'),
  'anonymous visitors cannot run the search');
select ok(has_function_privilege('authenticated', 'public.search_studio(uuid, text, int)', 'execute'),
  'signed-in people can');

-- ── As the owner of studio A ──────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;

select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'lincoln', 'jobs'),
  array['Lincoln Spring', 'Fall at Lincoln'],
  'owner A finds their jobs by name, ignoring case, starts-with first');
select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'lincoln', 'clients'),
  array['Lincoln Elementary', 'Abe Lincoln Prep'],
  'and their clients by name, starts-with first');
select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job00002', 'jobs'), array['Lincoln Spring'],
  'jobs are found by internal number');
select is(
  public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall at') -> 'jobs' -> 0,
  jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000001', 'name', 'Fall at Lincoln',
    'internal_number', 'JOB00001', 'status', 'draft', 'picture_day', '2026-10-14'),
  'a job result has id, name, number, status and picture day only');
select is(
  public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Elem') -> 'clients' -> 0,
  jsonb_build_object('id', 'a0000000-0000-4000-8000-0000000000c1', 'name', 'Lincoln Elementary', 'city', 'Toronto'),
  'a client result has id, name and city only (no contact person)');
select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Quill', 'clients'), '{}'::text[],
  'contact people never match');
select is(public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Zebulon'),
  '{"jobs": [], "clients": []}'::jsonb, 'children are never searched');

-- Wildcards are literal.
select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50%', 'jobs'), array['Promo 50% off'],
  '"%" is a literal percent sign');
select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '5_0', 'jobs'), array['Grade 5_0 team'],
  '"_" is a literal underscore');
select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '\%', 'jobs'), '{}'::text[],
  'a backslash is literal too');

-- Short text returns nothing and never raises.
select is(public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'L'),
  '{"jobs": [], "clients": []}'::jsonb, 'one character returns nothing');
select is(public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '  L  '),
  '{"jobs": [], "clients": []}'::jsonb, 'one character with spaces returns nothing');
select lives_ok($$ select public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null) $$,
  'no text at all does not raise');
select is(public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '_'),
  '{"jobs": [], "clients": []}'::jsonb, 'a lone wildcard returns nothing');

-- Text longer than 100 characters returns nothing and never raises (a cap on the work one call can ask for).
select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Longname' || repeat('x', 92), 'jobs'),
  array['Longname' || repeat('x', 102)], '100 characters still search');
select is(public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Longname' || repeat('x', 93)),
  '{"jobs": [], "clients": []}'::jsonb, '101 characters return nothing, even when a job would match');

-- At most 10 of each, whatever limit is asked for.
select is(cardinality(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bulk', 'jobs')), 10,
  'at most 10 jobs');
select is(cardinality(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bulk', 'clients', 50)), 10,
  'at most 10 clients, even when more are asked for');
select is(cardinality(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bulk', 'jobs', 3)), 3,
  'a smaller limit is respected');

select is((select count(*) from public.events where subject_id = 'a0000000-0000-4000-8000-000000000001'
  and type = 'job.created'), 1::bigint, 'owner A reads their own job''s activity');

-- Staff search too (any member).
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
select is(pg_temp.names('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'lincoln', 'jobs'),
  array['Lincoln Spring', 'Fall at Lincoln'], 'staff find the studio''s jobs too');

-- ── Leak tests: the owner of studio B ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select is(pg_temp.names('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'lincoln', 'jobs'), array['Lincoln Secret Fall'],
  'owner B searching their own studio finds only their own jobs');
select is(pg_temp.names('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'lincoln', 'clients'), array['Lincoln Secret School'],
  'and only their own clients');
select is(public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'lincoln'),
  '{"jobs": [], "clients": []}'::jsonb, 'owner B passing studio A''s id sees none of A''s jobs or clients');
select is((select count(*) from public.events where subject_id = 'a0000000-0000-4000-8000-000000000001'
  and type = 'job.created'), 0::bigint, 'owner B reads none of A''s job activity');

-- ── Anonymous ─────────────────────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok($$ select public.search_studio('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'lincoln') $$, '42501',
  null, 'anonymous visitors are refused');

select * from finish();
rollback;
