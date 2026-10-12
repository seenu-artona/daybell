-- Phase 1, step 4: photo storage and upload (D39, D53, D60, D85, D96, D100, D113, D141, D142, F9, F10; Seenu's
-- answers of Oct 11, 2026; ADR 0016). A forward migration: 20261011090000 is deployed. upload_batches and photos are
-- new.
-- Originals and previews live in object storage under keys made of IDs only ({studio}/{job}/{photo}/…). A photo's
-- original filename is kept here and nowhere else: never in keys, URLs, events or logs.

create type public.photo_status as enum ('uploading', 'processing', 'ready', 'failed');

-- ── Upload batches ────────────────────────────────────────────────────────────────────────────────────────────────
-- One drop of photos (a folder or a selection), and nothing more: a batch has no meaning such as a class (brief). seq
-- orders batches by when they started, for tagging (D142 answer 7: batch, then capture time, then filename); UUIDs
-- don't sort by time.
create table public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  -- No foreign key, as on events: erasing a person must never be blocked by their uploads.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Files the same job already had (same content), skipped and counted (Seenu, answer 5).
  duplicates_skipped int not null default 0 check (duplicates_skipped >= 0),
  -- Files the browser left out (not JPEG, empty, over 50 MB), reported when the batch finishes.
  files_skipped int not null default 0 check (files_skipped >= 0),
  constraint upload_batches_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete restrict,
  -- Lets a photo reference its batch together with the batch's studio, job and order.
  constraint upload_batches_photo_key unique (studio_id, job_id, id, seq)
);
create index upload_batches_studio_idx on public.upload_batches (studio_id);
create index upload_batches_job_idx on public.upload_batches (job_id, seq);
create index upload_batches_open_idx on public.upload_batches (created_at) where finished_at is null;
comment on table public.upload_batches is
  'One drop of photos into a job. Counts only; it means nothing more (no class or folder name is kept).';

-- ── Photos ────────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  batch_id uuid not null,
  batch_seq bigint not null,
  status public.photo_status not null default 'uploading',
  -- The file's own name, without folders. Personal data at times ("Maya Johnson.jpg"): kept here only.
  original_filename text not null check (
    char_length(original_filename) between 1 and 255 and original_filename !~ '[[:cntrl:]/\\]'),
  byte_size bigint not null check (byte_size between 1 and 52428800),
  -- SHA-256 of the file, hashed in the browser and checked by the image worker; duplicates are found by it.
  sha256 bytea not null check (octet_length(sha256) = 32),
  -- The storage multipart upload's id while uploading. Never readable by browsers.
  upload_id text check (char_length(upload_id) between 1 and 1024),
  -- Filled in by the image worker.
  width int check (width > 0),
  height int check (height > 0),
  -- EXIF DateTimeOriginal with SubSecTimeOriginal, as the camera's clock wrote it (no zone), so bursts keep order.
  captured_at timestamp,
  failure_reason text check (failure_reason in ('not_jpeg', 'too_large', 'hash_mismatch', 'unreadable', 'incomplete')),
  -- The bin (Seenu, answer 7): binned photos are deleted for good after 30 days.
  binned_at timestamptz,
  binned_by uuid,
  -- Set when a photo is first sold (Phase 3). A sold photo can't be binned (Seenu, answer 7).
  sold_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint photos_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete restrict,
  -- A photo's batch is in the photo's own studio and job, and batch_seq is that batch's.
  constraint photos_batch_fk foreign key (studio_id, job_id, batch_id, batch_seq)
    references public.upload_batches (studio_id, job_id, id, seq) on delete restrict,
  constraint photos_failure_reason check ((status = 'failed') = (failure_reason is not null)),
  constraint photos_bin check ((binned_at is null) = (binned_by is null)),
  constraint photos_upload_id check (upload_id is null or status = 'uploading')
);
comment on table public.photos is
  'Photos of a job. Objects live in storage under ID-only keys; original_filename is kept only here (never in keys, URLs, events or logs).';

create trigger photos_touch before update on public.photos
for each row execute function app.touch_updated_at();

