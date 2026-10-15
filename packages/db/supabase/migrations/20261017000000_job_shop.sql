-- UI round 7: Job › Shop (D157; Seenu's answers B1, B2 and N4 of Oct 14, 2026; ADR 0033, amending ADR 0019 and 0021).
-- A forward migration: 20261016100000 is merged.
--
-- A job sells its price list's items, with this job's own changes on top, and products of its own (Shopify's pattern,
-- Seenu): a change is a row keyed by (job, list item) holding a price, or the item switched off; resolution is the
-- job's price, else the list's. The shared list never changes. Job-only products are packages and prints (B2) living
-- on the job. One resolver, app.job_offer, gives everything a job can sell; every price read uses it (the parent shop,
-- the bag and checkout in 20261017000100, Start selling here).
--
-- Members read; owners and admins write (ADR 0019 answer 8). Prices are whole cents (D96). Events carry ids, kinds and
-- field names only, never prices or names. No money moves, so no ledger entries.

-- ── This job's prices ─────────────────────────────────────────────────────────────────────────────────────────────
-- A row only while something differs from the list: a price of its own (price_cents), or the item switched off
-- (sold = false). price_list_id is the job's list when the row was written; swapping the list deletes the rows of the
-- old one (B1, below), and the composite key keeps the item on that list.
create table public.job_price_overrides (
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  price_list_id uuid not null,
  price_list_item_id uuid not null,
  price_cents bigint check (price_cents between 0 and 1000000),
  sold boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, price_list_item_id),
  constraint job_price_overrides_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete cascade,
  -- An item deleted from its list takes this job's change with it.
  constraint job_price_overrides_item_fk foreign key (studio_id, price_list_id, price_list_item_id)
    references public.price_list_items (studio_id, price_list_id, id) on delete cascade,
  constraint job_price_overrides_differs check (price_cents is not null or not sold)
);
create index job_price_overrides_studio_idx on public.job_price_overrides (studio_id);
create index job_price_overrides_item_idx on public.job_price_overrides (price_list_item_id);
comment on table public.job_price_overrides is
  'A job''s own price for a list item, or the item switched off for the job (D157). Whole cents, before tax.';

