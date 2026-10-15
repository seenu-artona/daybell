-- UI round 6: Job › Photos, People and Groups (D156; Seenu's answers of Oct 14, 2026; ADR 0030, amending ADRs 0016,
-- 0018, 0022 and 0026). A forward migration: 20261015000000 is merged.
--
-- Individual photos are uploaded once for the whole job and split by QR card as before. Groups are made by hand (or
-- once from a roster column) and are members plus their group photos; a person can be in several groups and a group
-- photo shown in several groups. Group photos are linked to their group once, when their files are registered, and
-- move between groups only by hand: nothing here (uploads, tagging, roster changes, new groups) moves a group's photos
-- or removes a member by itself. Classes stay as they are (job_groups, children.group_id: C1); a class only loses its
-- photo meaning. Existing class photo sets become group photos in no group, which parents don't see until the studio
-- puts them in a group (C2): nothing is backfilled. Names never go in events, logs or errors: ids and counts only.

-- ── Groups ────────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.photo_groups (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  -- 1-60 characters, trimmed, unique per job ignoring case (C10). No control characters (C0 or C1) and no bidi
  -- overrides or isolates, which could make a name read differently from what it is (as price list names).
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)
    and name !~ '[\u0001-\u001F\u007F-\u009F‪-‮⁦-⁩]'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photo_groups_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete restrict,
  -- Members, photos and upload batches reference a group together with its studio and job (ADR 0008).
  constraint photo_groups_studio_job_id_key unique (studio_id, job_id, id)
);
create unique index photo_groups_job_name_key on public.photo_groups (studio_id, job_id, lower(name));
create index photo_groups_studio_idx on public.photo_groups (studio_id);
comment on table public.photo_groups is
  'A group of people in a job and its group photos (D156; ADR 0030). Not a class: classes are job_groups.';
-- Two kinds of "group", kept apart by name in the API (C6): job_groups are the roster's classes (children.group_id,
-- /classes), named by the job's label (Class, Team…); photo_groups are these photo groups (/groups), with members and
-- group photos. A class never makes anyone a member of a photo group by itself.
comment on table public.job_groups is
  'A job''s classes (teams, homerooms…): the roster''s class field (children.group_id). Not photo groups (photo_groups).';

create trigger photo_groups_touch before update on public.photo_groups
for each row execute function app.touch_updated_at();

-- Who is in a group. A person can be in several groups; they leave with their child row or their group.
create table public.photo_group_members (
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  group_id uuid not null,
  child_id uuid not null,
  added_at timestamptz not null default now(),
  -- No foreign key, as on events: erasing a person is never blocked.
  added_by uuid,
  primary key (group_id, child_id),
  constraint photo_group_members_group_fk foreign key (studio_id, job_id, group_id)
    references public.photo_groups (studio_id, job_id, id) on delete cascade,
  constraint photo_group_members_child_fk foreign key (studio_id, job_id, child_id)
    references public.children (studio_id, job_id, id) on delete cascade
);
create index photo_group_members_child_idx on public.photo_group_members (child_id);
create index photo_group_members_studio_idx on public.photo_group_members (studio_id);
comment on table public.photo_group_members is 'The people in each photo group (D156). Changed only by hand.';

-- Which group photos each group shows. A photo can be shown in several groups. A group with photos is deleted only
-- after its photos go to another group or the bin (restrict; C4); a photo purged from the bin leaves its groups.
create table public.photo_group_photos (
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  group_id uuid not null,
  photo_id uuid not null,
  added_at timestamptz not null default now(),
  added_by uuid,
  primary key (group_id, photo_id),
  constraint photo_group_photos_group_fk foreign key (studio_id, job_id, group_id)
    references public.photo_groups (studio_id, job_id, id) on delete restrict,
  constraint photo_group_photos_photo_fk foreign key (studio_id, job_id, photo_id)
    references public.photos (studio_id, job_id, id) on delete cascade
);
create index photo_group_photos_photo_idx on public.photo_group_photos (photo_id);
create index photo_group_photos_studio_idx on public.photo_group_photos (studio_id);
comment on table public.photo_group_photos is
  'The group photos each photo group shows (D156). Written when the files are registered, then changed only by hand.';

-- Everyone on the team reads groups; nobody signed in writes. Writes go through the functions below (service role),
-- which act for the person and check their role (owners, admins and photographers; C11).
alter table public.photo_groups enable row level security;
alter table public.photo_group_members enable row level security;
alter table public.photo_group_photos enable row level security;
create policy "members read their studio's photo groups" on public.photo_groups
  for select to authenticated using (app.is_member(studio_id));
create policy "members read their studio's photo group members" on public.photo_group_members
  for select to authenticated using (app.is_member(studio_id));
create policy "members read their studio's photo group photos" on public.photo_group_photos
  for select to authenticated using (app.is_member(studio_id));
revoke all on public.photo_groups, public.photo_group_members, public.photo_group_photos from anon, authenticated;
grant select on public.photo_groups, public.photo_group_members, public.photo_group_photos to authenticated;

-- ── Upload batches: a kind, and the group they are for ────────────────────────────────────────────────────────────
-- kind: individual photos (split by QR card) or group photos. photo_group_id: a group upload's group (its photos are
-- linked to it when registered). add_to_group_id: an individual upload whose people are added to a group as tagging
-- places their photos (C7). A deleted group leaves the batch with none.
alter table public.upload_batches
  add column kind text not null default 'individual' check (kind in ('individual', 'group')),
  add column photo_group_id uuid,
  add column add_to_group_id uuid,
  add constraint upload_batches_photo_group_fk foreign key (studio_id, job_id, photo_group_id)
    references public.photo_groups (studio_id, job_id, id) on delete set null (photo_group_id),
  add constraint upload_batches_add_to_group_fk foreign key (studio_id, job_id, add_to_group_id)
    references public.photo_groups (studio_id, job_id, id) on delete set null (add_to_group_id),
  add constraint upload_batches_kind_groups check (
    (kind = 'group' or photo_group_id is null) and (kind = 'individual' or add_to_group_id is null));
create index upload_batches_photo_group_idx on public.upload_batches (photo_group_id) where photo_group_id is not null;
create index upload_batches_add_to_group_idx on public.upload_batches (add_to_group_id)
  where add_to_group_id is not null;
-- Class-photo uploads become group uploads in no group (C2).
update public.upload_batches set kind = 'group' where group_id is not null;
alter table public.upload_batches drop constraint upload_batches_group_fk, drop column group_id;

-- ── Tags: class photo sets become group photos ────────────────────────────────────────────────────────────────────
-- A group photo's groups are its links, so the tag holds no group. Existing class-set tags keep their place under its
-- new name and lose their class (C2: no groups).
alter table public.photo_tags drop constraint photo_tags_place_ids, drop constraint photo_tags_group_fk;
alter table public.photo_tags drop column group_id;
alter type public.photo_place rename value 'class_set' to 'group_photo';
alter table public.photo_tags add constraint photo_tags_place_ids check (
  (place = 'child') = (child_id is not null)
  and (card_id is null or place in ('card', 'blank_card'))
  and (place <> 'blank_card' or card_id is not null));
comment on table public.photo_tags is
  'Where each photo is after QR tagging and review: a child, a group photo, Leftovers, a card photo or a blank card. Card photos and flagged photos are never shown to parents.';

-- ── Group photos ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Whether a photo is a group photo (ADR 0030, call 2): a photo from a group upload, or one that was in a class's Class
-- photo set; a card photo inside a group upload stays a card photo. Its bin and status are the caller's to check.
create function app.is_group_photo(p_photo_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select t.place = 'group_photo' or (t.photo_id is null and b.kind = 'group')
    from public.photos p
    join public.upload_batches b on b.id = p.batch_id and b.studio_id = p.studio_id
    left join public.photo_tags t on t.photo_id = p.id
    where p.id = p_photo_id), false);
$$;

-- Checks a change's photos: 1 to 500, every one a group photo of the job, processed or failed (not uploading) and out of
-- the bin (not_group_photo otherwise).
create function app.check_group_photos(p_job_id uuid, p_photo_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_photo_ids), 0) not between 1 and 500 then
    raise exception 'Send 1 to 500 photos' using errcode = '22023';
  end if;
  if (select count(*) from public.photos p
      where p.job_id = p_job_id and p.id = any (p_photo_ids) and p.status <> 'uploading'
        and p.binned_at is null and app.is_group_photo(p.id))
     <> (select count(distinct x) from unnest(p_photo_ids) x) then
    raise exception 'not_group_photo' using errcode = 'P0001';
  end if;
end;
$$;

-- Checks a list of group ids: 1 to 500, every one a group of the job (group_not_in_job otherwise).
create function app.check_job_groups(p_job_id uuid, p_group_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_group_ids), 0) not between 1 and 500 then
    raise exception 'Send 1 to 500 groups' using errcode = '22023';
  end if;
  if (select count(*) from public.photo_groups g where g.job_id = p_job_id and g.id = any (p_group_ids))
     <> (select count(distinct x) from unnest(p_group_ids) x) then
    raise exception 'group_not_in_job' using errcode = 'P0001';
  end if;
