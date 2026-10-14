-- People (D150, D148, D96, D113; Seenu's answers of Oct 14, 2026; ADR 0028): client contacts have row-level security
-- like clients (the team reads, owners and admins write, nobody deletes directly), one main contact per client, kept in
-- step with the client's contact fields both ways; contact events hold field names only; the clients list's details,
-- the contacts list and every child across jobs are the caller's studio's only; "ordered" comes from one shared rule
-- (list_children and list_studio_children agree), and photographers get no order data and can't filter by it; the
-- People lists' saved chips take only their own keys and the studio's own records.
begin;
create extension if not exists pgtap with schema extensions;
select plan(89);

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
-- First names of a list_studio_children answer, in order.
create function pg_temp.names(p jsonb) returns text[] language sql as $$
  select coalesce(array_agg(s ->> 'first_name' order by n), '{}') from jsonb_array_elements(p -> 'subjects')
    with ordinality e (s, n) $$;
grant execute on function pg_temp.names(jsonb) to authenticated;
-- has_paid_order by first name, for a list_studio_children or list_children answer.
create function pg_temp.paid(p jsonb, p_key text) returns text language sql as $$
  select string_agg((s ->> 'first_name') || '=' || coalesce(s ->> 'has_paid_order', 'null'), ',' order by n)
  from jsonb_array_elements(p -> p_key) with ordinality e (s, n) $$;
grant execute on function pg_temp.paid(jsonb, text) to authenticated;

-- ── Fixtures: clients, jobs, children (as the database owner) ─────────────────────────────────────────────────────
-- Studio A: Lincoln SD (job A1, Fall) and Hillcrest SD (job A2); studio B: its own client and job.
insert into public.clients (id, studio_id, name) values
  ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hillcrest SD'),
  ('cb000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Secret School');
insert into public.clients (id, studio_id, name, contact_first_name, contact_email) values
  ('cb000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Other School', 'Bertha',
   'bertha@b.example');
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number, client_id) values
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hillcrest Fall', 'school',
   '2026-10-02', 'JOB00002', 'c1000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B Fall', 'school', '2026-10-13',
   'JOB00001', 'cb000000-0000-4000-8000-000000000001');

-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'client_contacts', 'client_contacts exists');
select ok((select relrowsecurity from pg_class where oid = 'public.client_contacts'::regclass),
  'row-level security is on');
select ok(not has_table_privilege('authenticated', 'public.client_contacts', 'delete')
  and not has_table_privilege('anon', 'public.client_contacts', 'select')
  and not has_column_privilege('authenticated', 'public.client_contacts', 'studio_id', 'update')
  and not has_column_privilege('authenticated', 'public.client_contacts', 'client_id', 'update'),
  'nobody deletes contacts directly, a contact never moves studio or client, logged-out visitors read nothing');
select ok((select indexdef from pg_indexes where indexname = 'client_contacts_one_main_key') ~ 'WHERE is_main',
  'a unique partial index allows one main contact per client');
select ok(has_function_privilege('authenticated', 'public.list_studio_children(uuid, text, text, uuid, uuid, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.list_studio_children(uuid, text, text, uuid, uuid, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.list_client_contacts(uuid, text, boolean, uuid, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.client_list_details(uuid, uuid[])', 'execute'),
  'the People lists are for signed-in people only');
select is((select prosecdef from pg_proc where oid = 'public.list_studio_children(uuid, text, text, uuid, uuid, uuid, integer)'::regprocedure),
  false, 'list_studio_children is SECURITY INVOKER: row-level security decides what it reads');
select is((select prosecdef from pg_proc where oid = 'public.list_client_contacts(uuid, text, boolean, uuid, uuid, integer)'::regprocedure),
  false, 'list_client_contacts is SECURITY INVOKER');
select is((select prosecdef from pg_proc where oid = 'public.client_list_details(uuid, uuid[])'::regprocedure),
  false, 'client_list_details is SECURITY INVOKER');
select is((select prosecdef from pg_proc where oid = 'app.ordered_children(uuid, uuid[])'::regprocedure),
  false, 'app.ordered_children is SECURITY INVOKER: only people who read orders get an answer');
select is((select prosecdef from pg_proc where oid = 'app.client_contact_take_main()'::regprocedure),
  false, 'app.client_contact_take_main is SECURITY INVOKER: the step-down is the caller''s own update');
select ok(not has_function_privilege('authenticated', 'app.mirror_main_contact(uuid, uuid)', 'execute'),
  'signed-in people can''t call the client mirror themselves');
