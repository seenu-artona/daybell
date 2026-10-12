-- Phase 1, step 5: QR tagging and review (D32, F16, D142 #7, D143, D96, D113; Seenu's answers of Oct 12, 2026;
-- ADR 0018, amending ADR 0015 and 0016). A forward migration: 20261012000000 is deployed.
-- The image worker reads each photo's QR card (in Canada, D113). The API tags each upload batch with the rules in
-- packages/core/src/tagging.ts and writes the result here; people fix tags at review. Card codes, names and access
-- codes never go in events, logs or error messages: events carry ids and counts only.

-- ── Cards: a blank card can be claimed ────────────────────────────────────────────────────────────────────────────
-- ADR 0015's order for naming a blank card's child: release the card's code, make the child with the same code, set
-- the card's child. The card's check (a blank card has a code; a child's card never does) can't be deferred, and the
-- child FK refuses a child that doesn't exist yet, so claim_blank_card sets child_id and clears the code in one
-- statement with this FK deferred to just after the child is inserted. Releasing first matters: the release trigger
-- deletes the registry row by hash, so releasing after the child's claim would delete the child's claim.
alter table public.qr_cards alter constraint qr_cards_child_fk deferrable initially immediate;
-- Lets a photo reference a card together with its studio and job, so a photo's card is always one of its own job's.
alter table public.qr_cards add constraint qr_cards_studio_job_id_key unique (studio_id, job_id, id);

-- ── Photos: what the worker read ──────────────────────────────────────────────────────────────────────────────────
-- qr_kind, null until a worker that reads cards processed the photo (older results count as plain photos):
-- - none: no Daybell card;
-- - card: one of the job's cards (qr_card_id), resolved by record_photo_result within the photo's own job only;
-- - unreadable: something that looks like a card but couldn't be read for sure (Seenu, answer 1);
-- - other_card: a Daybell card that isn't one of this job's (plan answer 2). Never looked up anywhere else.
-- A card deleted later (its child removed from a draft job) leaves qr_kind 'card' with no card: tagging treats it as
-- another job's card.
alter table public.photos
  add column qr_kind text check (qr_kind in ('none', 'card', 'unreadable', 'other_card')),
  add column qr_card_id uuid,
  add constraint photos_qr_card_fk foreign key (studio_id, job_id, qr_card_id)
    references public.qr_cards (studio_id, job_id, id) on delete set null (qr_card_id),
  add constraint photos_qr_card check (qr_card_id is null or qr_kind = 'card'),
  -- Lets a tag reference its photo together with the photo's studio and job.
  add constraint photos_studio_job_id_key unique (studio_id, job_id, id);
create index photos_qr_card_idx on public.photos (qr_card_id) where qr_card_id is not null;
grant select (qr_kind, qr_card_id) on public.photos to authenticated;
comment on column public.photos.qr_kind is
  'What the image worker read: none, card (qr_card_id), unreadable, or other_card (not this job''s). Card codes are never stored on photos.';

-- ── Upload batches: class-photo sets and tagging rounds ───────────────────────────────────────────────────────────
-- group_id: a class-photo upload (Seenu, answer 3): every photo goes to that class's "Class photo" set (amends ADR
-- 0016: a batch can now mean a class).
-- tag_round goes up whenever something tagging reads changes (a photo added, processed, binned or restored, its card
-- read or deleted); tagged_round is the round last tagged. Tagging writes only for the round it read, so a run that
-- read stale photos never overwrites a newer one.
alter table public.upload_batches
  add column group_id uuid,
  add column tag_round bigint not null default 0,
  add column tagged_round bigint not null default 0,
  add constraint upload_batches_group_fk foreign key (studio_id, job_id, group_id)
    references public.job_groups (studio_id, job_id, id) on delete restrict;
create index upload_batches_untagged_idx on public.upload_batches (job_id) where tag_round > tagged_round;
-- Batches uploaded before this step have photos but no tags: tag them (the daily clean-up sweeps them).
update public.upload_batches b set tag_round = 1
where exists (select 1 from public.photos p where p.batch_id = b.id and p.status <> 'uploading');

-- ── Tags ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create type public.photo_place as enum ('child', 'class_set', 'leftovers', 'card', 'blank_card');
-- after_purge: photos were purged from the bin near this one, and where they were among the photos that appeared or
-- moved since can't be known (Seenu, answer 13): never guessed, checked at review.
create type public.photo_flag as enum ('unreadable_card', 'other_card', 'after_unreadable', 'after_failed',
  'after_purge');

