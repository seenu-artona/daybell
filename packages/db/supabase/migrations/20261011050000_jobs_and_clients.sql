-- Phase 1, step 1b: organizations become clients; jobs get categories, internal numbers and subjects expected
-- (D96, D113, D131; Seenu's decisions of Oct 11, 2026; ADR 0009).
-- A forward migration: 20261011040000 is already deployed, and staging rows must survive. Everything is renamed or
-- altered in place, never dropped and recreated. Backfills run with the tables' own triggers off: they are not
-- anyone's change, so they write no events and leave updated_at alone.

-- ── Clients (formerly organizations) ──────────────────────────────────────────────────────────────────────────────
alter table public.organizations rename to clients;
alter table public.clients rename constraint organizations_pkey to clients_pkey;
alter table public.clients rename constraint organizations_studio_id_fkey to clients_studio_id_fkey;
alter table public.clients rename constraint organizations_studio_id_id_key to clients_studio_id_id_key;
alter table public.clients rename constraint organizations_name_check to clients_name_check;
alter table public.clients rename constraint organizations_notes_check to clients_notes_check;
alter table public.clients rename constraint organizations_address_line1_check to clients_address_line1_check;
alter table public.clients rename constraint organizations_address_line2_check to clients_address_line2_check;
alter table public.clients rename constraint organizations_city_check to clients_city_check;
alter table public.clients rename constraint organizations_region_code_check to clients_region_code_check;
alter table public.clients rename constraint organizations_postal_code_check to clients_postal_code_check;
alter table public.clients rename constraint organizations_country_check to clients_country_check;
alter table public.clients rename constraint organizations_no_quebec to clients_no_quebec;
alter index public.organizations_studio_name_idx rename to clients_studio_name_idx;
alter trigger organizations_touch on public.clients rename to clients_touch;
alter policy "members read their studio's organizations" on public.clients rename to "members read their studio's clients";
alter policy "owners and admins add organizations" on public.clients rename to "owners and admins add clients";
alter policy "owners and admins edit organizations" on public.clients rename to "owners and admins edit clients";

-- Job type carries what kind of shoot it is; clients have no kind (as in GotPhoto).
alter table public.clients drop column kind;
drop type public.organization_kind;

-- The contact person. Personal data: never in events, logs or URLs.
alter table public.clients
  add column contact_first_name text check (char_length(contact_first_name) between 1 and 60),
  add column contact_last_name text check (char_length(contact_last_name) between 1 and 60),
  add column contact_phone text check (char_length(contact_phone) between 1 and 30),
  add column contact_email text check (
    char_length(contact_email) <= 254 and contact_email = lower(contact_email)
    and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );
grant insert (contact_first_name, contact_last_name, contact_phone, contact_email) on public.clients to authenticated;
grant update (contact_first_name, contact_last_name, contact_phone, contact_email) on public.clients to authenticated;
comment on table public.clients is
  'Schools, daycares, teams and families a studio photographs for. Duplicate names allowed. Contact person is personal data.';
comment on column public.clients.notes is 'Only visible to the studio.';

-- Events: client.created and client.updated {fields}. Earlier organization.* events stay as written (events are
-- immutable); the activity log shows them as client events.
drop trigger organizations_events on public.clients;
drop function app.on_organization_change();
create function app.on_client_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'client.created', new.id, '{}'::jsonb);
  else
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.notes is distinct from old.notes then 'notes' end,
      case when new.address_line1 is distinct from old.address_line1 then 'address_line1' end,
      case when new.address_line2 is distinct from old.address_line2 then 'address_line2' end,
      case when new.city is distinct from old.city then 'city' end,
      case when new.region_code is distinct from old.region_code then 'region_code' end,
      case when new.postal_code is distinct from old.postal_code then 'postal_code' end,
      case when new.country is distinct from old.country then 'country' end,
      case when new.contact_first_name is distinct from old.contact_first_name then 'contact_first_name' end,
      case when new.contact_last_name is distinct from old.contact_last_name then 'contact_last_name' end,
      case when new.contact_phone is distinct from old.contact_phone then 'contact_phone' end,
      case when new.contact_email is distinct from old.contact_email then 'contact_email' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'client.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;
create trigger clients_events after insert or update on public.clients
for each row execute function app.on_client_change();

-- ── Job categories ────────────────────────────────────────────────────────────────────────────────────────────────
-- Studio-owned list (Fall, Spring, Graduation…). Seeded for every studio; a Settings screen to edit it comes later.
create table public.job_categories (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_categories_studio_id_id_key unique (studio_id, id)
);
create unique index job_categories_studio_name_key on public.job_categories (studio_id, lower(name));
comment on table public.job_categories is 'A studio''s job categories, e.g. Fall, Spring, Graduation.';

create trigger job_categories_touch before update on public.job_categories
for each row execute function app.touch_updated_at();

alter table public.job_categories enable row level security;
create policy "members read their studio's job categories" on public.job_categories
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add job categories" on public.job_categories
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit job categories" on public.job_categories
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));
revoke all on public.job_categories from anon, authenticated;
grant select on public.job_categories to authenticated;
grant insert (studio_id, name, position) on public.job_categories to authenticated;
grant update (name, position) on public.job_categories to authenticated;