select is((select count(*) from public.client_contacts where client_id = 'cb000000-0000-4000-8000-000000000002'
  and is_main and first_name = 'Bertha'), 1::bigint, 'a client added with a contact person gets them as its main contact');

-- ── Contacts as studio A's owner ──────────────────────────────────────────────────────────────────────────────────
create temp table ids (k text primary key, id uuid not null);
grant all on ids to authenticated;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;

select lives_ok($$
  with r as (
    insert into public.clients (studio_id, name, contact_first_name, contact_last_name, contact_phone, contact_email)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln SD', 'Pat', 'Rivera', '+1 416 555 0100',
            'pat.rivera@lincoln.example')
    returning id)
  insert into ids select 'lincoln', id from r $$,
  'the owner adds a client with a contact person');
insert into ids select 'pat', id from public.client_contacts where client_id = (select id from ids where k = 'lincoln');
select results_eq($$ select first_name, last_name, phone, email, is_main from public.client_contacts
  where client_id = (select id from ids where k = 'lincoln') $$,
  $$ values ('Pat'::text, 'Rivera'::text, '+1 416 555 0100'::text, 'pat.rivera@lincoln.example'::text, true) $$,
  'who becomes the client''s main contact (answer 3)');
select lives_ok($$
  with r as (
    insert into public.client_contacts (studio_id, client_id, first_name, last_name, role, email)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'lincoln'), 'Mark', 'Ellis',
            'Principal', 'principal@lincoln.example')
    returning id)
  insert into ids select 'mark', id from r $$,
  'the owner adds a second contact, not main');
select is((select contact_first_name from public.clients where id = (select id from ids where k = 'lincoln')), 'Pat',
  'an ordinary contact leaves the client''s contact fields alone');
select throws_ok($$
  insert into public.client_contacts (studio_id, client_id, role)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'lincoln'), 'Nobody') $$,
  '23514', null, 'a contact must have a name, an email or a phone');
select throws_ok($$
  insert into public.client_contacts (studio_id, client_id, first_name, role)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'lincoln'), 'Ann', repeat('r', 61)) $$,
  '23514', null, 'a role is at most 60 characters');

-- Making Mark main: Pat steps down and the client's contact fields become Mark's.
update public.client_contacts set is_main = true where id = (select id from ids where k = 'mark');
select results_eq($$ select first_name, is_main from public.client_contacts
  where client_id = (select id from ids where k = 'lincoln') order by first_name $$,
  $$ values ('Mark'::text, true), ('Pat'::text, false) $$, 'a contact made main takes over from the previous one');
select results_eq($$ select contact_first_name, contact_last_name, contact_phone, contact_email from public.clients
  where id = (select id from ids where k = 'lincoln') $$,
  $$ values ('Mark'::text, 'Ellis'::text, null::text, 'principal@lincoln.example'::text) $$,
  'and the client''s contact fields follow the main contact');
update public.client_contacts set role = 'Head', phone = '555 0101' where id = (select id from ids where k = 'mark');
select is((select contact_phone from public.clients where id = (select id from ids where k = 'lincoln')), '555 0101',
  'a change to the main contact reaches the client');
-- The other way: the client form changes its contact fields.
update public.clients set contact_email = 'office@lincoln.example' where id = (select id from ids where k = 'lincoln');
select results_eq($$ select email, role from public.client_contacts where id = (select id from ids where k = 'mark') $$,
  $$ values ('office@lincoln.example'::text, 'Head'::text) $$,
  'a change to the client''s contact fields reaches its main contact (its role stays)');
select is((select count(*) from public.client_contacts where client_id = (select id from ids where k = 'lincoln')
  and is_main), 1::bigint, 'there is still one main contact');

-- The index itself, without the trigger that steps the old main down.
reset role;
alter table public.client_contacts disable trigger client_contacts_take_main;
select throws_ok($$ update public.client_contacts set is_main = true where id = (select id from ids where k = 'pat') $$,
  '23505', null, 'two main contacts for one client are refused by the unique index');
alter table public.client_contacts enable trigger client_contacts_take_main;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;

-- Clearing the client's contact person removes its main contact; the other contacts stay.
update public.clients set contact_first_name = null, contact_last_name = null, contact_phone = null,
  contact_email = null where id = (select id from ids where k = 'lincoln');