-- What photos purged from the bin just before a photo did to the photos after them (packages/core's TagStep), kept
-- on the next photo of the batch by delete_purged_photos (security review 1): before_card, a card that sent the
-- photos after it to its child (before_card_id, null if the card has since been removed: then it counts as another
-- job's card); before_flag, a flag carried until the next card. Ids and flags only: never a filename.
alter table public.photos
  add column before_card boolean not null default false,
  add column before_card_id uuid,
  add column before_flag public.photo_flag check (before_flag in ('after_unreadable', 'after_failed')),
  add constraint photos_before_card_fk foreign key (studio_id, job_id, before_card_id)
    references public.qr_cards (studio_id, job_id, id) on delete set null (before_card_id),
  add constraint photos_before_card check (before_card or before_card_id is null);
create index photos_before_card_idx on public.photos (before_card_id) where before_card_id is not null;

-- Purges that left a step (Seenu, answer 13). purge_steps: a purge in this batch carried a step onto the next photo or
-- left one with no photo after it (purge_tail: the purged photos were last in the batch). after_purge: the photo came
-- into the batch's tagging order, or moved in it (its capture time changed), after such a purge, so where the purged
-- photos were relative to it is unknown. Tagging flags what that could change instead of guessing (core's tagBatch).
alter table public.upload_batches
  add column purge_steps boolean not null default false,
  add column purge_tail boolean not null default false,
  add constraint upload_batches_purge_tail check (purge_steps or not purge_tail);
alter table public.photos add column after_purge boolean not null default false;

-- Where each processed photo is (one row per photo): a child, a class's "Class photo" set, Leftovers, a card photo
-- (hidden from parents), or a blank card's photos waiting for the studio to name the child. Every ready photo of a
-- tagged batch has a row. source 'auto' rows are written by tagging; 'manual' rows by people at review (moves and
-- confirmations), and tagging never overwrites them. A flag means "check this": flagged photos are hidden from parents
-- until confirmed.
create table public.photo_tags (
  photo_id uuid primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  place public.photo_place not null,
  child_id uuid,
  group_id uuid,
  card_id uuid,
  flag public.photo_flag,
  source text not null check (source in ('auto', 'manual')),
  -- Who moved or confirmed it (manual rows). No foreign key, as on events: erasing a person is never blocked.
  tagged_by uuid,
  updated_at timestamptz not null default now(),
  constraint photo_tags_photo_fk foreign key (studio_id, job_id, photo_id)
    references public.photos (studio_id, job_id, id) on delete cascade,
  -- A removed child's photos go to Leftovers first (app.on_child_removed_tags), so this never blocks.
  constraint photo_tags_child_fk foreign key (studio_id, job_id, child_id)
    references public.children (studio_id, job_id, id),
  constraint photo_tags_group_fk foreign key (studio_id, job_id, group_id)
    references public.job_groups (studio_id, job_id, id) on delete restrict,
  constraint photo_tags_card_fk foreign key (studio_id, job_id, card_id)
    references public.qr_cards (studio_id, job_id, id) on delete set null (card_id),
  constraint photo_tags_place_ids check (
    (place = 'child') = (child_id is not null)
    and (place = 'class_set') = (group_id is not null)
    and (card_id is null or place in ('card', 'blank_card'))
    and (place <> 'blank_card' or card_id is not null)),
  -- A manual tag has no flag, except a card photo mark undone (unreadable_card, Seenu answer 12) or a removed child's
  -- photos after a purged card (after_purge, answer 13): checked again at review, never changed by tagging.
  constraint photo_tags_manual check (source = 'auto' or flag is null or flag in ('unreadable_card', 'after_purge')),
  -- Automatic tags have no person; manual ones name who made them (nobody when the system moved them, e.g. a removed
  -- child's photos).
  constraint photo_tags_tagged_by check (source = 'manual' or tagged_by is null)
);
create index photo_tags_studio_idx on public.photo_tags (studio_id);
create index photo_tags_job_place_idx on public.photo_tags (job_id, place);
create index photo_tags_child_idx on public.photo_tags (child_id) where child_id is not null;
create index photo_tags_group_idx on public.photo_tags (group_id) where group_id is not null;
create index photo_tags_card_idx on public.photo_tags (card_id) where card_id is not null;
create index photo_tags_flagged_idx on public.photo_tags (job_id) where flag is not null;
comment on table public.photo_tags is
  'Where each photo is after QR tagging and review. Card photos and flagged photos are never shown to parents.';

create trigger photo_tags_touch before update on public.photo_tags
for each row execute function app.touch_updated_at();

alter table public.photo_tags enable row level security;
create policy "members read their studio's photo tags" on public.photo_tags
  for select to authenticated using (app.is_member(studio_id));
-- No write policy or grant: tags are written by the functions below (service role), which check the person's role.
revoke all on public.photo_tags from anon, authenticated;
grant select on public.photo_tags to authenticated;

-- ── Review state ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Someone clicked Mark reviewed (Seenu, answer 4). The row is removed when new photos arrive or a change puts photos in
-- Leftovers or flags them, which reopens the checklist task; moving photos between children doesn't (plan answer 5).
create table public.job_tagging_reviews (
  job_id uuid primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  -- No foreign key, as on events.
  reviewed_by uuid not null,
  constraint job_tagging_reviews_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete cascade
);
create index job_tagging_reviews_studio_idx on public.job_tagging_reviews (studio_id);
alter table public.job_tagging_reviews enable row level security;
create policy "members read their studio's tagging reviews" on public.job_tagging_reviews
  for select to authenticated using (app.is_member(studio_id));
revoke all on public.job_tagging_reviews from anon, authenticated;
grant select on public.job_tagging_reviews to authenticated;

-- Takes each job's tagging lock first (in job order), as Mark reviewed does, so a review can't be saved just after the
-- reopen it would have missed (code review nice 1).
create function app.reopen_tagging_review(p_job_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || j::text, 0))
  from (select distinct x as j from unnest(p_job_ids) x where x is not null order by x) ids;
  delete from public.job_tagging_reviews r where r.job_id = any (p_job_ids);
end;
$$;

-- ── Keeping rounds and reviews up to date ─────────────────────────────────────────────────────────────────────────
-- Statement-level, with transition tables: one update per statement, however many photos it touched. The old/new
-- join is kept to a hash join, as in ADR 0016's bin trigger.
create function app.on_photos_tagging_change() returns trigger
language plpgsql security definer
set search_path = ''
set enable_nestloop = off
as $$
begin
  if tg_op = 'INSERT' then
    update public.upload_batches b set tag_round = b.tag_round + 1
    where b.id in (select distinct n.batch_id from new_rows n);
    -- New photos reopen the review (Seenu, answer 4).
    perform app.reopen_tagging_review(array(select distinct n.job_id from new_rows n));
  elsif tg_op = 'DELETE' then
    -- Cancelled uploads and purged photos (from the bin) were never in tagging's input.
    update public.upload_batches b set tag_round = b.tag_round + 1
    where b.id in (select distinct o.batch_id from old_rows o
                   where o.status <> 'uploading' and o.binned_at is null);
  else
    update public.upload_batches b set tag_round = b.tag_round + 1
    where b.id in (
      select distinct n.batch_id from new_rows n join old_rows o on o.id = n.id
      where (n.status, n.qr_kind, n.qr_card_id, n.binned_at is null, n.captured_at, n.before_card, n.before_card_id,
             n.before_flag, n.after_purge)
        is distinct from (o.status, o.qr_kind, o.qr_card_id, o.binned_at is null, o.captured_at, o.before_card,
                          o.before_card_id, o.before_flag, o.after_purge));
  end if;
  return null;
end;
$$;
create trigger photos_tagging_insert after insert on public.photos
referencing new table as new_rows
for each statement execute function app.on_photos_tagging_change();
create trigger photos_tagging_update after update on public.photos
referencing old table as old_rows new table as new_rows
for each statement execute function app.on_photos_tagging_change();
create trigger photos_tagging_delete after delete on public.photos
referencing old table as old_rows
for each statement execute function app.on_photos_tagging_change();

-- A photo that comes into its batch's tagging order (it leaves 'uploading') or moves in it (its capture time changes)
-- after a purge left a step in the batch is marked after_purge (Seenu, answer 13): where the purged photos were
-- relative to it is unknown.
create function app.on_photo_after_purge() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.after_purge then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'uploading' then
      return new;
    end if;
  elsif not ((old.status = 'uploading' and new.status <> 'uploading')
             or old.captured_at is distinct from new.captured_at) then
    return new;
  end if;
  if exists (select 1 from public.upload_batches b where b.id = new.batch_id and b.purge_steps) then
    new.after_purge := true;
  end if;
  return new;
end;
$$;
create trigger photos_after_purge before insert or update of status, captured_at on public.photos
for each row execute function app.on_photo_after_purge();

-- Children are removed only from draft jobs. Their photos go to Leftovers (by hand, so tagging won't send them back
-- to a child that no longer exists), which reopens the review. A photo that may be a card (unreadable_card,
-- other_card) keeps its flag and source, so it still has to be confirmed before it can be moved (security review 3-4;
-- an undone card photo mark stays the reviewer's, answer 12). In a batch where the child's card was purged from the
-- bin, the photos it gave the child are flagged after_purge (answer 13): whose they are can't be known any more. Locks
-- are taken in tagging runs' order (the batches, then the job's tagging lock), as removing the child's card touches the
-- batches of its card photos.
create function app.on_child_removed_tags() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform 1 from public.upload_batches b
  where b.id in (select p.batch_id from public.photo_tags t join public.photos p on p.id = t.photo_id
                 where t.child_id = old.id
                 union
                 select p.batch_id from public.photos p join public.qr_cards q
                   on q.id = p.qr_card_id or q.id = p.before_card_id
                 where q.child_id = old.id)
  order by b.id
  for update;
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || old.job_id::text, 0));
  update public.photo_tags t
  set place = 'leftovers', child_id = null,
    flag = case
      when t.flag in ('unreadable_card', 'other_card') then t.flag
      when exists (select 1 from public.photos p join public.photos x on x.batch_id = p.batch_id
                   join public.qr_cards q on q.id = x.before_card_id
                   where p.id = t.photo_id and q.child_id = old.id) then 'after_purge'::public.photo_flag
    end,
    source = case when t.flag in ('unreadable_card', 'other_card') then t.source else 'manual' end,
    tagged_by = case when t.flag in ('unreadable_card', 'other_card') then t.tagged_by else (select auth.uid()) end
  where t.child_id = old.id;
  if found then
    perform app.reopen_tagging_review(array[old.job_id]);
  end if;
  return old;
end;
$$;
create trigger children_tags_to_leftovers before delete on public.children
for each row execute function app.on_child_removed_tags();

-- ── The image worker's result, with what it read ──────────────────────────────────────────────────────────────────
-- p_result as before (ADR 0016), and for a ready photo qr: {kind: none | card | unreadable, card_code}. qr is required
-- for ready results (security review 2): a result from a worker that doesn't read cards is refused, so its message goes
-- back to the queue for a worker that does, rather than tagging the photo as if it had no card.
-- A card code is looked up among the photo's own job's cards only: anything else is another job's card. Card codes are
-- checked here so a bad value is refused without values in the error.
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
    processed_at = now()
  where p.id = p_photo_id and p.status = 'processing' and p.attempt = p_attempt;
  return found;
end;
$$;

-- ── Class-photo uploads ───────────────────────────────────────────────────────────────────────────────────────────
-- create_upload_batch gains the class a class-photo upload is for (Seenu, answer 3). Without it, an upload of
-- individual photos, tagged by their QR cards.
drop function public.create_upload_batch(uuid, uuid);
create function public.create_upload_batch(p_actor uuid, p_job_id uuid, p_group_id uuid default null)
returns uuid
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
  if p_group_id is not null and not exists (
    select 1 from public.job_groups g where g.studio_id = v_studio and g.job_id = p_job_id and g.id = p_group_id) then
    raise exception 'The class must be one of the job''s' using errcode = '22023';
  end if;
  insert into public.upload_batches (studio_id, job_id, created_by, group_id)
  values (v_studio, p_job_id, p_actor, p_group_id)
  returning id into v_id;
  perform app.end_act_for(v_previous);
  return v_id;
end;
$$;

-- ── Tagging a batch (the API runs the rules in packages/core, as the service role) ───────────────────────────────
-- What tagging needs about a batch: its class (for class-photo uploads), its round, and its photos in tagging order
-- (D142 #7), with what the worker read, each card's child (null for a blank card), the photo's current tag, what
-- purged photos just before it did (before), whether it is in the bin, and whether it came or moved after a purge
-- (after_purge; the batch's purge_tail: a purge left a step with no photo after it; answer 13). Photos in the bin are
-- kept, marked binned: they get no tag but still mark where cards were (security review 1). Photos still uploading are
-- left out. Ids only: never filenames or card codes.
create function public.tagging_inputs(p_batch_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'batch_id', b.id, 'studio_id', b.studio_id, 'job_id', b.job_id, 'group_id', b.group_id,
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
            'place', t.place, 'child_id', t.child_id, 'group_id', t.group_id, 'card_id', t.card_id,
            'flag', t.flag, 'source', t.source) end)
        order by coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id)
      from public.photos p
      left join public.qr_cards q on q.id = p.qr_card_id
      left join public.qr_cards bq on bq.id = p.before_card_id
      left join public.photo_tags t on t.photo_id = p.id
      where p.batch_id = b.id and p.status <> 'uploading'), '[]'::jsonb))
  from public.upload_batches b where b.id = p_batch_id;
