-- Phase 1, step 1: jobs and organizations (D96, D113, D131; ADR 0008).
-- An organization is who a studio photographs for (a school, daycare, club, league…). A job is one shoot or season
-- for it. Both are studio-owned: studio_id, row-level security, and an event for every change.

create type public.organization_kind as enum ('school', 'daycare', 'club', 'league', 'dance_studio', 'other');
create type public.job_type as enum ('school', 'preschool', 'sports', 'dance', 'seniors', 'mini_session');
create type public.job_status as enum ('draft', 'selling', 'closed');

-- Keeps updated_at honest whoever writes the row.
create function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Organizations ─────────────────────────────────────────────────────────────────────────────────────────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name)),
  kind public.organization_kind not null,
  notes text check (char_length(notes) <= 2000),
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),
  city text check (char_length(city) <= 120),
  region_code text check (region_code ~ '^[A-Z]{2}$'),
  postal_code text check (char_length(postal_code) <= 10),
  country char(2) check (country in ('US', 'CA')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Quebec is excluded at launch (D131; Seenu, Oct 11 2026). QC is never a US state, so an address with no country
  -- is treated as Canadian here. Canadian postal codes starting with G, H or J are all in Quebec.
  constraint organizations_no_quebec check (
    not (coalesce(country, 'CA') = 'CA'
         and (upper(region_code) = 'QC' or upper(left(btrim(postal_code), 1)) in ('G', 'H', 'J')))
  ),
  -- Lets other tables reference an organization together with its studio (composite studio FKs, ADR 0008).
  constraint organizations_studio_id_id_key unique (studio_id, id)
);
create index organizations_studio_name_idx on public.organizations (studio_id, name);
comment on table public.organizations is 'Schools, daycares, clubs and leagues a studio photographs for. Duplicate names allowed.';

-- ── Jobs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- brand_id arrives in a later step by migration (ADR 0008).
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name)),
  type public.job_type not null,
  status public.job_status not null default 'draft',
  picture_day date,
  organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The organization must belong to the same studio (composite studio FK, ADR 0008).
  constraint jobs_organization_fk foreign key (studio_id, organization_id)
    references public.organizations (studio_id, id) on delete restrict,
  -- School, preschool, sports and dance jobs are for an organization; seniors and mini sessions may not be.
  constraint jobs_organization_required check (organization_id is not null or type in ('seniors', 'mini_session'))
);
create index jobs_studio_created_idx on public.jobs (studio_id, created_at desc);
create index jobs_studio_organization_idx on public.jobs (studio_id, organization_id);
comment on table public.jobs is 'A shoot or season a studio photographs and sells. Status changes only through functions (step 8).';

create trigger organizations_touch before update on public.organizations
for each row execute function app.touch_updated_at();
create trigger jobs_touch before update on public.jobs
for each row execute function app.touch_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────────────────────────────────────────
-- Everyone on the team reads; owners and admins create and edit. Nobody deletes (no delete policy or grant).
alter table public.organizations enable row level security;
alter table public.jobs enable row level security;

create policy "members read their studio's organizations" on public.organizations
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add organizations" on public.organizations
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit organizations" on public.organizations
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));

create policy "members read their studio's jobs" on public.jobs
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add jobs" on public.jobs
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit jobs" on public.jobs
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));

-- Column grants: a row never moves studio, ids and timestamps are the database's, and a job's status cannot be set
-- or changed directly; step 8 adds the function that moves a job through its statuses (ADR 0008).
-- Column grants only work once the table-wide grant Supabase adds by default is removed.
revoke all on public.organizations, public.jobs from anon, authenticated;
grant select on public.organizations, public.jobs to authenticated;
grant insert (studio_id, name, kind, notes, address_line1, address_line2, city, region_code, postal_code, country)
  on public.organizations to authenticated;
grant update (name, kind, notes, address_line1, address_line2, city, region_code, postal_code, country)
  on public.organizations to authenticated;
grant insert (studio_id, name, type, picture_day, organization_id) on public.jobs to authenticated;
grant update (name, type, picture_day, organization_id) on public.jobs to authenticated;

-- ── Events (D96) ──────────────────────────────────────────────────────────────────────────────────────────────────
-- IDs, kinds and changed field names only. Never names, addresses or notes.
create function app.on_organization_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'organization.created', new.id, jsonb_build_object('kind', new.kind));
  else
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.kind is distinct from old.kind then 'kind' end,
      case when new.notes is distinct from old.notes then 'notes' end,
      case when new.address_line1 is distinct from old.address_line1 then 'address_line1' end,
      case when new.address_line2 is distinct from old.address_line2 then 'address_line2' end,
      case when new.city is distinct from old.city then 'city' end,
      case when new.region_code is distinct from old.region_code then 'region_code' end,
      case when new.postal_code is distinct from old.postal_code then 'postal_code' end,
      case when new.country is distinct from old.country then 'country' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'organization.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;
create trigger organizations_events after insert or update on public.organizations
for each row execute function app.on_organization_change();

create function app.on_job_change() returns trigger
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
      case when new.organization_id is distinct from old.organization_id then 'organization_id' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;
create trigger jobs_events after insert or update on public.jobs
for each row execute function app.on_job_change();

revoke all on function app.touch_updated_at(), app.on_organization_change(), app.on_job_change() from public;

notify pgrst, 'reload schema';