-- The same file twice in a job is a duplicate (Seenu, answer 5), in the bin too. A failed upload doesn't count, so the
-- same file can be uploaded again.
create unique index photos_job_sha256_key on public.photos (job_id, sha256) where status <> 'failed';
-- Tagging order (D142 answers 5 and 7): batch, then capture time (untimed photos last), then filename byte by byte,
-- then id. coalesce makes the order a plain row comparison, for keyset pages.
create index photos_tagging_order_idx on public.photos
  (job_id, batch_seq, coalesce(captured_at, 'infinity'::timestamp), original_filename collate "C", id)
  where binned_at is null;
create index photos_bin_idx on public.photos (binned_at) where binned_at is not null;
create index photos_unfinished_idx on public.photos (status, created_at) where status in ('uploading', 'processing');
create index photos_batch_idx on public.photos (batch_id);
create index photos_studio_idx on public.photos (studio_id);

-- ── Row-level security ────────────────────────────────────────────────────────────────────────────────────────────
-- Everyone on the team sees the job's photos. Nobody signed in writes: uploads, the bin and results go through the
-- functions below, run by the API as the service role after checking the person (ADR 0016).
alter table public.upload_batches enable row level security;
alter table public.photos enable row level security;
create policy "members read their studio's upload batches" on public.upload_batches
  for select to authenticated using (app.is_member(studio_id));
create policy "members read their studio's photos" on public.photos
  for select to authenticated using (app.is_member(studio_id));
revoke all on public.upload_batches, public.photos from anon, authenticated;
grant select on public.upload_batches to authenticated;
-- Every column but upload_id.
grant select (id, studio_id, job_id, batch_id, batch_seq, status, original_filename, byte_size, sha256, width, height,
  captured_at, failure_reason, binned_at, binned_by, sold_at, created_by, created_at, processed_at, updated_at)
  on public.photos to authenticated;

-- ── Events (D96; D142 answer 1) ───────────────────────────────────────────────────────────────────────────────────
-- One event per finished batch (photos.uploaded, written by the functions below) and one per bulk action on the bin:
-- photos.binned, photos.restored and photos.purged, with the photos' ids and a count, on the job. Upload progress and
-- the image worker's results write no events (D142 answer 1, an exception to ADR 0006 for Seenu to review): a
-- 50,000-photo job would otherwise write 150,000. Never filenames.
-- Transition tables have no statistics when the plan is cached, so the old/new join is kept to a hash join: a nested
-- loop would be quadratic for a statement that touches a whole job's photos.
create function app.on_photos_bin_change() returns trigger
language plpgsql security definer
set search_path = ''
set enable_nestloop = off
as $$
begin
  perform app.emit(c.studio_id, c.type, c.job_id, jsonb_build_object('photo_ids', c.ids, 'count', cardinality(c.ids)))
  from (
    select n.studio_id, n.job_id,
      case when o.binned_at is null then 'photos.binned' else 'photos.restored' end as type,
      array_agg(n.id order by n.id) as ids
    from new_rows n join old_rows o on o.id = n.id
    where (o.binned_at is null) <> (n.binned_at is null)
    group by 1, 2, 3
  ) c;
  return null;
end;
$$;

create function app.on_photos_purged() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Only binned photos are purged; dropping an upload that never finished is not an event (it never became a photo).
  perform app.emit(c.studio_id, 'photos.purged', c.job_id,
    jsonb_build_object('photo_ids', c.ids, 'count', cardinality(c.ids)))
  from (
    select o.studio_id, o.job_id, array_agg(o.id order by o.id) as ids
    from old_rows o
    -- Deleting a whole studio removes its photos too; there is no studio left to log against.
    where o.binned_at is not null and exists (select 1 from public.studios s where s.id = o.studio_id)
    group by 1, 2
  ) c;
  return null;
end;
$$;

create trigger photos_bin_events after update on public.photos
referencing old table as old_rows new table as new_rows
for each statement execute function app.on_photos_bin_change();
create trigger photos_purge_events after delete on public.photos
referencing old table as old_rows
for each statement execute function app.on_photos_purged();

-- ── Uploading ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Run only as the service role, by API routes that already checked the signed-in person; each acts for p_actor and
-- checks that person's role again (owners, admins and photographers; Seenu, answer 6), like add_child (ADR 0011).
-- Error messages carry no values.

-- Draft and selling jobs take photos; closed jobs don't (D142 answer 2).
create function app.assert_job_open(p_job_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select j.status from public.jobs j where j.id = p_job_id) = 'closed' then
    raise exception 'job_closed' using errcode = 'P0001';
  end if;
