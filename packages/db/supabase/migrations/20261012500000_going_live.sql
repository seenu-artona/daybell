-- Phase 1, step 8: going live (D47, D75, D127, D143, D96, D92, D113; Claude's calls 1–8 of the step 8 brief, the
-- architect's A1–A3 and the orchestrator's Q1–Q3 of Oct 12, 2026, all for Seenu to review; ADR 0021, amending ADR
-- 0008, 0017, 0018, 0019 and 0020). A forward migration: 20261012400000 is merged.
--
-- A job moves Draft → Selling → Closed, and Closed → Selling again ("Reopen shop"). Never back to Draft: pausing a
-- shop means closing it (call 2). Status changes only through the functions below, which the API runs as the service
-- role for an owner or admin (call 1): each re-checks the person's role, locks the job and checks, in the same
-- transaction, what the Start selling dialog lists (A1): a roster, a ready photo, tagging reviewed, a price list with
-- at least one item (A2) and Active payouts. A job may carry a closing date (closes_at); the jobs cron closes it once
-- that moment has passed.
--
-- Bell notifications (call 4) are a per-person read model made from the event log by a trigger, inside the studio's
-- own regional database (D113): ids and counts only, never names; the screens put the words and the job's name in at
-- read time. Making them and marking them read writes no event (Q3: an exception to D96, like ADR 0016's upload
-- progress; for Seenu to accept).

-- ── Jobs: the closing date ────────────────────────────────────────────────────────────────────────────────────────
-- An exact moment: the end of the chosen day in the time zone of whoever set it (Q2); everyone sees it in their own.
alter table public.jobs add column closes_at timestamptz;
comment on column public.jobs.closes_at is
  'When the shop closes by itself (the jobs cron, hourly; ADR 0021). Null: no closing date. Cleared when it closes.';
-- Owners and admins set it like any other job detail; the status itself stays ungranted (ADR 0008).
grant insert (closes_at) on public.jobs to authenticated;
grant update (closes_at) on public.jobs to authenticated;
-- The cron's query: selling jobs whose moment has come, oldest first.
create index jobs_closing_idx on public.jobs (closes_at) where status = 'selling' and closes_at is not null;

-- A closing date is in the future and at most 400 days away, and a closed job's can't be set. Clearing it is always
-- allowed. Named errors, no values.
create function app.guard_job_closes_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.closes_at is null or (tg_op = 'UPDATE' and new.closes_at is not distinct from old.closes_at) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' then
    raise exception 'job_closed' using errcode = 'P0001';
  end if;
  if new.closes_at <= now() or new.closes_at > now() + interval '400 days' then
    raise exception 'closes_at_invalid' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger jobs_guard_closes_at before insert or update of closes_at on public.jobs
for each row execute function app.guard_job_closes_at();

-- The status moves Draft → Selling, Selling → Closed and Closed → Selling only, whoever writes (a backstop behind the
-- functions below; call 2: never back to Draft).
create function app.guard_job_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status = 'selling')
    or (old.status = 'selling' and new.status = 'closed')
    or (old.status = 'closed' and new.status = 'selling')) then
    raise exception 'job_status_invalid' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger jobs_guard_status before update of status on public.jobs
for each row execute function app.guard_job_status();

-- job.updated no longer names the status: a status change writes job.selling or job.closed instead (A3). It names the
-- closing date.
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
      case when new.picture_day is distinct from old.picture_day then 'picture_day' end,
      case when new.client_id is distinct from old.client_id then 'client_id' end,
      case when new.internal_number is distinct from old.internal_number then 'internal_number' end,
      case when new.subjects_expected is distinct from old.subjects_expected then 'subjects_expected' end,
      case when new.price_list_id is distinct from old.price_list_id then 'price_list_id' end,
      case when new.deliver_to_school is distinct from old.deliver_to_school then 'deliver_to_school' end,
      -- Not when the shop closes: job.closed says so.
      case when new.closes_at is distinct from old.closes_at and new.status = old.status then 'closes_at' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;