-- ── Products only this job sells (B2: packages and prints) ────────────────────────────────────────────────────────
create table public.job_shop_items (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  kind public.price_item_kind not null check (kind in ('package', 'print')),
  -- The price list's text rules (20261012200000): no control characters, no bidi overrides or isolates.
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[\u0001-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]'),
  description text check (
    char_length(description) between 1 and 500 and description = btrim(description) and description !~ '[\u0001-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]'),
  print_size public.print_size,
  price_cents bigint not null check (price_cents between 0 and 1000000),
  sold boolean not null default true,
  position integer not null default 0 check (position between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_shop_items_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete cascade,
  constraint job_shop_items_print_size check ((kind = 'print') = (print_size is not null)),
  constraint job_shop_items_job_id_key unique (studio_id, job_id, id),
  -- Lets a bag line reference a product together with its kind (as price_list_items_studio_list_id_kind_key).
  constraint job_shop_items_job_id_kind_key unique (studio_id, job_id, id, kind)
);
create index job_shop_items_studio_idx on public.job_shop_items (studio_id);
create index job_shop_items_job_idx on public.job_shop_items (job_id, position);
comment on table public.job_shop_items is
  'Packages and prints only one job sells (D157, B2). Orders copy what they sell; ids stay stable on edit.';

create table public.job_shop_package_lines (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  job_item_id uuid not null,
  line_kind text not null check (line_kind in ('print', 'digital')),
  print_size public.print_size,
  quantity integer not null check (quantity between 1 and 99),
  position integer not null default 0 check (position between 0 and 10000),
  created_at timestamptz not null default now(),
  constraint job_shop_package_lines_item_fk foreign key (studio_id, job_id, job_item_id)
    references public.job_shop_items (studio_id, job_id, id) on delete cascade,
  constraint job_shop_package_lines_print_size check ((line_kind = 'print') = (print_size is not null)),
  constraint job_shop_package_lines_digital_one check (line_kind = 'print' or quantity = 1)
);
create index job_shop_package_lines_item_idx on public.job_shop_package_lines (job_item_id, position);
create index job_shop_package_lines_studio_idx on public.job_shop_package_lines (studio_id);
create unique index job_shop_package_lines_one_digital on public.job_shop_package_lines (job_item_id)
  where line_kind = 'digital';
comment on table public.job_shop_package_lines is 'What a job-only package holds: prints by size, and at most one digital.';

create trigger job_price_overrides_touch before update on public.job_price_overrides
for each row execute function app.touch_updated_at();
create trigger job_shop_items_touch before update on public.job_shop_items
for each row execute function app.touch_updated_at();

-- ── Guards ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The job's row, locked FOR SHARE, so a list swap (an UPDATE of the row) and a change here take turns: whichever comes
-- second sees the other. A closed job's shop never changes (job_closed, as app.assert_job_open); a price change must be
-- for an item on the job's current list (not_on_list).
create function app.check_job_shop_open(p_studio_id uuid, p_job_id uuid, p_price_list_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status public.job_status;
  v_list uuid;
begin
  select j.status, j.price_list_id into v_status, v_list
  from public.jobs j where j.id = p_job_id and j.studio_id = p_studio_id for share;
  if v_status = 'closed' then
    raise exception 'job_closed' using errcode = 'P0001';
  end if;
  if p_price_list_id is not null and v_list is distinct from p_price_list_id then
    raise exception 'not_on_list' using errcode = 'P0001';
  end if;
end;
$$;

-- Each guard first refuses a signed-in person who isn't an owner or admin of the row's studio (42501) before any lock,
-- lookup or count (they run ahead of row-level security's WITH CHECK, ADR 0019), so a refusal tells an outsider
-- nothing. Rows deleted along with their parent (a job, a list item, a package: the parent is already gone when a
-- cascade reaches them; a list swap: one trigger level deeper) pass, so a cascade never fails on a closed job.
create function app.guard_job_price_override() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.job_price_overrides := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1
       or not exists (select 1 from public.jobs j where j.id = old.job_id)
       or not exists (select 1 from public.price_list_items i where i.id = old.price_list_item_id)) then
    return old;
  end if;
  if pg_trigger_depth() = 1 and (select auth.uid()) is not null
     and not app.has_role(v.studio_id, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.studio_id, new.job_id, new.price_list_id, new.price_list_item_id)
       is distinct from (old.studio_id, old.job_id, old.price_list_id, old.price_list_item_id) then
    raise exception 'job_price_fixed' using errcode = 'check_violation';
  end if;
  perform app.check_job_shop_open(v.studio_id, v.job_id, case when tg_op = 'DELETE' then null else v.price_list_id end);
  return v;
end;
$$;
create trigger job_price_overrides_guard before insert or update or delete on public.job_price_overrides
for each row execute function app.guard_job_price_override();

-- A job-only product never changes studio, job or kind; at most 100 per job (B2), serialised per job.
create function app.guard_job_shop_item() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.job_shop_items := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or not exists (select 1 from public.jobs j where j.id = old.job_id)) then
    return old;
  end if;
  if pg_trigger_depth() = 1 and (select auth.uid()) is not null
     and not app.has_role(v.studio_id, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.studio_id, new.job_id, new.kind) is distinct from (old.studio_id, old.job_id, old.kind) then
    raise exception 'job_item_fixed' using errcode = 'check_violation';
  end if;
  perform app.check_job_shop_open(v.studio_id, v.job_id, null);
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('job_shop_items:' || new.job_id::text, 0));
    if (select count(*) from public.job_shop_items i
        where i.job_id = new.job_id and i.studio_id = new.studio_id) >= 100 then
      raise exception 'item_limit' using errcode = 'P0001';
    end if;
  end if;
  return v;
end;
$$;
create trigger job_shop_items_guard before insert or update or delete on public.job_shop_items
for each row execute function app.guard_job_shop_item();

-- Only packages have lines; at most 20 per package (as app.guard_package_line).
create function app.guard_job_package_line() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.job_shop_package_lines := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1
       or not exists (select 1 from public.job_shop_items i where i.id = old.job_item_id)) then
    return old;
  end if;
  if pg_trigger_depth() = 1 and (select auth.uid()) is not null
     and not app.has_role(v.studio_id, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = 'insufficient_privilege';
  end if;
  perform app.check_job_shop_open(v.studio_id, v.job_id, null);
  if tg_op = 'INSERT' then
    if (select i.kind from public.job_shop_items i
        where i.id = new.job_item_id and i.studio_id = new.studio_id and i.job_id = new.job_id)
       is distinct from 'package' then
      raise exception 'not_package' using errcode = 'check_violation';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('job_shop_package_lines:' || new.job_item_id::text, 0));
    if (select count(*) from public.job_shop_package_lines l
        where l.job_item_id = new.job_item_id and l.studio_id = new.studio_id) >= 20 then
      raise exception 'line_limit' using errcode = 'P0001';
    end if;
  end if;
  return v;