end;
$$;

create function public.create_upload_batch(p_actor uuid, p_job_id uuid) returns uuid
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
  perform app.assert_job_open(p_job_id);
  insert into public.upload_batches (studio_id, job_id, created_by) values (v_studio, p_job_id, p_actor)
  returning id into v_id;
  perform app.end_act_for(v_previous);
  return v_id;
end;
$$;

-- The batch, for the functions below: its studio and job, checked for the actor; refused once finished.
create function app.open_batch(p_actor uuid, p_batch_id uuid, out studio_id uuid, out job_id uuid, out seq bigint,
  out previous text)
language plpgsql security definer
set search_path = ''
as $$
begin
  select b.studio_id, b.job_id, b.seq into studio_id, job_id, seq
  from public.upload_batches b where b.id = p_batch_id and b.finished_at is null;
  if studio_id is null then
    if exists (select 1 from public.upload_batches b where b.id = p_batch_id) then
      raise exception 'batch_finished' using errcode = 'P0001';
    end if;
    raise exception 'Batch not found' using errcode = 'P0002';
  end if;
  previous := app.act_for(p_actor, studio_id);
  perform app.assert_job_open(job_id);
end;
$$;

-- Registers up to 500 files of a drop, before they are uploaded. Each answers:
-- - new: a photo was made; upload it (photo_id).
-- - resume: the same file is still uploading (from an earlier drop, a reload or another computer); carry on with that
--   photo (photo_id). Resuming is driven from here, not the browser (ADR 0016).
-- - duplicate / duplicate_in_bin: the job already has this file (Seenu, answer 5), counted on the batch.
-- Files are {name, size, sha256 (hex)}. A job holds at most 50,000 photos, the bin included (photo_limit). Drops into
-- the same job are registered one at a time, so a file can't become two photos.
create function public.register_photos(p_actor uuid, p_batch_id uuid, p_files jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch record;
  v_count int;
  v_new int;
  v_result jsonb;
begin
  select * into v_batch from app.open_batch(p_actor, p_batch_id);
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 500 then
    raise exception 'Send 1 to 500 files' using errcode = '22023';
  end if;
  -- As strict as the table's checks, so Postgres never refuses (and logs) a row holding a filename.
  if exists (
    select 1 from jsonb_array_elements(p_files) f
    where jsonb_typeof(f) is distinct from 'object'
      or coalesce(f ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
      or coalesce(f ->> 'size', '') !~ '^[0-9]{1,8}$'
      or (f ->> 'size')::bigint not between 1 and 52428800
      or jsonb_typeof(f -> 'name') is distinct from 'string'
      or char_length(f ->> 'name') not between 1 and 255
      or f ->> 'name' ~ '[[:cntrl:]/\\]') then
    raise exception 'Every file needs a name, a size and a SHA-256' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('photos:' || v_batch.job_id::text, 0));

  -- New files: the first of each hash in the request that the job doesn't have (failed uploads aside).
  select count(distinct f ->> 'sha256') into v_new
  from jsonb_array_elements(p_files) f
  where not exists (select 1 from public.photos p
                    where p.job_id = v_batch.job_id and p.sha256 = decode(f ->> 'sha256', 'hex')
                      and p.status <> 'failed');
  select count(*) into v_count from public.photos p where p.job_id = v_batch.job_id;
  if v_count + v_new > 50000 then
    raise exception 'photo_limit' using errcode = 'P0001';
  end if;

  with input as (
    select t.ord, t.f ->> 'name' as name, (t.f ->> 'size')::bigint as size, decode(t.f ->> 'sha256', 'hex') as sha,
      row_number() over (partition by t.f ->> 'sha256' order by t.ord) = 1 as first
    from jsonb_array_elements(p_files) with ordinality t (f, ord)
  ),
  -- At most one match per file: the job's unique (job_id, sha256) index covers every status but failed.
  planned as (
    select i.*, e.id as existing_id, e.status as existing_status, e.binned_at is not null as existing_binned,
      case when i.first and e.id is null then gen_random_uuid() end as new_id
    from input i
    left join public.photos e on e.job_id = v_batch.job_id and e.sha256 = i.sha and e.status <> 'failed'
  ),
  inserted as (
    insert into public.photos (id, studio_id, job_id, batch_id, batch_seq, original_filename, byte_size, sha256,
      created_by)
    select pl.new_id, v_batch.studio_id, v_batch.job_id, p_batch_id, v_batch.seq, pl.name, pl.size, pl.sha, p_actor
    from planned pl where pl.new_id is not null
    order by pl.ord
    returning 1
  )
  select jsonb_agg(jsonb_build_object(
      'index', pl.ord - 1,
      'outcome', o.outcome,
      'photo_id', case when o.outcome in ('new', 'resume') then coalesce(pl.new_id, pl.existing_id) end)
    order by pl.ord)
  into v_result
  from planned pl
  cross join lateral (select case
    when not pl.first then 'duplicate'
    when pl.new_id is not null then 'new'
    when pl.existing_status = 'uploading' then 'resume'
    when pl.existing_binned then 'duplicate_in_bin'
    else 'duplicate' end as outcome) o;

  update public.upload_batches b
  set duplicates_skipped = b.duplicates_skipped
    + (select count(*) from jsonb_array_elements(v_result) r where r ->> 'outcome' like 'duplicate%')
  where b.id = p_batch_id;

  perform app.end_act_for(v_batch.previous);
  return v_result;
end;
$$;

-- A photo still uploading, for the actor; the functions below share it.
create function app.uploading_photo(p_actor uuid, p_photo_id uuid, out studio_id uuid, out previous text)
language plpgsql security definer
set search_path = ''
as $$
begin
  select p.studio_id into studio_id from public.photos p where p.id = p_photo_id;
  if studio_id is null then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  previous := app.act_for(p_actor, studio_id);
  if (select p.status from public.photos p where p.id = p_photo_id) <> 'uploading' then
    raise exception 'not_uploading' using errcode = 'P0001';
  end if;
end;
$$;

-- Remembers the storage upload's id, only if the photo has none yet; returns the one kept. Two requests racing to
-- start the same upload agree on the first, and the API aborts the other's.
create function public.set_photo_upload_id(p_actor uuid, p_photo_id uuid, p_upload_id text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_photo record;
  v_kept text;
begin
  select * into v_photo from app.uploading_photo(p_actor, p_photo_id);
  update public.photos p set upload_id = p_upload_id where p.id = p_photo_id and p.upload_id is null;
  select p.upload_id into v_kept from public.photos p where p.id = p_photo_id;
  perform app.end_act_for(v_photo.previous);
  return v_kept;
end;
$$;

-- The upload is complete in storage: on to processing. With p_failure (the stored file wasn't the declared size),
-- the photo fails instead, so the same file can be dropped again.
create function public.mark_photo_uploaded(p_actor uuid, p_photo_id uuid, p_failure text default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_photo record;
begin
  select * into v_photo from app.uploading_photo(p_actor, p_photo_id);
  update public.photos p
  set status = case when p_failure is null then 'processing'::public.photo_status else 'failed' end,
    failure_reason = p_failure, upload_id = null
  where p.id = p_photo_id;
  perform app.end_act_for(v_photo.previous);
end;
$$;

-- Cancels an upload (the person removed the file before it finished): the photo is gone, as if never dropped.
-- Returns the storage upload's id so the API can abort it.
create function public.cancel_photo_upload(p_actor uuid, p_photo_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_photo record;
  v_upload text;
begin
  select * into v_photo from app.uploading_photo(p_actor, p_photo_id);
  delete from public.photos p where p.id = p_photo_id returning p.upload_id into v_upload;
  perform app.end_act_for(v_photo.previous);
  return v_upload;
end;
$$;

-- Ends a batch: what the browser skipped is added, and one event says what happened (counts and ids only).
create function app.close_batch(p_batch_id uuid, p_files_skipped int) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.upload_batches;
begin
  update public.upload_batches b
  set finished_at = now(), files_skipped = b.files_skipped + greatest(coalesce(p_files_skipped, 0), 0)
  where b.id = p_batch_id and b.finished_at is null
  returning * into v_batch;
  if v_batch.id is null then
    return;
  end if;
  perform app.emit(v_batch.studio_id, 'photos.uploaded', v_batch.job_id, (
    select jsonb_build_object(
      'batch_id', v_batch.id,
      'added', count(*) filter (where p.status in ('processing', 'ready')),
      'failed', count(*) filter (where p.status = 'failed'),
      'unfinished', count(*) filter (where p.status = 'uploading'),
      'duplicates', v_batch.duplicates_skipped,
      'skipped', v_batch.files_skipped)
    from public.photos p where p.batch_id = v_batch.id));
end;
$$;

create function public.finish_upload_batch(p_actor uuid, p_batch_id uuid, p_files_skipped int) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select b.studio_id from public.upload_batches b where b.id = p_batch_id);
  v_previous text;
begin
  if v_studio is null then
    raise exception 'Batch not found' using errcode = 'P0002';
  end if;
  if p_files_skipped is null or p_files_skipped not between 0 and 1000000 then
    raise exception 'Skipped files must be a count' using errcode = '22023';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  -- Finishing twice (a retry after a dropped connection) changes nothing.
  perform app.close_batch(p_batch_id, p_files_skipped);
  perform app.end_act_for(v_previous);
end;
$$;

-- ── The image worker ──────────────────────────────────────────────────────────────────────────────────────────────
-- What the worker needs to make a photo's previews: ids, the expected hash and size, and the studio's name for the
-- watermark (Seenu, answer 4). Run only as the service role by the HMAC-checked internal route.
create function public.photo_for_worker(p_photo_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'studio_id', p.studio_id, 'job_id', p.job_id, 'status', p.status,
    'sha256', encode(p.sha256, 'hex'), 'byte_size', p.byte_size, 'studio_name', s.name)
  from public.photos p join public.studios s on s.id = p.studio_id
  where p.id = p_photo_id;
$$;

-- The worker's result. Idempotent: only a photo being processed changes, so a repeated message does nothing.
-- p_result is {status: ready, width, height, captured_at} or {status: failed, failure_reason}.
create function public.record_photo_result(p_photo_id uuid, p_result jsonb) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ready boolean := p_result ->> 'status' = 'ready';
begin
  if jsonb_typeof(p_result) is distinct from 'object' or p_result ->> 'status' not in ('ready', 'failed')
     or (v_ready and (coalesce(p_result ->> 'width', '') !~ '^[1-9][0-9]{0,5}$'
                      or coalesce(p_result ->> 'height', '') !~ '^[1-9][0-9]{0,5}$')) then
    raise exception 'A result is ready (with a size) or failed' using errcode = '22023';
  end if;
  update public.photos p
  set status = (p_result ->> 'status')::public.photo_status,
    width = case when v_ready then (p_result ->> 'width')::int end,
    height = case when v_ready then (p_result ->> 'height')::int end,
    captured_at = case when v_ready then (p_result ->> 'captured_at')::timestamp end,
    failure_reason = case when not v_ready then p_result ->> 'failure_reason' end,
    processed_at = now()
  where p.id = p_photo_id and p.status = 'processing';
  return found;
end;
$$;

-- Tries a photo's previews again: a photo the worker couldn't read, or one stuck processing for 15 minutes (its
-- message ended in the dead-letter queue). Returns whether the API should queue it.
create function public.retry_photo(p_actor uuid, p_photo_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select p.studio_id from public.photos p where p.id = p_photo_id);
  v_previous text;
begin
  if v_studio is null then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  update public.photos p
  set status = 'processing', failure_reason = null
  where p.id = p_photo_id and p.binned_at is null
    and ((p.status = 'failed' and p.failure_reason = 'unreadable')
      or (p.status = 'processing' and p.updated_at < now() - interval '15 minutes'));
  if not found then
    raise exception 'not_retryable' using errcode = 'P0001';
  end if;
  perform app.end_act_for(v_previous);
  return true;
end;
$$;

-- ── The bin (Seenu, answer 7) ─────────────────────────────────────────────────────────────────────────────────────
-- Up to 500 photos of one job at a time. A photo that has sold can't be binned (photo_sold, nothing changes). A photo
-- still uploading isn't binned (cancel it instead). Returns how many moved; one event for the lot.
create function app.check_bin_request(p_job_id uuid, p_photo_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_photo_ids), 0) not between 1 and 500 then
    raise exception 'Send 1 to 500 photos' using errcode = '22023';
  end if;
  if (select count(*) from public.photos p where p.job_id = p_job_id and p.id = any (p_photo_ids))
     <> (select count(distinct x) from unnest(p_photo_ids) x) then
    raise exception 'Every photo must be one of the job''s' using errcode = '22023';
  end if;
end;
$$;

create function public.bin_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[]) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_count int;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.check_bin_request(p_job_id, p_photo_ids);
  if exists (select 1 from public.photos p where p.id = any (p_photo_ids) and p.sold_at is not null) then
    raise exception 'photo_sold' using errcode = 'P0001';
  end if;
  update public.photos p set binned_at = now(), binned_by = p_actor
  where p.id = any (p_photo_ids) and p.binned_at is null and p.status <> 'uploading';
  get diagnostics v_count = row_count;
  perform app.end_act_for(v_previous);
  return v_count;
end;
$$;

create function public.restore_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[]) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_count int;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.check_bin_request(p_job_id, p_photo_ids);
  update public.photos p set binned_at = null, binned_by = null
  where p.id = any (p_photo_ids) and p.binned_at is not null;
  get diagnostics v_count = row_count;
  perform app.end_act_for(v_previous);
  return v_count;
end;
$$;

-- ── Daily clean-up (the cron, service role) ───────────────────────────────────────────────────────────────────────
-- Photos in the bin for more than 30 days, never sold. The cron deletes their stored objects (every version) first,
-- then the rows (delete_purged_photos re-checks the rule), so a failure never leaves objects without a row.
create function public.photos_due_for_purge(p_limit int) returns table (id uuid, studio_id uuid, job_id uuid)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.studio_id, p.job_id from public.photos p
  where p.binned_at < now() - interval '30 days' and p.sold_at is null
  order by p.binned_at
  limit least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;

create function public.delete_purged_photos(p_photo_ids uuid[]) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.photos p
  where p.id = any (p_photo_ids) and p.binned_at < now() - interval '30 days' and p.sold_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Uploads started more than 7 days ago and never finished (storage aborts their parts after 7 days too).
create function public.abandoned_uploads(p_limit int)
returns table (id uuid, studio_id uuid, job_id uuid, upload_id text)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.studio_id, p.job_id, p.upload_id from public.photos p
  where p.status = 'uploading' and p.created_at < now() - interval '7 days'
  order by p.created_at
  limit least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;

create function public.delete_abandoned_uploads(p_photo_ids uuid[]) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.photos p
  where p.id = any (p_photo_ids) and p.status = 'uploading' and p.created_at < now() - interval '7 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Batches nobody finished (the tab was closed) and without a new file for a day are finished, attributed to the
-- person who started them.
create function public.finish_idle_batches() returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch record;
  v_previous text := current_setting('request.jwt.claim.sub', true);
  v_count int := 0;
begin
  for v_batch in
    select b.id, b.created_by from public.upload_batches b
    where b.finished_at is null and b.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.photos p
                      where p.batch_id = b.id and p.created_at >= now() - interval '24 hours')
    order by b.created_at
    limit 1000
  loop
    perform set_config('request.jwt.claim.sub', v_batch.created_by::text, true);
    perform app.close_batch(v_batch.id, 0);
    v_count := v_count + 1;
  end loop;
  perform app.end_act_for(v_previous);
  return v_count;
