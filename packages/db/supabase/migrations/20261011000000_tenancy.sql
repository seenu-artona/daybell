-- Phase 0, step 3: studios, members, roles and row-level security.
-- D96: every studio-owned table has studio_id and RLS. D113: a studio's data stays in its region.

create schema if not exists app;
comment on schema app is 'Daybell internal helpers. Not exposed through the API.';
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create type public.data_region as enum ('us', 'ca');
create type public.studio_role as enum ('owner', 'admin', 'photographer', 'staff');

-- Studios: the tenant root. Its id is the studio_id every other table carries.
create table public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  data_region public.data_region not null,
  created_at timestamptz not null default now()
);
comment on table public.studios is 'A photo studio (tenant). Each regional database only holds studios of its own region (D113).';

create table public.studio_members (
  studio_id uuid not null references public.studios (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.studio_role not null,
  created_at timestamptz not null default now(),
  primary key (studio_id, user_id)
);
create index studio_members_user_id_idx on public.studio_members (user_id);
comment on table public.studio_members is 'Who works at a studio and what they may do.';

-- D113 guard: each regional database records its region once, at first deploy (see packages/db/README.md):
--   insert into app.config (key, value) values ('data_region', 'us');   -- or 'ca'
-- A studio of the other region can never be written here, and a studio never changes region.
create table app.config (
  key text primary key,
  value text not null
);
comment on table app.config is 'Per-database settings written by deploys. Not reachable through the API.';
revoke all on app.config from public;

create function app.guard_config_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.key = 'data_region' then
    raise exception 'The data region of a database never changes' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger config_guard_immutable
before update or delete on app.config
for each row execute function app.guard_config_immutable();

create function app.guard_config_truncate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'app.config cannot be truncated' using errcode = 'check_violation';
end;
$$;

create trigger config_guard_truncate
before truncate on app.config
for each statement execute function app.guard_config_truncate();

-- SECURITY DEFINER: the guard must read app.config whoever writes the studio (including the server's service role).
create function app.guard_studio_region() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  db_region text := (select c.value from app.config c where c.key = 'data_region');
begin
  if tg_op = 'UPDATE' and new.data_region <> old.data_region then
    raise exception 'A studio cannot change data region' using errcode = 'check_violation';
  end if;
  -- Fail closed: a database that has not recorded its region accepts no studios at all.
  if db_region is null then
    raise exception 'This database has no data region recorded in app.config' using errcode = 'check_violation';
  end if;
  if new.data_region::text <> db_region then
    raise exception 'Studio region % does not match this database (%)', new.data_region, db_region
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger studios_guard_region
before insert or update of data_region on public.studios
for each row execute function app.guard_studio_region();

-- Membership helpers. SECURITY DEFINER so policies can read studio_members without recursing into its own RLS.
create function app.is_member(p_studio_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.studio_members m
    where m.studio_id = p_studio_id and m.user_id = (select auth.uid())
  );
$$;

create function app.has_role(p_studio_id uuid, p_roles public.studio_role[]) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.studio_members m
    where m.studio_id = p_studio_id and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

revoke all on function app.is_member(uuid), app.has_role(uuid, public.studio_role[]) from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.studio_role[]) to authenticated;

-- Never leave a studio without an owner.
-- SECURITY DEFINER so it sees every owner regardless of the caller's RLS view. Locking the studio row serialises
-- concurrent changes, so two owners demoting each other at the same moment cannot leave the studio ownerless.
create function app.guard_last_owner() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    perform 1 from public.studios s where s.id = old.studio_id for update;
    if not exists (
      select 1 from public.studio_members m
      where m.studio_id = old.studio_id and m.role = 'owner' and m.user_id <> old.user_id
    ) and exists (select 1 from public.studios s where s.id = old.studio_id) then
      raise exception 'A studio must keep at least one owner' using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger studio_members_guard_last_owner
before update of role or delete on public.studio_members
for each row execute function app.guard_last_owner();

-- Row-level security. Studios are created by the server (sign-up, step 4), never directly by a browser.
alter table public.studios enable row level security;
alter table public.studio_members enable row level security;

create policy "members read their studio" on public.studios
  for select to authenticated using (app.is_member(id));

create policy "owners and admins update their studio" on public.studios
  for update to authenticated
  using (app.has_role(id, '{owner,admin}'))
  with check (app.has_role(id, '{owner,admin}'));

create policy "members see their colleagues" on public.studio_members
  for select to authenticated using (app.is_member(studio_id));

create policy "owners add members" on public.studio_members
  for insert to authenticated with check (app.has_role(studio_id, '{owner}'));

create policy "owners change roles" on public.studio_members
  for update to authenticated
  using (app.has_role(studio_id, '{owner}'))
  with check (app.has_role(studio_id, '{owner}'));

create policy "owners remove members" on public.studio_members
  for delete to authenticated using (app.has_role(studio_id, '{owner}'));

revoke all on function app.guard_studio_region(), app.guard_last_owner(), app.guard_config_immutable(),
  app.guard_config_truncate() from public;

-- Logged-out visitors get nothing from these tables. Signed-in people can never truncate (TRUNCATE ignores RLS).
revoke all on public.studios, public.studio_members from anon;
revoke truncate, references, trigger on public.studios, public.studio_members from authenticated;
