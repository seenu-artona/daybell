-- DRM in the parent shop's large view (D158; ADR 0034). A forward migration. Each ready photo of a Canadian studio may
-- be packaged once more by the image worker: its watermarked proof.webp as a 2-second, one-key, cbcs-encrypted clip
-- stored beside it (drm.mp4 and its manifests, ids-only keys). The content key never reaches the database: the worker
-- asks KMS (ca-central-1) for a data key and reports only the key wrapped by KMS, kept here in app.photo_drm_keys,
-- which nobody but these functions reads. The API unwraps it per license token, in memory (ADR 0034).
--
-- No events (C5; ADR 0016's exception for the worker's results, ADR 0022 call 10 for parents' actions): packaging and
-- tokens are machine work and a parent's own viewing. The switch's history is kept in platform_settings_changes.

-- ── The photo's DRM state ─────────────────────────────────────────────────────────────────────────────────────────
-- requested: a packaging task is queued (drm_attempt names it); ready: drm_key_id's clip is stored; failed: given up
-- for good (the shop keeps the WebP). Null: never asked (the daily cron backfills, C8). drm_attempt only grows, so a
-- late result of an earlier request is ignored; drm_requests counts the queue messages of the current request (the cron
-- re-queues after an hour, 3 in all).
create type public.photo_drm_status as enum ('requested', 'ready', 'failed');

alter table public.photos
  add column drm_status public.photo_drm_status,
  add column drm_key_id uuid,
  add column drm_attempt integer not null default 0 check (drm_attempt >= 0),
  add column drm_requested_at timestamptz,
  add column drm_requests smallint not null default 0 check (drm_requests between 0 and 100),
  add constraint photos_drm_key_id_key unique (drm_key_id),
  add constraint photos_drm_ready check (coalesce(drm_status = 'ready', false) = (drm_key_id is not null)),
  add constraint photos_drm_requested check (drm_status is null or drm_requested_at is not null);
-- The cron's two queries: requests without an answer, and photos never asked (never a card photo: those are never
-- packaged, so the backfill's index leaves them out rather than reading past them every day; review #13).
create index photos_drm_requested_idx on public.photos (drm_requested_at) where drm_status = 'requested';
create index photos_drm_backfill_idx on public.photos (created_at)
  where drm_status is null and status = 'ready' and binned_at is null
    and qr_kind is distinct from 'card' and qr_kind is distinct from 'other_card';
-- Browsers keep reading the columns granted in 20261011100000 only: none of these.

-- ── Wrapped keys ──────────────────────────────────────────────────────────────────────────────────────────────────
-- One content key per photo (B2), wrapped by KMS with the encryption context {studio, photo, key}: useless without
-- kms:Decrypt on the DRM key, which only the shop's DRM role has (B4). Never the plaintext. Goes with its photo (a purge
-- deletes the row); a new round of processing or packaging replaces it.
create table app.photo_drm_keys (
  studio_id uuid not null,
  job_id uuid not null,
  photo_id uuid primary key,
  key_id uuid not null unique,
  -- KMS's CiphertextBlob for 16 bytes (about 180 bytes).
  wrapped_key bytea not null check (octet_length(wrapped_key) between 16 and 1024),
  kms_key_arn text not null check (kms_key_arn ~ '^arn:aws:kms:ca-central-1:[0-9]{12}:key/[0-9a-f-]{36}$'),
  -- The photo's processing round the clip was made from (its proof.webp).
  photo_attempt integer not null check (photo_attempt >= 1),
  width integer not null check (width between 2 and 4096 and width % 2 = 0),
  height integer not null check (height between 2 and 4096 and height % 2 = 0),
  bytes bigint not null check (bytes between 1 and 52428800),
  created_at timestamptz not null default now(),
  constraint photo_drm_keys_photo_fk foreign key (studio_id, job_id, photo_id)
    references public.photos (studio_id, job_id, id) on delete cascade
);
create index photo_drm_keys_studio_idx on app.photo_drm_keys (studio_id);
comment on table app.photo_drm_keys is
  'Each photo''s DRM content key, wrapped by KMS (never plaintext). Read only by shop_drm_key, for a token (ADR 0034).';