$$;

-- Writes a batch's automatic tags for the round tagging read (p_round). A run that read stale photos is refused
-- (tagging_stale) and nothing changes. Only automatic tags are written: a photo tagged by hand keeps its tag. Each
-- write is {photo_id, place, child_id, group_id, card_id, flag}; place null removes the photo's automatic tag. One
-- photos.tagged event per run that changed something (ids and counts only), attributed to whoever started the upload.
create function public.apply_batch_tags(p_batch_id uuid, p_round bigint, p_writes jsonb) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.upload_batches;
  v_previous text := current_setting('request.jwt.claim.sub', true);
  v_changed int := 0;
  v_n int;
  v_reopen boolean;
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
      or (w ->> 'group_id' is not null and w ->> 'group_id' !~ '^[0-9a-f-]{36}$')
      or (w ->> 'card_id' is not null and w ->> 'card_id' !~ '^[0-9a-f-]{36}$')
      or (w ->> 'place' is not null and w ->> 'place' not in ('child', 'class_set', 'leftovers', 'card', 'blank_card'))
      or (w ->> 'flag' is not null
          and w ->> 'flag' not in ('unreadable_card', 'other_card', 'after_unreadable', 'after_failed', 'after_purge'))
      or (w ->> 'place' is not null and (
        ((w ->> 'place' = 'child') <> (w ->> 'child_id' is not null))
        or ((w ->> 'place' = 'class_set') <> (w ->> 'group_id' is not null))
        or (w ->> 'card_id' is not null and w ->> 'place' not in ('card', 'blank_card'))
        or (w ->> 'place' = 'blank_card' and w ->> 'card_id' is null)))
      or not exists (select 1 from public.photos p
                     where p.id = (w ->> 'photo_id')::uuid and p.batch_id = p_batch_id and p.binned_at is null)
      or (w ->> 'child_id' is not null and not exists (
        select 1 from public.children c
        where c.id = (w ->> 'child_id')::uuid and c.studio_id = v_batch.studio_id and c.job_id = v_batch.job_id))
      or (w ->> 'group_id' is not null and not exists (
        select 1 from public.job_groups g
        where g.id = (w ->> 'group_id')::uuid and g.studio_id = v_batch.studio_id and g.job_id = v_batch.job_id))
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
  -- nice 2).
  with written as (
    insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, group_id, card_id, flag, source)
    select (w ->> 'photo_id')::uuid, v_batch.studio_id, v_batch.job_id, (w ->> 'place')::public.photo_place,
      (w ->> 'child_id')::uuid, (w ->> 'group_id')::uuid, (w ->> 'card_id')::uuid, (w ->> 'flag')::public.photo_flag,
      'auto'
    from jsonb_array_elements(p_writes) w
    where w ->> 'place' is not null
    on conflict (photo_id) do update
    set place = excluded.place, child_id = excluded.child_id, group_id = excluded.group_id,
      card_id = excluded.card_id, flag = excluded.flag
    -- Manual tags are never overwritten.
    where public.photo_tags.source = 'auto'
      and (public.photo_tags.place, public.photo_tags.child_id, public.photo_tags.group_id, public.photo_tags.card_id,
           public.photo_tags.flag)
        is distinct from (excluded.place, excluded.child_id, excluded.group_id, excluded.card_id, excluded.flag)
    returning place, flag
  )
  select count(*), coalesce(bool_or(written.place = 'leftovers' or written.flag is not null), false)
  into v_n, v_reopen
  from written;
  v_changed := v_changed + v_n;

  update public.upload_batches b set tagged_round = p_round where b.id = p_batch_id;

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