select results_eq($$ select first_name, is_main from public.client_contacts
  where client_id = (select id from ids where k = 'lincoln') $$,
  $$ values ('Pat'::text, false) $$, 'clearing the client''s contact person removes its main contact only');
-- Pat made main again fills the client in.
update public.client_contacts set is_main = true where id = (select id from ids where k = 'pat');
select is((select contact_first_name from public.clients where id = (select id from ids where k = 'lincoln')), 'Pat',
  'a new main contact fills in the client''s contact fields');
insert into public.client_contacts (studio_id, client_id, first_name, last_name, role, email)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'lincoln'), 'Ann', 'Moreau', 'Office',
        'office@lincoln.example');

-- Cross-studio writes and reads.
select throws_ok($$
  insert into public.client_contacts (studio_id, client_id, first_name)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cb000000-0000-4000-8000-000000000001', 'Planted') $$,
  '42501', null, 'the owner can''t add a contact to studio B');
select throws_ok($$
  insert into public.client_contacts (studio_id, client_id, first_name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cb000000-0000-4000-8000-000000000001', 'Borrowed') $$,
  '23503', null, 'nor to studio B''s client under studio A');
select is((select count(*) from public.client_contacts where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint, 'the owner reads none of studio B''s contacts');
update public.client_contacts set role = 'hacked' where studio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select throws_ok($$ delete from public.client_contacts where id = (select id from ids where k = 'mark') $$,
  '42501', null, 'contacts can''t be deleted directly');
select throws_ok($$
  update public.client_contacts set client_id = 'c1000000-0000-4000-8000-000000000001'
  where id = (select id from ids where k = 'mark') $$,
  '42501', null, 'a contact can''t move to another client');

-- The lists.
select is((public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') ->> 'total')::int, 2,
  'the contacts list has studio A''s two contacts');
select is((select array_agg(c ->> 'first_name' order by n) from jsonb_array_elements(
    public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') -> 'contacts') with ordinality e (c, n)),
  array['Pat', 'Ann'], 'by client, the main contact first');
select is((public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, true) ->> 'total')::int, 1,
  'Main contacts keeps the main one');
select is((public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'OFFICE@lincoln') ->> 'total')::int, 1,
  'a search finds a name or an email, ignoring case');
select is(public.list_client_contacts('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') -> 'contacts', '[]'::jsonb,
  'asking for studio B''s contacts gives studio A''s owner nothing');
select is(public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, false,
  'cb000000-0000-4000-8000-000000000001') -> 'contacts', '[]'::jsonb,
  'nor does naming studio B''s client');
select is(jsonb_array_length(public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, false, null,
  (select id from ids where k = 'pat'), 50) -> 'contacts'), 1, 'pages continue after a contact''s id');

reset role;
insert into public.jobs (id, studio_id, name, type, picture_day, internal_number, client_id) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Fall', 'school',
   '2026-10-13', 'JOB00001', (select id from ids where k = 'lincoln')),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lincoln Spring', 'school',
   '2027-04-01', 'JOB00003', (select id from ids where k = 'lincoln'));
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select results_eq($$
  select d ->> 'job_count', d -> 'latest_job' ->> 'name', d -> 'main_contact' ->> 'first_name'
  from jsonb_array_elements(public.client_list_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array[(select id from ids where k = 'lincoln')])) d $$,
  $$ values ('2'::text, 'Lincoln Spring'::text, 'Pat'::text) $$,
  'the clients list has the job count, the latest job by picture day and the main contact');
select is(public.client_list_details('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  array['cb000000-0000-4000-8000-000000000001'::uuid]), '[]'::jsonb,
  'and gives nothing of studio B''s');

-- ── Photographers and staff read contacts; only owners and admins write ───────────────────────────────────────────
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select is((select count(*) from public.client_contacts), 2::bigint, 'photographers read the studio''s contacts');
select throws_ok($$
  insert into public.client_contacts (studio_id, client_id, first_name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'lincoln'), 'Mine') $$,
  '42501', null, 'photographers can''t add contacts');
update public.client_contacts set role = 'changed by a photographer';
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
update public.client_contacts set role = 'changed by staff';
select is((select count(*) from public.client_contacts where role like 'changed by%' or role = 'hacked'), 0::bigint,
  'photographers and staff change nothing, and studio B''s contacts were never touched');
select pg_temp.as_user('55555555-5555-4555-8555-555555555555') as signed_in;
update public.client_contacts set role = 'Principal' where id = (select id from ids where k = 'pat');
select is((select role from public.client_contacts where id = (select id from ids where k = 'pat')), 'Principal',
  'admins edit contacts');