end;
$$;

-- ── Counts for the Photos tab and the Overview ────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER: row-level security applies, so another studio's job counts nothing.
create function public.job_photo_counts(p_job_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'photos', count(*) filter (where p.binned_at is null and p.status <> 'uploading'),
    'ready', count(*) filter (where p.binned_at is null and p.status = 'ready'),
    'processing', count(*) filter (where p.binned_at is null and p.status = 'processing'),
    'failed', count(*) filter (where p.binned_at is null and p.status = 'failed'),
    'uploading', count(*) filter (where p.status = 'uploading'),
    'binned', count(*) filter (where p.binned_at is not null),
    'uploads', (select count(*) from public.upload_batches b where b.job_id = p_job_id),
    'duplicates_skipped', (select coalesce(sum(b.duplicates_skipped), 0) from public.upload_batches b
                           where b.job_id = p_job_id))
  from public.photos p where p.job_id = p_job_id;
$$;

-- One page of a job's photos in tagging order, after the photo `p_after` (keyset; the cursor is an id, so no
-- filename ever goes in a URL). p_bin: the bin instead of the job's photos. p_status: only that status. The job's
-- photos (not the bin) are read through the tagging-order index. SECURITY INVOKER: row-level security applies.
create function public.job_photos_page(p_job_id uuid, p_after uuid, p_limit int, p_bin boolean,
  p_status public.photo_status)