-- Events for changes people make. The starter list written when a studio is created is part of studio.created
-- (written from inside the studio trigger, so pg_trigger_depth() > 1) and adds no events of its own.
create function app.on_job_category_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'job_category.created', new.id, '{}'::jsonb);
  else
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.position is distinct from old.position then 'position' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job_category.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;
create trigger job_categories_events after insert or update on public.job_categories
for each row execute function app.on_job_category_change();

-- Every new studio starts with the same list.
create function app.seed_job_categories() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.job_categories (studio_id, name, position)
  select new.id, c.name, c.position
  from unnest(array['Fall', 'Spring', 'Graduation', 'Sports', 'Dance', 'Yearbook', 'Other'])
    with ordinality as c(name, position);
  return new;
end;
$$;
create trigger studios_seed_job_categories after insert on public.studios
for each row execute function app.seed_job_categories();

-- Backfill: studios that already exist get the same list (no events; see the top of this file).
alter table public.job_categories disable trigger user;
insert into public.job_categories (studio_id, name, position)
select s.id, c.name, c.position
from public.studios s,
  unnest(array['Fall', 'Spring', 'Graduation', 'Sports', 'Dance', 'Yearbook', 'Other'])
    with ordinality as c(name, position)
on conflict do nothing;
alter table public.job_categories enable trigger user;

-- ── Jobs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- A client is optional for every job type now (Seenu, Oct 11 2026).
alter table public.jobs drop constraint jobs_organization_required;
alter table public.jobs rename column organization_id to client_id;
alter table public.jobs rename constraint jobs_organization_fk to jobs_client_fk;
alter index public.jobs_studio_organization_idx rename to jobs_studio_client_idx;

alter table public.jobs
  add column internal_number text,
  add column subjects_expected integer check (subjects_expected between 1 and 100000),
  add column category_id uuid;

-- Backfill existing jobs (no events, updated_at unchanged): picture day from when the job was created, numbers
-- JOB00001… per studio in creation order, and the studio's "Other" category.
alter table public.jobs disable trigger user;
update public.jobs set picture_day = created_at::date where picture_day is null;
update public.jobs j set internal_number = 'JOB' || lpad(n.n::text, 5, '0')
from (select id, row_number() over (partition by studio_id order by created_at, id) as n from public.jobs) n
where n.id = j.id;
update public.jobs j set category_id = c.id
from public.job_categories c
where c.studio_id = j.studio_id and c.name = 'Other';
alter table public.jobs enable trigger user;

-- Picture day is required now (Seenu, Oct 11 2026).
alter table public.jobs alter column picture_day set not null;
-- Internal job number: only the studio sees it; unique per studio, ignoring case.
alter table public.jobs alter column internal_number set not null;
alter table public.jobs add constraint jobs_internal_number_check
  check (char_length(internal_number) between 1 and 30 and internal_number = btrim(internal_number));
create unique index jobs_studio_internal_number_key on public.jobs (studio_id, lower(internal_number));
-- Category: composite studio FK, like the client (ADR 0008).
alter table public.jobs alter column category_id set not null;
alter table public.jobs add constraint jobs_category_fk foreign key (studio_id, category_id)
  references public.job_categories (studio_id, id) on delete restrict;
create index jobs_studio_category_idx on public.jobs (studio_id, category_id);

-- client_id keeps its grants through the rename; status stays locked until step 8.
grant insert (internal_number, subjects_expected, category_id) on public.jobs to authenticated;
grant update (internal_number, subjects_expected, category_id) on public.jobs to authenticated;

create or replace function app.on_job_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'job.created', new.id, jsonb_build_object('type', new.type, 'status', new.status));
  else
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.type is distinct from old.type then 'type' end,
      case when new.status is distinct from old.status then 'status' end,
      case when new.picture_day is distinct from old.picture_day then 'picture_day' end,
      case when new.client_id is distinct from old.client_id then 'client_id' end,
      case when new.internal_number is distinct from old.internal_number then 'internal_number' end,
      case when new.subjects_expected is distinct from old.subjects_expected then 'subjects_expected' end,
      case when new.category_id is distinct from old.category_id then 'category_id' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;

-- The next free JOBnnnnn number for a studio: the highest numeric JOB suffix + 1, zero-padded to 5 digits.
-- SECURITY INVOKER, so it only sees jobs the caller may read.
create function public.next_job_number(p_studio_id uuid) returns text
language sql stable
set search_path = ''
as $$
  select 'JOB' || lpad(n::text, greatest(5, char_length(n::text)), '0')
  from (
    select coalesce(max(substring(upper(j.internal_number) from '^JOB0*(\d{1,18})$')::bigint), 0) + 1::bigint as n
    from public.jobs j
    where j.studio_id = p_studio_id
  ) s;
$$;

revoke all on function app.on_client_change(), app.on_job_category_change(), app.seed_job_categories() from public;
revoke all on function public.next_job_number(uuid) from public, anon;
grant execute on function public.next_job_number(uuid) to authenticated;

notify pgrst, 'reload schema';