end;
$$;
create trigger job_shop_package_lines_guard before insert or delete on public.job_shop_package_lines
for each row execute function app.guard_job_package_line();

-- Every job-only package holds at least one line, checked at commit (as app.check_package_has_lines).
create function app.check_job_package_has_lines() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_package uuid := case when tg_table_name = 'job_shop_items' then (to_jsonb(new) ->> 'id')::uuid
                    else (to_jsonb(old) ->> 'job_item_id')::uuid end;
begin
  if exists (select 1 from public.job_shop_items i where i.id = v_package and i.kind = 'package')
     and not exists (select 1 from public.job_shop_package_lines l where l.job_item_id = v_package) then
    raise exception 'package_empty' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger job_shop_items_package_has_lines after insert on public.job_shop_items
deferrable initially deferred
for each row when (new.kind = 'package') execute function app.check_job_package_has_lines();
create constraint trigger job_shop_package_lines_package_has_lines after delete on public.job_shop_package_lines
deferrable initially deferred
for each row execute function app.check_job_package_has_lines();

-- ── Swapping the list (B1) ────────────────────────────────────────────────────────────────────────────────────────
-- The old list's changes for this job go; job-only products stay. One trigger level deeper, so no job_price.reset
-- events: job.updated {fields: ["price_list_id"]} says what happened.
create function app.drop_job_price_overrides() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.job_price_overrides o
  where o.job_id = new.id and o.studio_id = new.studio_id and o.price_list_id = old.price_list_id;
  return null;
end;
$$;
create trigger jobs_drop_price_overrides after update of price_list_id on public.jobs
for each row when (old.price_list_id is distinct from new.price_list_id)
execute function app.drop_job_price_overrides();

-- ── Row-level security (ADR 0019 answer 8) ────────────────────────────────────────────────────────────────────────
alter table public.job_price_overrides enable row level security;
alter table public.job_shop_items enable row level security;
alter table public.job_shop_package_lines enable row level security;

create policy "members read their studio's job prices" on public.job_price_overrides
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add job prices" on public.job_price_overrides
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit job prices" on public.job_price_overrides
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins delete job prices" on public.job_price_overrides
  for delete to authenticated using (app.has_role(studio_id, '{owner,admin}'));

create policy "members read their studio's job products" on public.job_shop_items
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add job products" on public.job_shop_items
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit job products" on public.job_shop_items
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins delete job products" on public.job_shop_items
  for delete to authenticated using (app.has_role(studio_id, '{owner,admin}'));

create policy "members read their studio's job package lines" on public.job_shop_package_lines
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add job package lines" on public.job_shop_package_lines
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins delete job package lines" on public.job_shop_package_lines
  for delete to authenticated using (app.has_role(studio_id, '{owner,admin}'));

-- Column grants: rows never move studio, job, list or item; a product never changes kind; ids, positions and
-- timestamps are the database's. Lines are replaced as a whole, never updated.
revoke all on public.job_price_overrides, public.job_shop_items, public.job_shop_package_lines from anon, authenticated;
grant select, delete on public.job_price_overrides, public.job_shop_items, public.job_shop_package_lines
  to authenticated;
grant insert (studio_id, job_id, price_list_id, price_list_item_id, price_cents, sold)
  on public.job_price_overrides to authenticated;
grant update (price_cents, sold) on public.job_price_overrides to authenticated;
grant insert (studio_id, job_id, kind, name, description, print_size, price_cents, sold, position)
  on public.job_shop_items to authenticated;
grant update (name, description, print_size, price_cents, sold) on public.job_shop_items to authenticated;
grant insert (studio_id, job_id, job_item_id, line_kind, print_size, quantity, position)
  on public.job_shop_package_lines to authenticated;