-- ── Studio B's owner ──────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select is((select count(*) from public.client_contacts), 1::bigint, 'studio B''s owner reads only studio B''s contact');
select is((public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') ->> 'total')::int, 0,
  'and lists none of studio A''s');

-- ── Events: field names only ──────────────────────────────────────────────────────────────────────────────────────
reset role;
select ok((select count(*) from public.events where type = 'contact.created') = 4
  and exists (select 1 from public.events where type = 'contact.updated'
              and data = '{"fields": ["is_main"]}'::jsonb and subject_id = (select id from ids where k = 'pat')),
  'contact events point at the contact by id (Bertha, Pat, Mark and Ann were added; Pat stepped down)');
select results_eq($$ select subject_id from public.events where type = 'contact.deleted' $$,
  $$ select id from ids where k = 'mark' $$,
  'clearing the client''s contact person removed its main contact, Mark, with one contact.deleted');
select is((select count(*) from public.events where type like 'contact.%'
  and data::text ~* '(pat|rivera|mark|ellis|lincoln|555|@|head|principal)'), 0::bigint,
  'contact events never hold names, emails, phones or roles');
select is((select count(*) from public.events where type = 'client.updated'
  and subject_id = (select id from ids where k = 'lincoln') and data -> 'fields' ? 'contact_first_name'), 1::bigint,
  'client.updated lists contact fields only when people changed them on the client, not for a contact''s own change');

-- ── Subjects: children, a payout account, photos and one paid order ───────────────────────────────────────────────
-- Job A1: Ava Patel (Room 1) and Noah Brown; job A2: Mia Chen; job B: Bea Brown. Ava's parent buys a download.
insert into public.job_groups (id, studio_id, job_id, name) values
  ('d0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 'Room 1');
insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, access_code_hash,
  access_code_ciphertext) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001', 'Ava', 'Patel', pg_temp.h('c1'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   null, 'Noah', 'Brown', pg_temp.h('c2'), 'v1.' || repeat('A', 48)),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002',
   null, 'Mia', 'Chen', pg_temp.h('c3'), 'v1.' || repeat('A', 48)),
  ('cb000000-0000-4000-8000-0000000000c1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001',
   null, 'Bea', 'Brown', pg_temp.h('cb1'), 'v1.' || repeat('A', 48));
insert into public.upload_batches (id, studio_id, job_id, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111');
insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256,
  width, height, qr_kind, created_by)
select 'f0000000-0000-4000-8000-000000000001', b.studio_id, b.job_id, b.id, b.seq, 'ready', 'IMG_1.JPG', 1,
  extensions.digest('1', 'sha256'), 1200, 1500, 'none', b.created_by
from public.upload_batches b where b.id = 'e1000000-0000-4000-8000-000000000001';
insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, source) values
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'child', 'c0000000-0000-4000-8000-000000000001', 'auto');
update public.upload_batches set tagged_round = tag_round;
update public.jobs set status = 'selling' where id = 'a0000000-0000-4000-8000-000000000001';
select public.create_payout_account('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'acct_A1', false, '{"details_submitted": true, "charges_enabled": true, "payouts_enabled": true}'::jsonb,
  '{"payout_interval": "weekly", "weekly_anchor": "friday", "delay_days": 2}'::jsonb, 'active');
insert into public.shop_sessions (id, studio_id, token_hash) values
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.h('s1'));
insert into public.shop_session_children (session_id, studio_id, job_id, child_id) values
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001');
-- As in 024_orders_refunds: a cart line, a checkout and Stripe's facts for a paid order (no tax in studio A).
select public.shop_cart_add(pg_temp.h('s1'), 'c0000000-0000-4000-8000-000000000001',
  (select i.id from public.price_list_items i join public.jobs j on j.price_list_id = i.price_list_id
   where j.id = 'a0000000-0000-4000-8000-000000000001' and i.kind = 'digital_single' order by i.position limit 1),
  'f0000000-0000-4000-8000-000000000001', 1);