end;
$$;

-- ── Uploads: a kind, and group links written when files are registered ────────────────────────────────────────────
drop function public.create_upload_batch(uuid, uuid, uuid);
-- An upload of individual photos (optionally adding everyone it places to a group, C7) or of group photos for one of
-- the job's groups. The groups must be the job's (group_not_in_job), locked against deletion until the batch exists.
create function public.create_upload_batch(p_actor uuid, p_job_id uuid, p_kind text default 'individual',
  p_photo_group_id uuid default null, p_add_to_group_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_group uuid := coalesce(p_photo_group_id, p_add_to_group_id);
  v_id uuid;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.assert_job_open(p_job_id);
  if coalesce(p_kind, '') not in ('individual', 'group')
     or (p_kind = 'group' and (p_photo_group_id is null or p_add_to_group_id is not null))
     or (p_kind = 'individual' and p_photo_group_id is not null) then
    raise exception 'An upload is individual photos or one group''s photos' using errcode = '22023';
  end if;
  if v_group is not null then
    perform 1 from public.photo_groups g
    where g.studio_id = v_studio and g.job_id = p_job_id and g.id = v_group
    for key share;
    if not found then
      raise exception 'group_not_in_job' using errcode = 'P0001';
    end if;
  end if;
  insert into public.upload_batches (studio_id, job_id, created_by, kind, photo_group_id, add_to_group_id)
  values (v_studio, p_job_id, p_actor, p_kind, p_photo_group_id, p_add_to_group_id)
  returning id into v_id;
  perform app.end_act_for(v_previous);
  return v_id;
end;
$$;

-- As in 20261011100000, and a group upload's new photos are linked to its group as they are registered (never a
-- resumed photo of another drop, never by tagging; C12: no event of their own). The group is locked for the
-- statement, so it can't be deleted halfway.
create or replace function public.register_photos(p_actor uuid, p_batch_id uuid, p_files jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch record;
  v_group uuid;
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

  select g.id into v_group
  from public.upload_batches b
  join public.photo_groups g on g.id = b.photo_group_id and g.studio_id = b.studio_id and g.job_id = b.job_id
  where b.id = p_batch_id and b.kind = 'group'
  for key share of g;

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
    returning id
  ),
  -- A group upload's new photos join its group (D156: "uploaded into a group").
  linked as (
    insert into public.photo_group_photos (studio_id, job_id, group_id, photo_id, added_by)
    select v_batch.studio_id, v_batch.job_id, v_group, i.id, p_actor
    from inserted i where v_group is not null
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

-- As in 20261011100000; photos.uploaded also says the upload's kind and group (C12).
create or replace function app.close_batch(p_batch_id uuid, p_files_skipped int, p_duplicates int) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.upload_batches;
begin
  update public.upload_batches b
  set finished_at = now(), files_skipped = b.files_skipped + greatest(coalesce(p_files_skipped, 0), 0),
    duplicates_skipped = b.duplicates_skipped + greatest(coalesce(p_duplicates, 0), 0)
  where b.id = p_batch_id and b.finished_at is null
  returning * into v_batch;
  if v_batch.id is null then
    return;
  end if;
  perform app.emit(v_batch.studio_id, 'photos.uploaded', v_batch.job_id, (
    select jsonb_build_object(
      'batch_id', v_batch.id,
      'kind', v_batch.kind,
      'photo_group_id', v_batch.photo_group_id,
      'added', count(*) filter (where p.status in ('processing', 'ready')),
      'failed', count(*) filter (where p.status = 'failed'),
      'unfinished', count(*) filter (where p.status = 'uploading'),
      'duplicates', v_batch.duplicates_skipped,
      'skipped', v_batch.files_skipped)
    from public.photos p where p.batch_id = v_batch.id));
end;
$$;

-- ── Tagging keys on the batch's kind ──────────────────────────────────────────────────────────────────────────────
-- As in 20261012100000, with the batch's kind in place of its class.
create or replace function public.tagging_inputs(p_batch_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'batch_id', b.id, 'studio_id', b.studio_id, 'job_id', b.job_id, 'kind', b.kind,
    'tag_round', b.tag_round, 'tagged_round', b.tagged_round, 'purge_tail', b.purge_tail,
    'processing', (select count(*) from public.photos p
                   where p.batch_id = b.id and p.binned_at is null and p.status = 'processing'),
    -- Processing for 15 minutes: stuck (its message went to the dead-letter queue; Try again restarts it).
    'processing_stuck', (select count(*) from public.photos p
                         where p.batch_id = b.id and p.binned_at is null and p.status = 'processing'
                           and p.updated_at < now() - interval '15 minutes'),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'status', p.status, 'qr_kind', p.qr_kind, 'card_id', p.qr_card_id,
          'card_child_id', q.child_id, 'binned', p.binned_at is not null, 'after_purge', p.after_purge,
          'before', case when p.before_card or p.before_flag is not null then jsonb_build_object(
            'card', p.before_card, 'card_id', p.before_card_id, 'card_child_id', bq.child_id,
            'flag', p.before_flag) end,
          'tag', case when t.photo_id is not null then jsonb_build_object(
            'place', t.place, 'child_id', t.child_id, 'card_id', t.card_id,
            'flag', t.flag, 'source', t.source) end)
        order by coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id)
      from public.photos p
      left join public.qr_cards q on q.id = p.qr_card_id
      left join public.qr_cards bq on bq.id = p.before_card_id
      left join public.photo_tags t on t.photo_id = p.id
      where p.batch_id = b.id and p.status <> 'uploading'), '[]'::jsonb))
  from public.upload_batches b where b.id = p_batch_id;
$$;

-- As in 20261012100000, with group photos in place of class sets: a group upload's photos are group photos (or card
-- photos), an individual upload's never are. Each person a run newly places photos with joins the upload's
-- add_to_group_id (add only, C7), in one photo_group.members_changed event (ADR 0030, call 10).
create or replace function public.apply_batch_tags(p_batch_id uuid, p_round bigint, p_writes jsonb) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.upload_batches;
  v_previous text := current_setting('request.jwt.claim.sub', true);
  v_changed int := 0;
  v_n int;
  v_reopen boolean;
  v_placed uuid[];
  v_added int;
  v_counts jsonb;
