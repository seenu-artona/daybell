-- LOCAL TESTS ONLY. Recreates the small part of Supabase the migrations rely on, so the same pgTAP tests run
-- against plain Postgres when Docker is unavailable. CI runs them against the real Supabase stack instead.
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists pgcrypto;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), ''
  )::uuid;
$$;

grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase grants table access to these roles by default and relies on RLS to filter rows.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

do $$ begin execute format('alter database %I set search_path = "$user", public, extensions', current_database()); end $$;