-- The batches of some photos, so the API can tag them again after a result, the bin or a restore. Ids only.
create function public.batches_of_photos(p_photo_ids uuid[]) returns table (id uuid)
language sql stable security definer
set search_path = ''
as $$
  select distinct p.batch_id from public.photos p where p.id = any (p_photo_ids);
$$;

-- Batches whose photos changed since they were last tagged, for the daily clean-up's sweep (the API tags them).
create function public.batches_to_tag(p_limit int) returns table (id uuid)
language sql stable security definer
set search_path = ''
as $$
  select b.id from public.upload_batches b
  where b.tag_round > b.tagged_round
  order by b.seq
  limit least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;

-- ── Review: moves and confirmations (owners, admins and photographers; Seenu, answer 8) ──────────────────────────
-- Up to 500 of a job's photos, which must all be the job's and processed, in a job that isn't closed. Never card
-- photos (card_photo): a photo whose card was read (one of the job's cards), or one a person marked a card photo
-- (security review 3); they stay hidden from parents for good.
create function app.check_tag_request(p_job_id uuid, p_photo_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.assert_job_open(p_job_id);
  perform app.check_bin_request(p_job_id, p_photo_ids);
  if exists (select 1 from public.photos p left join public.photo_tags t on t.photo_id = p.id
             where p.id = any (p_photo_ids)
               and ((p.qr_kind = 'card' and p.qr_card_id is not null) or t.place = 'card')) then
    raise exception 'card_photo' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.photos p
             where p.id = any (p_photo_ids) and (p.status <> 'ready' or p.binned_at is not null)) then
    raise exception 'photo_not_ready' using errcode = 'P0001';
  end if;
end;
$$;

-- Moves photos by hand (Seenu, answer 7): to a child, a class's "Class photo" set, or Leftovers. Moved photos keep
-- their place from then on (tagging never overwrites them) and lose any flag. One photos.moved event for the lot.
-- Moving to Leftovers reopens the review; moving between children doesn't (plan answer 5). A photo that may be a card
-- (flagged unreadable_card or other_card) is never moved: it is confirmed first, either way (confirm_first; Seenu,
-- plan answer 1). A photo of another job's card (or of a removed card) is never moved at all: it shows another child's
-- card, so it can only be marked a card photo (other_card; security review 4, code review M1). The job's tagging lock
-- is taken first, so a move to Leftovers and Mark reviewed take turns (code review nice 1).
create function public.move_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[], p_target jsonb) returns int
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
  if jsonb_typeof(p_target) is distinct from 'object' or coalesce(v_kind, '') not in ('child', 'class_set', 'leftovers')
     or (v_kind <> 'leftovers' and coalesce(p_target ->> 'id', '') !~ '^[0-9a-f-]{36}$') then
    raise exception 'Move to a child, a class photo set or Leftovers' using errcode = '22023';
  end if;
  v_id := case when v_kind <> 'leftovers' then (p_target ->> 'id')::uuid end;
  if (v_kind = 'child' and not exists (select 1 from public.children c
                                       where c.id = v_id and c.studio_id = v_studio and c.job_id = p_job_id))
     or (v_kind = 'class_set' and not exists (select 1 from public.job_groups g
                                              where g.id = v_id and g.studio_id = v_studio and g.job_id = p_job_id)) then
    raise exception 'The target must be one of the job''s' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || p_job_id::text, 0));
  perform app.check_tag_request(p_job_id, p_photo_ids);
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

  insert into public.photo_tags (photo_id, studio_id, job_id, place, child_id, group_id, card_id, flag, source,
    tagged_by)
  select p.id, v_studio, p_job_id, v_place, case when v_kind = 'child' then v_id end,
    case when v_kind = 'class_set' then v_id end, null, null, 'manual', p_actor
  from public.photos p where p.id = any (p_photo_ids)
  on conflict (photo_id) do update
  set place = excluded.place, child_id = excluded.child_id, group_id = excluded.group_id, card_id = null,
    flag = null, source = 'manual', tagged_by = excluded.tagged_by
  where (public.photo_tags.place, public.photo_tags.child_id, public.photo_tags.group_id, public.photo_tags.flag,
         public.photo_tags.source)
    is distinct from (excluded.place, excluded.child_id, excluded.group_id, null::public.photo_flag, 'manual');
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