create function pg_temp.facts(p_order uuid) returns jsonb language sql as $$
  select jsonb_build_object('checkout_session_id', o.checkout_session_id, 'payment_intent_id', 'pi_' || md5(o.id::text),
    'charge_id', 'ch_' || md5(o.id::text), 'transfer_id', 'tr_' || md5(o.id::text), 'livemode', false,
    'currency', 'cad', 'amount_subtotal', o.products_cents, 'amount_shipping', o.shipping_cents, 'amount_tax', 0,
    'amount_total', o.products_cents + o.shipping_cents, 'destination', o.stripe_account_id,
    'on_behalf_of', o.stripe_account_id, 'application_fee_amount', o.daybell_fee_cents, 'shipping', null)
  from public.orders o where o.id = p_order $$;
create function pg_temp.buy(p_session text) returns uuid language plpgsql as $$
declare
  v_order uuid := (public.shop_checkout_begin(pg_temp.h(p_session)) ->> 'order_id')::uuid;
begin
  perform public.shop_checkout_attach(pg_temp.h(p_session), v_order, 'cs_test_' || md5(v_order::text),
    now() + interval '30 minutes');
  perform public.complete_order(v_order, pg_temp.facts(v_order));
  return v_order;
end;
$$;
select pg_temp.buy('s1') is not null as bought;

-- ── Subjects as studio A's owner ──────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select is(pg_temp.names(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
  array['Noah', 'Mia', 'Ava'], 'every child across the studio''s jobs, by last name');
select results_eq($$ select (r ->> 'total')::int, (r ->> 'jobs')::int
  from (select public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') r) x $$,
  $$ values (3, 2) $$, 'with the count of children and of the jobs they are in');
select results_eq($$ select s ->> 'job_name', s ->> 'group_name'
  from jsonb_array_elements(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') -> 'subjects') s
  where s ->> 'first_name' = 'Ava' $$,
  $$ values ('Lincoln Fall'::text, 'Room 1'::text) $$, 'each with their job and class');
select is(pg_temp.paid(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'subjects'),
  'Noah=false,Mia=false,Ava=true', 'Ava has ordered; Noah and Mia haven''t (D148)');
select is(pg_temp.paid(public.list_children('a0000000-0000-4000-8000-000000000001'), 'children'),
  'Noah=false,Ava=true', 'the job''s roster says the same, from the same rule');
select is((select array_agg(o.child_id) from app.ordered_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['c0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid]) o),
  array['c0000000-0000-4000-8000-000000000001'::uuid], 'the shared rule, asked by the owner, answers Ava');
select is(pg_temp.names(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'ordered')),
  array['Ava'], 'the Ordered chip');
select is(pg_temp.names(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'notOrdered')),
  array['Noah', 'Mia'], 'the Not ordered chip');
select is((public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'notOrdered') ->> 'jobs')::int, 2,
  'Not ordered counts the jobs of its children');
select is(pg_temp.names(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null,
  'a0000000-0000-4000-8000-000000000002')), array['Mia'], 'one job''s children');
select is(pg_temp.names(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null, null,
  (select id from ids where k = 'lincoln'))), array['Noah', 'Ava'], 'one client''s jobs'' children');
select is(pg_temp.names(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'AVA pa')),
  array['Ava'], 'a search in the name, ignoring case');
select is(pg_temp.names(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null, null, null,
  'c0000000-0000-4000-8000-000000000002', 1)), array['Mia'], 'pages continue after a child''s id');
select throws_ok($$ select public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'noFamily') $$,
  '22023', 'list_studio_children_show', 'an unknown chip is refused');
select is(pg_temp.names(public.list_studio_children('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')), '{}'::text[],
  'asking for studio B''s children gives studio A''s owner nothing');
select is(pg_temp.names(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null,
  'b0000000-0000-4000-8000-000000000001')), '{}'::text[], 'nor does naming studio B''s job');

-- ── Staff see order data; photographers don't ─────────────────────────────────────────────────────────────────────
select pg_temp.as_user('44444444-4444-4444-8444-444444444444') as signed_in;
select is(pg_temp.paid(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'subjects'),
  'Noah=false,Mia=false,Ava=true', 'staff see who has ordered, as they see orders (Q4 of ADR 0024)');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select is(pg_temp.paid(public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'subjects'),
  'Noah=null,Mia=null,Ava=null', 'photographers get every child with no order data');
select throws_ok($$ select public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'notOrdered') $$,
  '42501', null, 'and can''t filter by it');
select is(pg_temp.paid(public.list_children('a0000000-0000-4000-8000-000000000001'), 'children'),
  'Noah=null,Ava=null', 'nor on the job''s roster');