begin
  select * into v_batch from public.upload_batches b where b.id = p_batch_id for update;
  if v_batch.id is null then
    raise exception 'Batch not found' using errcode = 'P0002';
  end if;
  if v_batch.tag_round <> p_round then
    raise exception 'tagging_stale' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_writes) is distinct from 'array'
     or (select count(*) from jsonb_array_elements(p_writes))
        <> (select count(distinct w ->> 'photo_id') from jsonb_array_elements(p_writes) w) then
    raise exception 'Writes must be a list, one per photo' using errcode = '22023';
  end if;
  -- Tagging runs of a job and Mark reviewed take turns, so a review never misses Leftovers written meanwhile.
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || v_batch.job_id::text, 0));
  -- A blank card named since the run read its photos (claim_blank_card also moves the round on): never hold photos
  -- for a card that already has its child (code review M2).
  if exists (select 1 from jsonb_array_elements(p_writes) w join public.qr_cards q
               on q.id = case when w ->> 'card_id' ~ '^[0-9a-f-]{36}$' then (w ->> 'card_id')::uuid end
             where w ->> 'place' = 'blank_card' and q.child_id is not null) then
    raise exception 'tagging_stale' using errcode = 'P0001';
  end if;
  -- As strict as the table's checks, so Postgres never refuses (and logs) a row.
  if exists (
    select 1 from jsonb_array_elements(p_writes) w
    where jsonb_typeof(w) is distinct from 'object'
      or coalesce(w ->> 'photo_id', '') !~ '^[0-9a-f-]{36}$'
      or (w ->> 'child_id' is not null and w ->> 'child_id' !~ '^[0-9a-f-]{36}$')
      or (w ->> 'card_id' is not null and w ->> 'card_id' !~ '^[0-9a-f-]{36}$')
      or (w ->> 'place' is not null and w ->> 'place' not in ('child', 'group_photo', 'leftovers', 'card', 'blank_card'))
      or (w ->> 'flag' is not null
          and w ->> 'flag' not in ('unreadable_card', 'other_card', 'after_unreadable', 'after_failed', 'after_purge'))
      or (w ->> 'place' is not null and (
        ((w ->> 'place' = 'child') <> (w ->> 'child_id' is not null))
        or (w ->> 'card_id' is not null and w ->> 'place' not in ('card', 'blank_card'))
        or (w ->> 'place' = 'blank_card' and w ->> 'card_id' is null)
        -- A group upload holds group photos and card photos only; an individual upload never holds group photos.
        or (w ->> 'place' <> 'card' and (w ->> 'place' = 'group_photo') <> (v_batch.kind = 'group'))))
      or not exists (select 1 from public.photos p
                     where p.id = (w ->> 'photo_id')::uuid and p.batch_id = p_batch_id and p.binned_at is null)
      or (w ->> 'child_id' is not null and not exists (
        select 1 from public.children c
        where c.id = (w ->> 'child_id')::uuid and c.studio_id = v_batch.studio_id and c.job_id = v_batch.job_id))
      or (w ->> 'card_id' is not null and not exists (
        select 1 from public.qr_cards q
        where q.id = (w ->> 'card_id')::uuid and q.studio_id = v_batch.studio_id and q.job_id = v_batch.job_id))) then
    raise exception 'Every write must be one of the batch''s photos, tagged to the job' using errcode = '22023';
  end if;

  -- The event is attributed to the person who started the upload, like the batch's own event (ADR 0016).
  perform set_config('request.jwt.claim.sub', v_batch.created_by::text, true);

  delete from public.photo_tags t
  using jsonb_array_elements(p_writes) w
  where w ->> 'place' is null and t.photo_id = (w ->> 'photo_id')::uuid and t.source = 'auto';
  get diagnostics v_n = row_count;
  v_changed := v_changed + v_n;

  -- Only the rows actually written count, so a write skipped for a manual tag never reopens the review (code review
  -- nice 2). prev is read before the write (one snapshot). A person counts as placed for the upload's add-to-group
  -- (C7) only by a photo tagged for the first time: a later run that retags photos (after a purge, a card printed
  -- again) never adds back someone a person took out of the group by hand (ADR 0030, Calls).
  with prev as (
    select t.photo_id, t.child_id from public.photo_tags t
    where t.photo_id in (select (w ->> 'photo_id')::uuid from jsonb_array_elements(p_writes) w)
  ),
  written as (
    insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, card_id, flag, source)
    select (w ->> 'photo_id')::uuid, v_batch.studio_id, v_batch.job_id, (w ->> 'place')::public.photo_place,
      (w ->> 'child_id')::uuid, (w ->> 'card_id')::uuid, (w ->> 'flag')::public.photo_flag, 'auto'
    from jsonb_array_elements(p_writes) w
    where w ->> 'place' is not null
    on conflict (photo_id) do update
    set place = excluded.place, child_id = excluded.child_id, card_id = excluded.card_id, flag = excluded.flag
    -- Manual tags are never overwritten.
    where public.photo_tags.source = 'auto'
      and (public.photo_tags.place, public.photo_tags.child_id, public.photo_tags.card_id, public.photo_tags.flag)
        is distinct from (excluded.place, excluded.child_id, excluded.card_id, excluded.flag)
    returning photo_id, place, flag, child_id
  )
  select count(*), coalesce(bool_or(w.place = 'leftovers' or w.flag is not null), false),
    array(select distinct x.child_id from written x
          where x.place = 'child'
            and not exists (select 1 from prev p where p.photo_id = x.photo_id))
  into v_n, v_reopen, v_placed
  from written w;
  v_changed := v_changed + v_n;

  update public.upload_batches b set tagged_round = p_round where b.id = p_batch_id;

  -- "Add everyone in this upload to a group" (C7): add only, never a removal; a deleted group adds nobody.
  if v_batch.add_to_group_id is not null and cardinality(v_placed) > 0 then
    with added as (
      insert into public.photo_group_members (studio_id, job_id, group_id, child_id, added_by)
      select v_batch.studio_id, v_batch.job_id, g.id, c, v_batch.created_by
      from unnest(v_placed) c
      join public.photo_groups g on g.id = v_batch.add_to_group_id and g.studio_id = v_batch.studio_id
        and g.job_id = v_batch.job_id
      on conflict (group_id, child_id) do nothing
      returning 1
    )
    select count(*) into v_added from added;
    if v_added > 0 then
      perform app.emit(v_batch.studio_id, 'photo_group.members_changed', v_batch.add_to_group_id,
        jsonb_build_object('added', v_added, 'removed', 0,
          'count', (select count(*) from public.photo_group_members m where m.group_id = v_batch.add_to_group_id)));
    end if;
  end if;

  if v_changed > 0 then
    -- New Leftovers or flags reopen the review (Seenu, answer 4).
    if v_reopen then
      perform app.reopen_tagging_review(array[v_batch.job_id]);
    end if;
    select jsonb_build_object(
        'cards', count(*) filter (where t.place = 'card'),
        'leftovers', count(*) filter (where t.place = 'leftovers'),
        'flagged', count(*) filter (where t.flag is not null),
        'blank_cards', count(distinct t.card_id) filter (where t.place = 'blank_card'))
      into v_counts
    from public.photo_tags t join public.photos p on p.id = t.photo_id
    where p.batch_id = p_batch_id and p.binned_at is null;
    perform app.emit(v_batch.studio_id, 'photos.tagged', v_batch.job_id,
      jsonb_build_object('batch_id', p_batch_id, 'round', p_round, 'photos', v_changed) || v_counts);
  end if;
  perform app.end_act_for(v_previous);
  return v_changed;
end;
$$;

-- As in 20261012100000: a group upload's photos are tagged one by one, so purging them carries nothing.
create or replace function app.carry_purged_steps(p_photo_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_legacy boolean;
  r record;
  -- The steps of the purged photos since the last photo that stays (core's TagStep).
  v_card boolean;
  v_card_id uuid;
  v_flag public.photo_flag;
begin
  for v_batch in
    select distinct p.batch_id from public.photos p join public.upload_batches b on b.id = p.batch_id
    where p.id = any (p_photo_ids) and b.kind = 'individual'
    order by p.batch_id
  loop
    -- A batch uploaded before cards were read: a photo without a QR result is a plain photo (core's isLegacyBatch).
    v_legacy := not exists (select 1 from public.photos p
                            where p.batch_id = v_batch and p.status = 'ready' and p.qr_kind is not null);
    v_card := false;
    v_card_id := null;
    v_flag := null;
    for r in
      select p.id, p.status, p.qr_kind, p.qr_card_id, p.before_card, p.before_card_id, p.before_flag,
        p.id = any (p_photo_ids) as purged
      from public.photos p
      where p.batch_id = v_batch and p.status <> 'uploading'
      order by coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
      for update
    loop
      if r.purged then
        -- What purged photos before it did, then what it did itself.
        if r.before_card then
          v_card := true;
          v_card_id := r.before_card_id;
          v_flag := r.before_flag;
        else
          v_flag := coalesce(r.before_flag, v_flag);
        end if;
        if r.status <> 'ready' then
          v_flag := 'after_failed';
        elsif r.qr_kind = 'card' and r.qr_card_id is not null then
          v_card := true;
          v_card_id := r.qr_card_id;
          v_flag := null;
        elsif r.qr_kind in ('unreadable', 'other_card', 'card') or (r.qr_kind is null and not v_legacy) then
          v_flag := 'after_unreadable';
        end if;
      elsif v_card or v_flag is not null then
        -- The purged photos' steps, then the ones this photo already carried (purged earlier, after them).
        update public.photos p
        set before_card = v_card or r.before_card,
          before_card_id = case when r.before_card then r.before_card_id else v_card_id end,
          before_flag = case when r.before_card then r.before_flag else coalesce(r.before_flag, v_flag) end
        where p.id = r.id;
        update public.upload_batches b set purge_steps = true where b.id = v_batch and not b.purge_steps;
        v_card := false;
        v_card_id := null;
        v_flag := null;
      end if;
    end loop;
    -- The last photos purged did something, and no photo follows: nothing to carry it on, but a photo that sorts
    -- after them later can't be tagged without it.
    if v_card or v_flag is not null then
      update public.upload_batches b set purge_steps = true, purge_tail = true
      where b.id = v_batch and not (b.purge_steps and b.purge_tail);
    end if;
  end loop;
end;
$$;

-- ── Review: moves and confirmations ───────────────────────────────────────────────────────────────────────────────
-- As in 20261012100000, to a child or Leftovers only ("Give to a person"). Group photos never become a person's
-- photos (C8: group_photo).
create or replace function public.move_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[], p_target jsonb)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_kind text := p_target ->> 'kind';
  v_id uuid;
  v_place public.photo_place;
  v_count int;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  if jsonb_typeof(p_target) is distinct from 'object' or coalesce(v_kind, '') not in ('child', 'leftovers')
     or (v_kind = 'child' and coalesce(p_target ->> 'id', '') !~ '^[0-9a-f-]{36}$') then
    raise exception 'Move to a child or Leftovers' using errcode = '22023';
  end if;
  v_id := case when v_kind = 'child' then (p_target ->> 'id')::uuid end;
  if v_kind = 'child' and not exists (select 1 from public.children c
                                      where c.id = v_id and c.studio_id = v_studio and c.job_id = p_job_id) then
    raise exception 'The target must be one of the job''s' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || p_job_id::text, 0));
  perform app.check_tag_request(p_job_id, p_photo_ids);
  if exists (select 1 from unnest(p_photo_ids) x where app.is_group_photo(x)) then
    raise exception 'group_photo' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.photos p
             where p.id = any (p_photo_ids)
               and (p.qr_kind = 'other_card' or (p.qr_kind = 'card' and p.qr_card_id is null))) then
    raise exception 'other_card' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.photo_tags t
             where t.photo_id = any (p_photo_ids) and t.flag in ('unreadable_card', 'other_card')) then
    raise exception 'confirm_first' using errcode = 'P0001';
  end if;
  v_place := v_kind::public.photo_place;

  insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, card_id, flag, source, tagged_by)
  select p.id, v_studio, p_job_id, v_place, v_id, null, null, 'manual', p_actor
  from public.photos p where p.id = any (p_photo_ids)
  on conflict (photo_id) do update
  set place = excluded.place, child_id = excluded.child_id, card_id = null,
    flag = null, source = 'manual', tagged_by = excluded.tagged_by
  where (public.photo_tags.place, public.photo_tags.child_id, public.photo_tags.flag, public.photo_tags.source)
    is distinct from (excluded.place, excluded.child_id, null::public.photo_flag, 'manual');
  get diagnostics v_count = row_count;

  if v_count > 0 then
    if v_kind = 'leftovers' then
      perform app.reopen_tagging_review(array[p_job_id]);
    end if;
    perform app.emit(v_studio, 'photos.moved', p_job_id, jsonb_build_object(
      'photo_ids', to_jsonb(array(select x from unnest(p_photo_ids) x order by x)), 'count', v_count,
      'target_kind', v_kind, 'target_id', v_id));
  end if;
  perform app.end_act_for(v_previous);
  return v_count;
