-- Phase 1, step 6: products and price lists (D36, D59, D104, D143, D96, D113; Seenu's answers 1–8 and Claude's calls
-- 1–10 of Oct 12, 2026; ADR 0019, amending ADR 0008 and 0017). A forward migration: 20261012100000 is deployed.
--
-- A studio has many price lists; each job uses one, and new jobs get the studio's default (answer 1). A list holds
-- packages (prints plus at most one digital download of the one pose the parent picks; answer 3), single prints of
-- five fixed sizes, one single digital download and one "all digitals" (answer 7). Prices are whole cents in the
-- list's currency, which is always the studio's region's (us → USD, ca → CAD; ADR 0006, call 7), and are before tax.
-- The home shipping fee is set on the list; free delivery to school is switched on per job (answer 4; off by default,
-- call 6). Owners and admins edit; photographers and staff read (answer 8).
--
-- Events carry ids, kinds and field names only, never names or prices (D96). The starter list written for a new
-- studio is part of studio.created and writes no events of its own (the job_categories precedent, 20261011050000).

create type public.price_item_kind as enum ('package', 'print', 'digital_single', 'digital_all');
-- Print sizes are fixed for Phase 1 (call 8). wallets_8 is one sheet of 8 wallets.
create type public.print_size as enum ('4x6', '5x7', '8x10', '11x14', 'wallets_8');

-- ── Price lists ───────────────────────────────────────────────────────────────────────────────────────────────────
create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  -- Shown to parents: no control characters (C0, DEL, C1) and no bidi overrides or isolates, which could make a name
  -- read differently from what it is (U+202A–U+202E, U+2066–U+2069). Spelled out rather than [[:cntrl:]] so the rule
  -- doesn't depend on the server's locale, and matches the API's (packages/api priceText).
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[\u0001-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]'),
  -- Set by app.guard_price_list from the studio's region; clients never send it and it never changes.
  currency char(3) not null check (currency in ('USD', 'CAD')),
  home_shipping_cents bigint not null default 0 check (home_shipping_cents between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets items, jobs and the studio's default reference a list together with its studio (ADR 0008).
  constraint price_lists_studio_id_id_key unique (studio_id, id)
);
comment on table public.price_lists is
  'A studio''s price lists (D36). Money in whole cents in the list''s currency, before tax (D96). Names may repeat.';

create table public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  price_list_id uuid not null,
  kind public.price_item_kind not null,
  -- The same text rules as price_lists.name.
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[\u0001-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]'),
  description text check (
    char_length(description) between 1 and 500 and description = btrim(description) and description !~ '[\u0001-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]'),
  print_size public.print_size,
  price_cents bigint not null check (price_cents between 0 and 1000000),
  -- Bounded so max(position) + 1 can never overflow; at most 100 items, renumbered 1..n on reorder.
  position integer not null default 0 check (position between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_list_items_list_fk foreign key (studio_id, price_list_id)
    references public.price_lists (studio_id, id) on delete cascade,
  -- A print has a size; nothing else does.
  constraint price_list_items_print_size check ((kind = 'print') = (print_size is not null)),
  constraint price_list_items_studio_list_id_key unique (studio_id, price_list_id, id)
);
create index price_list_items_list_idx on public.price_list_items (price_list_id, position);
-- One single digital and one "all digitals" per list at most (answer 7).
create unique index price_list_items_one_digital_single on public.price_list_items (price_list_id)
  where kind = 'digital_single';
create unique index price_list_items_one_digital_all on public.price_list_items (price_list_id)
  where kind = 'digital_all';
comment on table public.price_list_items is
  'Packages, single prints and digital downloads on a price list. Orders (step 10) copy what they sell, so edits and '
  'deletes never change past orders; ids stay stable on edit.';