alter table app.photo_drm_keys enable row level security;
revoke all on app.photo_drm_keys from public, anon, authenticated, service_role;

-- ── Token counts (C3) ─────────────────────────────────────────────────────────────────────────────────────────────
-- Per shop session: at most 60 tokens a minute and 1,500 a day (UTC), counted here so every Vercel instance shares
-- them. Goes with the session; prune_shop drops days that are over.
create table app.shop_drm_rate (
  session_id uuid primary key,
  studio_id uuid not null,
  minute_start timestamptz not null,
  minute_hits integer not null check (minute_hits >= 0),
  day_start timestamptz not null,
  day_hits integer not null check (day_hits >= 0),
  constraint shop_drm_rate_session_fk foreign key (studio_id, session_id)
    references public.shop_sessions (studio_id, id) on delete cascade
);
create index shop_drm_rate_studio_idx on app.shop_drm_rate (studio_id);
create index shop_drm_rate_day_idx on app.shop_drm_rate (day_start);
alter table app.shop_drm_rate enable row level security;
revoke all on app.shop_drm_rate from public, anon, authenticated, service_role;

-- ── The kill switch (B3, C6) and the studios it covers ──────────────────────────────────────────────────────────
-- Off by default; only the database owner turns it on (set_shop_drm, from the SQL editor), never the API. A missing
-- settings row also means off. shop_drm_studio_ids narrows it to some studios (null = every studio): staging can be
-- switched on for Seenu's own test studio alone to run the device matrix (review M1/M2).
alter table app.platform_settings add column shop_drm_enabled boolean not null default false;
alter table app.platform_settings add column shop_drm_studio_ids uuid[]
  check (shop_drm_studio_ids is null or cardinality(shop_drm_studio_ids) between 1 and 100);
alter table app.platform_settings_changes drop constraint platform_settings_changes_setting_check;
alter table app.platform_settings_changes add constraint platform_settings_changes_setting_check
  check (setting in ('daybell_fee_bps', 'card_fee_recovery', 'shop_drm_enabled', 'shop_drm_studio_ids'));

-- Whether the switch is on at all (any studio).
create function public.shop_drm_enabled() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select s.shop_drm_enabled from app.platform_settings s), false);
$$;

-- Whether the switch is on for one studio: on, and the studio listed (or no list).
create function app.shop_drm_on_for(p_studio_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select s.shop_drm_enabled and (s.shop_drm_studio_ids is null or p_studio_id = any (s.shop_drm_studio_ids))
                   from app.platform_settings s), false);
$$;

-- For GET /shop/drm: whether the switch is on for the studio of a live session (false for anything else).
create function public.shop_drm_enabled_for(p_session_hash text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select app.shop_drm_on_for(x.studio_id) from public.shop_sessions x
                   where x.token_hash = p_session_hash and x.expires_at > now()), false);
$$;

