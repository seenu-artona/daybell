-- Phase 1, step 9: the parent gallery (D24, D60, D116, D119, F17, D113, D96; Seenu's answers 1–4 and Claude's calls
-- 1–13 of Oct 12, 2026, every call for Seenu to review; ADR 0022, amending ADR 0015 and 0021). A forward migration:
-- 20261012600000 is merged.
--
-- A parent types a child's access code and sees that child's photos straight away (D24): no account. The code opens a
-- shop session, kept by this regional database (D113) and named by a random token in an httpOnly cookie; the database
-- stores only the token's SHA-256. A session belongs to one studio and holds up to 5 of that studio's children (call 1)
-- for 30 days from the first code (answer 3, call 11), with a bag of what the parent picked. One device may hold a
-- session for each of up to 3 studios (code review S6): a code from a studio the device already has adds to that
-- session; another studio's opens a session of its own. Codes are looked up by their existing HMAC only (ADR 0011),
-- after a lockout check (answer 2, call 4; security review H1 and M3) so a locked caller learns nothing.
--
-- Everything here is used only by the API, as the service role, through the SECURITY DEFINER functions below: browsers
-- (signed in or not) can read or run none of it. Sessions, attempts and the bag are the parent's own state, not a
-- studio's change: they write no events (call 10, the notifications precedent of ADR 0021). No names, codes or IP
-- addresses are stored: codes only as their HMAC (on children, as before), devices and networks only as HMACs.

create type public.shop_shipping_method as enum ('home', 'school');

-- Lets a bag line reference an item together with its kind, so the line's kind is always the item's (an item's kind
-- never changes: app.guard_price_list_item).
alter table public.price_list_items
  add constraint price_list_items_studio_list_id_kind_key unique (studio_id, price_list_id, id, kind);

-- ── Shop sessions ─────────────────────────────────────────────────────────────────────────────────────────────────
create table public.shop_sessions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  -- SHA-256 (hex) of the cookie's 32-byte random token. The token itself is never stored.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  -- Fixed at 30 days from the first code; adding a sibling never extends it (call 11).
  expires_at timestamptz not null default now() + interval '30 days',
  -- Null until the parent chooses (and when the bag needs no delivery).
  shipping_method public.shop_shipping_method,
  constraint shop_sessions_token_hash_key unique (token_hash),
  constraint shop_sessions_studio_id_id_key unique (studio_id, id),
  constraint shop_sessions_expiry check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index shop_sessions_studio_idx on public.shop_sessions (studio_id);
create index shop_sessions_expires_idx on public.shop_sessions (expires_at);
comment on table public.shop_sessions is
  'A parent''s device in one studio''s shop for 30 days (ADR 0022). Token SHA-256 only. Service role only.';

-- The children a session shows: the first code's child and up to 4 siblings of the same studio (call 1).
create table public.shop_session_children (
  session_id uuid not null,
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  child_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (session_id, child_id),
  constraint shop_session_children_session_fk foreign key (studio_id, session_id)
    references public.shop_sessions (studio_id, id) on delete cascade,
  -- Cascade: children are removed only while their job is a draft.
  constraint shop_session_children_child_fk foreign key (studio_id, job_id, child_id)
    references public.children (studio_id, job_id, id) on delete cascade,
  -- Lets a bag line reference its child together with the session, studio and job.
  constraint shop_session_children_line_key unique (session_id, child_id, studio_id, job_id)
);
create index shop_session_children_studio_idx on public.shop_session_children (studio_id);
create index shop_session_children_child_idx on public.shop_session_children (child_id, added_at);
comment on table public.shop_session_children is 'The children a shop session shows (at most 5). Service role only.';

-- At most 5 children per session (call 1), whoever writes: the session's row is locked first, so two siblings added at
-- the same moment can't both pass.
create function app.guard_shop_session_child() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform 1 from public.shop_sessions s where s.id = new.session_id and s.studio_id = new.studio_id for update;
  if (select count(*) from public.shop_session_children c
      where c.session_id = new.session_id and c.studio_id = new.studio_id) >= 5 then
    raise exception 'sibling_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger shop_session_children_guard before insert on public.shop_session_children
for each row execute function app.guard_shop_session_child();

