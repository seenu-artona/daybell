-- Phase 1, step 2: the roster. Classes, teams or groups (job_groups) and the children on a job, each with an access
-- code (D23, D24, D83 deferred, D96, D113; Seenu's answers of Oct 11, 2026; ADR 0011).
-- A forward migration: 20261011060000 is deployed. The tables are new, so nothing is backfilled.
-- Names, student IDs, grades, parent emails and access codes are personal data: never in events, logs or URLs.

-- Lets other tables reference a job together with its studio (composite studio FKs, ADR 0008).
alter table public.jobs add constraint jobs_studio_id_id_key unique (studio_id, id);

-- ── Groups: a class, team or group of a job ───────────────────────────────────────────────────────────────────────
-- Named job_groups: GROUPS is an SQL keyword, and the name says whose groups they are.
create table public.job_groups (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_groups_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete restrict,
  constraint job_groups_studio_id_id_key unique (studio_id, id),
  -- The children FK targets this, so a child's group is always in the child's own job.
  constraint job_groups_studio_job_id_key unique (studio_id, job_id, id)
);
create unique index job_groups_job_name_key on public.job_groups (studio_id, job_id, lower(name));
comment on table public.job_groups is 'A class, team or group of children in one job.';

create trigger job_groups_touch before update on public.job_groups
for each row execute function app.touch_updated_at();

alter table public.job_groups enable row level security;
create policy "members read their studio's groups" on public.job_groups
  for select to authenticated using (app.is_member(studio_id));
create policy "roster editors add groups" on public.job_groups
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin,photographer}'));
create policy "roster editors rename groups" on public.job_groups
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin,photographer}'))
  with check (app.has_role(studio_id, '{owner,admin,photographer}'));
-- No delete policy or grant: removing groups is not part of this step.
revoke all on public.job_groups from anon, authenticated;
grant select on public.job_groups to authenticated;
grant insert (studio_id, job_id, name) on public.job_groups to authenticated;
grant update (name) on public.job_groups to authenticated;

create function app.on_job_group_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'job_group.created', new.id, jsonb_build_object('job_id', new.job_id));
  elsif new.name is distinct from old.name then
    perform app.emit(new.studio_id, 'job_group.updated', new.id, jsonb_build_object('fields', jsonb_build_array('name')));
  end if;
  return new;
end;
$$;
create trigger job_groups_events after insert or update on public.job_groups
for each row execute function app.on_job_group_change();

-- ── Children: one child on a job's roster ─────────────────────────────────────────────────────────────────────────
create table public.children (
  -- The API sets the id itself: the encrypted access code is bound to it (ADR 0011).
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  group_id uuid,
  first_name text not null check (char_length(first_name) between 1 and 60 and first_name = btrim(first_name)),
  last_name text not null check (char_length(last_name) between 1 and 60 and last_name = btrim(last_name)),
  student_id text check (char_length(student_id) between 1 and 40 and student_id = btrim(student_id)),
  grade text check (char_length(grade) between 1 and 20 and grade = btrim(grade)),
  parent_email text check (
    char_length(parent_email) <= 254 and parent_email = lower(parent_email)
    and parent_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  do_not_photograph boolean not null default false,
  do_not_publish boolean not null default false,
  school_provided boolean not null default true,
  -- HMAC-SHA256 of the code (lowercase hex) for parent lookup, and an AES-256-GCM copy the studio can read and print.
  access_code_hash text not null check (access_code_hash ~ '^[0-9a-f]{64}$'),
  access_code_ciphertext text not null check (access_code_ciphertext ~ '^v1\.[A-Za-z0-9_-]{48}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint children_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete restrict,
  -- MATCH SIMPLE: a child may have no group; when it has one, the group is in the same studio and job.
  constraint children_group_fk foreign key (studio_id, job_id, group_id)
    references public.job_groups (studio_id, job_id, id) on delete restrict,
  constraint children_studio_id_id_key unique (studio_id, id),
  -- Parents type only the code, so it is unique in the whole regional database, not per studio.
  constraint children_access_code_hash_key unique (access_code_hash)
);
create index children_roster_idx on public.children (studio_id, job_id, lower(last_name), lower(first_name), id);
create index children_group_idx on public.children (studio_id, job_id, group_id);
create index children_student_id_idx on public.children (studio_id, job_id, lower(student_id))
  where student_id is not null;
comment on table public.children is
  'Children on a job''s roster. Names, student ID, grade, parent email and access code are personal data: never put them in events, logs or URLs.';
comment on column public.children.school_provided is
  'School-provided roster data (FERPA): never used for marketing.';
comment on column public.children.access_code_hash is
  'HMAC-SHA256 of the access code. Never readable by browsers.';

create trigger children_touch before update on public.children
for each row execute function app.touch_updated_at();

alter table public.children enable row level security;
create policy "members read their studio's children" on public.children
  for select to authenticated using (app.is_member(studio_id));
-- No insert policy or grant: every child gets an access code, and code-bearing writes are server-only (ADR 0011). The
-- API adds children through add_child and import_roster below, which only the service role can run.
create policy "roster editors edit children" on public.children
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin,photographer}'))
  with check (app.has_role(studio_id, '{owner,admin,photographer}'));
create policy "roster editors remove children" on public.children
  for delete to authenticated using (app.has_role(studio_id, '{owner,admin,photographer}'));

-- Column grants: the hash is never readable; browsers never write codes (no insert at all), and codes, job, studio and
-- school_provided can never be changed directly.
revoke all on public.children from anon, authenticated;
grant select (id, studio_id, job_id, group_id, first_name, last_name, student_id, grade, parent_email,
  do_not_photograph, do_not_publish, school_provided, access_code_ciphertext, created_at, updated_at)
  on public.children to authenticated;
grant update (group_id, first_name, last_name, student_id, grade, parent_email, do_not_photograph, do_not_publish)
  on public.children to authenticated;
grant delete on public.children to authenticated;

-- Children can be removed only while their job is a draft (Seenu, Oct 11 2026). Deleting a whole studio still
-- cascades: by then the studio row is gone.
create function app.guard_child_delete() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.studios s where s.id = old.studio_id)
     and exists (select 1 from public.jobs j where j.id = old.job_id and j.status <> 'draft') then
    raise exception 'Children can be removed only while the job is a draft' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