-- p_studio_ids: null = every studio; otherwise only these (1 to 100, each a studio of this database). Each change is
-- kept with the note: the switch, and the list when it changes.
create function public.set_shop_drm(p_enabled boolean, p_note text, p_studio_ids uuid[] default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v record;
begin
  if p_enabled is null then
    raise exception 'Say on or off' using errcode = '22023';
  end if;
  if p_studio_ids is not null and (cardinality(p_studio_ids) not between 1 and 100 or array_position(p_studio_ids, null) is not null
     or (select count(*) from public.studios s where s.id = any (p_studio_ids))
        <> (select count(distinct x) from unnest(p_studio_ids) x)) then
    raise exception 'List 1 to 100 studios of this database, or none for every studio' using errcode = '22023';
  end if;
  perform app.check_settings_note(p_note);
  select s.shop_drm_enabled as enabled, s.shop_drm_studio_ids as studio_ids into v
  from app.platform_settings s for update;
  if not found then
    raise exception 'platform_settings_missing' using errcode = 'P0001';
  end if;
  insert into app.platform_settings_changes (setting, old_value, new_value, note)
  values ('shop_drm_enabled', v.enabled::text, p_enabled::text, p_note);
  if v.studio_ids is distinct from p_studio_ids then
    insert into app.platform_settings_changes (setting, old_value, new_value, note)
    values ('shop_drm_studio_ids', coalesce(v.studio_ids::text, 'all'), coalesce(p_studio_ids::text, 'all'), p_note);
  end if;
  update app.platform_settings s
  set shop_drm_enabled = p_enabled, shop_drm_studio_ids = p_studio_ids, updated_at = now() where s.id;
end;
$$;

-- ── Packaging requests (B6) ───────────────────────────────────────────────────────────────────────────────────────
-- A photo parents could be shown: ready, not in the bin or being purged, never a card photo; of a Canadian studio
-- (photos and keys stay in ca-central-1, D113).
create function app.photo_drm_eligible(p public.photos) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p.status = 'ready' and p.binned_at is null and p.purge_started_at is null
    and p.qr_kind is distinct from 'card' and p.qr_kind is distinct from 'other_card'
    and exists (select 1 from public.studios s where s.id = p.studio_id and s.data_region = 'ca');
$$;

-- Asks for a photo's clip (after a new ready result, or a backfill): drops any earlier key and starts a new request.
-- Returns its attempt (the worker reports for it), or null when the photo can't be packaged.
create function public.photo_drm_requested(p_photo_id uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  update public.photos p
  set drm_status = 'requested', drm_key_id = null, drm_attempt = p.drm_attempt + 1, drm_requested_at = now(),
    drm_requests = 1
  where p.id = p_photo_id and app.photo_drm_eligible(p)
  returning p.drm_attempt into v_attempt;
  if v_attempt is not null then
    delete from app.photo_drm_keys k where k.photo_id = p_photo_id;
  end if;
  return v_attempt;
end;
$$;

-- The worker's clip for one request (p_attempt): its key ID, KMS's wrapped key and the clip's facts. Ignored (false)
-- unless the photo is still waiting for that very request and can still be shown: a late or replayed result changes
-- nothing. Checked here so a bad value is refused without values in the error.
create function public.record_photo_drm_result(p_photo_id uuid, p_attempt integer, p_key_id uuid,
  p_wrapped_key bytea, p_kms_key_arn text, p_width integer, p_height integer, p_bytes bigint)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.photos;
begin
  if p_attempt is null or p_attempt < 1
     or coalesce(p_key_id::text, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(octet_length(p_wrapped_key), 0) not between 16 and 1024
     or coalesce(p_kms_key_arn, '') !~ '^arn:aws:kms:ca-central-1:[0-9]{12}:key/[0-9a-f-]{36}$'
     or coalesce(p_width, 0) not between 2 and 4096 or p_width % 2 <> 0
     or coalesce(p_height, 0) not between 2 and 4096 or p_height % 2 <> 0
     or coalesce(p_bytes, 0) not between 1 and 52428800 then
    raise exception 'A clip has a key, its wrapped key, a KMS key in ca-central-1 and its size' using errcode = '22023';
  end if;
  select * into v from public.photos p where p.id = p_photo_id for update;
  if v.id is null or v.drm_status is distinct from 'requested' or v.drm_attempt <> p_attempt
     or not app.photo_drm_eligible(v) then
    return false;
  end if;
  insert into app.photo_drm_keys as k (studio_id, job_id, photo_id, key_id, wrapped_key, kms_key_arn, photo_attempt,
    width, height, bytes)
  values (v.studio_id, v.job_id, v.id, p_key_id, p_wrapped_key, p_kms_key_arn, v.attempt, p_width, p_height, p_bytes)
  on conflict (photo_id) do update
  set key_id = excluded.key_id, wrapped_key = excluded.wrapped_key, kms_key_arn = excluded.kms_key_arn,
    photo_attempt = excluded.photo_attempt, width = excluded.width, height = excluded.height, bytes = excluded.bytes,
    created_at = now();
  update public.photos p set drm_status = 'ready', drm_key_id = p_key_id where p.id = v.id;
  return true;
end;
$$;

-- The worker gave up for good on one request (no proof, unreadable, too large): the shop keeps the WebP.
create function public.record_photo_drm_failed(p_photo_id uuid, p_attempt integer) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_attempt is null or p_attempt < 1 then
    raise exception 'Send the attempt' using errcode = '22023';
  end if;
  update public.photos p set drm_status = 'failed'
  where p.id = p_photo_id and p.drm_status = 'requested' and p.drm_attempt = p_attempt;
  return found;
end;
$$;

-- The daily cron's work, at most p_limit photos (C8: 2,000) in this order: requests unanswered for an hour that were
-- already queued 3 times become failed ('failed', for the cron's drm_unavailable log line); other unanswered requests
-- are queued again ('retry', same attempt); then photos never asked are requested ('backfill'). Locked rows are
-- skipped, so two runs never take the same photo. Rows are marked before their messages are sent (a worker that read
-- the photo first would skip it); the cron undoes the mark of any message it couldn't send (photos_drm_unsent), so
-- drm_requests counts only real sends (review #12). Only a Canadian database packages (D113).
create function public.photos_drm_due(p_limit integer)
returns table (id uuid, studio_id uuid, job_id uuid, outcome text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_left integer := least(greatest(coalesce(p_limit, 0), 0), 2000);
  v_count integer;
begin
  if (select c.value from app.config c where c.key = 'data_region') is distinct from 'ca' then
    return;
  end if;
  return query
  with due as (
    select x.id from public.photos x
    where x.drm_status = 'requested' and x.drm_requested_at < now() - interval '60 minutes' and x.drm_requests >= 3
    order by x.drm_requested_at limit v_left for update skip locked
  )
  update public.photos p set drm_status = 'failed' from due where p.id = due.id
  returning p.id, p.studio_id, p.job_id, 'failed'::text;
  get diagnostics v_count = row_count;
  v_left := v_left - v_count;

  return query
  with due as (
    select x.id from public.photos x
    where x.drm_status = 'requested' and x.drm_requested_at < now() - interval '60 minutes' and x.drm_requests < 3
      and app.photo_drm_eligible(x)
    order by x.drm_requested_at limit v_left for update skip locked
  )
  update public.photos p set drm_requests = p.drm_requests + 1, drm_requested_at = now() from due where p.id = due.id
  returning p.id, p.studio_id, p.job_id, 'retry'::text;
  get diagnostics v_count = row_count;
  v_left := v_left - v_count;

  return query
  with due as (
    select x.id from public.photos x
    where x.drm_status is null and x.status = 'ready' and x.binned_at is null and app.photo_drm_eligible(x)
    order by x.created_at limit v_left for update skip locked
  )
  update public.photos p
  set drm_status = 'requested', drm_key_id = null, drm_attempt = p.drm_attempt + 1, drm_requested_at = now(),
    drm_requests = 1
  from due where p.id = due.id
  returning p.id, p.studio_id, p.job_id, 'backfill'::text;
end;
$$;

-- The messages the cron couldn't send: their marks undone, so a retry counts only real sends, and a backfill that never
-- left goes back to "never asked" (the next daily run takes it again).
create function public.photos_drm_unsent(p_photo_ids uuid[]) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(cardinality(p_photo_ids), 0) > 2000 then
    raise exception 'At most 2000 photos' using errcode = '22023';
  end if;
  update public.photos p
  set drm_requests = greatest(p.drm_requests - 1, 0),
    drm_status = case when p.drm_requests <= 1 then null else p.drm_status end,
    drm_requested_at = case when p.drm_requests <= 1 then null else p.drm_requested_at end
  where p.id = any (coalesce(p_photo_ids, '{}')) and p.drm_status = 'requested';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── The image worker's read, with the photo's DRM request ─────────────────────────────────────────────────────────
-- photo_for_worker as in 20261011100000, plus drm_status and drm_attempt for packaging tasks.
create or replace function public.photo_for_worker(p_photo_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'studio_id', p.studio_id, 'job_id', p.job_id, 'status', p.status,
    'sha256', encode(p.sha256, 'hex'), 'byte_size', p.byte_size, 'attempt', p.attempt, 'studio_name', s.name,
    'drm_status', p.drm_status, 'drm_attempt', p.drm_attempt)
  from public.photos p join public.studios s on s.id = p.studio_id
  where p.id = p_photo_id;
$$;

-- ── A new round of processing makes the clip stale ────────────────────────────────────────────────────────────────
-- record_photo_result as in 20261012100000, and a recorded result also drops the photo's clip and key: its proofs are
-- remade, so the API requests packaging again (reprocessing resets DRM).
create or replace function public.record_photo_result(p_photo_id uuid, p_attempt int, p_result jsonb) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ready boolean := p_result ->> 'status' = 'ready';
  v_qr jsonb := case when jsonb_typeof(p_result -> 'qr') = 'object' then p_result -> 'qr' end;
  v_kind text;
  v_card uuid;
begin
  if jsonb_typeof(p_result) is distinct from 'object' or p_result ->> 'status' not in ('ready', 'failed')
     or p_attempt is null
     or (v_ready and (coalesce(p_result ->> 'width', '') !~ '^[1-9][0-9]{0,5}$'
                      or coalesce(p_result ->> 'height', '') !~ '^[1-9][0-9]{0,5}$'
                      or (p_result ->> 'captured_at' is not null
                          and p_result ->> 'captured_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$')))
     or (not v_ready and coalesce(p_result ->> 'failure_reason', '')
                         not in ('not_jpeg', 'too_large', 'hash_mismatch', 'unreadable'))
     -- qr only, and always, for ready photos; a card has a code.
     or (not v_ready and coalesce(jsonb_typeof(p_result -> 'qr'), 'null') <> 'null')
     or (v_ready and (v_qr is null
                      or coalesce(v_qr ->> 'kind', '') not in ('none', 'card', 'unreadable')
                      or (v_qr ->> 'kind' = 'card') <> (v_qr ->> 'card_code' is not null)
                      or v_qr ->> 'card_code' !~ '^[0-9A-HJKMNP-TV-Z]{20}$')) then
    raise exception 'A result is ready (with a size) or failed' using errcode = '22023';
  end if;
  if v_qr is not null then
    v_kind := v_qr ->> 'kind';
    if v_kind = 'card' then
      select q.id into v_card from public.qr_cards q join public.photos p
        on p.id = p_photo_id and q.studio_id = p.studio_id and q.job_id = p.job_id
      where q.card_code = v_qr ->> 'card_code';
      if v_card is null then
        v_kind := 'other_card';
      end if;
    end if;
  end if;
  update public.photos p
  set status = (p_result ->> 'status')::public.photo_status,
    width = case when v_ready then (p_result ->> 'width')::int end,
    height = case when v_ready then (p_result ->> 'height')::int end,
    captured_at = case when v_ready then (p_result ->> 'captured_at')::timestamp end,
    failure_reason = case when not v_ready then p_result ->> 'failure_reason' end,
    qr_kind = v_kind,
    qr_card_id = v_card,
    processed_at = now(),
    drm_status = null,
    drm_key_id = null
  where p.id = p_photo_id and p.status = 'processing' and p.attempt = p_attempt;
  if not found then
    return false;
  end if;
  delete from app.photo_drm_keys k where k.photo_id = p_photo_id;
  return true;
end;
$$;

-- ── The parent shop ───────────────────────────────────────────────────────────────────────────────────────────────
-- A large view's entitlement, in this order (ADR 0034): a live session holding the child (else session_required, or
-- not found), the child's shop open, the photo one the child's parent may see (their portraits and their groups'
-- photos: app.parent_visible_photos), then a Canadian studio (region_unavailable), the switch on and the clip ready
-- (drm_unavailable). Anything a parent may not see is "not found", exactly like a photo that doesn't exist.
create function app.shop_drm_photo_row(p_session_hash text, p_child_id uuid, p_photo_id uuid)
returns public.photos
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_child public.children := app.shop_session_child(v, p_child_id);
  v_photo public.photos;
begin
  if app.shop_child_state(v_child.id) <> 'open'
     or not exists (select 1 from app.parent_visible_photos(v_child.job_id, v_child.id, true) x
                    where x.id = p_photo_id) then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  select * into v_photo from public.photos p
  where p.id = p_photo_id and p.studio_id = v.studio_id and p.job_id = v_child.job_id;
  if v_photo.id is null then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.studios s where s.id = v.studio_id and s.data_region = 'ca') then
    raise exception 'region_unavailable' using errcode = 'P0001';
  end if;
  if not app.shop_drm_on_for(v.studio_id) or v_photo.drm_status is distinct from 'ready' then
    raise exception 'drm_unavailable' using errcode = 'P0001';
  end if;
  return v_photo;
end;
$$;

-- Where a large view's clip is: for the manifest route, which signs drm.mp4. No key.
create function public.shop_drm_photo(p_session_hash text, p_child_id uuid, p_photo_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.photos := app.shop_drm_photo_row(p_session_hash, p_child_id, p_photo_id);
begin
  -- The key ID names the clip's files (drm/{key}.*): only the files the database's key encrypted are ever served.
  return jsonb_build_object('studio_id', v.studio_id, 'job_id', v.job_id, 'photo_id', v.id, 'key_id', v.drm_key_id);
end;
$$;

-- A large view's wrapped key, for one license token: the entitlement above, then the session's token budget (C3: 60 a
-- minute, 1,500 a UTC day; over it, {rate_limited, retry_after} in seconds and nothing counted). The key is still
-- wrapped by KMS; the API unwraps it with the encryption context {studio, photo, key}.
create function public.shop_drm_key(p_session_hash text, p_child_id uuid, p_photo_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_photo public.photos := app.shop_drm_photo_row(p_session_hash, p_child_id, p_photo_id);
  v_session uuid := (select s.id from public.shop_sessions s where s.token_hash = p_session_hash);
  v_minute timestamptz := date_trunc('minute', now());
  v_day timestamptz := date_trunc('day', now(), 'UTC');
  v_rate app.shop_drm_rate;
  v_key app.photo_drm_keys;
begin
  insert into app.shop_drm_rate as r (session_id, studio_id, minute_start, minute_hits, day_start, day_hits)
  values (v_session, v_photo.studio_id, v_minute, 0, v_day, 0)
  on conflict (session_id) do nothing;
  select * into v_rate from app.shop_drm_rate r where r.session_id = v_session for update;
  if v_rate.day_start = v_day and v_rate.day_hits >= 1500 then
    return jsonb_build_object('rate_limited', true,
      'retry_after', greatest(1, ceil(extract(epoch from v_day + interval '1 day' - now())))::integer);
  end if;
  if v_rate.minute_start = v_minute and v_rate.minute_hits >= 60 then
    return jsonb_build_object('rate_limited', true,
      'retry_after', greatest(1, ceil(extract(epoch from v_minute + interval '1 minute' - now())))::integer);
  end if;
  update app.shop_drm_rate r
  set minute_hits = case when r.minute_start = v_minute then r.minute_hits + 1 else 1 end,
    minute_start = v_minute,
    day_hits = case when r.day_start = v_day then r.day_hits + 1 else 1 end,
    day_start = v_day
  where r.session_id = v_session;
  select * into v_key from app.photo_drm_keys k
  where k.photo_id = v_photo.id and k.studio_id = v_photo.studio_id and k.key_id = v_photo.drm_key_id;
  if v_key.photo_id is null then
    raise exception 'drm_unavailable' using errcode = 'P0001';
  end if;
  return jsonb_build_object('studio_id', v_key.studio_id, 'photo_id', v_key.photo_id, 'key_id', v_key.key_id,
    'wrapped_key', encode(v_key.wrapped_key, 'base64'), 'kms_key_arn', v_key.kms_key_arn);
end;
$$;

-- A child's gallery as in 20261016000000, each photo saying whether its large view is protected (drm): the switch on,
-- a Canadian studio and the clip ready. Otherwise the viewer shows the watermarked WebP, as before.
create or replace function public.shop_gallery(p_session_hash text, p_child_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_child public.children := app.shop_session_child(v, p_child_id);
  v_state text := app.shop_child_state(v_child.id);
  v_drm boolean := app.shop_drm_on_for(v.studio_id)
    and exists (select 1 from public.studios s where s.id = v.studio_id and s.data_region = 'ca');
begin
  if v_state <> 'open' then
    return jsonb_build_object('state', v_state);
  end if;
  return jsonb_build_object('state', v_state, 'studio_id', v.studio_id, 'job_id', v_child.job_id,
    'portraits', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'width', x.width, 'height', x.height,
        'drm', v_drm and ph.drm_status is not distinct from 'ready') order by x.ord)
      from (select * from app.parent_visible_photos(v_child.job_id, v_child.id, false) p
            where p.place = 'child' order by p.ord limit 500) x
      join public.photos ph on ph.id = x.id and ph.studio_id = v.studio_id), '[]'::jsonb),
    'group_photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'width', x.width, 'height', x.height,
        'drm', v_drm and ph.drm_status is not distinct from 'ready') order by x.ord)
      from (select * from app.parent_visible_photos(v_child.job_id, v_child.id, true) p
            where p.place = 'group_photo' order by p.ord limit 500) x
      join public.photos ph on ph.id = x.id and ph.studio_id = v.studio_id), '[]'::jsonb));