-- ── The bag ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- Item ids, pose ids and quantities only: never a price. Prices are read from the job's current list every time
-- (server-priced), so step 10 can snapshot the bag into an order exactly as ADR 0019 describes.
create table public.shop_cart_lines (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  session_id uuid not null,
  child_id uuid not null,
  job_id uuid not null,
  price_list_id uuid not null,
  item_id uuid not null,
  kind public.price_item_kind not null,
  -- The pose: a parent-visible portrait of the child. None for "all digitals".
  photo_id uuid,
  quantity integer not null check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  constraint shop_cart_lines_child_fk foreign key (session_id, child_id, studio_id, job_id)
    references public.shop_session_children (session_id, child_id, studio_id, job_id) on delete cascade,
  -- An item deleted from its list leaves no line.
  constraint shop_cart_lines_item_fk foreign key (studio_id, price_list_id, item_id, kind)
    references public.price_list_items (studio_id, price_list_id, id, kind) on delete cascade,
  -- MATCH SIMPLE: "all digitals" has no pose. A photo purged from the bin leaves no line.
  constraint shop_cart_lines_photo_fk foreign key (studio_id, job_id, photo_id)
    references public.photos (studio_id, job_id, id) on delete cascade,
  constraint shop_cart_lines_pose check ((kind = 'digital_all') = (photo_id is null)),
  constraint shop_cart_lines_digital_one check (kind not in ('digital_single', 'digital_all') or quantity = 1)
);
-- Adding the same thing again raises the quantity instead of making a second line.
create unique index shop_cart_lines_same_key on public.shop_cart_lines
  (session_id, child_id, item_id, coalesce(photo_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index shop_cart_lines_studio_idx on public.shop_cart_lines (studio_id);
create index shop_cart_lines_item_idx on public.shop_cart_lines (item_id);
create index shop_cart_lines_photo_idx on public.shop_cart_lines (photo_id) where photo_id is not null;
comment on table public.shop_cart_lines is
  'A parent''s bag (ADR 0022): ids and quantities only, priced from the job''s current list on every read. Service role only.';

-- Service role only, like stripe_events: row-level security on, no policies, nothing granted to browsers.
alter table public.shop_sessions enable row level security;
alter table public.shop_session_children enable row level security;
alter table public.shop_cart_lines enable row level security;
revoke all on public.shop_sessions, public.shop_session_children, public.shop_cart_lines from anon, authenticated;

-- ── Wrong codes, new devices and request counts (answer 2, call 4; security review H1, M2, M3) ─────────────────────
-- In the app schema: never reachable through the Data API. A wrong guess belongs to no studio, so there is no
-- studio_id. key_hash is an HMAC made by the API (SHOP_THROTTLE_KEY), never an address or a device id. Kinds:
-- - device: a device the server issued (its signed cookie checked by the API), wherever it is: 5 wrong codes in 24
--   hours lock it for 15 minutes. known: it has opened a gallery (M3); locked_at: when it was last locked.
-- - nodevice: the one shared bucket of a network's requests without such a device: 5, like a device.
-- - net (an IPv4 address or an IPv6 /64), wide (IPv4 /24, IPv6 /56), wider (IPv6 /48): 30, 100 and 300 wrong codes in
--   15 minutes lock the network for 15 minutes; a third of that while the breaker is tripped.
-- - issue_net, issue_wide, issue_wider: hits counts new devices issued per network in 24 hours (50, 200, 500).
-- - region: the circuit breaker, one row: 600 wrong codes in a minute across the region trip it for 15 minutes.
-- Rows are written only on a wrong code, a new device or a known device's right code: never on a locked or refused
-- request (M2). They go after 24 hours untouched (a known device's after 30 days; prune_shop).
create table app.shop_code_attempts (
  kind text not null check (kind in ('device', 'nodevice', 'net', 'wide', 'wider', 'issue_net', 'issue_wide',
    'issue_wider', 'region')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  -- Wrong codes in the window (issue_* rows: devices issued).
  hits integer not null default 0 check (hits between 0 and 1000000),
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  locked_at timestamptz,
  known boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (kind, key_hash)
);
comment on table app.shop_code_attempts is
  'Wrong access codes per device, network and region, and devices issued per network (HMACs only), for the lockout (ADR 0022).';
create index shop_code_attempts_updated_idx on app.shop_code_attempts (updated_at);

-- Shop requests per network per minute (Claude's call: 120), the stripe_call_budget pattern.
create table app.shop_rate (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null check (hits between 0 and 1000000)
);
comment on table app.shop_rate is 'Shop requests per network in the current minute (HMACs only; ADR 0022).';
create index shop_rate_window_idx on app.shop_rate (window_start);
revoke all on app.shop_code_attempts, app.shop_rate from public, anon, authenticated, service_role;

-- ── What parents may see ──────────────────────────────────────────────────────────────────────────────────────────
-- The set-based twin of public.photo_parent_visible (ADR 0018), for one child's portraits (p_child_id) and one class's
-- photo set (p_group_id) of a job: a ready photo, not in the bin, never a card photo nor a photo of another job's card,
-- one that may be a card only once a person placed or confirmed it, with a child or in a class photo set, not flagged,
-- in a batch whose tags are up to date. pgTAP 021 proves the two agree on every fixture photo. ord is the tagging
-- order (batch, capture time, filename, id); filenames never leave this function.
create function app.parent_visible_photos(p_job_id uuid, p_child_id uuid, p_group_id uuid)
returns table (id uuid, place public.photo_place, width integer, height integer, ord bigint)
language sql stable security definer
set search_path = ''
as $$
  select p.id, t.place, p.width, p.height,
    row_number() over (order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp),
                         p.original_filename collate "C", p.id)
  from public.photo_tags t
  join public.photos p on p.id = t.photo_id and p.studio_id = t.studio_id and p.job_id = t.job_id
  join public.upload_batches b on b.id = p.batch_id and b.studio_id = p.studio_id
  where t.job_id = p_job_id
    and ((t.place = 'child' and t.child_id = p_child_id) or (t.place = 'class_set' and t.group_id = p_group_id))
    and p.status = 'ready' and p.binned_at is null
    and p.qr_kind is distinct from 'card' and p.qr_kind is distinct from 'other_card'
    and (p.qr_kind = 'none' or t.source = 'manual')
    and t.flag is null
    and b.tag_round = b.tagged_round;
$$;

-- What a parent sees for a child (answer 4; calls 6 and 12):
-- - closed: the job isn't selling (a draft too: drafts are never revealed), or its closing date has passed even if the
--   cron hasn't run yet;
-- - unavailable: the child is marked Do not publish or Do not photograph, or has no portrait parents may see;
-- - open: the gallery.
create function app.shop_child_state(p_child_id uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when j.status <> 'selling' or j.closes_at <= now() then 'closed'
    when c.do_not_publish or c.do_not_photograph then 'unavailable'
    when not exists (select 1 from app.parent_visible_photos(c.job_id, c.id, null) v) then 'unavailable'
    else 'open'
  end
  from public.children c join public.jobs j on j.id = c.job_id and j.studio_id = c.studio_id
  where c.id = p_child_id;
$$;

-- Whether a bag line can still be bought (code review M2: one rule for the bag's totals, delivery and quantities):
-- its item is on the job's current list, its child's shop is open, and its pose (if any) is still one of the child's
-- visible portraits.
create function app.shop_line_available(p_line public.shop_cart_lines) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.jobs j
                 where j.id = p_line.job_id and j.studio_id = p_line.studio_id
                   and j.price_list_id = p_line.price_list_id)
    and app.shop_child_state(p_line.child_id) = 'open'
    and (p_line.photo_id is null or exists (
      select 1 from app.parent_visible_photos(p_line.job_id, p_line.child_id, null) p
      where p.id = p_line.photo_id and p.place = 'child'));
$$;

-- Whether a bag line needs delivery: a print, or a package holding prints.
create function app.shop_line_physical(p_line public.shop_cart_lines) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_line.kind = 'print' or (p_line.kind = 'package' and exists (
    select 1 from public.price_list_package_lines pk
    where pk.package_item_id = p_line.item_id and pk.studio_id = p_line.studio_id and pk.line_kind = 'print'));
$$;

-- ── Sessions ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- The session a cookie's token names while it lasts, optionally locked; session_required (P0001) otherwise, so a
-- missing, forged and expired cookie are the same.
create function app.shop_session_row(p_session_hash text, p_lock boolean default false)
returns public.shop_sessions
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions;
begin
  if p_lock then
    select * into v from public.shop_sessions s
    where s.token_hash = p_session_hash and s.expires_at > now() for update;
  else
    select * into v from public.shop_sessions s where s.token_hash = p_session_hash and s.expires_at > now();
  end if;
  if v.id is null then
    raise exception 'session_required' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- One of the session's children; a child of another session or studio is not found (P0002), exactly like a missing
-- one.
create function app.shop_session_child(p_session public.shop_sessions, p_child_id uuid)
returns public.children
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.children;
begin
  select c.* into v from public.shop_session_children sc
  join public.children c on c.id = sc.child_id and c.studio_id = sc.studio_id and c.job_id = sc.job_id
  where sc.session_id = p_session.id and sc.studio_id = p_session.studio_id and sc.child_id = p_child_id;
  if v.id is null then
    raise exception 'Child not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- A wrong code for one key (the caller holds its advisory lock): counts it, and locks the key for 15 minutes when the
-- count reaches p_limit in p_window. A lock that has run out, or (unlocked) a window that has passed, starts the count
-- again; a running lock is never extended or cleared (a known device's misses still count on a locked network, M3). A right code never resets the count, so one real code can't clear it between
-- guesses. Returns when the key is locked until, or null. (packages/core's lockoutStep is the same rule.)
create function app.shop_code_failed(p_kind text, p_key text, p_limit integer, p_window interval)
returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v app.shop_code_attempts;
  v_locking boolean := false;
begin
  select * into v from app.shop_code_attempts a where a.kind = p_kind and a.key_hash = p_key;
  if v.kind is null or v.locked_until <= now()
     or (v.locked_until is null and v.window_start + p_window <= now()) then
    v.hits := 0;
    v.window_start := now();
    v.locked_until := null;
  end if;
  v.hits := least(v.hits + 1, 1000000);
  if v.locked_until is null and v.hits >= p_limit then
    v.locked_until := now() + interval '15 minutes';
    v_locking := true;
  end if;
  insert into app.shop_code_attempts as a (kind, key_hash, hits, window_start, locked_until, locked_at, updated_at)
  values (p_kind, p_key, v.hits, v.window_start, v.locked_until, case when v_locking then now() end, now())
  on conflict (kind, key_hash) do update
  set hits = excluded.hits, window_start = excluded.window_start, locked_until = excluded.locked_until,
    locked_at = coalesce(excluded.locked_at, a.locked_at), updated_at = now();
  return v.locked_until;
end;
$$;

-- The region's circuit breaker (H1): every wrong code counts here; the 600th in a minute trips it for 15 minutes.
-- Returns true only on the wrong code that trips it, so the API logs one code-free alert.
create function app.shop_breaker_failed() returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into app.shop_code_attempts as a (kind, key_hash, hits, window_start)
  values ('region', repeat('0', 64), 1, now())
  on conflict (kind, key_hash) do update
  set hits = case when a.window_start + interval '1 minute' <= now() then 1 else least(a.hits + 1, 1000000) end,
    window_start = case when a.window_start + interval '1 minute' <= now() then now() else a.window_start end,
    updated_at = now()
  returning a.hits into v_hits;
  if v_hits = 600 then
    update app.shop_code_attempts a set locked_until = now() + interval '15 minutes', locked_at = now()
    where a.kind = 'region' and a.key_hash = repeat('0', 64);
    return true;
  end if;
  return false;
end;
$$;

-- A new device for a request that had none (H1): yes while the network has had fewer than 50 new devices in 24 hours
-- (its IPv4 /24 or IPv6 /56 fewer than 200, its IPv6 /48 fewer than 500), and counts it. Otherwise the request stays
-- in its network's shared no-device bucket.
create function app.shop_issue_device(p_net_key text, p_wide_key text, p_wider_key text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from app.shop_code_attempts a
             where (a.kind, a.key_hash) in (('issue_net', p_net_key), ('issue_wide', p_wide_key),
                                            ('issue_wider', p_wider_key))
               and a.window_start > now() - interval '24 hours'
               and a.hits >= case a.kind when 'issue_net' then 50 when 'issue_wide' then 200 else 500 end) then
    return false;
  end if;
  insert into app.shop_code_attempts as a (kind, key_hash, hits, window_start)
  select k.kind, k.key_hash, 1, now()
  from (values ('issue_net', p_net_key), ('issue_wide', p_wide_key), ('issue_wider', p_wider_key)) k (kind, key_hash)
  where k.key_hash is not null
  on conflict (kind, key_hash) do update
  set hits = case when a.window_start <= now() - interval '24 hours' then 1 else least(a.hits + 1, 1000000) end,
    window_start = case when a.window_start <= now() - interval '24 hours' then now() else a.window_start end,
    updated_at = now();
  return true;
end;
$$;

-- At most 10 sessions show a child (M2): the session just used (p_keep) and the 9 newest others; older ones go, with
-- their bags.
create function app.shop_trim_child_sessions(p_studio_id uuid, p_child_id uuid, p_keep uuid) returns void
language sql security definer
set search_path = ''
as $$
  delete from public.shop_sessions s
  where s.studio_id = p_studio_id and s.id in (
    select sc.session_id from public.shop_session_children sc
    where sc.child_id = p_child_id and sc.studio_id = p_studio_id and sc.session_id <> p_keep
    order by sc.added_at desc, sc.session_id desc
    offset 9);
$$;

-- A parent enters an access code (answers 1–3; calls 1, 4, 5; security review H1, M2, M3; code review S5, S6, N1).
-- The API sends HMACs only: the device (p_device_key, a device it issued and signed; or p_new_device_key, one it offers
-- when the request had none), the network (p_net_key: IPv4 address or IPv6 /64), the wider networks (p_wide_key: IPv4
-- /24 or IPv6 /56; p_wider_key: IPv6 /48, null for IPv4), the device's session hashes in this region (at most 3, one
-- per studio) and a new session's hash. In order:
-- 1. A device for a request without one, within the day's caps for its networks (never while the breaker is tripped).
-- 2. Every key's advisory lock, in one order, then any session row (N1): parallel guesses take turns, and the order is
--    the same for every call, so two tabs can't deadlock.
-- 3. The lock, before any lookup, so a locked caller learns nothing: the device's own bucket (or the network's shared
--    no-device bucket) and the networks'. A known device (one that has opened a gallery and hasn't been locked in 24
--    hours) keeps its own 5 tries while its network is locked (M3), unless the breaker is tripped.
-- 4. The code's HMAC among children only (never a blank card's code, call 5; never a card code). A miss (or a null
--    hash: a code of a region not set up here, or not a code at all) counts against the device's bucket, every network
--    and the region's breaker. A hit never resets a count.
-- 5. A hit: a session of the code's studio on this device gets the child (added, already, limit: 5 children); else a
--    new session (opened), while the device has fewer than 3 (gallery_limit).
-- Answers carry no codes or names: outcome, child_id, session_hash, live (the device's sessions here that still
-- last), retry_after, device_issued, and alert (this miss tripped the breaker).
create function public.shop_enter_code(p_code_hash text, p_device_key text, p_new_device_key text, p_net_key text,
  p_wide_key text, p_wider_key text, p_session_hashes text[], p_new_session_hash text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hashes text[] := coalesce(p_session_hashes, '{}');
  v_tripped boolean;
  v_device text := p_device_key;
  v_issued boolean := false;
  v_own_kind text;
  v_own_key text;
  v_known boolean := false;
  v_lock bigint;
  v_until timestamptz;
  v_network_until timestamptz;
  v_alert boolean;
  v_child public.children;
  v_session public.shop_sessions;
  v_live text[];
  v_result jsonb;
begin
  if coalesce(p_net_key, '') !~ '^[0-9a-f]{64}$' or coalesce(p_wide_key, '') !~ '^[0-9a-f]{64}$'
     or p_wider_key !~ '^[0-9a-f]{64}$' or p_device_key !~ '^[0-9a-f]{64}$'
     or p_new_device_key !~ '^[0-9a-f]{64}$' or p_code_hash !~ '^[0-9a-f]{64}$'
     or coalesce(p_new_session_hash, '') !~ '^[0-9a-f]{64}$'
     or cardinality(v_hashes) > 3
     or exists (select 1 from unnest(v_hashes) h where coalesce(h, '') !~ '^[0-9a-f]{64}$') then
    raise exception 'Send the keys and a session' using errcode = '22023';
  end if;

  v_tripped := exists (select 1 from app.shop_code_attempts a
                       where a.kind = 'region' and a.key_hash = repeat('0', 64) and a.locked_until > now());
  if v_device is null and p_new_device_key is not null and not v_tripped
     and app.shop_issue_device(p_net_key, p_wide_key, p_wider_key) then
    v_device := p_new_device_key;
    v_issued := true;
  end if;
  v_own_kind := case when v_device is null then 'nodevice' else 'device' end;
  v_own_key := coalesce(v_device, p_net_key);

  for v_lock in
    select distinct hashtextextended(k, 0) from unnest(array[v_own_kind || ':' || v_own_key, 'net:' || p_net_key,
      'wide:' || p_wide_key, 'wider:' || p_wider_key]) k where k is not null order by 1
  loop
    perform pg_advisory_xact_lock(v_lock);
  end loop;

  if v_device is not null and not v_tripped then
    select a.known and (a.locked_at is null or a.locked_at <= now() - interval '24 hours') into v_known
    from app.shop_code_attempts a where a.kind = 'device' and a.key_hash = v_device;
    v_known := coalesce(v_known, false);
  end if;
  select max(a.locked_until) into v_until from app.shop_code_attempts a
  where a.locked_until > now()
    and ((a.kind = v_own_kind and a.key_hash = v_own_key)
         or (not v_known and (a.kind, a.key_hash) in (('net', p_net_key), ('wide', p_wide_key),
                                                     ('wider', p_wider_key))));
  if v_until is not null then
    return jsonb_build_object('outcome', 'locked', 'device_issued', v_issued,
      'retry_after', greatest(ceil(extract(epoch from v_until - now()))::int, 1));
  end if;

  if p_code_hash is not null then
    select * into v_child from public.children c where c.access_code_hash = p_code_hash;
  end if;
  if v_child.id is null then
    v_until := app.shop_code_failed(v_own_kind, v_own_key, 5, interval '24 hours');
    v_network_until := greatest(
      app.shop_code_failed('net', p_net_key, case when v_tripped then 10 else 30 end, interval '15 minutes'),
      app.shop_code_failed('wide', p_wide_key, case when v_tripped then 30 else 100 end, interval '15 minutes'),
      case when p_wider_key is not null then
        app.shop_code_failed('wider', p_wider_key, case when v_tripped then 100 else 300 end, interval '15 minutes')
      end);
    v_alert := app.shop_breaker_failed();
    if not v_known then
      v_until := greatest(v_until, v_network_until);
    end if;
    if v_until is not null then
      return jsonb_build_object('outcome', 'locked', 'device_issued', v_issued, 'alert', v_alert,
        'retry_after', greatest(ceil(extract(epoch from v_until - now()))::int, 1));
    end if;
    return jsonb_build_object('outcome', 'not_found', 'device_issued', v_issued, 'alert', v_alert);
  end if;

  -- A device that opens a gallery is known: it keeps its own allowance on a locked network (M3).
  if v_device is not null then
    insert into app.shop_code_attempts as a (kind, key_hash, known) values ('device', v_device, true)
    on conflict (kind, key_hash) do update set known = true, updated_at = now();
  end if;

  select array_agg(s.token_hash order by s.created_at, s.id) into v_live from public.shop_sessions s
  where s.token_hash = any (v_hashes) and s.expires_at > now();
  v_live := coalesce(v_live, '{}');
  select * into v_session from public.shop_sessions s
  where s.token_hash = any (v_live) and s.studio_id = v_child.studio_id
  order by s.created_at desc, s.id limit 1
  for update;

  if v_session.id is not null then
    v_result := jsonb_build_object('child_id', v_child.id, 'session_hash', v_session.token_hash, 'live', v_live,
      'device_issued', v_issued);
    if exists (select 1 from public.shop_session_children sc
               where sc.session_id = v_session.id and sc.studio_id = v_session.studio_id
                 and sc.child_id = v_child.id) then
      return v_result || jsonb_build_object('outcome', 'already');
    end if;
    if (select count(*) from public.shop_session_children sc
        where sc.session_id = v_session.id and sc.studio_id = v_session.studio_id) >= 5 then
      return jsonb_build_object('outcome', 'limit', 'live', v_live, 'device_issued', v_issued);
    end if;
    insert into public.shop_session_children (session_id, studio_id, job_id, child_id)
    values (v_session.id, v_session.studio_id, v_child.job_id, v_child.id);
    perform app.shop_trim_child_sessions(v_child.studio_id, v_child.id, v_session.id);
    return v_result || jsonb_build_object('outcome', 'added');
  end if;

  if cardinality(v_live) >= 3 then
    return jsonb_build_object('outcome', 'gallery_limit', 'live', v_live, 'device_issued', v_issued);
  end if;
  insert into public.shop_sessions (studio_id, token_hash) values (v_child.studio_id, p_new_session_hash)
  returning * into v_session;
  insert into public.shop_session_children (session_id, studio_id, job_id, child_id)
  values (v_session.id, v_child.studio_id, v_child.job_id, v_child.id);
  perform app.shop_trim_child_sessions(v_child.studio_id, v_child.id, v_session.id);
  return jsonb_build_object('outcome', 'opened', 'child_id', v_child.id, 'session_hash', v_session.token_hash,
    'live', v_live || v_session.token_hash, 'device_issued', v_issued);
end;
$$;

-- The session: its studio's name, when it ends, the delivery chosen, how many things are in the bag, and each child.
-- A child whose shop is open: first name and last initial only (call 2), the job, the school (the client's name, else
-- the job's), picture day, the closing date, whether the job delivers to school. A closed, draft or unavailable child:
-- the id and state only (security review M1: a stale card never reveals a name, a school or a date).
create function public.shop_session(p_session_hash text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
begin
  return jsonb_build_object(
    'studio_name', (select s.name from public.studios s where s.id = v.studio_id),
    'expires_at', v.expires_at,
    'shipping_method', v.shipping_method,
    'bag_count', (select coalesce(sum(l.quantity), 0) from public.shop_cart_lines l
                  where l.session_id = v.id and l.studio_id = v.studio_id),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'state', st.state) || case when st.state = 'open' then
          jsonb_build_object('first_name', c.first_name, 'last_initial', upper(left(c.last_name, 1)), 'job_id', j.id,
            'school', coalesce(cl.name, j.name), 'picture_day', j.picture_day, 'closes_at', j.closes_at,
            'deliver_to_school', j.deliver_to_school)
          else '{}'::jsonb end
        order by sc.added_at, c.id)
      from public.shop_session_children sc
      join public.children c on c.id = sc.child_id and c.studio_id = sc.studio_id and c.job_id = sc.job_id
      join public.jobs j on j.id = c.job_id and j.studio_id = c.studio_id
      left join public.clients cl on cl.id = j.client_id and cl.studio_id = j.studio_id
      cross join lateral (select app.shop_child_state(c.id) as state) st
      where sc.session_id = v.id and sc.studio_id = v.studio_id), '[]'::jsonb));
end;
$$;

-- A child's gallery: their portraits and their own class's photo set, in tagging order, each with its size; ids only
-- (the API signs the watermarked previews). Only the state unless it is open. Class photos only for a child in a class.
create function public.shop_gallery(p_session_hash text, p_child_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_child public.children := app.shop_session_child(v, p_child_id);
  v_state text := app.shop_child_state(v_child.id);
begin
  if v_state <> 'open' then
    return jsonb_build_object('state', v_state);
  end if;
  return jsonb_build_object('state', v_state, 'studio_id', v.studio_id, 'job_id', v_child.job_id,
    'portraits', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'width', x.width, 'height', x.height) order by x.ord)
      from (select * from app.parent_visible_photos(v_child.job_id, v_child.id, null) p
            where p.place = 'child' order by p.ord limit 500) x), '[]'::jsonb),
    'class_photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'width', x.width, 'height', x.height) order by x.ord)
      from (select * from app.parent_visible_photos(v_child.job_id, null, v_child.group_id) p
            where p.place = 'class_set' and v_child.group_id is not null order by p.ord limit 500) x), '[]'::jsonb));
