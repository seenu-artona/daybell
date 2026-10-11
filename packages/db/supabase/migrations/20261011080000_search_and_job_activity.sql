-- Phase 1, step 2b: the menu search box and the job page's activity (D96, D113, D137, D138; ADR 0013).
-- A forward migration: no table, policy or grant changes. Read-only, so no events.

-- ── Job activity ──────────────────────────────────────────────────────────────────────────────────────────────────
-- The job page shows the job's own activity (GET /studio/activity?jobId=). Every roster import writes thousands of
-- hidden child and class events, so without this index the newest-first query for one job walks the studio's whole
-- event log. Row-level security on events is unchanged (owners and admins read their studio's events).
create index events_studio_subject_idx on public.events (studio_id, subject_id, id desc);

-- ── Menu search ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Finds the studio's jobs (by name or internal number) and clients (by name only, never the contact person). Children
-- are never searched. An RPC called with a POST body so the typed text, which may be someone's name, never appears in
-- a URL or request log (ADR 0011). SECURITY INVOKER: row-level security applies, and the explicit studio filter
-- makes the scope plain to read. LIKE wildcards in the text are escaped, so "50%" finds "50%". Text shorter than 2
-- characters or longer than 100 returns nothing; the function never raises, so the text can't reach the Postgres log
-- in an error. Starts-with matches come first, then by name. At most 10 of each.
create function public.search_studio(p_studio_id uuid, p_query text, p_limit int default 10)
returns jsonb
language sql stable
set search_path = ''
as $$
  with term as (
    select
      '%' || e || '%' as anywhere,
      e || '%' as start,
      least(greatest(coalesce(p_limit, 10), 0), 10) as n
    from (select replace(replace(replace(lower(btrim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') as e) s
    where char_length(btrim(coalesce(p_query, ''))) >= 2
      and char_length(p_query) <= 100
  ),
  found_jobs as (
    select j.id, j.name, j.internal_number, j.status, j.picture_day,
      (lower(j.name) like t.start or lower(j.internal_number) like t.start) as starts
    from public.jobs j cross join term t
    where j.studio_id = p_studio_id
      and (lower(j.name) like t.anywhere or lower(j.internal_number) like t.anywhere)
    order by starts desc, lower(j.name), j.id
    limit (select n from term)
  ),
  found_clients as (
    select c.id, c.name, c.city, lower(c.name) like t.start as starts
    from public.clients c cross join term t
    where c.studio_id = p_studio_id and lower(c.name) like t.anywhere
    order by starts desc, lower(c.name), c.id
    limit (select n from term)
  )
  select jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'name', j.name, 'internal_number', j.internal_number, 'status', j.status,
        'picture_day', j.picture_day) order by j.starts desc, lower(j.name), j.id)
      from found_jobs j), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city)
        order by c.starts desc, lower(c.name), c.id)
      from found_clients c), '[]'::jsonb));
$$;

revoke all on function public.search_studio(uuid, text, int) from public, anon;
grant execute on function public.search_studio(uuid, text, int) to authenticated;

notify pgrst, 'reload schema';