-- ── Going live ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Acting for p_actor, who must be an owner or admin of the studio (call 1); refused (42501) before anything is read.
create function app.act_for_manager(p_actor uuid, p_studio_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for(p_actor, p_studio_id);
begin
  if not app.has_role(p_studio_id, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = '42501';
  end if;
  return v_previous;
end;
$$;

-- What still stops a job selling, in the Start selling dialog's order (packages/core SELL_CHECKLIST): roster (no
-- child), photos (no ready photo outside the bin), tagging (not clean and marked reviewed: core's reviewTaggingDone),
-- price_list (the job's list has no item, A2) and payouts (the studio's payout account isn't Active). Reads the job's
-- own studio's rows only. Keys only.
create function app.sell_blockers(p_job_id uuid) returns text[]
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
  if not exists (select 1 from public.price_list_items i
                 where i.price_list_id = v_job.price_list_id and i.studio_id = v_job.studio_id) then
    v_out := array_append(v_out, 'price_list');
  end if;
  if not exists (select 1 from public.payout_accounts a where a.studio_id = v_job.studio_id and a.status = 'active') then
    v_out := array_append(v_out, 'payouts');
  end if;
  return v_out;
end;
$$;

-- Opens a draft's shop (expected 'draft') or reopens a closed one (expected 'closed'), once nothing blocks it. The
-- job's tagging lock first (as Mark reviewed and tagging runs take it), so a review can't reopen between the check and
-- the write; then the job's row, FOR NO KEY UPDATE so photo and roster writes (which only key-share it) never wait on
-- it. Named errors without values: already_selling, job_closed (use Reopen), job_not_closed, and not_ready, whose
-- DETAIL lists the blockers' keys.
create function app.go_live(p_actor uuid, p_job_id uuid, p_expected public.job_status) returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_status public.job_status;
  v_blockers text[];
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for_manager(p_actor, v_studio);
  perform pg_advisory_xact_lock(hashtextextended('tagging:' || p_job_id::text, 0));
  select j.status into v_status from public.jobs j where j.id = p_job_id for no key update;
  if v_status is distinct from p_expected then
    if p_expected = 'closed' then
      raise exception 'job_not_closed' using errcode = 'P0001';
    elsif v_status = 'selling' then
      raise exception 'already_selling' using errcode = 'P0001';
    else
      raise exception 'job_closed' using errcode = 'P0001';
    end if;
  end if;
  v_blockers := app.sell_blockers(p_job_id);
  if cardinality(v_blockers) > 0 then
    raise exception 'not_ready' using errcode = 'P0001', detail = array_to_string(v_blockers, ',');
  end if;
  update public.jobs j set status = 'selling' where j.id = p_job_id;
  perform app.emit(v_studio, 'job.selling', p_job_id, jsonb_build_object('from', p_expected));
  perform app.end_act_for(v_previous);
  return now();
end;
$$;

-- Start selling (call 1): a draft goes live. One job.selling {from: "draft"} event.
create function public.start_selling(p_actor uuid, p_job_id uuid) returns timestamptz
language sql security definer
set search_path = ''
as $$
  select app.go_live(p_actor, p_job_id, 'draft');
$$;

-- Reopen shop (call 2): a closed job sells again, with the same checks. One job.selling {from: "closed"} event.
create function public.reopen_job(p_actor uuid, p_job_id uuid) returns timestamptz
language sql security definer
set search_path = ''
as $$
  select app.go_live(p_actor, p_job_id, 'closed');
$$;

-- Close shop (call 2): a selling job closes now, and its closing date goes. One job.closed {scheduled: false} event.
create function public.close_job(p_actor uuid, p_job_id uuid) returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_status public.job_status;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for_manager(p_actor, v_studio);
  select j.status into v_status from public.jobs j where j.id = p_job_id for no key update;
  if v_status is distinct from 'selling' then
    raise exception 'job_not_selling' using errcode = 'P0001';
  end if;
  update public.jobs j set status = 'closed', closes_at = null where j.id = p_job_id;
  perform app.emit(v_studio, 'job.closed', p_job_id, jsonb_build_object('scheduled', false));
  perform app.end_act_for(v_previous);
  return now();
end;
$$;

-- The jobs cron (hourly): closes up to p_limit selling jobs whose closing date has passed, in every studio of this
-- database, oldest date first; jobs another transaction holds are left for the next run. Nobody did it, so the
-- job.closed {scheduled: true} events have no actor. Returns how many closed.
create function public.close_due_jobs(p_limit int) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_job record;
  v_count int := 0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  -- Nobody: auth.uid() reads either setting, so both are blanked here and put back below.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  for v_job in
    select j.id, j.studio_id from public.jobs j
    where j.status = 'selling' and j.closes_at <= now()
    order by j.closes_at, j.id
    limit p_limit
    for no key update skip locked
  loop
    update public.jobs j set status = 'closed', closes_at = null where j.id = v_job.id;
    perform app.emit(v_job.studio_id, 'job.closed', v_job.id, jsonb_build_object('scheduled', true));
    v_count := v_count + 1;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform app.end_act_for(v_previous);
  return v_count;
end;
$$;

-- ── Bell notifications (call 4) ───────────────────────────────────────────────────────────────────────────────────
-- The same list as packages/core NOTIFICATION_KINDS (a test in packages/api keeps them in step).
create type public.notification_kind as enum (
  'job_selling', 'job_closed', 'payouts_active', 'payouts_restricted', 'photos_failed', 'tagging_ready');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  -- Erasing a person takes their notifications with them.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The event it was made from. No foreign key: events are only removed with their studio, which takes these too,
  -- and a key would change how the event log refuses TRUNCATE (005_events_and_ledger).
  event_id bigint not null,
  kind public.notification_kind not null,
  job_id uuid,
  -- The upload batch a photo notification is about. No foreign key, as on events: ids only.
  batch_id uuid,
  -- Counts and flags only, never names or people: what the words need besides the job's name.
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete cascade,
  -- One event can be two notifications (a batch with Leftovers and failed photos), but never the same one twice.
  constraint notifications_event_key unique (user_id, event_id, kind),
  constraint notifications_data check (
    jsonb_typeof(data) = 'object'
    and data - array['scheduled', 'from', 'failed', 'leftovers', 'flagged'] = '{}'::jsonb
    and (not data ? 'scheduled' or jsonb_typeof(data -> 'scheduled') = 'boolean')
    and (not data ? 'from' or data ->> 'from' in ('draft', 'closed'))
    and (not data ? 'failed' or jsonb_typeof(data -> 'failed') = 'number')
    and (not data ? 'leftovers' or jsonb_typeof(data -> 'leftovers') = 'number')
    and (not data ? 'flagged' or jsonb_typeof(data -> 'flagged') = 'number'))
);
-- One tagging or failed-photos notification per batch and person, however many times the batch is tagged.
create unique index notifications_batch_key on public.notifications (user_id, kind, batch_id)
  where batch_id is not null;
create index notifications_user_idx on public.notifications (user_id, studio_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, studio_id) where read_at is null;
create index notifications_studio_idx on public.notifications (studio_id);
create index notifications_job_idx on public.notifications (job_id) where job_id is not null;
create index notifications_event_idx on public.notifications (event_id);
create index notifications_created_idx on public.notifications (created_at);
comment on table public.notifications is
  'The bell (ADR 0021): one row per person per event worth telling them. Ids and counts only; words come from the '
  'locale files at read time. Made by a trigger on events; people only mark their own read.';

-- Each person reads and marks read their own, in a studio they still belong to.
alter table public.notifications enable row level security;
create policy "people read their own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()) and app.is_member(studio_id));
create policy "people mark their own notifications read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()) and app.is_member(studio_id))
  with check (user_id = (select auth.uid()) and app.is_member(studio_id));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Only read_at changes, once, from empty to the database's own clock; it is never cleared or moved, whoever writes.
create function app.guard_notification_read() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.studio_id, new.user_id, new.event_id, new.kind, new.job_id, new.batch_id, new.data, new.created_at)
       is distinct from
     (old.id, old.studio_id, old.user_id, old.event_id, old.kind, old.job_id, old.batch_id, old.data, old.created_at) then
    raise exception 'notification_fixed' using errcode = 'check_violation';
  end if;
  if old.read_at is not null then
    new.read_at := old.read_at;
  elsif new.read_at is not null then
    new.read_at := now();
  end if;
  return new;
end;
$$;
create trigger notifications_guard_read before update on public.notifications
for each row execute function app.guard_notification_read();

-- Who hears about each kind (the same as packages/core NOTIFICATION_AUDIENCE): everyone about the shop opening and
-- closing; owners and admins about payouts; owners, admins and photographers about photos and tagging.
create function app.notification_audience(p_kind public.notification_kind) returns public.studio_role[]
language sql immutable
set search_path = ''
as $$
  select case p_kind
    when 'job_selling' then '{owner,admin,photographer,staff}'::public.studio_role[]
    when 'job_closed' then '{owner,admin,photographer,staff}'::public.studio_role[]
    when 'payouts_active' then '{owner,admin}'::public.studio_role[]
    when 'payouts_restricted' then '{owner,admin}'::public.studio_role[]
    else '{owner,admin,photographer}'::public.studio_role[]
  end;
$$;

-- One notification per member of the event's studio in the kind's audience; the person who did it isn't told about
-- their own action when p_exclude_actor. A repeat (same event, or same batch and kind) adds nothing.
create function app.notify(p_event_id bigint, p_studio_id uuid, p_actor uuid, p_kind public.notification_kind,
  p_job_id uuid, p_batch_id uuid, p_data jsonb, p_exclude_actor boolean) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (studio_id, user_id, event_id, kind, job_id, batch_id, data)
  select p_studio_id, m.user_id, p_event_id, p_kind, p_job_id, p_batch_id, p_data
  from public.studio_members m
  where m.studio_id = p_studio_id and m.role = any (app.notification_audience(p_kind))
    and (not p_exclude_actor or m.user_id is distinct from p_actor)
  on conflict do nothing;
$$;

-- Turns the events worth a bell into notifications, in the same transaction (no queue, no other service; D113):
-- - job.selling and job.closed: the shop opened or closed (not to whoever did it);
-- - payout_account.status_changed to active or restricted;
-- - photos.tagged: a batch tagged with photos in Leftovers or flagged (tagging_ready), and a batch with photos that
--   failed (photos_failed), once per batch.
-- Only these types reach it (the trigger's WHEN): every other event pays nothing.
create function app.notify_from_event() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_leftovers int;
  v_flagged int;
  v_failed int;
begin
  if new.type = 'job.selling' then
    perform app.notify(new.id, new.studio_id, new.actor_id, 'job_selling', new.subject_id, null,
      jsonb_build_object('from', case when new.data ->> 'from' = 'closed' then 'closed' else 'draft' end), true);
  elsif new.type = 'job.closed' then
    perform app.notify(new.id, new.studio_id, new.actor_id, 'job_closed', new.subject_id, null,
      jsonb_build_object('scheduled', coalesce(new.data ->> 'scheduled', 'false') = 'true'), true);
  elsif new.type = 'payout_account.status_changed' then
    if new.data ->> 'to' = 'active' then
      perform app.notify(new.id, new.studio_id, new.actor_id, 'payouts_active', null, null, '{}'::jsonb, true);
    elsif new.data ->> 'to' = 'restricted' then
      perform app.notify(new.id, new.studio_id, new.actor_id, 'payouts_restricted', null, null, '{}'::jsonb, true);
    end if;
  elsif new.type = 'photos.tagged' then
    v_batch := case when new.data ->> 'batch_id' ~ '^[0-9a-f-]{36}$' then (new.data ->> 'batch_id')::uuid end;
    if v_batch is null or new.subject_id is null then
      return null;
    end if;
    v_leftovers := case when jsonb_typeof(new.data -> 'leftovers') = 'number' then (new.data ->> 'leftovers')::int else 0 end;
    v_flagged := case when jsonb_typeof(new.data -> 'flagged') = 'number' then (new.data ->> 'flagged')::int else 0 end;
    if v_leftovers + v_flagged > 0 then
      perform app.notify(new.id, new.studio_id, new.actor_id, 'tagging_ready', new.subject_id, v_batch,
        jsonb_build_object('leftovers', v_leftovers, 'flagged', v_flagged), false);
    end if;
    select count(*) into v_failed from public.photos p
    where p.batch_id = v_batch and p.studio_id = new.studio_id and p.status = 'failed' and p.binned_at is null;
    if v_failed > 0 then
      perform app.notify(new.id, new.studio_id, new.actor_id, 'photos_failed', new.subject_id, v_batch,
        jsonb_build_object('failed', v_failed), false);
    end if;
  end if;
  return null;
end;
$$;
create trigger events_notify after insert on public.events
for each row when (new.type in ('job.selling', 'job.closed', 'payout_account.status_changed', 'photos.tagged'))
execute function app.notify_from_event();

-- Someone who leaves a studio loses its notifications; someone whose role changes keeps only the kinds their new role
-- hears about (a photographer made staff no longer has photo notifications). Less data kept, nothing seen twice.
create function app.on_member_change_notifications() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.notifications n where n.studio_id = old.studio_id and n.user_id = old.user_id;
    return old;
  end if;
  delete from public.notifications n
  where n.studio_id = new.studio_id and n.user_id = new.user_id
    and not new.role = any (app.notification_audience(n.kind));
  return new;
end;
$$;
create trigger studio_members_notifications after delete or update of role on public.studio_members
for each row execute function app.on_member_change_notifications();

-- The jobs cron's tidy-up: read notifications older than 90 days and any older than 180 days go, up to p_limit at a
-- time (Claude's call). Returns how many.
create function public.prune_notifications(p_limit int) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  delete from public.notifications n
  where n.id in (
    select x.id from public.notifications x
    where x.created_at < now() - interval '180 days'
       or (x.read_at is not null and x.created_at < now() - interval '90 days')
    limit p_limit);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.guard_job_closes_at(), app.guard_job_status(), app.act_for_manager(uuid, uuid),
  app.sell_blockers(uuid), app.go_live(uuid, uuid, public.job_status), app.guard_notification_read(),
  app.notification_audience(public.notification_kind),
  app.notify(bigint, uuid, uuid, public.notification_kind, uuid, uuid, jsonb, boolean), app.notify_from_event(),
  app.on_member_change_notifications()
  from public;
-- Status changes and the cron's work: the service role only (route handlers), never browsers.
revoke all on function public.start_selling(uuid, uuid), public.reopen_job(uuid, uuid), public.close_job(uuid, uuid),
  public.close_due_jobs(int), public.prune_notifications(int)
  from public, anon, authenticated;
grant execute on function public.start_selling(uuid, uuid), public.reopen_job(uuid, uuid),
  public.close_job(uuid, uuid), public.close_due_jobs(int), public.prune_notifications(int)
  to service_role;

notify pgrst, 'reload schema';