end;
$$;

-- What a child's job sells now: the job's current list (currency, home shipping fee) and its items in order with
-- package contents. Nothing unless the state is open.
create function public.shop_price_list(p_session_hash text, p_child_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_child public.children := app.shop_session_child(v, p_child_id);
  v_state text := app.shop_child_state(v_child.id);
begin
  if v_state <> 'open' then
    return jsonb_build_object('state', v_state);
  end if;
  return (
    select jsonb_build_object('state', v_state, 'currency', l.currency, 'home_shipping_cents', l.home_shipping_cents,
      'deliver_to_school', j.deliver_to_school,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'name', i.name, 'description', i.description, 'print_size', i.print_size,
            'price_cents', i.price_cents,
            'contents', coalesce((
              select jsonb_agg(jsonb_build_object('kind', pk.line_kind, 'print_size', pk.print_size,
                  'quantity', pk.quantity) order by pk.position, pk.id)
              from public.price_list_package_lines pk
              where pk.package_item_id = i.id and pk.studio_id = i.studio_id), '[]'::jsonb))
          order by i.position, i.id)
        from public.price_list_items i where i.price_list_id = l.id and i.studio_id = l.studio_id), '[]'::jsonb))
    from public.jobs j join public.price_lists l on l.id = j.price_list_id and l.studio_id = j.studio_id
    where j.id = v_child.job_id and j.studio_id = v.studio_id);