-- Confirms flagged photos at review (Seenu, plan answer 1): "Looks right" / "It's a normal photo" keeps them where
-- they are; "This is a card photo" (p_as_card) makes them card photos, hidden from parents (never moved or confirmed
-- again; only owners and admins can undo it, undo_card_photos). A card photo stays listed on review: with the child it was with (that child's card), with its blank
-- card, or else among the job's other card photos. A photo of another job's card (or of a removed card) can only be
-- marked a card photo (other_card; security review 4). Either way they are the reviewer's from then on.
create function public.confirm_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[], p_as_card boolean)
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
  update public.photo_tags t
  set flag = null, source = 'manual', tagged_by = p_actor,
    place = case when p_as_card then 'card'::public.photo_place else t.place end,
    child_id = case when p_as_card then null else t.child_id end,
    group_id = case when p_as_card then null else t.group_id end,
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

-- Undoes "This is a card photo" (Seenu, answer 12): owners and admins only (photographers and staff get 42501). The
-- photos go back to Flagged, unreadable_card, hidden from parents until someone confirms them again, either way. They
-- stay the reviewer's (manual: tagging never changes them), back where they were: with the child whose card they were
-- listed under, with their blank card (or its child, if named since), or else in Leftovers (a mark made in Leftovers or
-- a class photo set keeps no place to go back to). Only photos a person marked can be undone
-- (not_marked_card): a photo whose card was read stays a card photo. The flag reopens the review. One
-- photos.card_unmarked event (ids and a count). The job's tagging lock first, as for moves.
create function public.undo_card_photos(p_actor uuid, p_job_id uuid, p_photo_ids uuid[]) returns int
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
                   else 'leftovers'::public.photo_place end,
    child_id = q.child_id,
    group_id = null,
    card_id = case when q.child_id is null then q.id end,
    flag = 'unreadable_card', source = 'manual', tagged_by = p_actor
  from public.photo_tags t2
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

-- ── Naming a blank card's child (Seenu, answer 2; ADR 0015) ──────────────────────────────────────────────────────
-- The blank card's encrypted code, for the API to decrypt and re-encrypt for the new child's id (the copy is bound to
-- the card, ADR 0015). Only for a blank card of the job, for owners, admins and photographers.
create function public.blank_card_code(p_actor uuid, p_job_id uuid, p_card_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_card public.qr_cards;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  select * into v_card from public.qr_cards q
  where q.id = p_card_id and q.studio_id = v_studio and q.job_id = p_job_id;
  if v_card.id is null then
    raise exception 'Card not found' using errcode = 'P0002';
  end if;
  if v_card.child_id is not null then
    raise exception 'card_claimed' using errcode = 'P0001';
  end if;
  perform app.end_act_for(v_previous);
  return v_card.access_code_ciphertext;
end;
$$;

-- Makes the blank card's child and moves the card's code to them, in one transaction (ADR 0015's order, section
-- above): lock the card; with the card's child FK deferred, give the card its child and clear its code in one
-- statement (releasing the hash); insert the child with the card's hash (claiming it again) and the API's copy
-- re-encrypted for the child's id; check the FK; then the card's photos waiting for a name go to the child. New
-- children only go into the job's existing classes (plan answer 6), and not in a closed job. The round of every batch
-- with the card's photos moves on, so a tagging run that read them before the claim is refused (tagging_stale) instead
-- of holding new photos for a card that already has its child (code review M2). One qr_card.claimed event (ids only),
-- besides the child's own child.created.
create type app.claimed_child as (id uuid, first_name text, last_name text, group_id uuid,
  access_code_ciphertext text);

create function public.claim_blank_card(p_actor uuid, p_job_id uuid, p_card_id uuid, p_child jsonb) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_card public.qr_cards;
  v_child app.claimed_child;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.assert_job_open(p_job_id);
  if jsonb_typeof(p_child) is distinct from 'object' then
    raise exception 'The child must be an object' using errcode = '22023';
  end if;
  v_child := jsonb_populate_record(null::app.claimed_child, p_child);
  -- As strict as the children table's checks, so Postgres never refuses (and logs) a row holding a name.
  if v_child.id is null
     or coalesce(char_length(v_child.first_name), 0) not between 1 and 60 or v_child.first_name <> btrim(v_child.first_name)
     or coalesce(char_length(v_child.last_name), 0) not between 1 and 60 or v_child.last_name <> btrim(v_child.last_name)
     or coalesce(v_child.access_code_ciphertext, '') !~ '^v1\.[A-Za-z0-9_-]{48}$' then
    raise exception 'A child needs a first and last name' using errcode = '22023';
  end if;
  if v_child.group_id is not null and not exists (
    select 1 from public.job_groups g where g.id = v_child.group_id and g.studio_id = v_studio and g.job_id = p_job_id) then
    raise exception 'The class must be one of the job''s' using errcode = '22023';
  end if;

  select * into v_card from public.qr_cards q
  where q.id = p_card_id and q.studio_id = v_studio and q.job_id = p_job_id
  for update;
  if v_card.id is null then
    raise exception 'Card not found' using errcode = 'P0002';
  end if;
  if v_card.child_id is not null then
    raise exception 'card_claimed' using errcode = 'P0001';
  end if;

  set constraints public.qr_cards_child_fk deferred;
  -- Releases the card's hash (qr_cards_code_change_release), so the child can claim it.
  update public.qr_cards q
  set child_id = v_child.id, access_code_hash = null, access_code_ciphertext = null
  where q.id = p_card_id;
  -- Claims the same hash again for the child (children_code_claim).
  insert into public.children (id, studio_id, job_id, group_id, first_name, last_name, access_code_hash,
    access_code_ciphertext)
  values (v_child.id, v_studio, p_job_id, v_child.group_id, v_child.first_name, v_child.last_name,
    v_card.access_code_hash, v_child.access_code_ciphertext);
  set constraints public.qr_cards_child_fk immediate;

  -- Tagging runs lock their batch, then the job's tagging lock: the same order here.
  update public.upload_batches b set tag_round = b.tag_round + 1
  where b.id in (select p.batch_id from public.photos p
                 where p.qr_card_id = p_card_id or p.before_card_id = p_card_id
                 union
                 select p.batch_id from public.photo_tags t join public.photos p on p.id = t.photo_id
                 where t.card_id = p_card_id);
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || p_job_id::text, 0));

  update public.photo_tags t
  set place = 'child', child_id = v_child.id, card_id = null
  where t.card_id = p_card_id and t.place = 'blank_card';

  perform app.emit(v_studio, 'qr_card.claimed', p_job_id,
    jsonb_build_object('card_id', p_card_id, 'child_id', v_child.id));
  perform app.end_act_for(v_previous);
  return v_child.id;