returns table (id uuid, batch_id uuid, batch_seq bigint, status public.photo_status, original_filename text,
  byte_size bigint, width int, height int, captured_at timestamp, failure_reason text, binned_at timestamptz,
  created_at timestamptz, processed_at timestamptz)
language plpgsql stable
set search_path = ''
as $$
declare
  v_seq bigint;
  v_at timestamp;
  v_name text;
  v_id uuid;
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if p_after is not null then
    select p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename, p.id
    into v_seq, v_at, v_name, v_id
    from public.photos p where p.id = p_after and p.job_id = p_job_id;
    if v_id is null then
      return;
    end if;
  end if;
  if coalesce(p_bin, false) then
    return query
      select p.id, p.batch_id, p.batch_seq, p.status, p.original_filename, p.byte_size, p.width, p.height,
        p.captured_at, p.failure_reason, p.binned_at, p.created_at, p.processed_at
      from public.photos p
      where p.job_id = p_job_id and p.binned_at is not null
        and (p_status is null or p.status = p_status)
        and (v_id is null or (p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp),
                              p.original_filename collate "C", p.id) > (v_seq, v_at, v_name collate "C", v_id))
      order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
      limit v_limit;
  else
    return query
      select p.id, p.batch_id, p.batch_seq, p.status, p.original_filename, p.byte_size, p.width, p.height,
        p.captured_at, p.failure_reason, p.binned_at, p.created_at, p.processed_at
      from public.photos p
      where p.job_id = p_job_id and p.binned_at is null and p.status <> 'uploading'
        and (p_status is null or p.status = p_status)
        and (v_id is null or (p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp),
                              p.original_filename collate "C", p.id) > (v_seq, v_at, v_name collate "C", v_id))
      order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
      limit v_limit;
  end if;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.on_photos_bin_change(), app.on_photos_purged(), app.assert_job_open(uuid),
  app.open_batch(uuid, uuid), app.uploading_photo(uuid, uuid), app.close_batch(uuid, int),
  app.check_bin_request(uuid, uuid[])
  from public;