end;
$$;

-- As in 20261012100000, without the tag's class.
create or replace function public.confirm_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[], p_as_card boolean)
returns int
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
  if p_as_card is null then
    raise exception 'Say whether these are card photos' using errcode = '22023';
  end if;
  perform app.check_tag_request(p_job_id, p_photo_ids);
  if not p_as_card and exists (
    select 1 from public.photos p
    where p.id = any (p_photo_ids)
      and (p.qr_kind = 'other_card' or (p.qr_kind = 'card' and p.qr_card_id is null))) then
    raise exception 'other_card' using errcode = 'P0001';
  end if;
  -- Leftovers are given to someone or binned, never "Looks right" where they are (C9; core's reviewActions), unless the
  -- photo may be a card and is being said to be a normal photo.
  if not p_as_card and exists (
    select 1 from public.photo_tags t
    where t.photo_id = any (p_photo_ids) and t.job_id = p_job_id and t.place = 'leftovers'
      and t.flag is distinct from 'unreadable_card') then
    raise exception 'leftovers_confirm' using errcode = 'P0001';
  end if;
  update public.photo_tags t
  set flag = null, source = 'manual', tagged_by = p_actor,
    place = case when p_as_card then 'card'::public.photo_place else t.place end,
    child_id = case when p_as_card then null else t.child_id end,
    card_id = case
      when not p_as_card or t.place = 'blank_card' then t.card_id
      when t.place = 'child' then (select q.id from public.qr_cards q
                                   where q.child_id = t.child_id and q.studio_id = v_studio and q.job_id = p_job_id)
    end
  where t.photo_id = any (p_photo_ids) and t.job_id = p_job_id
    and (t.flag is not null or t.source = 'auto' or p_as_card);
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform app.emit(v_studio, 'photos.confirmed', p_job_id, jsonb_build_object(
      'photo_ids', to_jsonb(array(select x from unnest(p_photo_ids) x order by x)), 'count', v_count,
      'as_card', p_as_card));
  end if;
  perform app.end_act_for(v_previous);
  return v_count;
end;
$$;

-- As in 20261012100000; a photo from a group upload goes back among the group photos, flagged, never to Leftovers, so
-- it can't become a person's photo (C8; ADR 0030, call 4).
create or replace function public.undo_card_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[]) returns int
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
  if not app.has_role(v_studio, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = '42501';
  end if;
  perform app.assert_job_open(p_job_id);
  perform app.check_bin_request(p_job_id, p_photo_ids);
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || p_job_id::text, 0));
  if exists (select 1 from public.photos p left join public.photo_tags t on t.photo_id = p.id
             where p.id = any (p_photo_ids)
               and (t.photo_id is null or t.place <> 'card' or t.source <> 'manual'
                    or (p.qr_kind = 'card' and p.qr_card_id is not null))) then
    raise exception 'not_marked_card' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.photos p
             where p.id = any (p_photo_ids) and (p.status <> 'ready' or p.binned_at is not null)) then
    raise exception 'photo_not_ready' using errcode = 'P0001';
  end if;

  update public.photo_tags t
  set place = case when q.child_id is not null then 'child'::public.photo_place
                   when q.id is not null then 'blank_card'::public.photo_place
                   when b.kind = 'group' then 'group_photo'::public.photo_place
                   else 'leftovers'::public.photo_place end,
    child_id = q.child_id,
    card_id = case when q.child_id is null then q.id end,
    flag = 'unreadable_card', source = 'manual', tagged_by = p_actor
  from public.photo_tags t2
  join public.photos p on p.id = t2.photo_id
  join public.upload_batches b on b.id = p.batch_id
  left join public.qr_cards q on q.id = t2.card_id and q.studio_id = v_studio and q.job_id = p_job_id
  where t2.photo_id = t.photo_id and t.photo_id = any (p_photo_ids) and t.job_id = p_job_id;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform app.reopen_tagging_review(array[p_job_id]);
    perform app.emit(v_studio, 'photos.card_unmarked', p_job_id, jsonb_build_object(
      'photo_ids', to_jsonb(array(select x from unnest(p_photo_ids) x order by x)), 'count', v_count));
  end if;
  perform app.end_act_for(v_previous);
  return v_count;
end;
$$;

-- ── Reads for the review (SECURITY INVOKER) ───────────────────────────────────────────────────────────────────────
-- As in 20261012100000, without the class albums and No photos yet (C17).
create or replace function public.job_tagging_overview(p_job_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  with live as (
    select t.* from public.photo_tags t join public.photos p on p.id = t.photo_id
    where t.job_id = p_job_id and p.binned_at is null
  )
  select jsonb_build_object(
    'photos', (select count(*) from public.photos p
               where p.job_id = p_job_id and p.binned_at is null and p.status <> 'uploading'),
    'processing', (select count(*) from public.photos p
                   where p.job_id = p_job_id and p.binned_at is null and p.status = 'processing'),
    'failed', (select count(*) from public.photos p
               where p.job_id = p_job_id and p.binned_at is null and p.status = 'failed'),
    'untagged_batches', (select count(*) from public.upload_batches b
                         where b.job_id = p_job_id and b.tag_round > b.tagged_round),
    'leftovers', (select count(*) from live l where l.place = 'leftovers'),
    'flagged', (select count(*) from live l where l.flag is not null),
    'blank_cards', (select count(distinct l.card_id) from live l where l.place = 'blank_card'),
    'card_photos', (select count(*) from live l where l.place = 'card'),
    'unlinked_card_photos', (select count(*) from live l where l.place = 'card' and l.card_id is null),
    'reviewed_at', (select r.reviewed_at from public.job_tagging_reviews r where r.job_id = p_job_id));
$$;

-- As in 20261012100000, without class sets: Leftovers, flagged, a person's photos (with their card photos), a blank
-- card's, or the card photos linked to none of the job's cards.
drop function public.tagging_photos(uuid, text, uuid, uuid, int);
create function public.tagging_photos(p_job_id uuid, p_place text, p_id uuid, p_after uuid, p_limit int)
returns table (id uuid, status public.photo_status, place public.photo_place, flag public.photo_flag,
  child_id uuid, card_id uuid, source text, qr_kind text, qr_card boolean)
language plpgsql stable
set search_path = ''
as $$
declare
  v_seq bigint;
  v_at timestamp;
  v_name text;
  v_id uuid;
  v_card uuid := case when p_place = 'child' then (select q.id from public.qr_cards q where q.child_id = p_id) end;
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 501);
begin
  if p_place not in ('leftovers', 'flagged', 'child', 'blank_card', 'unlinked_cards') then
    raise exception 'Unknown place' using errcode = '22023';
  end if;
  if p_after is not null then
    select p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename, p.id
    into v_seq, v_at, v_name, v_id
    from public.photos p where p.id = p_after and p.job_id = p_job_id;
    if v_id is null then
      return;
    end if;
  end if;
  return query
    select p.id, p.status, t.place, t.flag, t.child_id, t.card_id, t.source, p.qr_kind,
      p.qr_card_id is not null
    from public.photos p join public.photo_tags t on t.photo_id = p.id
    where p.job_id = p_job_id and p.binned_at is null
      and case p_place
        when 'leftovers' then t.place = 'leftovers'
        when 'flagged' then t.flag is not null
        when 'child' then (t.place = 'child' and t.child_id = p_id) or (t.place = 'card' and t.card_id = v_card)
        when 'blank_card' then t.card_id = p_id
        when 'unlinked_cards' then t.place = 'card' and t.card_id is null
      end
      and (v_id is null or (p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp),
                            p.original_filename collate "C", p.id) > (v_seq, v_at, v_name collate "C", v_id))
    order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
    limit v_limit;
end;
$$;

-- Class albums and No photos yet leave Photos (C17; ADR 0030, call 5).
drop function public.tagging_children(uuid, uuid, boolean, uuid, int, int);
drop function public.tagging_no_photos(uuid);