-- ── Events (D96) ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Ids and field names only, never prices or names. Rows deleted with their parent (a job, a list item, a list swap,
-- a product's lines) write none: the parent is gone by then, or the swap runs one trigger level deeper.
create function app.on_job_price_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.jobs j where j.id = old.job_id)
       or not exists (select 1 from public.price_list_items i where i.id = old.price_list_item_id) then
      return old;
    end if;
    perform app.emit(old.studio_id, 'job_price.reset', old.job_id,
      jsonb_build_object('job_id', old.job_id, 'price_list_item_id', old.price_list_item_id));
    return old;
  end if;
  v_fields := array_remove(array[
    case when new.price_cents is distinct from (case when tg_op = 'UPDATE' then old.price_cents end)
      then 'price_cents' end,
    case when new.sold is distinct from (case when tg_op = 'UPDATE' then old.sold else true end)
      then 'sold' end], null);
  if cardinality(v_fields) > 0 then
    perform app.emit(new.studio_id, 'job_price.changed', new.job_id, jsonb_build_object(
      'job_id', new.job_id, 'price_list_item_id', new.price_list_item_id, 'fields', to_jsonb(v_fields)));
  end if;
  return new;
end;
$$;
create trigger job_price_overrides_events after insert or update or delete on public.job_price_overrides
for each row execute function app.on_job_price_change();

create function app.on_job_item_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'job_item.created', new.id,
      jsonb_build_object('job_id', new.job_id, 'kind', new.kind));
  elsif tg_op = 'UPDATE' then
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.description is distinct from old.description then 'description' end,
      case when new.print_size is distinct from old.print_size then 'print_size' end,
      case when new.price_cents is distinct from old.price_cents then 'price_cents' end,
      case when new.sold is distinct from old.sold then 'sold' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job_item.updated', new.id,
        jsonb_build_object('job_id', new.job_id, 'fields', to_jsonb(v_fields)));
    end if;
  elsif exists (select 1 from public.jobs j where j.id = old.job_id) then
    perform app.emit(old.studio_id, 'job_item.deleted', old.id,
      jsonb_build_object('job_id', old.job_id, 'kind', old.kind));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger job_shop_items_events after insert or update or delete on public.job_shop_items
for each row execute function app.on_job_item_change();

-- A package's contents: one job_item.updated {fields: ["contents"]} per package per transaction, none for a package
-- made in the same transaction (as app.on_package_line_change).
create function app.on_job_package_line_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_line public.job_shop_package_lines := coalesce(new, old);
begin
  if pg_trigger_depth() > 1
     or not exists (select 1 from public.job_shop_items i where i.id = v_line.job_item_id) then
    return v_line;
  end if;
  if not exists (select 1 from public.job_shop_items i
                 where i.id = v_line.job_item_id and i.created_at = now())
     and not exists (select 1 from public.events e
                     where e.studio_id = v_line.studio_id and e.subject_id = v_line.job_item_id
                       and e.occurred_at = now() and e.type = 'job_item.updated'
                       and e.data -> 'fields' ? 'contents') then
    perform app.emit(v_line.studio_id, 'job_item.updated', v_line.job_item_id,
      jsonb_build_object('job_id', v_line.job_id, 'fields', jsonb_build_array('contents')));
  end if;
  return v_line;
end;
$$;
create trigger job_shop_package_lines_events after insert or delete on public.job_shop_package_lines
for each row execute function app.on_job_package_line_change();

-- ── The one resolver ──────────────────────────────────────────────────────────────────────────────────────────────
-- Everything a job can sell, as the job sells it: the job's current list's items at this job's price (its own, else
-- the list's) and whether they are sold, then the job's own products (list_price_cents null), each with its contents
-- (packages) and the list's currency. ord is the screen order: packages, prints, digital downloads; in each, the
-- list's items first, then the job's own (N5); then position and id. Every price read uses it: never a list price
-- directly. Nobody signed in calls it (SECURITY DEFINER functions do, after their own checks).
create function app.job_offer(p_job_id uuid)
returns table (item_id uuid, source text, kind public.price_item_kind, name text, description text,
  print_size public.print_size, list_price_cents bigint, price_cents bigint, sold boolean, item_position integer,
  contents jsonb, currency text, ord bigint)
