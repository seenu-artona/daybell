-- Phase 1, step 2d: one checklist (D143, amending D140; D96, D113; Seenu's answers of Oct 12, 2026; ADR 0017).
-- A forward migration: 20261011100000 is deployed. One new nullable column on studios, one read-only function and one
-- partial index. No new table, and no policy changes: studios keep "members read their studio" and "owners and admins
-- update their studio".

-- ── Onboarding stays done ─────────────────────────────────────────────────────────────────────────────────────────
-- Home shows owners and admins the studio setup checklist until every built task is done (D143). The server records
-- the moment it first completes, so removing the only job or the last teammate later never brings it back (Seenu,
-- answer 5). Owners and admins write it through their own session (the update policy above), and only ever once.
alter table public.studios add column onboarded_at timestamptz;
comment on column public.studios.onboarded_at is
  'When the studio setup checklist was first complete (D143). Set once by the server; never cleared or moved.';

-- Write-once: the database's clock, not the caller's, and never cleared or changed afterwards.
create function app.guard_studio_onboarded() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.onboarded_at is not null then
    new.onboarded_at := old.onboarded_at;
  elsif new.onboarded_at is not null then
    new.onboarded_at := now();
  end if;
  return new;
end;
$$;
create trigger studios_guard_onboarded before update of onboarded_at on public.studios
for each row execute function app.guard_studio_onboarded();

-- One event when it happens (D96): the studio's id only.
create function app.on_studio_onboarded() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.emit(new.id, 'studio.onboarded', new.id);
  return new;
end;
$$;
create trigger studios_onboarded_event after update of onboarded_at on public.studios
for each row when (old.onboarded_at is null and new.onboarded_at is not null)
execute function app.on_studio_onboarded();

revoke all on function app.guard_studio_onboarded(), app.on_studio_onboarded() from public;

-- ── Checklist facts ───────────────────────────────────────────────────────────────────────────────────────────────
-- What the checklist needs about many jobs at once, in one query (the Jobs list page and Home's Up next), never one
-- request per job. Counts and flags only; the rules themselves live in packages/core (checklist.ts). Failed photos
-- count only those not in the bin (Seenu, answer 9: possible duplicates are not "broken" for now).
--
-- Studio scope (D96): SECURITY DEFINER with one explicit check that the caller is a member of p_studio_id, and every
-- table filtered by p_studio_id. Another studio's id, or another studio's job ids, return no rows. Row-level security
-- would give the same answer, but it calls app.is_member once per child, card and photo row: on a seeded studio of
-- 300 jobs, 90,000 children and 300,000 photos, 50 jobs took 200 ms that way and 39 ms this way (ADR 0017).
create function public.job_checklist_facts(p_studio_id uuid, p_job_ids uuid[])
returns table (job_id uuid, children int, qr_eligible int, qr_with_card int, has_ready_photo boolean,
  failed_photos int)
language sql stable security definer
set search_path = ''
as $$
  with js as (
    select j.id from public.jobs j
    where app.is_member(p_studio_id) and j.studio_id = p_studio_id and j.id = any (p_job_ids)
  ), kids as (
    select c.job_id, count(*)::int as children,
      count(*) filter (where not c.do_not_photograph)::int as eligible,
      count(q.child_id) filter (where not c.do_not_photograph)::int as with_card
    from public.children c
    left join public.qr_cards q on q.child_id = c.id and q.studio_id = p_studio_id
    where c.studio_id = p_studio_id and c.job_id in (select id from js)
    group by c.job_id
  ), failed as (
    select p.job_id, count(*)::int as n from public.photos p
    where p.studio_id = p_studio_id and p.job_id in (select id from js)
      and p.status = 'failed' and p.binned_at is null
    group by p.job_id
  )
  select js.id, coalesce(k.children, 0), coalesce(k.eligible, 0), coalesce(k.with_card, 0),
    exists (select 1 from public.photos p
            where p.job_id = js.id and p.studio_id = p_studio_id and p.binned_at is null and p.status = 'ready'),
    coalesce(f.n, 0)
  from js left join kids k on k.job_id = js.id left join failed f on f.job_id = js.id;
$$;

-- Failed photos per job without reading every photo of the job: EXPLAIN on the seeded studio above showed a bitmap
-- scan of ~1,000 photos per job (30 ms each) to find a handful of failed ones. Failed photos are few, so the index is
-- small.
create index photos_failed_idx on public.photos (job_id) where status = 'failed' and binned_at is null;

revoke all on function public.job_checklist_facts(uuid, uuid[]) from public, anon;
grant execute on function public.job_checklist_facts(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