-- What a package holds: lines of its own rather than references to the list's print items, so a package stays whole
-- if the studio stops selling a size on its own (ADR 0019). Lines are replaced as a whole, never updated.
create table public.price_list_package_lines (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  price_list_id uuid not null,
  package_item_id uuid not null,
  line_kind text not null check (line_kind in ('print', 'digital')),
  print_size public.print_size,
  quantity integer not null check (quantity between 1 and 99),
  position integer not null default 0 check (position between 0 and 10000),
  created_at timestamptz not null default now(),
  constraint price_list_package_lines_item_fk foreign key (studio_id, price_list_id, package_item_id)
    references public.price_list_items (studio_id, price_list_id, id) on delete cascade,
  constraint price_list_package_lines_print_size check ((line_kind = 'print') = (print_size is not null)),
  -- The digital download of the package's one pose: always one.
  constraint price_list_package_lines_digital_one check (line_kind = 'print' or quantity = 1)
);
create index price_list_package_lines_item_idx on public.price_list_package_lines (package_item_id, position);
-- One pose per package, so at most one digital line (answer 3).
create unique index price_list_package_lines_one_digital on public.price_list_package_lines (package_item_id)
  where line_kind = 'digital';
comment on table public.price_list_package_lines is 'What a package holds: prints by size, and at most one digital.';

create trigger price_lists_touch before update on public.price_lists
for each row execute function app.touch_updated_at();
create trigger price_list_items_touch before update on public.price_list_items
for each row execute function app.touch_updated_at();