end;
$$;

-- The bag, priced now: each line with its item's current name, size and price, its pose's size, whether it needs
-- delivery (app.shop_line_physical) and whether it can still be bought (app.shop_line_available). Lines in the order
-- the children were added, then as added. Each job in the bag with its current home shipping fee and whether it
-- delivers to school; the studio's id (for the previews' keys) and currency (its region's, ADR 0006). The API totals it
-- (core cartTotals).
create function public.shop_cart(p_session_hash text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
begin
  return (
    with kids as (
      select sc.child_id, sc.job_id, sc.added_at
      from public.shop_session_children sc where sc.session_id = v.id and sc.studio_id = v.studio_id
    ), lines as (
      select l.*, k.added_at, i.name, i.print_size, i.price_cents, pl.currency, ph.width, ph.height,
        app.shop_line_physical(l) as physical, app.shop_line_available(l) as available
      from public.shop_cart_lines l
      join kids k on k.child_id = l.child_id
      join public.price_list_items i on i.id = l.item_id and i.studio_id = l.studio_id
      join public.price_lists pl on pl.id = l.price_list_id and pl.studio_id = l.studio_id
      left join public.photos ph on ph.id = l.photo_id and ph.studio_id = l.studio_id
      where l.session_id = v.id and l.studio_id = v.studio_id
    )
    select jsonb_build_object(
      'studio_id', v.studio_id,
      'currency', (select case s.data_region when 'us' then 'USD' else 'CAD' end
                   from public.studios s where s.id = v.studio_id),
      'shipping_method', v.shipping_method,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', x.id, 'child_id', x.child_id, 'job_id', x.job_id, 'item_id', x.item_id, 'kind', x.kind,
            'name', x.name, 'print_size', x.print_size, 'price_cents', x.price_cents, 'currency', x.currency,
            'quantity', x.quantity, 'photo_id', x.photo_id, 'width', x.width, 'height', x.height,
            'physical', x.physical, 'available', x.available)
          order by x.added_at, x.child_id, x.created_at, x.id)
        from lines x), '[]'::jsonb),
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object('job_id', j.id, 'deliver_to_school', j.deliver_to_school,
            'home_shipping_cents', pl.home_shipping_cents, 'currency', pl.currency) order by j.id)
        from public.jobs j join public.price_lists pl on pl.id = j.price_list_id and pl.studio_id = j.studio_id
        where j.studio_id = v.studio_id and j.id in (select x.job_id from lines x)), '[]'::jsonb)));