select is((select count(*) from app.ordered_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['c0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid])), 0::bigint,
  'nor from the shared rule itself: photographers read no orders, so it answers nobody');

-- ── Studio B ──────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-4222-8222-222222222222') as signed_in;
select is(pg_temp.paid(public.list_studio_children('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'subjects'), 'Bea=false',
  'studio B''s owner sees only Bea, who hasn''t ordered');
select is((public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') ->> 'total')::int, 0,
  'and finds none of studio A''s children');
select throws_ok($$ select public.list_studio_children('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'ordered') $$,
  '42501', null, 'nor who in studio A ordered');

-- ── Saved chips on the People lists (answer 6) ────────────────────────────────────────────────────────────────────
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'people_subjects', null,
  '[{"key": "job", "value": "a0000000-0000-4000-8000-000000000002"},
    {"key": "client", "value": "c1000000-0000-4000-8000-000000000001"}]') $$,
  'Subjects saves a job and a client chip');
select lives_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'people_contacts', null,
  '[{"key": "client", "value": "c1000000-0000-4000-8000-000000000001"}]') $$, 'Contacts saves a client chip');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'people_clients', null,
  '[{"key": "client", "value": "c1000000-0000-4000-8000-000000000001"}]') $$, '22023', 'list_filters_invalid',
  'Clients takes no chips');
select throws_ok($$ select public.save_list_filters('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'people_subjects', null,
  '[{"key": "job", "value": "b0000000-0000-4000-8000-000000000001"}]') $$, '22023', 'list_filters_record',
  'another studio''s job is refused');

-- ── The lists' inputs are bounded ─────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ select public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 120)) $$,
  'a contacts search of 120 characters is read');
select throws_ok($$ select public.list_client_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 121)) $$,
  '22023', 'list_client_contacts_q', 'a longer one is refused');
select lives_ok($$ select public.client_list_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array(select gen_random_uuid() from generate_series(1, 101))) $$,
  'the clients list''s details take a page of 101 clients');
select throws_ok($$ select public.client_list_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array(select gen_random_uuid() from generate_series(1, 102))) $$,
  '22023', 'client_list_details_ids', 'and refuse more');

-- ── Making a contact main needs the right to write contacts ───────────────────────────────────────────────────────
select pg_temp.as_user('33333333-3333-4333-8333-333333333333') as signed_in;
select throws_ok($$
  insert into public.client_contacts (studio_id, client_id, first_name, is_main)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'lincoln'), 'Usurper', true) $$,
  '42501', null, 'a photographer can''t add a main contact');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select throws_ok($$
  insert into public.client_contacts (studio_id, client_id, first_name, is_main)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cb000000-0000-4000-8000-000000000002', 'Usurper', true) $$,
  '42501', null, 'studio A''s owner can''t add a main contact to studio B''s client');
reset role;
select results_eq($$ select c.contact_first_name, k.first_name, k.is_main from public.clients c
  join public.client_contacts k on k.studio_id = c.studio_id and k.client_id = c.id
  where c.id = (select id from ids where k = 'lincoln') and k.is_main $$,
  $$ values ('Pat'::text, 'Pat'::text, true) $$, 'Lincoln''s main contact is still Pat, on the client too');
select results_eq($$ select c.contact_first_name, k.first_name, k.is_main from public.clients c
  join public.client_contacts k on k.studio_id = c.studio_id and k.client_id = c.id
  where c.id = 'cb000000-0000-4000-8000-000000000002' $$,
  $$ values ('Bertha'::text, 'Bertha'::text, true) $$, 'and studio B''s client still has only Bertha, as main');

-- ── A contact added as main takes over ────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111') as signed_in;
select lives_ok($$
  insert into public.client_contacts (studio_id, client_id, first_name, last_name, role, email, is_main)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from ids where k = 'lincoln'), 'Yan', 'Lee', 'Secretary',
          'yan.lee@lincoln.example', true) $$,
  'the owner adds a contact as main');
select results_eq($$ select first_name, is_main from public.client_contacts
  where client_id = (select id from ids where k = 'lincoln') order by first_name $$,
  $$ values ('Ann'::text, false), ('Pat'::text, false), ('Yan'::text, true) $$,
  'they take over from Pat, who stays as an ordinary contact');
select results_eq($$ select contact_first_name, contact_last_name, contact_phone, contact_email from public.clients
  where id = (select id from ids where k = 'lincoln') $$,
  $$ values ('Yan'::text, 'Lee'::text, null::text, 'yan.lee@lincoln.example'::text) $$,
  'and the client''s contact fields become theirs');

select * from finish();
rollback;