-- ── Guards ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Currency follows the studio's region and never changes; at most 50 lists per studio. SECURITY DEFINER so it reads
-- the studio whoever writes; it first refuses a signed-in person who isn't an owner or admin of the row's studio
-- (42501, as row-level security would), so it never reveals anything about another studio. No values in errors.
create function app.guard_price_list() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_currency text;
begin
  -- Before anything else, so the lock and counts below never run for another studio's rows (BEFORE triggers run
  -- ahead of row-level security's WITH CHECK; otherwise a failure would tell an outsider that a list exists). The
  -- starter list, written by the studio's own insert trigger before its owner is a member, runs one level deeper.
  if pg_trigger_depth() = 1 and (select auth.uid()) is not null
     and not app.has_role(new.studio_id, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = 'insufficient_privilege';
  end if;
  v_currency := (
    select case s.data_region when 'us' then 'USD' else 'CAD' end from public.studios s where s.id = new.studio_id);
  if tg_op = 'INSERT' then
    if new.currency is null then
      new.currency := v_currency;
    elsif new.currency is distinct from v_currency then
      raise exception 'price_list_currency' using errcode = 'check_violation';
    end if;
    -- Serialise per studio so parallel inserts can't both pass the limit.
    perform pg_advisory_xact_lock(hashtextextended('price_lists:' || new.studio_id::text, 0));
    if (select count(*) from public.price_lists l where l.studio_id = new.studio_id) >= 50 then
      raise exception 'price_list_limit' using errcode = 'P0001';
    end if;
  elsif new.currency is distinct from old.currency or new.studio_id is distinct from old.studio_id then
    raise exception 'price_list_currency' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger price_lists_guard before insert or update on public.price_lists
for each row execute function app.guard_price_list();

-- An item never changes kind, list or studio; at most 100 items per list.
create function app.guard_price_list_item() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- As in app.guard_price_list: refuse other studios' rows before the lock and count.
  if pg_trigger_depth() = 1 and (select auth.uid()) is not null
     and not app.has_role(new.studio_id, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('price_list_items:' || new.price_list_id::text, 0));
    if (select count(*) from public.price_list_items i
        where i.price_list_id = new.price_list_id and i.studio_id = new.studio_id) >= 100 then
      raise exception 'item_limit' using errcode = 'P0001';
    end if;
  elsif new.kind is distinct from old.kind or new.price_list_id is distinct from old.price_list_id
     or new.studio_id is distinct from old.studio_id then
    raise exception 'price_list_item_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger price_list_items_guard before insert or update on public.price_list_items
for each row execute function app.guard_price_list_item();

-- Only packages have lines; at most 20 lines per package.
create function app.guard_package_line() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- As in app.guard_price_list: refuse other studios' rows before the lookup, lock and count.
  if pg_trigger_depth() = 1 and (select auth.uid()) is not null
     and not app.has_role(new.studio_id, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = 'insufficient_privilege';
  end if;
  if (select i.kind from public.price_list_items i
      where i.id = new.package_item_id and i.studio_id = new.studio_id) is distinct from 'package' then
    raise exception 'not_package' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('price_list_package_lines:' || new.package_item_id::text, 0));
  if (select count(*) from public.price_list_package_lines l
      where l.package_item_id = new.package_item_id and l.studio_id = new.studio_id) >= 20 then
    raise exception 'line_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger price_list_package_lines_guard before insert on public.price_list_package_lines
for each row execute function app.guard_package_line();

-- Every package holds at least one line (answer 3), whoever writes: checked at commit, so save_price_list_item can
-- replace a package's contents (delete, then insert) and a new package can get its lines after it is inserted. A
-- package deleted along the way (or its list, or its studio) needs nothing. SECURITY DEFINER so it sees every line of
-- the package, not just the ones row-level security shows; it reads the one package the write touched.
create function app.check_package_has_lines() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  -- Read through jsonb: NEW and OLD have different row types on the two tables.
  v_package uuid := case when tg_table_name = 'price_list_items' then (to_jsonb(new) ->> 'id')::uuid
                    else (to_jsonb(old) ->> 'package_item_id')::uuid end;
begin
  if exists (select 1 from public.price_list_items i where i.id = v_package and i.kind = 'package')
     and not exists (select 1 from public.price_list_package_lines l where l.package_item_id = v_package) then
    raise exception 'package_empty' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger price_list_items_package_has_lines after insert on public.price_list_items
deferrable initially deferred
for each row when (new.kind = 'package') execute function app.check_package_has_lines();
create constraint trigger price_list_package_lines_package_has_lines after delete on public.price_list_package_lines
deferrable initially deferred
for each row execute function app.check_package_has_lines();

-- ── Row-level security (answer 8) ─────────────────────────────────────────────────────────────────────────────────
alter table public.price_lists enable row level security;
alter table public.price_list_items enable row level security;
alter table public.price_list_package_lines enable row level security;

create policy "members read their studio's price lists" on public.price_lists
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add price lists" on public.price_lists
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit price lists" on public.price_lists
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins delete price lists" on public.price_lists
  for delete to authenticated using (app.has_role(studio_id, '{owner,admin}'));

create policy "members read their studio's price list items" on public.price_list_items
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add price list items" on public.price_list_items
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit price list items" on public.price_list_items
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins delete price list items" on public.price_list_items
  for delete to authenticated using (app.has_role(studio_id, '{owner,admin}'));

create policy "members read their studio's package lines" on public.price_list_package_lines
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add package lines" on public.price_list_package_lines
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins delete package lines" on public.price_list_package_lines
  for delete to authenticated using (app.has_role(studio_id, '{owner,admin}'));

-- Column grants: a row never moves studio or list, an item never changes kind, the currency is the database's, and
-- ids and timestamps are the database's. Lines are never updated (replaced as a whole).
revoke all on public.price_lists, public.price_list_items, public.price_list_package_lines from anon, authenticated;
grant select, delete on public.price_lists, public.price_list_items, public.price_list_package_lines to authenticated;
grant insert (studio_id, name, home_shipping_cents) on public.price_lists to authenticated;
grant update (name, home_shipping_cents) on public.price_lists to authenticated;
grant insert (studio_id, price_list_id, kind, name, description, print_size, price_cents, position)
  on public.price_list_items to authenticated;
-- Position isn't updatable: the order changes only through set_price_list_item_order (all items, renumbered 1..n).
grant update (name, description, print_size, price_cents) on public.price_list_items to authenticated;
grant insert (studio_id, price_list_id, package_item_id, line_kind, print_size, quantity, position)
  on public.price_list_package_lines to authenticated;

-- ── The studio's default list, and "Review your price list" ───────────────────────────────────────────────────────
-- One pointer, so switching the default is one update (ADR 0019 rejects an is_default flag). `no action`, so the
-- default list can't be deleted, while deleting the studio (which takes its lists with it) still works: the check
-- runs at the end of the statement, when the studio row is already gone. Owners and admins change it through the
-- existing "owners and admins update their studio" policy; the composite FK keeps it inside the studio.
alter table public.studios
  add column default_price_list_id uuid,
  add column price_list_reviewed_at timestamptz,
  add constraint studios_default_price_list_fk foreign key (id, default_price_list_id)
    references public.price_lists (studio_id, id);
comment on column public.studios.default_price_list_id is 'The price list new jobs get (answer 1).';
comment on column public.studios.price_list_reviewed_at is
  'When an owner or admin first saved a price list change (onboarding, ADR 0019). Set once by the database; never '
  'cleared or moved, and never set by hand.';

-- Only the database writes it: browsers lose the table-wide UPDATE on studios (Supabase's default) and get the columns
-- they already used, plus the default list (column grants only work without the table-wide grant). The id,
-- created_at and data_region were never meant to change and are no longer updatable by browsers either.
revoke update on public.studios from authenticated;
-- Not data_region: nothing in the browser writes it, and a trigger refuses changes anyway (D113).
grant update (name, slug, onboarded_at, default_price_list_id) on public.studios to authenticated;

-- Write-once, with the database's clock. A person changing the studio's default list (not the first default, set
-- when the studio is created) counts as a price list change. Once a studio has a default it always has one (answer
-- 1): new jobs need it (jobs.price_list_id is NOT NULL), and it keeps the studio's last list from being deleted.
create function app.guard_studio_price_list_review() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.default_price_list_id is not null and new.default_price_list_id is null then
    raise exception 'default_price_list_required' using errcode = 'check_violation';
  end if;
  if old.price_list_reviewed_at is not null then
    new.price_list_reviewed_at := old.price_list_reviewed_at;
  elsif new.price_list_reviewed_at is not null then
    new.price_list_reviewed_at := now();
  elsif old.default_price_list_id is not null
     and new.default_price_list_id is distinct from old.default_price_list_id
     and (select auth.uid()) is not null then
    new.price_list_reviewed_at := now();
  end if;
  return new;
end;
$$;
create trigger studios_guard_price_list_review before update on public.studios
for each row execute function app.guard_studio_price_list_review();

-- Called for a person's own price list change (never for the starter list or a cascade, and never without a signed-in
-- person). SECURITY DEFINER: browsers can't write the column themselves.
create function app.mark_price_list_reviewed(p_studio_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.studios s set price_list_reviewed_at = now()
  where s.id = p_studio_id and s.price_list_reviewed_at is null and (select auth.uid()) is not null;
$$;

-- ── Jobs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Free delivery to school is off by default (call 6). The price list is filled in from the studio's default below.
alter table public.jobs
  add column price_list_id uuid,
  add column deliver_to_school boolean not null default false;

-- ── The starter list (answer 2; call 9: placeholder prices for Seenu) ─────────────────────────────────────────────
-- The JSON between the markers must equal STARTER_PRICE_LIST in packages/core/src/price-lists.ts (a test in
-- packages/api compares them). Money in whole cents, per currency.
create function app.starter_price_list() returns jsonb
language sql immutable
set search_path = ''
as $$
  select $starter$
{
  "name": "Starter price list",
  "homeShipping": { "USD": 895, "CAD": 1195 },
  "items": [
    { "kind": "package", "name": "Package A", "description": null, "printSize": null,
      "price": { "USD": 6400, "CAD": 8500 },
      "contents": [
        { "kind": "print", "printSize": "8x10", "quantity": 1 },
        { "kind": "print", "printSize": "5x7", "quantity": 2 },
        { "kind": "print", "printSize": "wallets_8", "quantity": 1 },
        { "kind": "digital", "printSize": null, "quantity": 1 } ] },
    { "kind": "package", "name": "Package B", "description": null, "printSize": null,
      "price": { "USD": 4400, "CAD": 5900 },
      "contents": [
        { "kind": "print", "printSize": "5x7", "quantity": 2 },
        { "kind": "print", "printSize": "wallets_8", "quantity": 1 },
        { "kind": "digital", "printSize": null, "quantity": 1 } ] },
    { "kind": "package", "name": "Package C", "description": null, "printSize": null,
      "price": { "USD": 2900, "CAD": 3900 },
      "contents": [
        { "kind": "print", "printSize": "5x7", "quantity": 1 },
        { "kind": "print", "printSize": "wallets_8", "quantity": 1 } ] },
    { "kind": "print", "name": "4×6 print", "description": null, "printSize": "4x6",
      "price": { "USD": 1000, "CAD": 1300 }, "contents": [] },
    { "kind": "print", "name": "5×7 print", "description": null, "printSize": "5x7",
      "price": { "USD": 1400, "CAD": 1900 }, "contents": [] },
    { "kind": "print", "name": "8×10 print", "description": null, "printSize": "8x10",
      "price": { "USD": 2000, "CAD": 2700 }, "contents": [] },
    { "kind": "print", "name": "11×14 print", "description": null, "printSize": "11x14",
      "price": { "USD": 3200, "CAD": 4300 }, "contents": [] },
    { "kind": "print", "name": "Wallets (sheet of 8)", "description": null, "printSize": "wallets_8",
      "price": { "USD": 1500, "CAD": 2000 }, "contents": [] },
    { "kind": "digital_single", "name": "Digital download",
      "description": "One photo, full resolution, no watermark.", "printSize": null,
      "price": { "USD": 2500, "CAD": 3300 }, "contents": [] },
    { "kind": "digital_all", "name": "All digitals",
      "description": "Every photo of your child in this job, full resolution, no watermark.", "printSize": null,
      "price": { "USD": 5900, "CAD": 7900 }, "contents": [] }
  ]
}
$starter$::jsonb;
$$;

-- Writes the starter list for a studio in its region's currency and makes it the default if it has none. Returns the
-- list's id. Run from the studio's insert trigger (so its rows write no events) and by the backfill below.
create function app.seed_price_list(p_studio_id uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_template jsonb := app.starter_price_list();
  v_currency text := (
    select case s.data_region when 'us' then 'USD' else 'CAD' end from public.studios s where s.id = p_studio_id);
  v_list uuid;
  v_item uuid;
  v_entry record;
begin
  insert into public.price_lists (studio_id, name, currency, home_shipping_cents)
  values (p_studio_id, v_template ->> 'name', v_currency, (v_template -> 'homeShipping' ->> v_currency)::bigint)
  returning id into v_list;
  for v_entry in
    select e.value as item, e.ordinality as position from jsonb_array_elements(v_template -> 'items') with ordinality e
  loop
    insert into public.price_list_items (studio_id, price_list_id, kind, name, description, print_size, price_cents,
      position)
    values (p_studio_id, v_list, (v_entry.item ->> 'kind')::public.price_item_kind, v_entry.item ->> 'name',
      v_entry.item ->> 'description', (v_entry.item ->> 'printSize')::public.print_size,
      (v_entry.item -> 'price' ->> v_currency)::bigint, v_entry.position)
    returning id into v_item;
    insert into public.price_list_package_lines (studio_id, price_list_id, package_item_id, line_kind, print_size,
      quantity, position)
    select p_studio_id, v_list, v_item, l.value ->> 'kind', (l.value ->> 'printSize')::public.print_size,
      (l.value ->> 'quantity')::int, l.ordinality
    from jsonb_array_elements(v_entry.item -> 'contents') with ordinality l;
  end loop;
  update public.studios s set default_price_list_id = v_list
  where s.id = p_studio_id and s.default_price_list_id is null;
  return v_list;
end;
$$;

-- Backfill (event triggers are created after it, so it writes no events): every existing studio gets the starter
-- list as its default, and every existing job gets its studio's default, with the jobs' own triggers off (no
-- job.updated, updated_at unchanged; the 20261011050000 precedent).
select app.seed_price_list(s.id) from public.studios s where s.default_price_list_id is null;
alter table public.jobs disable trigger user;
update public.jobs j set price_list_id = s.default_price_list_id
from public.studios s where s.id = j.studio_id and j.price_list_id is null;
alter table public.jobs enable trigger user;

alter table public.jobs alter column price_list_id set not null;
-- `no action`, not `restrict` (amends ADR 0008): deleting a studio cascades to both its jobs and its lists, and
-- `restrict` is checked per row in the middle of that cascade. A list a job uses can't be deleted on its own.
alter table public.jobs add constraint jobs_price_list_fk foreign key (studio_id, price_list_id)
  references public.price_lists (studio_id, id);
create index jobs_studio_price_list_idx on public.jobs (studio_id, price_list_id);
grant insert (price_list_id, deliver_to_school) on public.jobs to authenticated;
grant update (price_list_id, deliver_to_school) on public.jobs to authenticated;

-- New studios get the starter list (inside studio creation, so pg_trigger_depth() > 1 for its rows: no events).
create function app.on_studio_created_seed_price_list() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.seed_price_list(new.id);
  return new;
end;
$$;
create trigger studios_seed_price_list after insert on public.studios
for each row execute function app.on_studio_created_seed_price_list();

-- New jobs get the studio's default list unless one is given (answer 1).
create function app.default_job_price_list() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.price_list_id is null then
    new.price_list_id := (select s.default_price_list_id from public.studios s where s.id = new.studio_id);
  end if;
  return new;
end;
$$;
create trigger jobs_default_price_list before insert on public.jobs
for each row execute function app.default_job_price_list();

-- A closed job's price list and delivery never change (call 4); draft and selling jobs may change both, which affects
-- new orders only (answer 5). Same error as app.assert_job_open.
create function app.guard_job_shop_open() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'closed'
     and (new.price_list_id is distinct from old.price_list_id or new.deliver_to_school is distinct from old.deliver_to_school) then
    raise exception 'job_closed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger jobs_guard_shop_open before update of price_list_id, deliver_to_school on public.jobs
for each row execute function app.guard_job_shop_open();

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
      case when new.price_list_id is distinct from old.price_list_id then 'price_list_id' end,
      case when new.deliver_to_school is distinct from old.deliver_to_school then 'deliver_to_school' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;

-- ── Events (D96) ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Ids, kinds and changed field names only. Rows written inside another trigger (the starter list) write none, nor do
-- rows deleted along with their parent (a studio's lists, a list's items, a package's lines): the parent is already
-- gone when they go. A person's own change also ticks "Review your price list".
create function app.on_price_list_change() returns trigger
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
    perform app.emit(new.studio_id, 'price_list.created', new.id, '{}'::jsonb);
  elsif tg_op = 'UPDATE' then
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.home_shipping_cents is distinct from old.home_shipping_cents then 'home_shipping_cents' end], null);
    if cardinality(v_fields) = 0 then
      return new;
    end if;
    perform app.emit(new.studio_id, 'price_list.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
  elsif exists (select 1 from public.studios s where s.id = old.studio_id) then
    perform app.emit(old.studio_id, 'price_list.deleted', old.id, '{}'::jsonb);
  else
    return old;
  end if;
  perform app.mark_price_list_reviewed(coalesce(new.studio_id, old.studio_id));
  return coalesce(new, old);
end;
$$;
create trigger price_lists_events after insert or update or delete on public.price_lists
for each row execute function app.on_price_list_change();

-- A position change alone writes nothing here: reordering writes one price_list.reordered.
create function app.on_price_list_item_change() returns trigger
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
    perform app.emit(new.studio_id, 'price_list_item.created', new.id,
      jsonb_build_object('price_list_id', new.price_list_id, 'kind', new.kind));
  elsif tg_op = 'UPDATE' then
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.description is distinct from old.description then 'description' end,
      case when new.print_size is distinct from old.print_size then 'print_size' end,
      case when new.price_cents is distinct from old.price_cents then 'price_cents' end], null);
    if cardinality(v_fields) = 0 then
      return new;
    end if;
    perform app.emit(new.studio_id, 'price_list_item.updated', new.id,
      jsonb_build_object('price_list_id', new.price_list_id, 'fields', to_jsonb(v_fields)));
  elsif exists (select 1 from public.price_lists l where l.id = old.price_list_id) then
    perform app.emit(old.studio_id, 'price_list_item.deleted', old.id,
      jsonb_build_object('price_list_id', old.price_list_id, 'kind', old.kind));
  else
    return old;
  end if;
  perform app.mark_price_list_reviewed(coalesce(new.studio_id, old.studio_id));
  return coalesce(new, old);
end;
$$;
create trigger price_list_items_events after insert or update or delete on public.price_list_items
for each row execute function app.on_price_list_item_change();

-- Package contents: one price_list_item.updated {fields: ["contents"]} per package per transaction, however many
-- lines change; none for a package created in the same transaction (its price_list_item.created covers it).
create function app.on_package_line_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_line public.price_list_package_lines := coalesce(new, old);
begin
  if pg_trigger_depth() > 1
     or not exists (select 1 from public.price_list_items i where i.id = v_line.package_item_id) then
    return v_line;
  end if;
  if not exists (select 1 from public.price_list_items i
                 where i.id = v_line.package_item_id and i.created_at = now())
     and not exists (select 1 from public.events e
                     where e.studio_id = v_line.studio_id and e.subject_id = v_line.package_item_id
                       and e.occurred_at = now() and e.type = 'price_list_item.updated'
                       and e.data -> 'fields' ? 'contents') then
    perform app.emit(v_line.studio_id, 'price_list_item.updated', v_line.package_item_id,
      jsonb_build_object('price_list_id', v_line.price_list_id, 'fields', jsonb_build_array('contents')));
  end if;
  perform app.mark_price_list_reviewed(v_line.studio_id);
  return v_line;
end;
$$;
create trigger price_list_package_lines_events after insert or delete on public.price_list_package_lines
for each row execute function app.on_package_line_change();

-- price_list.made_default: the studio's default changed (not the first one, set when the studio is created).
create function app.on_default_price_list_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.emit(new.id, 'price_list.made_default', new.default_price_list_id);
  return new;
end;
$$;
create trigger studios_default_price_list_event after update of default_price_list_id on public.studios
for each row when (old.default_price_list_id is not null
  and new.default_price_list_id is distinct from old.default_price_list_id)
execute function app.on_default_price_list_change();

-- ── Functions the API calls (SECURITY INVOKER unless noted: row-level security applies) ────────────────────────────
-- Save one item and, for a package, replace its contents, in one transaction. p_item_id null adds an item (with
-- p_item.kind); otherwise the item is updated in place, so its id stays stable for orders (step 10). p_lines null
-- keeps a package's contents. Named errors carry no values: not_found (P0002), package_empty, item_limit.
create function public.save_price_list_item(p_price_list_id uuid, p_item_id uuid, p_item jsonb, p_lines jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_studio uuid := (select l.studio_id from public.price_lists l where l.id = p_price_list_id);
  v_kind public.price_item_kind;
  v_id uuid;
begin
  if v_studio is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_item_id is null then
    insert into public.price_list_items (studio_id, price_list_id, kind, name, description, print_size, price_cents,
      position)
    values (v_studio, p_price_list_id, (p_item ->> 'kind')::public.price_item_kind, p_item ->> 'name',
      p_item ->> 'description', (p_item ->> 'print_size')::public.print_size, (p_item ->> 'price_cents')::bigint,
      least(coalesce((select max(i.position) + 1 from public.price_list_items i
                      where i.price_list_id = p_price_list_id and i.studio_id = v_studio), 1), 10000))
    returning id, kind into v_id, v_kind;
  else
    update public.price_list_items i set
      name = coalesce(p_item ->> 'name', i.name),
      description = case when p_item ? 'description' then p_item ->> 'description' else i.description end,
      print_size = case when p_item ? 'print_size' then (p_item ->> 'print_size')::public.print_size
                   else i.print_size end,
      price_cents = coalesce((p_item ->> 'price_cents')::bigint, i.price_cents)
    where i.id = p_item_id and i.price_list_id = p_price_list_id and i.studio_id = v_studio
    returning i.id, i.kind into v_id, v_kind;
    if v_id is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  if v_kind = 'package' and p_lines is not null then
    if jsonb_array_length(p_lines) = 0 then
      raise exception 'package_empty' using errcode = 'P0001';
    end if;
    delete from public.price_list_package_lines l where l.package_item_id = v_id and l.studio_id = v_studio;
    insert into public.price_list_package_lines (studio_id, price_list_id, package_item_id, line_kind, print_size,
      quantity, position)
    select v_studio, p_price_list_id, v_id, e.value ->> 'kind', (e.value ->> 'print_size')::public.print_size,
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

-- A copy of one of the studio's lists under a new name: settings, items (in order) and package contents. Each copied
-- row writes its own event, like any other change (only the starter list is folded into studio.created).
create function public.copy_price_list(p_source_id uuid, p_name text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_source public.price_lists := (select l from public.price_lists l where l.id = p_source_id);
  v_list uuid;
  v_item public.price_list_items;
  v_new uuid;
begin
  if v_source.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.price_lists (studio_id, name, home_shipping_cents)
  values (v_source.studio_id, btrim(p_name), v_source.home_shipping_cents)
  returning id into v_list;
  for v_item in
    select * from public.price_list_items i
    where i.price_list_id = v_source.id and i.studio_id = v_source.studio_id
    order by i.position, i.id
  loop
    insert into public.price_list_items (studio_id, price_list_id, kind, name, description, print_size, price_cents,
      position)
    values (v_source.studio_id, v_list, v_item.kind, v_item.name, v_item.description, v_item.print_size,
      v_item.price_cents, v_item.position)
    returning id into v_new;
    insert into public.price_list_package_lines (studio_id, price_list_id, package_item_id, line_kind, print_size,
      quantity, position)
    select v_source.studio_id, v_list, v_new, l.line_kind, l.print_size, l.quantity, l.position
    from public.price_list_package_lines l
    where l.package_item_id = v_item.id and l.studio_id = v_source.studio_id
    order by l.position, l.id;
  end loop;
  return v_list;
end;
$$;

-- Put a list's items in this order. p_item_ids must be exactly the list's items, each once (else 22023, no values).
-- SECURITY DEFINER so it can write the one price_list.reordered event; it checks the caller is an owner or admin of
-- the list's studio itself, and touches that list's rows only.
create function public.set_price_list_item_order(p_price_list_id uuid, p_item_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select l.studio_id from public.price_lists l where l.id = p_price_list_id);
  v_changed bigint;
begin
  if v_studio is null or not app.is_member(v_studio) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_role(v_studio, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_item_ids), 0) <> (select count(distinct x) from unnest(p_item_ids) x)
     or (select array_agg(i.id order by i.id) from public.price_list_items i
         where i.price_list_id = p_price_list_id and i.studio_id = v_studio)
        is distinct from (select array_agg(x order by x) from unnest(p_item_ids) x) then
    raise exception 'order_mismatch' using errcode = '22023';
  end if;
  update public.price_list_items i set position = o.ordinality
  from unnest(p_item_ids) with ordinality o (id, ordinality)
  where i.id = o.id and i.price_list_id = p_price_list_id and i.studio_id = v_studio
    and i.position is distinct from o.ordinality::int;
  -- The same order again (or an empty list) changes nothing: no event, and it doesn't count as a review.
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return;
  end if;
  perform app.emit(v_studio, 'price_list.reordered', p_price_list_id, '{}'::jsonb);
  perform app.mark_price_list_reviewed(v_studio);
end;
$$;

-- Every list of a studio with what the screens show: item counts by group, how many jobs use it and how many of those
-- are selling (the "live" note, answer 5). p_price_list_id narrows it to one list. Row-level security applies; the
-- explicit studio filter makes the scope plain to read.
create function public.price_list_summaries(p_studio_id uuid, p_price_list_id uuid default null)
returns table (id uuid, name text, currency text, is_default boolean, packages int, prints int, digitals int,
  jobs int, selling_jobs int, updated_at timestamptz)
language sql stable
set search_path = ''
as $$
  select l.id, l.name, l.currency::text, l.id = s.default_price_list_id,
    coalesce(i.packages, 0), coalesce(i.prints, 0), coalesce(i.digitals, 0),
    coalesce(j.jobs, 0), coalesce(j.selling, 0), l.updated_at
  from public.price_lists l
  join public.studios s on s.id = l.studio_id
  left join (
    select it.price_list_id,
      count(*) filter (where it.kind = 'package')::int as packages,
      count(*) filter (where it.kind = 'print')::int as prints,
      count(*) filter (where it.kind in ('digital_single', 'digital_all'))::int as digitals
    from public.price_list_items it where it.studio_id = p_studio_id group by it.price_list_id
  ) i on i.price_list_id = l.id
  left join (
    select jb.price_list_id, count(*)::int as jobs, count(*) filter (where jb.status = 'selling')::int as selling
    from public.jobs jb where jb.studio_id = p_studio_id group by jb.price_list_id
  ) j on j.price_list_id = l.id
  where l.studio_id = p_studio_id and (p_price_list_id is null or l.id = p_price_list_id)
  order by l.id = s.default_price_list_id desc, lower(l.name), l.id;
$$;

revoke all on function app.guard_price_list(), app.guard_price_list_item(), app.guard_package_line(),
  app.check_package_has_lines(), app.guard_studio_price_list_review(), app.mark_price_list_reviewed(uuid), app.starter_price_list(),
  app.seed_price_list(uuid), app.on_studio_created_seed_price_list(), app.default_job_price_list(),
  app.guard_job_shop_open(), app.on_price_list_change(), app.on_price_list_item_change(),
  app.on_package_line_change(), app.on_default_price_list_change() from public;
revoke all on function public.save_price_list_item(uuid, uuid, jsonb, jsonb), public.copy_price_list(uuid, text),
  public.set_price_list_item_order(uuid, uuid[]), public.price_list_summaries(uuid, uuid) from public, anon;
grant execute on function public.save_price_list_item(uuid, uuid, jsonb, jsonb), public.copy_price_list(uuid, text),
  public.set_price_list_item_order(uuid, uuid[]), public.price_list_summaries(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