revoke all on function public.job_photo_counts(uuid),
  public.job_photos_page(uuid, uuid, int, boolean, public.photo_status)
  from public, anon;
grant execute on function public.job_photo_counts(uuid),
  public.job_photos_page(uuid, uuid, int, boolean, public.photo_status)
  to authenticated;
-- Writes and the worker's and cron's reads: the service role only (route handlers), never browsers.
revoke all on function
  public.create_upload_batch(uuid, uuid),
  public.register_photos(uuid, uuid, jsonb),
  public.set_photo_upload_id(uuid, uuid, text),
  public.mark_photo_uploaded(uuid, uuid, text),
  public.cancel_photo_upload(uuid, uuid),
  public.finish_upload_batch(uuid, uuid, int),
  public.photo_for_worker(uuid),
  public.record_photo_result(uuid, jsonb),
  public.retry_photo(uuid, uuid),
  public.bin_photos(uuid, uuid, uuid[]),
  public.restore_photos(uuid, uuid, uuid[]),
  public.photos_due_for_purge(int),
  public.delete_purged_photos(uuid[]),
  public.abandoned_uploads(int),
  public.delete_abandoned_uploads(uuid[]),
  public.finish_idle_batches()
  from public, anon, authenticated;
grant execute on function
  public.create_upload_batch(uuid, uuid),
  public.register_photos(uuid, uuid, jsonb),
  public.set_photo_upload_id(uuid, uuid, text),
  public.mark_photo_uploaded(uuid, uuid, text),
  public.cancel_photo_upload(uuid, uuid),
  public.finish_upload_batch(uuid, uuid, int),
  public.photo_for_worker(uuid),
  public.record_photo_result(uuid, jsonb),
  public.retry_photo(uuid, uuid),
  public.bin_photos(uuid, uuid, uuid[]),
  public.restore_photos(uuid, uuid, uuid[]),
  public.photos_due_for_purge(int),
  public.delete_purged_photos(uuid[]),
  public.abandoned_uploads(int),
  public.delete_abandoned_uploads(uuid[]),
  public.finish_idle_batches()
  to service_role;

notify pgrst, 'reload schema';