-- ── People: everyone with photos, a line each (D156, C15) ─────────────────────────────────────────────────────────
-- One page of the people with photos (their own or a card photo of their card, out of the bin), by last and first
-- name, keyset after p_after (a child's id): each with how many photos they have (card photos not counted) and a
-- strip of their first p_strip photos, their first card photo first, then their photos in tagging order (card photos
-- included). p_group_id: only that group's members. total counts every person listed. SECURITY INVOKER: row-level
-- security applies. Names leave only in the result.
create function public.photo_people(p_job_id uuid, p_group_id uuid, p_after uuid, p_limit int, p_strip int)
returns jsonb
language sql stable
set search_path = ''
as $$
  with people as (
    select c.id, c.first_name, c.last_name,
      (select q.id from public.qr_cards q where q.child_id = c.id and q.studio_id = c.studio_id) as card_id
    from public.children c
    where c.job_id = p_job_id
      and (p_group_id is null or exists (select 1 from public.photo_group_members m
                                         where m.group_id = p_group_id and m.child_id = c.id))
  ), listed as (
    select k.* from people k
    where exists (select 1 from public.photo_tags t join public.photos p on p.id = t.photo_id
                  where t.child_id = k.id and t.place = 'child' and p.binned_at is null)
       or (k.card_id is not null
           and exists (select 1 from public.photo_tags t join public.photos p on p.id = t.photo_id
                       where t.card_id = k.card_id and t.place = 'card' and p.binned_at is null))
  ), page as (
    select l.* from listed l
    where p_after is null
       or (lower(l.last_name), lower(l.first_name), l.id)
          > (select lower(a.last_name), lower(a.first_name), a.id from public.children a
             where a.id = p_after and a.job_id = p_job_id)
    order by lower(l.last_name), lower(l.first_name), l.id
    limit least(greatest(coalesce(p_limit, 50), 1), 51)
  ), leaders as (
    select k.id as child_id, (
      select p.id from public.photos p join public.photo_tags t on t.photo_id = p.id
      where p.job_id = p_job_id and p.binned_at is null and t.place = 'card' and t.card_id = k.card_id
      order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
      limit 1) as photo_id
    from page k
  )
  select jsonb_build_object(
    'total', (select count(*) from listed),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', k.id, 'first_name', k.first_name, 'last_name', k.last_name,
          'photos', (select count(*) from public.photo_tags t join public.photos p on p.id = t.photo_id
                     where t.child_id = k.id and t.place = 'child' and p.binned_at is null),
          'card_photos', (select count(*) from public.photo_tags t join public.photos p on p.id = t.photo_id
                          where k.card_id is not null and t.card_id = k.card_id and t.place = 'card'
                            and p.binned_at is null),
          'strip', coalesce((
            select jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'place', s.place, 'flag', s.flag,
                'child_id', s.child_id, 'card_id', s.card_id, 'source', s.source, 'qr_kind', s.qr_kind,
                'qr_card', s.qr_card)
              order by s.leads desc, s.batch_seq, s.at, s.name collate "C", s.id)
            from (
              select p.id, p.status, t.place, t.flag, t.child_id, t.card_id, t.source, p.qr_kind,
                p.qr_card_id is not null as qr_card, p.batch_seq,
                coalesce(p.captured_at, 'infinity'::timestamp) as at, p.original_filename as name,
                (p.id is not distinct from ld.photo_id) as leads
              from public.photos p join public.photo_tags t on t.photo_id = p.id
              where p.job_id = p_job_id and p.binned_at is null
                and ((t.place = 'child' and t.child_id = k.id) or (t.place = 'card' and t.card_id = k.card_id))
              order by (p.id is not distinct from ld.photo_id) desc, p.batch_seq,
                coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
              limit least(greatest(coalesce(p_strip, 12), 0), 50)) s), '[]'::jsonb))
        order by lower(k.last_name), lower(k.first_name), k.id)
      from page k join leaders ld on ld.child_id = k.id), '[]'::jsonb));
$$;

-- ── Groups: reads (SECURITY INVOKER) ──────────────────────────────────────────────────────────────────────────────
-- A job's groups by name: members, group photos (out of the bin, not card photos) and Ordered, the paid orders holding
-- any of the group's photos (C16: owners and admins only, null for everyone else), plus how many of the job's group
-- photos are in no group (C2; ADR 0030, call 1).
create function public.list_photo_groups(p_job_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  with job as (
    select j.studio_id, app.has_role(j.studio_id, '{owner,admin}') as sees_orders
    from public.jobs j where j.id = p_job_id
  ), shown as (
    select l.group_id, l.photo_id
    from public.photo_group_photos l
    join public.photos p on p.id = l.photo_id
    left join public.photo_tags t on t.photo_id = p.id
    where l.job_id = p_job_id and p.binned_at is null and p.status <> 'uploading'
      and (t.photo_id is null or t.place = 'group_photo')
  )
  select jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name,
          'members', (select count(*) from public.photo_group_members m where m.group_id = g.id),
          'photos', (select count(*) from shown s where s.group_id = g.id),
          -- From the group's photo links to the lines that sold them (each by photo id, indexed), then their paid
          -- orders: never a scan of the studio's orders.
          'ordered', case when (select sees_orders from job) then (
            select count(distinct o.id)
            from (
              select ol.order_id
              from public.photo_group_photos l
              join public.order_lines ol on ol.photo_id = l.photo_id and ol.studio_id = l.studio_id
              where l.group_id = g.id
              union
              select ol.order_id
              from public.photo_group_photos l
              join public.order_line_photos lp on lp.photo_id = l.photo_id and lp.studio_id = l.studio_id
              join public.order_lines ol on ol.id = lp.order_line_id and ol.studio_id = lp.studio_id
              where l.group_id = g.id
            ) sold
            join public.orders o on o.id = sold.order_id and o.status = 'paid') end)
        order by lower(g.name), g.id)
      from public.photo_groups g where g.job_id = p_job_id), '[]'::jsonb),
    'not_in_group', (
      select count(*) from public.photos p
      join public.upload_batches b on b.id = p.batch_id
      left join public.photo_tags t on t.photo_id = p.id
      where p.job_id = p_job_id and p.binned_at is null and p.status <> 'uploading'
        and (t.place = 'group_photo' or (t.photo_id is null and b.kind = 'group'))
        and not exists (select 1 from public.photo_group_photos l where l.photo_id = p.id)));
$$;

-- A group's members by last and first name, keyset after p_after (a child's id), up to 501 (the API asks one more).
create function public.list_photo_group_members(p_group_id uuid, p_after uuid, p_limit int) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'first_name', x.first_name, 'last_name', x.last_name, 'class_id', x.class_id,
      'class_name', x.class_name)
    order by lower(x.last_name), lower(x.first_name), x.id), '[]'::jsonb)
  from (
    select c.id, c.first_name, c.last_name, c.group_id as class_id, k.name as class_name
    from public.photo_group_members m
    join public.children c on c.id = m.child_id and c.studio_id = m.studio_id
    left join public.job_groups k on k.id = c.group_id and k.studio_id = c.studio_id
    where m.group_id = p_group_id
      and (p_after is null
           or (lower(c.last_name), lower(c.first_name), c.id)
              > (select lower(a.last_name), lower(a.first_name), a.id from public.children a where a.id = p_after))
    order by lower(c.last_name), lower(c.first_name), c.id
    limit least(greatest(coalesce(p_limit, 100), 1), 501)
  ) x;
$$;

-- One page of a group's photos (p_group_id), or of the job's group photos in no group (p_group_id null), in tagging
-- order, keyset on the photo's id. Out of the bin; card photos of a group upload aren't group photos (call 2).
create function public.photo_group_photos_page(p_job_id uuid, p_group_id uuid, p_after uuid, p_limit int)
returns table (id uuid, status public.photo_status, place public.photo_place, flag public.photo_flag, source text,
  qr_kind text, qr_card boolean)
language plpgsql stable
set search_path = ''
as $$
declare
  v_seq bigint;
  v_at timestamp;
  v_name text;
  v_id uuid;
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 501);
begin
  if p_after is not null then
    select p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename, p.id
    into v_seq, v_at, v_name, v_id
    from public.photos p where p.id = p_after and p.job_id = p_job_id;
    if v_id is null then
      return;
    end if;
  end if;
  return query
    select p.id, p.status, t.place, t.flag, t.source, p.qr_kind, p.qr_card_id is not null
    from public.photos p
    join public.upload_batches b on b.id = p.batch_id
    left join public.photo_tags t on t.photo_id = p.id
    where p.job_id = p_job_id and p.binned_at is null and p.status <> 'uploading'
      and (t.place = 'group_photo' or (t.photo_id is null and b.kind = 'group'))
      and case when p_group_id is null
        then not exists (select 1 from public.photo_group_photos l where l.photo_id = p.id)
        else exists (select 1 from public.photo_group_photos l where l.photo_id = p.id and l.group_id = p_group_id)
      end
      and (v_id is null or (p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp),
                            p.original_filename collate "C", p.id) > (v_seq, v_at, v_name collate "C", v_id))
    order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
    limit v_limit;
end;
$$;