language sql stable security definer
set search_path = ''
as $$
  with j as (
    select j.id, j.studio_id, j.price_list_id, l.currency::text as currency
    from public.jobs j
    join public.price_lists l on l.id = j.price_list_id and l.studio_id = j.studio_id
    where j.id = p_job_id
  ), offer as (
    select i.id, 'list'::text as source, i.kind, i.name, i.description, i.print_size,
      i.price_cents as list_price, coalesce(o.price_cents, i.price_cents) as price, coalesce(o.sold, true) as sold,
      i.position,
      case when i.kind = 'package' then coalesce((
        select jsonb_agg(jsonb_build_object('kind', pk.line_kind, 'print_size', pk.print_size,
            'quantity', pk.quantity) order by pk.position, pk.id)
        from public.price_list_package_lines pk
        where pk.package_item_id = i.id and pk.studio_id = i.studio_id), '[]'::jsonb)
      else '[]'::jsonb end as contents,
      j.currency
    from j
    join public.price_list_items i on i.price_list_id = j.price_list_id and i.studio_id = j.studio_id
    left join public.job_price_overrides o
      on o.job_id = j.id and o.price_list_item_id = i.id and o.studio_id = j.studio_id
    union all
    select s.id, 'job', s.kind, s.name, s.description, s.print_size, null::bigint, s.price_cents, s.sold, s.position,
      case when s.kind = 'package' then coalesce((
        select jsonb_agg(jsonb_build_object('kind', pk.line_kind, 'print_size', pk.print_size,
            'quantity', pk.quantity) order by pk.position, pk.id)
        from public.job_shop_package_lines pk
        where pk.job_item_id = s.id and pk.studio_id = s.studio_id), '[]'::jsonb)
      else '[]'::jsonb end,
      j.currency
    from j
    join public.job_shop_items s on s.job_id = j.id and s.studio_id = j.studio_id
  )
  select x.id, x.source, x.kind, x.name, x.description, x.print_size, x.list_price, x.price, x.sold, x.position,
    x.contents, x.currency,
    row_number() over (order by case x.kind when 'package' then 1 when 'print' then 2 else 3 end,
                         x.source = 'job', x.position, x.id)
  from offer x;
$$;

-- ── Functions the API calls ───────────────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER (row-level security applies). Each finds the job through row-level security (another studio's job
-- is not_found, P0002), refuses anyone but owners and admins (42501), then locks the job's row FOR SHARE before
-- touching anything, in the same order as the guards, so a list swap and a change take turns without a deadlock.