end;
$$;

-- Adds to the bag (calls 8 and 9; packages/core cartLineRules): the child must be the session's and their shop open
-- (shop_closed; photo_unavailable when they have no photos), the item on the job's current list (item_unavailable),
-- a pose for everything but "all digitals" and none for it (22023), the pose one of the child's own visible portraits
-- (photo_unavailable: never a class photo, call 8, nor another child's), digital downloads once (quantity 1). The same
-- item and pose again adds to its quantity (at most 99). At most 100 lines (bag_full). Returns the line's id.
create function public.shop_cart_add(p_session_hash text, p_child_id uuid, p_item_id uuid, p_photo_id uuid,
  p_quantity integer)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
  v_child public.children := app.shop_session_child(v, p_child_id);
  v_state text := app.shop_child_state(v_child.id);
  v_item public.price_list_items;
  v_id uuid;
begin
  if p_quantity is null or p_quantity not between 1 and 99 then
    raise exception 'A quantity is 1 to 99' using errcode = '22023';
  end if;
  if v_state = 'closed' then
    raise exception 'shop_closed' using errcode = 'P0001';
  elsif v_state <> 'open' then
    raise exception 'photo_unavailable' using errcode = 'P0001';
  end if;
  select i.* into v_item from public.price_list_items i
  join public.jobs j on j.price_list_id = i.price_list_id and j.studio_id = i.studio_id
  where i.id = p_item_id and j.id = v_child.job_id and i.studio_id = v.studio_id;
  if v_item.id is null then
    raise exception 'item_unavailable' using errcode = 'P0001';
  end if;
  if (v_item.kind = 'digital_all') <> (p_photo_id is null)
     or (v_item.kind in ('digital_single', 'digital_all') and p_quantity <> 1) then
    raise exception 'A pose for everything but all digitals; digital downloads once' using errcode = '22023';
  end if;
  if p_photo_id is not null and not exists (
    select 1 from app.parent_visible_photos(v_child.job_id, v_child.id, null) p
    where p.id = p_photo_id and p.place = 'child') then
    raise exception 'photo_unavailable' using errcode = 'P0001';
  end if;
  if (select count(*) from public.shop_cart_lines l where l.session_id = v.id and l.studio_id = v.studio_id) >= 100
     and not exists (select 1 from public.shop_cart_lines l
                     where l.session_id = v.id and l.studio_id = v.studio_id and l.child_id = v_child.id
                       and l.item_id = v_item.id and l.photo_id is not distinct from p_photo_id) then
    raise exception 'bag_full' using errcode = 'P0001';
  end if;
  insert into public.shop_cart_lines as l (studio_id, session_id, child_id, job_id, price_list_id, item_id, kind,
    photo_id, quantity)
  values (v.studio_id, v.id, v_child.id, v_child.job_id, v_item.price_list_id, v_item.id, v_item.kind, p_photo_id,
    p_quantity)
  on conflict (session_id, child_id, item_id, coalesce(photo_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set quantity = case when l.kind in ('digital_single', 'digital_all') then 1
                                else least(l.quantity + excluded.quantity, 99) end
  returning l.id into v_id;
  return v_id;
end;
$$;

-- Changes a line's quantity (1 to 99; a digital download stays 1), only while the line can still be bought (code
-- review N2): shop_closed (the child's shop is closed), item_unavailable (off the job's list) or photo_unavailable.
create function public.shop_cart_set_quantity(p_session_hash text, p_line_id uuid, p_quantity integer) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
  v_line public.shop_cart_lines;
begin
  select * into v_line from public.shop_cart_lines l
  where l.id = p_line_id and l.session_id = v.id and l.studio_id = v.studio_id;
  if v_line.id is null then
    raise exception 'Line not found' using errcode = 'P0002';
  end if;
  if p_quantity is null or p_quantity not between 1 and 99
     or (v_line.kind in ('digital_single', 'digital_all') and p_quantity <> 1) then
    raise exception 'A quantity is 1 to 99; a digital download once' using errcode = '22023';
  end if;
  if not app.shop_line_available(v_line) then
    if app.shop_child_state(v_line.child_id) = 'closed' then
      raise exception 'shop_closed' using errcode = 'P0001';
    elsif not exists (select 1 from public.jobs j where j.id = v_line.job_id and j.studio_id = v_line.studio_id
                        and j.price_list_id = v_line.price_list_id) then
      raise exception 'item_unavailable' using errcode = 'P0001';
    end if;
    raise exception 'photo_unavailable' using errcode = 'P0001';
  end if;
  update public.shop_cart_lines l set quantity = p_quantity where l.id = v_line.id and l.studio_id = v.studio_id;
end;
$$;

-- Removes a line from the bag, whatever the shop's state.
create function public.shop_cart_remove(p_session_hash text, p_line_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
begin
  delete from public.shop_cart_lines l where l.id = p_line_id and l.session_id = v.id and l.studio_id = v.studio_id;
  if not found then
    raise exception 'Line not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Chooses delivery (call 9), looking only at lines that can still be bought (code review M2, the same rule as the bag's
-- totals): home always; school only when something needs delivery and every job with something to deliver delivers
-- to school (school_delivery_off otherwise).
create function public.shop_set_shipping(p_session_hash text, p_method public.shop_shipping_method) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
begin
  if p_method is null then
    raise exception 'Choose home or school' using errcode = '22023';
  end if;
  if p_method = 'school' and (
    not exists (select 1 from public.shop_cart_lines l
                where l.session_id = v.id and l.studio_id = v.studio_id
                  and app.shop_line_physical(l) and app.shop_line_available(l))
    or exists (select 1 from public.shop_cart_lines l
               join public.jobs j on j.id = l.job_id and j.studio_id = l.studio_id
               where l.session_id = v.id and l.studio_id = v.studio_id and not j.deliver_to_school
                 and app.shop_line_physical(l) and app.shop_line_available(l))) then
    raise exception 'school_delivery_off' using errcode = 'P0001';
  end if;
  update public.shop_sessions s set shipping_method = p_method where s.id = v.id and s.studio_id = v.studio_id;
end;
$$;

-- "Forget this device" (answer 3, call 11): the session, its children and its bag go. Any session, expired or not.
create function public.shop_forget(p_session_hash text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(p_session_hash, '') !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  delete from public.shop_sessions s where s.token_hash = p_session_hash;
  return found;
end;
$$;

-- Counts one shop request for a network in the current minute; false once p_limit is used up (the API answers 429).
create function public.take_shop_request(p_ip_key text, p_limit integer) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_limit is null or p_limit not between 1 and 10000 or coalesce(p_ip_key, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'A key and a limit of 1 to 10000' using errcode = '22023';
  end if;
  insert into app.shop_rate as r (key_hash, window_start, hits)
  values (p_ip_key, date_trunc('minute', now()), 1)
  on conflict (key_hash) do update
  set hits = case when r.window_start = excluded.window_start then least(r.hits + 1, 1000000) else 1 end,
    window_start = excluded.window_start
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- The jobs cron's tidy-up, one page: up to p_limit expired sessions (with their children and bags), up to p_limit
-- counts untouched for 24 hours and no longer locked (a known device's after 30 days), and up to p_limit request
-- counts over an hour old. Returns how many rows went; the cron calls it again while that is at least p_limit (M2).
create function public.prune_shop(p_limit integer) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sessions integer;
  v_attempts integer;
  v_rate integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  delete from public.shop_sessions s
  where s.id in (select x.id from public.shop_sessions x where x.expires_at <= now() limit p_limit);
  get diagnostics v_sessions = row_count;
  delete from app.shop_code_attempts a
  where (a.kind, a.key_hash) in (
    select x.kind, x.key_hash from app.shop_code_attempts x
    where x.updated_at < now() - interval '24 hours' and (x.locked_until is null or x.locked_until <= now())
      and (not x.known or x.updated_at < now() - interval '30 days')
    limit p_limit);
  get diagnostics v_attempts = row_count;
  delete from app.shop_rate r
  where r.key_hash in (select x.key_hash from app.shop_rate x
                       where x.window_start < now() - interval '1 hour' limit p_limit);
  get diagnostics v_rate = row_count;
  return v_sessions + v_attempts + v_rate;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.guard_shop_session_child(), app.parent_visible_photos(uuid, uuid, uuid),
  app.shop_child_state(uuid), app.shop_line_available(public.shop_cart_lines),
  app.shop_line_physical(public.shop_cart_lines), app.shop_session_row(text, boolean),
  app.shop_session_child(public.shop_sessions, uuid), app.shop_code_failed(text, text, integer, interval),
  app.shop_breaker_failed(), app.shop_issue_device(text, text, text),
  app.shop_trim_child_sessions(uuid, uuid, uuid)
  from public, anon, authenticated;
-- The parent shop's work: the service role only (the /api/v1/shop routes), never browsers.
revoke all on function
  public.shop_enter_code(text, text, text, text, text, text, text[], text),
  public.shop_session(text),
  public.shop_gallery(text, uuid),
  public.shop_price_list(text, uuid),
  public.shop_cart(text),
  public.shop_cart_add(text, uuid, uuid, uuid, integer),
  public.shop_cart_set_quantity(text, uuid, integer),
  public.shop_cart_remove(text, uuid),
  public.shop_set_shipping(text, public.shop_shipping_method),
  public.shop_forget(text),
  public.take_shop_request(text, integer),
  public.prune_shop(integer)
  from public, anon, authenticated;
grant execute on function
  public.shop_enter_code(text, text, text, text, text, text, text[], text),
  public.shop_session(text),
  public.shop_gallery(text, uuid),
  public.shop_price_list(text, uuid),
  public.shop_cart(text),
  public.shop_cart_add(text, uuid, uuid, uuid, integer),
  public.shop_cart_set_quantity(text, uuid, integer),
  public.shop_cart_remove(text, uuid),
  public.shop_set_shipping(text, public.shop_shipping_method),
  public.shop_forget(text),
  public.take_shop_request(text, integer),
  public.prune_shop(integer)
  to service_role;

notify pgrst, 'reload schema';