-- ── Groups: writes (service role, acting for the person; C10, C11) ────────────────────────────────────────────────
-- Errors carry no values: group_name_taken, group_limit, group_not_in_job, not_group_photo, group_has_photos,
-- photo_sold, job_closed. Group changes of a job take turns on photo_groups:<job>.
create function app.check_group_name(p_name text) returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_name is null or char_length(p_name) not between 1 and 60 or p_name <> btrim(p_name)
     or p_name ~ '[\u0001-\u001F\u007F-\u009F‪-‮⁦-⁩]' then
    raise exception 'A group name is 1 to 60 characters' using errcode = '22023';
  end if;
end;
$$;

create function public.create_photo_group(p_actor uuid, p_job_id uuid, p_name text) returns uuid
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
  perform app.check_group_name(p_name);
  perform pg_advisory_xact_lock(hashtextextended('photo_groups:' || p_job_id::text, 0));
  if (select count(*) from public.photo_groups g where g.job_id = p_job_id) >= 500 then
    raise exception 'group_limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.photo_groups g where g.job_id = p_job_id and lower(g.name) = lower(p_name)) then
    raise exception 'group_name_taken' using errcode = 'P0001';
  end if;
  insert into public.photo_groups (studio_id, job_id, name) values (v_studio, p_job_id, p_name)
  returning id into v_id;
  perform app.emit(v_studio, 'photo_group.created', v_id,
    jsonb_build_object('job_id', p_job_id, 'source', 'manual'));
  perform app.end_act_for(v_previous);
  return v_id;
end;
$$;