end;
$$;

-- ── Mark reviewed ─────────────────────────────────────────────────────────────────────────────────────────────────
-- A job's tagging state, the facts of packages/core's TaggingFacts. Pending: photos still processing, or a batch not
-- tagged since its photos changed.
create function app.job_tagging_state(p_job_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'has_ready_photo', exists (select 1 from public.photos p
                               where p.job_id = p_job_id and p.binned_at is null and p.status = 'ready'),
    'pending', exists (select 1 from public.photos p
                       where p.job_id = p_job_id and p.binned_at is null and p.status = 'processing')
               or exists (select 1 from public.upload_batches b
                          where b.job_id = p_job_id and b.tag_round > b.tagged_round),
    'leftovers', (select count(*) from public.photo_tags t join public.photos p on p.id = t.photo_id
                  where t.job_id = p_job_id and t.place = 'leftovers' and p.binned_at is null),
    'flagged', (select count(*) from public.photo_tags t join public.photos p on p.id = t.photo_id
                where t.job_id = p_job_id and t.flag is not null and p.binned_at is null),
    'blank_cards', (select count(distinct t.card_id) from public.photo_tags t join public.photos p on p.id = t.photo_id
                    where t.job_id = p_job_id and t.place = 'blank_card' and p.binned_at is null),
    'reviewed', exists (select 1 from public.job_tagging_reviews r where r.job_id = p_job_id));
$$;

-- Enabled only when clean (Seenu, plan answer 4): photos, nothing pending, no Leftovers, flags or blank cards to name.
create function public.mark_tagging_reviewed(p_actor uuid, p_job_id uuid) returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_state jsonb;
  v_at timestamptz;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  perform app.assert_job_open(p_job_id);
  -- One review at a time per job, after any tagging run in flight.
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || p_job_id::text, 0));
  v_state := app.job_tagging_state(p_job_id);
  if not (v_state ->> 'has_ready_photo')::boolean or (v_state ->> 'pending')::boolean
     or (v_state ->> 'leftovers')::int > 0 or (v_state ->> 'flagged')::int > 0
     or (v_state ->> 'blank_cards')::int > 0 then
    raise exception 'tagging_not_ready' using errcode = 'P0001';
  end if;
  insert into public.job_tagging_reviews (job_id, studio_id, reviewed_at, reviewed_by)
  values (p_job_id, v_studio, now(), p_actor)
  on conflict (job_id) do update set reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by
  returning reviewed_at into v_at;
  perform app.emit(v_studio, 'tagging.reviewed', p_job_id);
  perform app.end_act_for(v_previous);
  return v_at;
end;
$$;

-- ── Reads for the review screen (SECURITY INVOKER: row-level security applies) ──────────────────────────────────
-- Whether parents may ever see a photo (for the parent shop later, D60): a ready photo, not in the bin, with a child
-- or in a class photo set, not flagged, in a batch whose tags are up to date (security review 6: while a retag is due,
-- the tag may be about to change), and never a card photo: not one whose card was read, nor a photo of another job's
-- card (code review M1). A photo that may be a card (unreadable, or no QR result) shows only once a person put it
-- there or confirmed it. Card photos are kept for the studio.
create function public.photo_parent_visible(p_photo_id uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((
    select p.status = 'ready' and p.binned_at is null
      and p.qr_kind is distinct from 'card' and p.qr_kind is distinct from 'other_card'
      and (p.qr_kind = 'none' or t.source = 'manual')
      and t.place in ('child', 'class_set') and t.flag is null
      and b.tag_round = b.tagged_round
    from public.photos p
    join public.photo_tags t on t.photo_id = p.id
    join public.upload_batches b on b.id = p.batch_id
    where p.id = p_photo_id), false);
$$;

-- The review screen's header and albums: counts, the review state, and per class (and "No class") its children, how
-- many have photos and its class-photo set.
create function public.job_tagging_overview(p_job_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  with live as (
    select t.* from public.photo_tags t join public.photos p on p.id = t.photo_id
    where t.job_id = p_job_id and p.binned_at is null
  ), per_child as (
    select l.child_id, count(*) as n from live l where l.place = 'child' group by l.child_id
  ), kids as (
    select c.id, c.group_id, c.do_not_photograph, coalesce(pc.n, 0) as photos
    from public.children c left join per_child pc on pc.child_id = c.id
    where c.job_id = p_job_id
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
    'reviewed_at', (select r.reviewed_at from public.job_tagging_reviews r where r.job_id = p_job_id),
    'no_photos', (select count(*) from kids k where k.photos = 0 and not k.do_not_photograph),
    'albums', coalesce((
      select jsonb_agg(jsonb_build_object(
          'group_id', g.id, 'name', g.name,
          'children', (select count(*) from kids k where k.group_id = g.id),
          'children_with_photos', (select count(*) from kids k where k.group_id = g.id and k.photos > 0),
          'photos', (select coalesce(sum(k.photos), 0) from kids k where k.group_id = g.id),
          'class_photos', (select count(*) from live l where l.place = 'class_set' and l.group_id = g.id))
        order by lower(g.name), g.id)
      from public.job_groups g where g.job_id = p_job_id), '[]'::jsonb),
    'no_group', jsonb_build_object(
      'children', (select count(*) from kids k where k.group_id is null),
      'children_with_photos', (select count(*) from kids k where k.group_id is null and k.photos > 0),
      'photos', (select coalesce(sum(k.photos), 0) from kids k where k.group_id is null)));
$$;

-- One page of the photos in a place, in tagging order (keyset on the photo's id, so no filename is in a URL):
-- leftovers, flagged, a child (with the child's card photos), a class's photo set, a blank card (with its card
-- photos), or the job's other card photos (unlinked_cards: card photos linked to no card of the job, such as photos a
-- person marked card photos in Leftovers; security review 3). Flagged photos say where tagging put them, so the
-- reviewer sees the guess.
create function public.tagging_photos(p_job_id uuid, p_place text, p_id uuid, p_after uuid, p_limit int)
returns table (id uuid, status public.photo_status, place public.photo_place, flag public.photo_flag,
  child_id uuid, group_id uuid, card_id uuid, source text, qr_kind text, qr_card boolean)
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
  if p_place not in ('leftovers', 'flagged', 'child', 'class_set', 'blank_card', 'unlinked_cards') then
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
    select p.id, p.status, t.place, t.flag, t.child_id, t.group_id, t.card_id, t.source, p.qr_kind,
      p.qr_card_id is not null
    from public.photos p join public.photo_tags t on t.photo_id = p.id
    where p.job_id = p_job_id and p.binned_at is null
      and case p_place
        when 'leftovers' then t.place = 'leftovers'
        when 'flagged' then t.flag is not null
        when 'child' then (t.place = 'child' and t.child_id = p_id) or (t.place = 'card' and t.card_id = v_card)
        when 'class_set' then t.place = 'class_set' and t.group_id = p_id
        when 'blank_card' then t.card_id = p_id
        when 'unlinked_cards' then t.place = 'card' and t.card_id is null
      end
      and (v_id is null or (p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp),
                            p.original_filename collate "C", p.id) > (v_seq, v_at, v_name collate "C", v_id))
    order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
    limit v_limit;
end;
$$;

-- An album's children (a class, or p_no_group), by name, each with how many photos they have and the first few, in
-- tagging order, card photos included (labelled "Card" on screen). Keyset by name like list_children.
create function public.tagging_children(p_job_id uuid, p_group_id uuid, p_no_group boolean, p_after uuid,
  p_limit int, p_strip int)
returns jsonb
language sql stable
set search_path = ''
as $$
  with page as (
    select c.id, c.group_id, c.first_name, c.last_name, c.do_not_photograph,
      (select q.id from public.qr_cards q where q.child_id = c.id) as card_id
    from public.children c
    where c.job_id = p_job_id
      and (case when coalesce(p_no_group, false) then c.group_id is null else c.group_id = p_group_id end)
      and (p_after is null
           or (lower(c.last_name), lower(c.first_name), c.id)
              > (select lower(a.last_name), lower(a.first_name), a.id from public.children a where a.id = p_after))
    order by lower(c.last_name), lower(c.first_name), c.id
    limit least(greatest(coalesce(p_limit, 100), 1), 501)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'first_name', k.first_name, 'last_name', k.last_name, 'group_id', k.group_id,
      'do_not_photograph', k.do_not_photograph,
      'photos', (select count(*) from public.photo_tags t join public.photos p on p.id = t.photo_id
                 where t.child_id = k.id and t.place = 'child' and p.binned_at is null),
      'strip', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'place', s.place, 'flag', s.flag,
            'source', s.source, 'qr_kind', s.qr_kind, 'qr_card', s.qr_card)
          order by s.batch_seq, s.at, s.name collate "C", s.id)
        from (
          select p.id, p.status, t.place, t.flag, t.source, p.qr_kind, p.qr_card_id is not null as qr_card,
            p.batch_seq,
            coalesce(p.captured_at, 'infinity'::timestamp) as at, p.original_filename as name
          from public.photos p join public.photo_tags t on t.photo_id = p.id
          where p.job_id = p_job_id and p.binned_at is null
            and ((t.place = 'child' and t.child_id = k.id) or (t.place = 'card' and t.card_id = k.card_id))
          order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp), p.original_filename collate "C", p.id
          limit least(greatest(coalesce(p_strip, 12), 0), 50)) s), '[]'::jsonb))
    order by lower(k.last_name), lower(k.first_name), k.id), '[]'::jsonb)
  from page k;