create trigger children_guard_draft before delete on public.children
for each row execute function app.guard_child_delete();

-- Events: IDs and changed field names only. Never names, emails, student IDs, grades or codes.
create function app.on_child_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'child.created', new.id,
      jsonb_build_object('job_id', new.job_id, 'group_id', new.group_id));
  elsif tg_op = 'UPDATE' then
    v_fields := array_remove(array[
      case when new.group_id is distinct from old.group_id then 'group_id' end,
      case when new.first_name is distinct from old.first_name then 'first_name' end,
      case when new.last_name is distinct from old.last_name then 'last_name' end,
      case when new.student_id is distinct from old.student_id then 'student_id' end,
      case when new.grade is distinct from old.grade then 'grade' end,
      case when new.parent_email is distinct from old.parent_email then 'parent_email' end,
      case when new.do_not_photograph is distinct from old.do_not_photograph then 'do_not_photograph' end,
      case when new.do_not_publish is distinct from old.do_not_publish then 'do_not_publish' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'child.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  elsif exists (select 1 from public.studios s where s.id = old.studio_id) then
    perform app.emit(old.studio_id, 'child.deleted', old.id, jsonb_build_object('job_id', old.job_id));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger children_events after insert or update or delete on public.children
for each row execute function app.on_child_change();

-- ── Server-only writes of access codes (ADR 0011) ─────────────────────────────────────────────────────────────────
-- Browsers never write codes: adding a child and importing a roster run only as the service role, from API route
-- handlers that have already checked the signed-in person's studio and role. These functions check the role again for
-- the person the API acts for (p_actor), so a bug in the API can't let a staff member or another studio's member write.
-- app.act_for makes auth.uid() return p_actor until the calling function restores it, so app.has_role checks that
-- person and every event the triggers write is attributed to them, not to the service role.
create type app.child_row as (
  id uuid, group_id uuid, first_name text, last_name text, student_id text, grade text, parent_email text,
  do_not_photograph boolean, do_not_publish boolean, access_code_hash text, access_code_ciphertext text);

create function app.act_for(p_actor uuid, p_studio_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('request.jwt.claim.sub', true);
begin
  if p_actor is null or p_studio_id is null then
    raise exception 'Owners, admins and photographers only' using errcode = '42501';
  end if;
  -- Transaction-local, and not undone when this function returns: the caller restores it with app.end_act_for.
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if not app.has_role(p_studio_id, '{owner,admin,photographer}') then
    raise exception 'Owners, admins and photographers only' using errcode = '42501';
  end if;
  return coalesce(v_previous, '');
end;
$$;

create function app.end_act_for(p_previous text) returns void
language sql security definer
set search_path = ''
as $$
  select set_config('request.jwt.claim.sub', coalesce(p_previous, ''), true);
$$;

-- Add one child by hand. The API sets the id (the encrypted code is bound to it) and generates the code.
create function public.add_child(p_actor uuid, p_job_id uuid, p_child jsonb) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_id uuid;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  if jsonb_typeof(p_child) is distinct from 'object' then
    raise exception 'The child must be an object' using errcode = '22023';
  end if;
  insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, student_id, grade, parent_email,
    do_not_photograph, do_not_publish, access_code_hash, access_code_ciphertext)
  select r.id, v_studio, p_job_id, r.group_id, r.first_name, r.last_name, r.student_id, r.grade, r.parent_email,
    coalesce(r.do_not_photograph, false), coalesce(r.do_not_publish, false), r.access_code_hash, r.access_code_ciphertext
  from jsonb_populate_record(null::app.child_row, p_child) r
  on conflict (access_code_hash) do nothing
  returning id into v_id;
  if v_id is null then
    -- The API generates a new code and tries again.
    raise exception 'access_code_collision' using errcode = 'P0001';
  end if;
  perform app.end_act_for(v_previous);
  return v_id;
end;
$$;

-- ── Import: one transaction for a whole confirmed file ────────────────────────────────────────────────────────────
-- The API plans the import (adds and updates matched by student ID), generates codes and sends rows here, as the
-- service role (above). SECURITY DEFINER with explicit checks (like create_studio), so the whole file lands or nothing
-- does. Error messages carry no values, so no personal data or hash reaches the Postgres log.
-- Re-import fills and changes, never erases (Seenu, Oct 11 2026): names are replaced; group, grade and parent email
-- change only when the file has a value; opt-outs can be turned on by a file but never off; student ID is the key.
create type app.roster_row as (
  action text, id uuid, first_name text, last_name text, group_name text, student_id text, grade text,
  parent_email text, do_not_photograph boolean, do_not_publish boolean, access_code_hash text,
  access_code_ciphertext text);

create function public.import_roster(p_actor uuid, p_job_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_rows int;
  v_adds int;
  v_updates int;
  v_added int;
  v_updated int;
  v_groups int;
  v_previous text;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Rows must be a list' using errcode = '22023';
  end if;
  v_rows := jsonb_array_length(p_rows);
  if v_rows not between 1 and 5000 then
    raise exception 'Send 1 to 5000 rows' using errcode = '22023';
  end if;
  -- Imports into the same job run one at a time.
  perform pg_advisory_xact_lock(hashtextextended('roster:' || p_job_id::text, 0));

  select count(*) filter (where r.action = 'add' and r.id is not null),
         count(*) filter (where r.action = 'update' and r.id is not null)
    into v_adds, v_updates
    from jsonb_populate_recordset(null::app.roster_row, p_rows) r;
  if v_adds + v_updates <> v_rows then
    raise exception 'Each row needs an action (add or update) and an id' using errcode = '22023';
  end if;

  -- Groups by name, ignoring case; new ones are added.
  with ins as (
    insert into public.job_groups (studio_id, job_id, name)
    select distinct on (lower(r.group_name)) v_studio, p_job_id, r.group_name
    from jsonb_populate_recordset(null::app.roster_row, p_rows) r
    where r.group_name is not null
    order by lower(r.group_name), r.group_name
    on conflict (studio_id, job_id, lower(name)) do nothing
    returning 1)
  select count(*) into v_groups from ins;

  insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, student_id, grade, parent_email,
    do_not_photograph, do_not_publish, access_code_hash, access_code_ciphertext)
  select r.id, v_studio, p_job_id, g.id, r.first_name, r.last_name, r.student_id, r.grade, r.parent_email,
    coalesce(r.do_not_photograph, false), coalesce(r.do_not_publish, false), r.access_code_hash, r.access_code_ciphertext
  from jsonb_populate_recordset(null::app.roster_row, p_rows) r
  left join public.job_groups g
    on g.studio_id = v_studio and g.job_id = p_job_id and lower(g.name) = lower(r.group_name)
  where r.action = 'add'
  on conflict (access_code_hash) do nothing;
  get diagnostics v_added = row_count;
  if v_added <> v_adds then
    -- The API generates new codes and tries again. Everything here, groups included, rolls back.
    raise exception 'access_code_collision' using errcode = 'P0001';
  end if;

  update public.children c set
    first_name = r.first_name,
    last_name = r.last_name,
    group_id = coalesce(g.id, c.group_id),
    grade = coalesce(r.grade, c.grade),
    parent_email = coalesce(r.parent_email, c.parent_email),
    do_not_photograph = c.do_not_photograph or coalesce(r.do_not_photograph, false),
    do_not_publish = c.do_not_publish or coalesce(r.do_not_publish, false)
  from jsonb_populate_recordset(null::app.roster_row, p_rows) r
  left join public.job_groups g
    on g.studio_id = v_studio and g.job_id = p_job_id and lower(g.name) = lower(r.group_name)
  where r.action = 'update' and c.id = r.id and c.studio_id = v_studio and c.job_id = p_job_id;
  get diagnostics v_updated = row_count;
  if v_updated <> v_updates then
    -- Someone removed a matched child meanwhile; the API plans again.
    raise exception 'roster_changed' using errcode = 'P0001';
  end if;

  perform app.emit(v_studio, 'roster.imported', p_job_id,
    jsonb_build_object('added', v_added, 'updated', v_updated, 'groups_added', v_groups));
  perform app.end_act_for(v_previous);
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'groups_added', v_groups);
end;
$$;

-- ── Roster list ───────────────────────────────────────────────────────────────────────────────────────────────────
-- An RPC so child names never appear in a URL (keyset filters on names would put them in PostgREST URLs), and because
-- duplicate flags need the whole job. SECURITY INVOKER: row-level security and column grants apply; never reads the
-- hash. The duplicate rule matches packages/core roster.ts: same student ID (case and whitespace ignored); or, with no
-- student ID, same first + last name (case and whitespace ignored) in the same group ("no group" counts as one).
-- p_no_group lists only children without a group.
create function public.list_children(
  p_job_id uuid, p_group_id uuid default null, p_after uuid default null, p_limit int default 200,
  p_no_group boolean default false
) returns jsonb
language sql stable
set search_path = ''
as $$
  with base as (
    select c.id, c.job_id, c.group_id, g.name as group_name, c.first_name, c.last_name, c.student_id, c.grade,
      c.parent_email, c.do_not_photograph, c.do_not_publish, c.school_provided, c.access_code_ciphertext,
      c.created_at, c.updated_at,
      count(*) over (partition by
        case when c.student_id is not null
          then 'id:' || lower(regexp_replace(student_id, '\s', '', 'g'))
          else 'name:' || coalesce(c.group_id::text, '-') || ':' || lower(regexp_replace(first_name, '\s', '', 'g'))
            || '|' || lower(regexp_replace(last_name, '\s', '', 'g'))
        end) > 1 as duplicate
    from public.children c
    left join public.job_groups g on g.studio_id = c.studio_id and g.id = c.group_id
    where c.job_id = p_job_id
  ),
  filtered as (
    select * from base b
    where (p_group_id is null or b.group_id = p_group_id) and (not p_no_group or b.group_id is null)
  ),
  anchor as (
    select lower(c.last_name) as ln, lower(c.first_name) as fn, c.id from public.children c where c.id = p_after
  ),
  page as (
    select f.* from filtered f
    where p_after is null
       or (lower(f.last_name), lower(f.first_name), f.id) > (select a.ln, a.fn, a.id from anchor a)
    order by lower(f.last_name), lower(f.first_name), f.id
    limit greatest(least(coalesce(p_limit, 200), 1001), 1)
  )
  select jsonb_build_object(
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'job_id', p.job_id, 'group_id', p.group_id, 'group_name', p.group_name,
        'first_name', p.first_name, 'last_name', p.last_name, 'student_id', p.student_id, 'grade', p.grade,
        'parent_email', p.parent_email, 'do_not_photograph', p.do_not_photograph, 'do_not_publish', p.do_not_publish,
        'school_provided', p.school_provided, 'access_code_ciphertext', p.access_code_ciphertext,
        'duplicate', p.duplicate, 'created_at', p.created_at, 'updated_at', p.updated_at)
        order by lower(p.last_name), lower(p.first_name), p.id)
      from page p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'duplicates', (select count(*) from filtered f where f.duplicate));
$$;

-- A job's groups with how many children each has. SECURITY INVOKER, like list_children.
create function public.list_job_groups(p_job_id uuid)
returns table (id uuid, name text, child_count bigint)
language sql stable
set search_path = ''
as $$
  select g.id, g.name, (select count(*) from public.children c where c.studio_id = g.studio_id and c.group_id = g.id)
  from public.job_groups g
  where g.job_id = p_job_id;
$$;

revoke all on function app.on_job_group_change(), app.on_child_change(), app.guard_child_delete(),
  app.act_for(uuid, uuid), app.end_act_for(text) from public;
revoke all on type app.roster_row, app.child_row from public;
revoke all on function public.list_children(uuid, uuid, uuid, int, boolean), public.list_job_groups(uuid)
  from public, anon;
grant execute on function public.list_children(uuid, uuid, uuid, int, boolean), public.list_job_groups(uuid)
  to authenticated;
-- Code-bearing writes: the service role only (server-side route handlers), never browsers (ADR 0011).
revoke all on function public.add_child(uuid, uuid, jsonb), public.import_roster(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.add_child(uuid, uuid, jsonb), public.import_roster(uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