create function public.rename_photo_group(p_actor uuid, p_group_id uuid, p_name text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid;
  v_job uuid;
  v_previous text;
begin
  select g.studio_id, g.job_id into v_studio, v_job from public.photo_groups g where g.id = p_group_id;
  if v_studio is null then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.assert_job_open(v_job);
  perform app.check_group_name(p_name);
  perform pg_advisory_xact_lock(hashtextextended('photo_groups:' || v_job::text, 0));
  if exists (select 1 from public.photo_groups g
             where g.job_id = v_job and g.id <> p_group_id and lower(g.name) = lower(p_name)) then
    raise exception 'group_name_taken' using errcode = 'P0001';
  end if;
  update public.photo_groups g set name = p_name where g.id = p_group_id and g.name is distinct from p_name;
  if found then
    perform app.emit(v_studio, 'photo_group.updated', p_group_id,
      jsonb_build_object('fields', jsonb_build_array('name')));
  end if;
  perform app.end_act_for(v_previous);
end;
$$;

-- Deletes a group (C4; ADR 0030, call 3). Its photos go to another group of the job (p_photos_to 'group', p_target)
-- or to the bin ('bin': only the photos shown in no other group; the rest just leave this group). "Its photos" are
-- the ones the Groups list counts: out of the bin and not card photos (a card frame of a group upload stays a card
-- photo, call 2); links to binned photos and card photos are dropped quietly, and a card photo is never binned. A
-- group with photos needs a destination (group_has_photos); if any photo to bin has sold, nothing changes
-- (photo_sold). Members leave with the group. The group's row is locked first, so a file registered meanwhile can't
-- link a photo to it (register_photos takes the same row). Returns {moved: photos newly in the target, binned}.
create function public.delete_photo_group(p_actor uuid, p_group_id uuid, p_photos_to text, p_target uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid;
  v_job uuid;
  v_previous text;
  v_photos uuid[];
  v_bin uuid[];
  v_moved int := 0;
  v_binned int := 0;
begin
  select g.studio_id, g.job_id into v_studio, v_job from public.photo_groups g where g.id = p_group_id;
  if v_studio is null then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.assert_job_open(v_job);
  if (p_photos_to is not null and p_photos_to not in ('group', 'bin'))
     or (coalesce(p_photos_to, '') = 'group') <> (p_target is not null) or p_target = p_group_id then
    raise exception 'Photos go to another group or to the bin' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('photo_groups:' || v_job::text, 0));
  perform 1 from public.photo_groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  v_photos := array(select l.photo_id from public.photo_group_photos l
                    join public.photos p on p.id = l.photo_id
                    left join public.photo_tags t on t.photo_id = p.id
                    where l.group_id = p_group_id and p.binned_at is null
                      and (t.photo_id is null or t.place = 'group_photo')
                    order by l.photo_id);
  if cardinality(v_photos) > 0 and p_photos_to is null then
    raise exception 'group_has_photos' using errcode = 'P0001';
  end if;
  if p_photos_to = 'group' then
    if not exists (select 1 from public.photo_groups g where g.id = p_target and g.job_id = v_job) then
      raise exception 'group_not_in_job' using errcode = 'P0001';
    end if;
    perform 1 from public.photo_groups g where g.id = p_target for key share;
    insert into public.photo_group_photos (studio_id, job_id, group_id, photo_id, added_by)
    select v_studio, v_job, p_target, x, p_actor from unnest(v_photos) x
    on conflict (group_id, photo_id) do nothing;
    get diagnostics v_moved = row_count;
  elsif p_photos_to = 'bin' then
    v_bin := array(select p.id from public.photos p
                   where p.id = any (v_photos) and p.status <> 'uploading'
                     and not exists (select 1 from public.photo_group_photos l
                                     where l.photo_id = p.id and l.group_id <> p_group_id));
    if exists (select 1 from public.photos p where p.id = any (v_bin) and p.sold_at is not null) then
      raise exception 'photo_sold' using errcode = 'P0001';
    end if;
    -- The bin's own trigger writes photos.binned (ids and a count).
    update public.photos p set binned_at = now(), binned_by = p_actor where p.id = any (v_bin);
    get diagnostics v_binned = row_count;
  end if;
  delete from public.photo_group_photos l where l.group_id = p_group_id;
  delete from public.photo_groups g where g.id = p_group_id;
  perform app.emit(v_studio, 'photo_group.deleted', p_group_id, jsonb_build_object(
    'job_id', v_job, 'photos_to', p_photos_to, 'target_group_id', p_target));
  perform app.end_act_for(v_previous);
  return jsonb_build_object('moved', v_moved, 'binned', v_binned);
end;
$$;

-- Makes a group for each value of a roster column, once (D156: a shortcut, not a switch; C3 as Seenu narrowed it, ADR
-- 0030): p_column 'class' (the job's classes, in its own word for them) or 'grade'. Never a column that holds a
-- person's name or ID (a group name would keep it after the person is erased), nor parent email or a flag. A value is
-- cleaned as core's columnGroupsPreview cleans it (runs of ASCII whitespace made one space, ends trimmed); values
-- are compared ignoring case and the first by code point names the group; a blank value, or one that can't be a group
-- name (over 60 characters, control or bidi characters), makes no group; a value whose name is already a group is
-- skipped (its group is left alone). Each new group's members are the people with that value. All or nothing: the
-- 500-group limit is checked first. Returns {groups, members, skipped}.
create function public.make_photo_groups_from_column(p_actor uuid, p_job_id uuid, p_column text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_new int;
  v_skipped int;
  v_members int := 0;
  v_n int;
  v_id uuid;
  r record;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.assert_job_open(p_job_id);
  if coalesce(p_column, '') not in ('class', 'grade') then
    raise exception 'The column is class or grade' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('photo_groups:' || p_job_id::text, 0));

  -- One row per distinct value (ignoring case), with its people and whether a group already has its name.
  for r in
    with vals as (
      select c.id as child_id,
        btrim(regexp_replace(case p_column when 'class' then k.name else c.grade end, '[ \t\n\r\f\v]+', ' ', 'g'), ' ')
          as value
      from public.children c
      left join public.job_groups k on k.id = c.group_id and k.studio_id = c.studio_id
      where c.job_id = p_job_id and c.studio_id = v_studio
    ), named as (
      select min(v.value collate "C") as name, array_agg(v.child_id order by v.child_id) as children
      from vals v
      where v.value is not null and char_length(v.value) between 1 and 60
        and v.value !~ '[\u0001-\u001F\u007F-\u009F‪-‮⁦-⁩]'
      group by lower(v.value)
    )
    select n.name, n.children,
      exists (select 1 from public.photo_groups g where g.job_id = p_job_id and lower(g.name) = lower(n.name)) as taken
    from named n
    order by lower(n.name)
  loop
    if r.taken then
      v_skipped := coalesce(v_skipped, 0) + 1;
      continue;
    end if;
    v_new := coalesce(v_new, 0) + 1;
    -- All or nothing (ADR 0030, call 9): the limit is checked before the first group of a set that would pass it.
    if (select count(*) from public.photo_groups g where g.job_id = p_job_id) >= 500 then
      raise exception 'group_limit' using errcode = 'P0001';
    end if;
    insert into public.photo_groups (studio_id, job_id, name) values (v_studio, p_job_id, r.name)
    returning id into v_id;
    perform app.emit(v_studio, 'photo_group.created', v_id,
      jsonb_build_object('job_id', p_job_id, 'source', 'column'));
    insert into public.photo_group_members (studio_id, job_id, group_id, child_id, added_by)
    select v_studio, p_job_id, v_id, c, p_actor from unnest(r.children) c;
    get diagnostics v_n = row_count;
    v_members := v_members + v_n;
  end loop;
  v_new := coalesce(v_new, 0);
  v_skipped := coalesce(v_skipped, 0);

  perform app.emit(v_studio, 'photo_groups.made_from_column', p_job_id, jsonb_build_object(
    'job_id', p_job_id, 'column', p_column, 'groups', v_new, 'members', v_members));
  perform app.end_act_for(v_previous);
  return jsonb_build_object('groups', v_new, 'members', v_members, 'skipped', v_skipped);
end;
$$;

-- Adds and removes a group's members by hand: up to 500 of each, the job's own people (group_not_in_job), never the
-- same person in both. Returns {added, removed, count}.
create function public.set_photo_group_members(p_actor uuid, p_group_id uuid, p_add uuid[], p_remove uuid[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid;
  v_job uuid;
  v_previous text;
  v_add uuid[] := coalesce(p_add, '{}');
  v_remove uuid[] := coalesce(p_remove, '{}');
  v_added int;
  v_removed int;
  v_count int;
begin
  select g.studio_id, g.job_id into v_studio, v_job from public.photo_groups g where g.id = p_group_id;
  if v_studio is null then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.assert_job_open(v_job);
  if cardinality(v_add) > 500 or cardinality(v_remove) > 500 or cardinality(v_add) + cardinality(v_remove) = 0
     or v_add && v_remove or array_position(v_add, null) is not null or array_position(v_remove, null) is not null then
    raise exception 'Send up to 500 people to add and to remove' using errcode = '22023';
  end if;
  if (select count(*) from public.children c where c.job_id = v_job and c.id = any (v_add || v_remove))
     <> (select count(distinct x) from unnest(v_add || v_remove) x) then
    raise exception 'group_not_in_job' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('photo_groups:' || v_job::text, 0));
  insert into public.photo_group_members (studio_id, job_id, group_id, child_id, added_by)
  select distinct v_studio, v_job, p_group_id, x, p_actor from unnest(v_add) x
  on conflict (group_id, child_id) do nothing;
  get diagnostics v_added = row_count;
  delete from public.photo_group_members m where m.group_id = p_group_id and m.child_id = any (v_remove);
  get diagnostics v_removed = row_count;
  select count(*) into v_count from public.photo_group_members m where m.group_id = p_group_id;
  if v_added + v_removed > 0 then
    perform app.emit(v_studio, 'photo_group.members_changed', p_group_id,
      jsonb_build_object('added', v_added, 'removed', v_removed, 'count', v_count));
  end if;
  perform app.end_act_for(v_previous);
  return jsonb_build_object('added', v_added, 'removed', v_removed, 'count', v_count);
end;
$$;

-- Moves group photos by hand from one group (or from no group, p_from null) to another of the job: up to 500 of the
-- job's group photos, each in p_from (or in no group); they join p_to (if not there already) and leave p_from.
create function public.move_group_photos(p_actor uuid, p_job_id uuid, p_from uuid, p_to uuid, p_photo_ids uuid[])
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.assert_job_open(p_job_id);
  if p_to is null or p_to = p_from then
    raise exception 'Move to another group' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('photo_groups:' || p_job_id::text, 0));
  perform app.check_group_photos(p_job_id, p_photo_ids);
  perform app.check_job_groups(p_job_id, case when p_from is null then array[p_to] else array[p_from, p_to] end);
  if exists (select 1 from unnest(p_photo_ids) x
             where case when p_from is null
               then exists (select 1 from public.photo_group_photos l where l.photo_id = x)
               else not exists (select 1 from public.photo_group_photos l where l.photo_id = x and l.group_id = p_from)
             end) then
    raise exception 'group_not_in_job' using errcode = 'P0001';
  end if;
  insert into public.photo_group_photos (studio_id, job_id, group_id, photo_id, added_by)
  select distinct v_studio, p_job_id, p_to, x, p_actor from unnest(p_photo_ids) x
  on conflict (group_id, photo_id) do nothing;
  delete from public.photo_group_photos l where l.group_id = p_from and l.photo_id = any (p_photo_ids);
  perform app.emit(v_studio, 'photo_group.photos_moved', p_to, jsonb_build_object(
    'photo_ids', to_jsonb(array(select distinct x from unnest(p_photo_ids) x order by x)),
    'from', p_from, 'to', p_to));
  perform app.end_act_for(v_previous);
  return (select count(distinct x) from unnest(p_photo_ids) x)::int;
end;
$$;

-- Also shows group photos in more groups (Also show in…): links only added, those already there skipped. Returns how
-- many links were added.
create function public.also_show_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[], p_group_ids uuid[])
returns int
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
  perform app.assert_job_open(p_job_id);
  perform pg_advisory_xact_lock(hashtextextended('photo_groups:' || p_job_id::text, 0));
  perform app.check_group_photos(p_job_id, p_photo_ids);
  perform app.check_job_groups(p_job_id, p_group_ids);
  insert into public.photo_group_photos (studio_id, job_id, group_id, photo_id, added_by)
  select distinct v_studio, p_job_id, g, x, p_actor from unnest(p_group_ids) g cross join unnest(p_photo_ids) x
  on conflict (group_id, photo_id) do nothing;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform app.emit(v_studio, 'photo_group.photos_shown', p_job_id, jsonb_build_object(
      'photo_ids', to_jsonb(array(select distinct x from unnest(p_photo_ids) x order by x)),
      'group_ids', to_jsonb(array(select distinct g from unnest(p_group_ids) g order by g))));
  end if;
  perform app.end_act_for(v_previous);
  return v_count;
end;
$$;

-- ── What parents see (amends ADR 0022) ────────────────────────────────────────────────────────────────────────────
-- photo_parent_visible as in 20261012100000, with group photos in place of class sets: a group photo only when it is
-- in a group with at least one member (C2: one in no group is seen by no one). It means "some parent may see it",
-- never "this parent may": a parent's own access is app.parent_visible_photos for their child. Never use it to
-- authorize one parent. A member's Do not publish doesn't hide a group photo from the other members (Seenu, Oct 14);
-- that child's own gallery stays unavailable.
create or replace function public.photo_parent_visible(p_photo_id uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((
    select p.status = 'ready' and p.binned_at is null
      and p.qr_kind is distinct from 'card' and p.qr_kind is distinct from 'other_card'
      and (p.qr_kind = 'none' or t.source = 'manual')
      and t.flag is null
      and b.tag_round = b.tagged_round
      and (t.place = 'child'
           or (t.place = 'group_photo'
               and exists (select 1 from public.photo_group_photos l
                           join public.photo_group_members m on m.group_id = l.group_id
                           where l.photo_id = p.id)))
    from public.photos p
    join public.photo_tags t on t.photo_id = p.id
    join public.upload_batches b on b.id = p.batch_id
    where p.id = p_photo_id), false);
$$;

-- The set-based twin (pgTAP 021 and 029 prove they agree): one child's portraits and, with p_group_photos, the group
-- photos of every group the child is a member of, once each. ord is the tagging order over what is returned.
drop function app.parent_visible_photos(uuid, uuid, uuid);
create function app.parent_visible_photos(p_job_id uuid, p_child_id uuid, p_group_photos boolean default false)
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
    and ((t.place = 'child' and t.child_id = p_child_id)
         or (coalesce(p_group_photos, false) and t.place = 'group_photo'
             and exists (select 1 from public.photo_group_photos l
                         join public.photo_group_members m on m.group_id = l.group_id and m.studio_id = l.studio_id
                         where l.photo_id = p.id and l.studio_id = t.studio_id and m.child_id = p_child_id)))
    and p.status = 'ready' and p.binned_at is null
    and p.qr_kind is distinct from 'card' and p.qr_kind is distinct from 'other_card'
    and (p.qr_kind = 'none' or t.source = 'manual')
    and t.flag is null
    and b.tag_round = b.tagged_round;
$$;

-- A child's gallery (as in 20261012700000): their portraits, then the group photos of their groups (view only, C5).
create or replace function public.shop_gallery(p_session_hash text, p_child_id uuid) returns jsonb
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
      from (select * from app.parent_visible_photos(v_child.job_id, v_child.id, false) p
            where p.place = 'child' order by p.ord limit 500) x), '[]'::jsonb),
    'group_photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'width', x.width, 'height', x.height) order by x.ord)
      from (select * from app.parent_visible_photos(v_child.job_id, v_child.id, true) p
            where p.place = 'group_photo' order by p.ord limit 500) x), '[]'::jsonb));
end;
$$;