$$;

-- Children with no photos yet (Seenu, answer 6), for a retake day later; children marked Do not photograph aren't
-- missing anything. It doesn't block selling.
create function public.tagging_no_photos(p_job_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'group_id', c.group_id, 'group_name', g.name)
    order by lower(g.name) nulls last, lower(c.last_name), lower(c.first_name), c.id), '[]'::jsonb)
  from public.children c
  left join public.job_groups g on g.id = c.group_id
  where c.job_id = p_job_id and not c.do_not_photograph
    and not exists (select 1 from public.photo_tags t join public.photos p on p.id = t.photo_id
                    where t.child_id = c.id and t.place = 'child' and p.binned_at is null);
$$;

-- The blank cards of a job whose photos wait for a name: each card's id, its card photos and how many photos wait.
create function public.tagging_blank_cards(p_job_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'card_id', x.card_id, 'photos', x.n,
      'card_photo_id', (select p.id from public.photos p
                        where p.job_id = p_job_id and p.qr_card_id = x.card_id and p.binned_at is null
                          and p.status = 'ready'
                        order by p.batch_seq, coalesce(p.captured_at, 'infinity'::timestamp),
                          p.original_filename collate "C", p.id
                        limit 1))
    order by x.first_seq, x.card_id), '[]'::jsonb)
  from (
    select t.card_id, count(*) as n, min(p.batch_seq) as first_seq
    from public.photo_tags t join public.photos p on p.id = t.photo_id
    where t.job_id = p_job_id and t.place = 'blank_card' and p.binned_at is null
    group by t.card_id
  ) x;
$$;