-- This job's price and Sold for one of its list's items (N4; D157: "type the list price back to undo"). Null leaves
-- that field as it is, read under a per-item lock so a concurrent change to the other field is kept. The list's own price typed back clears the job's price; a row whose price and Sold then match
-- the list is deleted (it would say nothing). Named errors without values: job_closed, not_on_list.
create function public.set_job_price(p_job_id uuid, p_item_id uuid, p_price_cents bigint, p_sold boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_status public.job_status;
  v_list uuid;
  v_list_price bigint;
  v_current public.job_price_overrides;
  v_price bigint;
  v_sold boolean;
begin
  if v_studio is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_role(v_studio, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = '42501';
  end if;
  if p_price_cents is null and p_sold is null then
    raise exception 'Send a price or whether it is sold' using errcode = '22023';
  end if;
  select j.status, j.price_list_id into v_status, v_list
  from public.jobs j where j.id = p_job_id and j.studio_id = v_studio for share;
  -- One change to an item at a time (code review H1): a price and a Sold switch sent together each read the row only
  -- once the other has committed, so neither is lost. Taken after the job's share lock, as everywhere here.
  perform pg_advisory_xact_lock(hashtextextended('job_price:' || p_job_id::text || ':' || p_item_id::text, 0));
  if v_status = 'closed' then
    raise exception 'job_closed' using errcode = 'P0001';
  end if;
  select i.price_cents into v_list_price from public.price_list_items i
  where i.id = p_item_id and i.price_list_id = v_list and i.studio_id = v_studio;
  if v_list_price is null then
    raise exception 'not_on_list' using errcode = 'P0001';
  end if;
  select * into v_current from public.job_price_overrides o
  where o.job_id = p_job_id and o.price_list_item_id = p_item_id and o.studio_id = v_studio;
  v_price := coalesce(p_price_cents, v_current.price_cents);
  if v_price = v_list_price then
    v_price := null;
  end if;
  v_sold := coalesce(p_sold, v_current.sold, true);
  if v_price is null and v_sold then
    delete from public.job_price_overrides o
    where o.job_id = p_job_id and o.price_list_item_id = p_item_id and o.studio_id = v_studio;
  else
    insert into public.job_price_overrides as o (studio_id, job_id, price_list_id, price_list_item_id, price_cents, sold)
    values (v_studio, p_job_id, v_list, p_item_id, v_price, v_sold)
    on conflict (job_id, price_list_item_id) do update
    set price_cents = excluded.price_cents, sold = excluded.sold
    where (o.price_cents, o.sold) is distinct from (excluded.price_cents, excluded.sold);
  end if;
end;
$$;

-- Undo: the item goes back to the list's price and is sold again. Nothing to undo is fine.
create function public.reset_job_price(p_job_id uuid, p_item_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_status public.job_status;
begin
  if v_studio is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_role(v_studio, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = '42501';
  end if;
  select j.status into v_status from public.jobs j where j.id = p_job_id and j.studio_id = v_studio for share;
  if v_status = 'closed' then
    raise exception 'job_closed' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('job_price:' || p_job_id::text || ':' || p_item_id::text, 0));
  delete from public.job_price_overrides o
  where o.job_id = p_job_id and o.price_list_item_id = p_item_id and o.studio_id = v_studio;
end;
$$;

-- Adds or updates one job-only product and, for a package, replaces its contents, in one transaction (as
-- save_price_list_item). p_item_id null adds one (p_item.kind: package or print); otherwise it is updated in place,
-- so its id stays stable for orders. p_lines null keeps a package's contents. Named errors without values: not_found
-- (P0002), job_closed, item_limit, package_empty, not_package.
create function public.save_job_item(p_job_id uuid, p_item_id uuid, p_item jsonb, p_lines jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_kind public.price_item_kind;
  v_id uuid;
begin
  if v_studio is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_role(v_studio, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = '42501';
  end if;
  perform 1 from public.jobs j where j.id = p_job_id and j.studio_id = v_studio for share;
  if p_item_id is null then
    insert into public.job_shop_items (studio_id, job_id, kind, name, description, print_size, price_cents, sold,
      position)
    values (v_studio, p_job_id, (p_item ->> 'kind')::public.price_item_kind, p_item ->> 'name',
      p_item ->> 'description', (p_item ->> 'print_size')::public.print_size, (p_item ->> 'price_cents')::bigint,
      coalesce((p_item ->> 'sold')::boolean, true),
      least(coalesce((select max(i.position) + 1 from public.job_shop_items i
                      where i.job_id = p_job_id and i.studio_id = v_studio), 1), 10000))
    returning id, kind into v_id, v_kind;
  else
    update public.job_shop_items i set
      name = coalesce(p_item ->> 'name', i.name),
      description = case when p_item ? 'description' then p_item ->> 'description' else i.description end,
      print_size = case when p_item ? 'print_size' then (p_item ->> 'print_size')::public.print_size
                   else i.print_size end,
      price_cents = coalesce((p_item ->> 'price_cents')::bigint, i.price_cents),
      sold = coalesce((p_item ->> 'sold')::boolean, i.sold)
    where i.id = p_item_id and i.job_id = p_job_id and i.studio_id = v_studio
    returning i.id, i.kind into v_id, v_kind;
    if v_id is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  if v_kind = 'package' and p_lines is not null then
    if jsonb_array_length(p_lines) = 0 then
      raise exception 'package_empty' using errcode = 'P0001';
    end if;
    delete from public.job_shop_package_lines l where l.job_item_id = v_id and l.studio_id = v_studio;
    insert into public.job_shop_package_lines (studio_id, job_id, job_item_id, line_kind, print_size, quantity,
      position)
    select v_studio, p_job_id, v_id, e.value ->> 'kind', (e.value ->> 'print_size')::public.print_size,
      (e.value ->> 'quantity')::int, e.ordinality
    from jsonb_array_elements(p_lines) with ordinality e;
  elsif v_kind = 'package' and p_item_id is null then
    raise exception 'package_empty' using errcode = 'P0001';
  elsif v_kind <> 'package' and p_lines is not null then
    raise exception 'not_package' using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;

-- Removes a job-only product (and its contents). Orders already placed keep what they sold.
create function public.delete_job_item(p_job_id uuid, p_item_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
begin
  if v_studio is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_role(v_studio, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = '42501';
  end if;
  perform 1 from public.jobs j where j.id = p_job_id and j.studio_id = v_studio for share;
  delete from public.job_shop_items i where i.id = p_item_id and i.job_id = p_job_id and i.studio_id = v_studio;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Job › Shop (D157): the job's list, every row as the job sells it, and how many changes this job has (N1: changed
-- prices, items switched off and job-only products). For any member (N10: photographers keep seeing prices). SECURITY
-- DEFINER because it reads through app.job_offer: one membership check first (42501, before anything is read), then
-- every read names the studio; a job of another studio is not_found.
create function public.job_shop(p_studio_id uuid, p_job_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job record;
begin
  if (select auth.uid()) is null or p_studio_id is null or not app.is_member(p_studio_id) then
    raise exception 'Members only' using errcode = '42501';
  end if;
  select j.id, j.price_list_id into v_job from public.jobs j where j.id = p_job_id and j.studio_id = p_studio_id;
  if v_job.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return (
    with rows as (
      select o.*, (o.source = 'job' or o.price_cents is distinct from o.list_price_cents or not o.sold) as changed
      from app.job_offer(v_job.id) o
    )
    select jsonb_build_object(
      'job_id', v_job.id,
      'price_list', (select jsonb_build_object('id', l.id, 'name', l.name, 'currency', l.currency,
                       'home_shipping_cents', l.home_shipping_cents)
                     from public.price_lists l where l.id = v_job.price_list_id and l.studio_id = p_studio_id),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'item_id', r.item_id, 'source', r.source, 'kind', r.kind, 'name', r.name, 'description', r.description,
          'print_size', r.print_size, 'contents', r.contents, 'list_price_cents', r.list_price_cents,
          'price_cents', r.price_cents, 'sold', r.sold, 'changed', r.changed, 'position', r.item_position)
          order by r.ord) from rows r), '[]'::jsonb),
      'changes', (select count(*) from rows r where r.changed)));
end;
$$;

-- ── Start selling (amends ADR 0021 A2; N3) ────────────────────────────────────────────────────────────────────────
-- app.sell_blockers as in 20261012500000, with "price_list" meaning the job sells nothing: no item of its list is
-- sold for it and it has no product of its own that is.
create or replace function app.sell_blockers(p_job_id uuid) returns text[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job record;
  v_state jsonb;
  v_out text[] := '{}';
begin
  select j.studio_id, j.price_list_id into v_job from public.jobs j where j.id = p_job_id;
  v_state := app.job_tagging_state(p_job_id);
  if not exists (select 1 from public.children c where c.job_id = p_job_id and c.studio_id = v_job.studio_id) then
    v_out := array_append(v_out, 'roster');
  end if;
  if not (v_state ->> 'has_ready_photo')::boolean then
    v_out := array_append(v_out, 'photos');
  end if;
  if not ((v_state ->> 'has_ready_photo')::boolean and not (v_state ->> 'pending')::boolean
          and (v_state ->> 'leftovers')::int = 0 and (v_state ->> 'flagged')::int = 0
          and (v_state ->> 'blank_cards')::int = 0 and (v_state ->> 'reviewed')::boolean) then
    v_out := array_append(v_out, 'tagging');
  end if;
  if not exists (select 1 from app.job_offer(p_job_id) o where o.sold) then
    v_out := array_append(v_out, 'price_list');
  end if;
  if not exists (select 1 from public.payout_accounts a where a.studio_id = v_job.studio_id and a.status = 'active') then
    v_out := array_append(v_out, 'payouts');
  end if;
  return v_out;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.check_job_shop_open(uuid, uuid, uuid), app.guard_job_price_override(),
  app.guard_job_shop_item(), app.guard_job_package_line(), app.check_job_package_has_lines(),
  app.drop_job_price_overrides(), app.on_job_price_change(), app.on_job_item_change(),
  app.on_job_package_line_change(), app.job_offer(uuid)
  from public, anon, authenticated;
revoke all on function public.set_job_price(uuid, uuid, bigint, boolean), public.reset_job_price(uuid, uuid),
  public.save_job_item(uuid, uuid, jsonb, jsonb), public.delete_job_item(uuid, uuid), public.job_shop(uuid, uuid)
  from public, anon;
grant execute on function public.set_job_price(uuid, uuid, bigint, boolean), public.reset_job_price(uuid, uuid),
  public.save_job_item(uuid, uuid, jsonb, jsonb), public.delete_job_item(uuid, uuid), public.job_shop(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