-- ── Subjects: each person's groups, and the Group chip ────────────────────────────────────────────────────────────
-- list_children as in 20261014100100, with each child's photo groups ({id, name}, by name).
create or replace function public.list_children(
  p_job_id uuid, p_group_id uuid default null, p_after uuid default null, p_limit int default 200,
  p_no_group boolean default false
) returns jsonb
language sql stable
set search_path = ''
as $$
  with base as (
    select c.id, c.studio_id, c.job_id, c.group_id, g.name as group_name, c.first_name, c.last_name, c.student_id,
      c.grade, c.parent_email, c.do_not_photograph, c.do_not_publish, c.school_provided, c.access_code_ciphertext,
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
  ),
  job as (
    select j.studio_id, app.has_role(j.studio_id, '{owner,admin,staff}') as sees_orders
    from public.jobs j where j.id = p_job_id
  ),
  photo_counts as (
    select t.child_id, count(*) as n
    from public.photo_tags t
    join public.photos p on p.studio_id = t.studio_id and p.job_id = t.job_id and p.id = t.photo_id
    where t.job_id = p_job_id and t.place = 'child' and t.child_id in (select id from page)
      and p.status = 'ready' and p.binned_at is null
    group by t.child_id
  ),
  -- The children on this page who have ordered (D148), for people who see orders.
  ordered as (
    select o.child_id
    from app.ordered_children((select studio_id from job), array(select id from page)) o
    where coalesce((select sees_orders from job), false)
  )
  select jsonb_build_object(
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'job_id', p.job_id, 'group_id', p.group_id, 'group_name', p.group_name,
        'first_name', p.first_name, 'last_name', p.last_name, 'student_id', p.student_id, 'grade', p.grade,
        'parent_email', p.parent_email, 'do_not_photograph', p.do_not_photograph, 'do_not_publish', p.do_not_publish,
        'school_provided', p.school_provided, 'access_code_ciphertext', p.access_code_ciphertext,
        'duplicate', p.duplicate, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'photo_count', coalesce((select pc.n from photo_counts pc where pc.child_id = p.id), 0),
        'has_paid_order', case when coalesce((select sees_orders from job), false)
                               then exists (select 1 from ordered o where o.child_id = p.id) end,
        'photo_groups', coalesce((
          select jsonb_agg(jsonb_build_object('id', pg.id, 'name', pg.name) order by lower(pg.name), pg.id)
          from public.photo_group_members m
          join public.photo_groups pg on pg.id = m.group_id and pg.studio_id = m.studio_id
          where m.child_id = p.id), '[]'::jsonb))
        order by lower(p.last_name), lower(p.first_name), p.id)
      from page p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'duplicates', (select count(*) from filtered f where f.duplicate));
$$;

-- save_list_filters as in 20261015000000, with a Group chip (a photo group of this job) on Photos and Subjects.
create or replace function public.save_list_filters(p_studio_id uuid, p_page public.list_page, p_job_id uuid,
  p_chips jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null or p_studio_id is null or p_page is null or not app.is_member(p_studio_id) then
    raise exception 'Not a member of this studio' using errcode = '42501';
  end if;
  if (p_job_id is not null) <> (p_page in ('job_subjects', 'job_orders', 'job_photos')) then
    raise exception 'list_filters_job' using errcode = '22023';
  end if;
  if p_job_id is not null
     and not exists (select 1 from public.jobs j where j.studio_id = p_studio_id and j.id = p_job_id) then
    raise exception 'list_filters_job' using errcode = '22023';
  end if;
  if p_chips is null or jsonb_typeof(p_chips) <> 'array' then
    raise exception 'list_filters_invalid' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_chips);
  if v_count > 8 then
    raise exception 'list_filters_too_many' using errcode = '22023';
  end if;
  -- Checked before any cast, so a malformed value never reaches an error message or the database log.
  if exists (
    select 1 from jsonb_array_elements(p_chips) e (chip)
    where jsonb_typeof(e.chip) <> 'object'
       or jsonb_typeof(e.chip -> 'key') is distinct from 'string'
       or (e.chip ->> 'key') !~ '^[a-z][a-zA-Z]{1,39}$'
       or (jsonb_typeof(e.chip -> 'value') is not null and jsonb_typeof(e.chip -> 'value') <> 'null'
           and (jsonb_typeof(e.chip -> 'value') <> 'string'
                or (e.chip ->> 'value') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))) then
    raise exception 'list_filters_invalid' using errcode = '22023';
  end if;
  if (select count(distinct (e.chip ->> 'key', coalesce(lower(e.chip ->> 'value'), '')))
      from jsonb_array_elements(p_chips) e (chip)) <> v_count then
    raise exception 'list_filters_duplicate' using errcode = '22023';
  end if;
  -- The keys each page takes, and which name a record (the same list as the API's LIST_FILTER_KEYS).
  if exists (
    select 1 from jsonb_array_elements(p_chips) e (chip)
    left join (values
      ('jobs', 'closingThisWeek', false), ('jobs', 'pictureDayThisMonth', false), ('jobs', 'client', true),
      ('orders', 'deliveryHome', false), ('orders', 'deliverySchool', false), ('orders', 'job', true),
      ('job_orders', 'deliveryHome', false), ('job_orders', 'deliverySchool', false),
      ('job_subjects', 'class', true), ('job_subjects', 'noClass', false),
      ('job_subjects', 'doNotPhotograph', false), ('job_subjects', 'doNotPublish', false),
      ('job_subjects', 'duplicates', false), ('job_subjects', 'noPhotos', false),
      ('job_subjects', 'group', true), ('job_photos', 'group', true),
      ('people_contacts', 'client', true),
      ('people_subjects', 'job', true), ('people_subjects', 'client', true)
    ) k (page, key, takes_id) on k.page = p_page::text and k.key = e.chip ->> 'key'
    where k.key is null or k.takes_id <> coalesce(jsonb_typeof(e.chip -> 'value') = 'string', false)) then
    raise exception 'list_filters_invalid' using errcode = '22023';
  end if;
  -- Every id is the studio's own record of the key's kind.
  if exists (
    select 1 from jsonb_array_elements(p_chips) e (chip)
    where jsonb_typeof(e.chip -> 'value') = 'string'
      and not case e.chip ->> 'key'
        when 'client' then exists (select 1 from public.clients c
          where c.studio_id = p_studio_id and c.id = (e.chip ->> 'value')::uuid)
        when 'job' then exists (select 1 from public.jobs j
          where j.studio_id = p_studio_id and j.id = (e.chip ->> 'value')::uuid)
        when 'class' then exists (select 1 from public.job_groups g
          where g.studio_id = p_studio_id and g.job_id = p_job_id and g.id = (e.chip ->> 'value')::uuid)
        when 'group' then exists (select 1 from public.photo_groups g
          where g.studio_id = p_studio_id and g.job_id = p_job_id and g.id = (e.chip ->> 'value')::uuid)
        else false
      end) then
    raise exception 'list_filters_record' using errcode = '22023';
  end if;

  delete from public.list_filter_chips c
  where c.studio_id = p_studio_id and c.user_id = v_user and c.page = p_page
    and c.job_id is not distinct from p_job_id;
  insert into public.list_filter_chips (studio_id, user_id, page, job_id, position, filter_key, filter_value)
  select p_studio_id, v_user, p_page, p_job_id, e.n::smallint, e.chip ->> 'key', (e.chip ->> 'value')::uuid
  from jsonb_array_elements(p_chips) with ordinality e (chip, n);

  perform app.emit(p_studio_id, 'list_filters.saved', p_job_id,
    jsonb_build_object('page', p_page, 'count', v_count));
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.is_group_photo(uuid), app.check_group_photos(uuid, uuid[]),
  app.check_job_groups(uuid, uuid[]), app.check_group_name(text),
  app.parent_visible_photos(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.tagging_photos(uuid, text, uuid, uuid, int), public.photo_people(uuid, uuid, uuid, int, int),
  public.list_photo_groups(uuid), public.list_photo_group_members(uuid, uuid, int),
  public.photo_group_photos_page(uuid, uuid, uuid, int)
  from public, anon;
grant execute on function public.tagging_photos(uuid, text, uuid, uuid, int), public.photo_people(uuid, uuid, uuid, int, int),
  public.list_photo_groups(uuid), public.list_photo_group_members(uuid, uuid, int),
  public.photo_group_photos_page(uuid, uuid, uuid, int)
  to authenticated, service_role;
-- Writes: the service role only (route handlers, after their own checks), never browsers.
revoke all on function
  public.create_upload_batch(uuid, uuid, text, uuid, uuid),
  public.create_photo_group(uuid, uuid, text),
  public.rename_photo_group(uuid, uuid, text),
  public.delete_photo_group(uuid, uuid, text, uuid),
  public.make_photo_groups_from_column(uuid, uuid, text),
  public.set_photo_group_members(uuid, uuid, uuid[], uuid[]),
  public.move_group_photos(uuid, uuid, uuid, uuid, uuid[]),
  public.also_show_photos(uuid, uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function
  public.create_upload_batch(uuid, uuid, text, uuid, uuid),
  public.create_photo_group(uuid, uuid, text),
  public.rename_photo_group(uuid, uuid, text),
  public.delete_photo_group(uuid, uuid, text, uuid),
  public.make_photo_groups_from_column(uuid, uuid, text),
  public.set_photo_group_members(uuid, uuid, uuid[], uuid[]),
  public.move_group_photos(uuid, uuid, uuid, uuid, uuid[]),
  public.also_show_photos(uuid, uuid, uuid[], uuid[])
  to service_role;

notify pgrst, 'reload schema';