-- ── Purging photos from the bin keeps where cards were (security review 1) ───────────────────────────────────────
-- A photo in the bin still marks where a card was (tagging_inputs keeps it), but the daily clean-up deletes it for good
-- after 30 days. Before it does, what each purged photo did to the photos after it (packages/core's tagStep and
-- composeSteps: a card sends them to its child; a failed photo, or one that may be a card, flags them until the next
-- card) is kept on the next photo of its batch that stays (before_*), so tagging the batch again later gives every
-- photo the same place. Class-photo batches don't need it: their photos are tagged one by one. Ids and flags only.
-- The batch remembers that a purge left a step (purge_steps), and whether one was left with no photo after it
-- (purge_tail: the purged photos were last), so photos that come or move into the batch's order later are flagged
-- rather than guessed (on_photo_after_purge, core's tagBatch; Seenu, answer 13).
create function app.carry_purged_steps(p_photo_ids uuid[]) returns void
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
    where p.id = any (p_photo_ids) and b.group_id is null
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

create or replace function public.delete_purged_photos(p_photo_ids uuid[]) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count int;
begin
  v_ids := array(select p.id from public.photos p
                 where p.id = any (p_photo_ids) and p.binned_at < now() - interval '30 days' and p.sold_at is null
                   and p.purge_started_at is not null);
  perform app.carry_purged_steps(v_ids);
  delete from public.photos p where p.id = any (v_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Counts for the Photos tab and the Overview (amends ADR 0016's job_photo_counts) ───────────────────────────────
create or replace function public.job_photo_counts(p_job_id uuid) returns jsonb
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
                           where b.job_id = p_job_id),
    'leftovers', (select count(*) from public.photo_tags t join public.photos x on x.id = t.photo_id
                  where t.job_id = p_job_id and t.place = 'leftovers' and x.binned_at is null),
    'flagged', (select count(*) from public.photo_tags t join public.photos x on x.id = t.photo_id
                where t.job_id = p_job_id and t.flag is not null and x.binned_at is null))
  from public.photos p where p.job_id = p_job_id;
$$;

-- ── Checklist facts (amends ADR 0017): tagging, for Review tagging and Up next ────────────────────────────────────
drop function public.job_checklist_facts(uuid, uuid[]);
create function public.job_checklist_facts(p_studio_id uuid, p_job_ids uuid[])
returns table (job_id uuid, children int, qr_eligible int, qr_with_card int, has_ready_photo boolean,
  failed_photos int, tagging_pending boolean, leftovers int, flagged int, blank_cards_pending int,
  tagging_reviewed boolean)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce(cardinality(p_job_ids), 0) > 1000 then
    raise exception 'At most 1000 jobs per call' using errcode = '22023';
  end if;
  return query
  with js as (
    -- A scalar subquery, so the membership check runs once (an InitPlan), not per row.
    select j.id from public.jobs j
    where (select app.is_member(p_studio_id)) and j.studio_id = p_studio_id and j.id = any (p_job_ids)
  ), kids as (
    select c.job_id, count(*)::int as children,
      count(*) filter (where not c.do_not_photograph)::int as eligible,
      count(q.child_id) filter (where not c.do_not_photograph)::int as with_card
    from public.children c
    left join public.qr_cards q on q.child_id = c.id and q.studio_id = p_studio_id
    where c.studio_id = p_studio_id and c.job_id in (select js.id from js)
    group by c.job_id
  ), failed as (
    select p.job_id, count(*)::int as n from public.photos p
    where p.studio_id = p_studio_id and p.job_id in (select js.id from js)
      and p.status = 'failed' and p.binned_at is null
    group by p.job_id
  ), tags as (
    -- Leftovers, flags and blank cards are few (partial and place indexes); the photo is checked for the bin.
    select t.job_id,
      count(*) filter (where t.place = 'leftovers')::int as leftovers,
      count(*) filter (where t.flag is not null)::int as flagged,
      count(distinct t.card_id) filter (where t.place = 'blank_card')::int as blank_cards
    from public.photo_tags t join public.photos p on p.id = t.photo_id
    where t.studio_id = p_studio_id and t.job_id in (select js.id from js)
      and (t.place in ('leftovers', 'blank_card') or t.flag is not null) and p.binned_at is null
    group by t.job_id
  )
  select js.id, coalesce(k.children, 0), coalesce(k.eligible, 0), coalesce(k.with_card, 0),
    exists (select 1 from public.photos p
            where p.job_id = js.id and p.studio_id = p_studio_id and p.binned_at is null and p.status = 'ready'),
    coalesce(f.n, 0),
    exists (select 1 from public.photos p
            where p.job_id = js.id and p.studio_id = p_studio_id and p.binned_at is null and p.status = 'processing')
      or exists (select 1 from public.upload_batches b
                 where b.job_id = js.id and b.studio_id = p_studio_id and b.tag_round > b.tagged_round),
    coalesce(t.leftovers, 0), coalesce(t.flagged, 0), coalesce(t.blank_cards, 0),
    exists (select 1 from public.job_tagging_reviews r where r.job_id = js.id and r.studio_id = p_studio_id)
  from js left join kids k on k.job_id = js.id left join failed f on f.job_id = js.id
    left join tags t on t.job_id = js.id;
end;
$$;

-- Photos still processing, per job, without reading every photo (the checklist's "pending").
create index photos_processing_idx on public.photos (job_id) where status = 'processing' and binned_at is null;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.reopen_tagging_review(uuid[]), app.on_photos_tagging_change(),
  app.on_child_removed_tags(), app.check_tag_request(uuid, uuid[]), app.job_tagging_state(uuid),
  app.carry_purged_steps(uuid[]), app.on_photo_after_purge()
  from public;
revoke all on type app.claimed_child from public;
revoke all on function public.job_checklist_facts(uuid, uuid[]) from public, anon;
grant execute on function public.job_checklist_facts(uuid, uuid[]) to authenticated;
revoke all on function public.photo_parent_visible(uuid), public.job_tagging_overview(uuid),
  public.tagging_photos(uuid, text, uuid, uuid, int), public.tagging_children(uuid, uuid, boolean, uuid, int, int),
  public.tagging_no_photos(uuid), public.tagging_blank_cards(uuid)
  from public, anon;
grant execute on function public.photo_parent_visible(uuid), public.job_tagging_overview(uuid),
  public.tagging_photos(uuid, text, uuid, uuid, int), public.tagging_children(uuid, uuid, boolean, uuid, int, int),
  public.tagging_no_photos(uuid), public.tagging_blank_cards(uuid)
  to authenticated, service_role;
-- Writes, the worker's result and tagging runs: the service role only (route handlers), never browsers.
revoke all on function
  public.create_upload_batch(uuid, uuid, uuid),
  public.tagging_inputs(uuid),
  public.apply_batch_tags(uuid, bigint, jsonb),
  public.batches_to_tag(int),
  public.batches_of_photos(uuid[]),
  public.move_photos(uuid, uuid, uuid[], jsonb),
  public.confirm_photos(uuid, uuid, uuid[], boolean),
  public.undo_card_photos(uuid, uuid, uuid[]),
  public.blank_card_code(uuid, uuid, uuid),
  public.claim_blank_card(uuid, uuid, uuid, jsonb),
  public.mark_tagging_reviewed(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.create_upload_batch(uuid, uuid, uuid),
  public.tagging_inputs(uuid),
  public.apply_batch_tags(uuid, bigint, jsonb),
  public.batches_to_tag(int),
  public.batches_of_photos(uuid[]),
  public.move_photos(uuid, uuid, uuid[], jsonb),
  public.confirm_photos(uuid, uuid, uuid[], boolean),
  public.undo_card_photos(uuid, uuid, uuid[]),
  public.blank_card_code(uuid, uuid, uuid),
  public.claim_blank_card(uuid, uuid, uuid, jsonb),
  public.mark_tagging_reviewed(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