end;
$$;

-- prune_shop as in 20261012700000, and token counts whose day is over.
create or replace function public.prune_shop(p_limit integer) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sessions integer;
  v_attempts integer;
  v_rate integer;
  v_drm integer;
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
  delete from app.shop_drm_rate r
  where r.session_id in (select x.session_id from app.shop_drm_rate x
                         where x.day_start < now() - interval '1 day' limit p_limit);
  get diagnostics v_drm = row_count;
  return v_sessions + v_attempts + v_rate + v_drm;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.photo_drm_eligible(public.photos), app.shop_drm_photo_row(text, uuid, uuid),
  app.shop_drm_on_for(uuid)
  from public, anon, authenticated;
revoke all on function
  public.shop_drm_enabled(),
  public.shop_drm_enabled_for(text),
  public.set_shop_drm(boolean, text, uuid[]),
  public.photos_drm_unsent(uuid[]),
  public.photo_drm_requested(uuid),
  public.record_photo_drm_result(uuid, integer, uuid, bytea, text, integer, integer, bigint),
  public.record_photo_drm_failed(uuid, integer),
  public.photos_drm_due(integer),
  public.shop_drm_photo(text, uuid, uuid),
  public.shop_drm_key(text, uuid, uuid)
  from public, anon, authenticated;
-- The switch: the database owner only, from the SQL editor (like set_platform_fee): no bug in the API can turn it.
revoke all on function public.set_shop_drm(boolean, text, uuid[]) from service_role;
-- The worker's results and the cron (signed internal routes), and parents (the /api/v1/shop routes): the service role.
grant execute on function
  public.shop_drm_enabled(),
  public.shop_drm_enabled_for(text),
  public.photos_drm_unsent(uuid[]),
  public.photo_drm_requested(uuid),
  public.record_photo_drm_result(uuid, integer, uuid, bytea, text, integer, integer, bigint),
  public.record_photo_drm_failed(uuid, integer),
  public.photos_drm_due(integer),
  public.shop_drm_photo(text, uuid, uuid),
  public.shop_drm_key(text, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
