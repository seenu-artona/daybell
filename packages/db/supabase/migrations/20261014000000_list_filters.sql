-- D147 (amends D144 and D145; ADR 0026): filter chips over the studio's lists, saved per person; the roster's photo
-- and order columns; Orders' "Done" view.
-- D96: the new table has studio_id and row-level security; a person reads only their own chips. Chips hold filter keys
-- and record ids only: never a name, a grade or search text (D113), and the event says which page and how many.

-- ── Saved filter chips ────────────────────────────────────────────────────────────────────────────────────────────
-- The lists that can save chips: two studio-wide ones and three of a job's tabs (those carry the job's id).
create type public.list_page as enum ('jobs', 'orders', 'job_subjects', 'job_orders', 'job_photos');

-- One "+ Add filter" chip a person saved on a list, in order (1–8). filter_key is the API's key (e.g. closingThisWeek,
-- client); filter_value is a record's id for the keys that need one (a client, a job, a class), never text. The API
-- checks which keys each page takes and that every id is the studio's own; the chip's name is looked up by id each
-- time, so a renamed client shows its new name and nothing personal is stored here.
create table public.list_filter_chips (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  user_id uuid not null,
  page public.list_page not null,
  job_id uuid,
  position smallint not null check (position between 1 and 8),
  filter_key text not null check (filter_key ~ '^[a-z][a-zA-Z]{1,39}$'),
  filter_value uuid,
  created_at timestamptz not null default now(),
  -- A person who leaves the studio takes their chips with them.
  constraint list_filter_chips_member_fk foreign key (studio_id, user_id)
    references public.studio_members (studio_id, user_id) on delete cascade,
  -- A job's tabs' chips belong to that job, in the same studio, and go with it.
  constraint list_filter_chips_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete cascade,
  constraint list_filter_chips_job_page check ((job_id is not null) = (page in ('job_subjects', 'job_orders', 'job_photos')))
);
-- One chip per place in the row, and the same filter only once, per person, page and job (none for studio lists).
create unique index list_filter_chips_position_key on public.list_filter_chips
  (studio_id, user_id, page, coalesce(job_id, '00000000-0000-0000-0000-000000000000'::uuid), position);
create unique index list_filter_chips_filter_key on public.list_filter_chips
  (studio_id, user_id, page, coalesce(job_id, '00000000-0000-0000-0000-000000000000'::uuid), filter_key,
   coalesce(filter_value, '00000000-0000-0000-0000-000000000000'::uuid));
create index list_filter_chips_job_idx on public.list_filter_chips (studio_id, job_id) where job_id is not null;
comment on table public.list_filter_chips is
  'Filter chips a person added to a list (D147). Keys and record ids only; read by their owner only.';

alter table public.list_filter_chips enable row level security;
create policy "people read their own filter chips in their studio" on public.list_filter_chips
  for select to authenticated using (user_id = (select auth.uid()) and app.is_member(studio_id));
-- No write policy or grant: save_list_filters replaces a person's chips for one list at a time.
revoke all on public.list_filter_chips from anon, authenticated;
grant select on public.list_filter_chips to authenticated;

-- Replaces the signed-in person's chips on one list (and job) with p_chips, an array of {"key": text, "value": uuid or
-- null}, in order. SECURITY DEFINER (there is no write grant) with its own checks: a member of the studio, the job in
-- that studio for a job's tab, at most 8 chips, well-formed keys and ids, each key one the page takes (with an id
-- exactly when the key names a record), and every id the studio's own record of the right kind (a client or job of the
-- studio, a class of this job). The API checks the same first; this is the backstop for direct calls. Refusals carry
-- fixed messages, never the values sent. Writes one event with the page and the count only.
create function public.save_list_filters(p_studio_id uuid, p_page public.list_page, p_job_id uuid, p_chips jsonb)
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
      ('job_subjects', 'doNotPhotograph', false), ('job_subjects', 'doNotPublish', false)
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

revoke all on function public.save_list_filters(uuid, public.list_page, uuid, jsonb) from public, anon;
grant execute on function public.save_list_filters(uuid, public.list_page, uuid, jsonb) to authenticated;

-- ── Roster list: photos and orders per child ──────────────────────────────────────────────────────────────────────
-- As in 20261011070000, plus for each child: photo_count, the photos tagged to them that are ready and not in the bin
-- (flagged ones count: they are the child's, waiting for a check at review); and has_paid_order, whether a paid order
-- that is neither canceled nor refunded in full has a line of the child's own in this job that wasn't given back in
-- full (Seenu, Oct 14: a sibling's refunded lines don't matter; part of a line given back still counts). It is null
-- for anyone who doesn't see orders (photographers: Q4 of ADR 0024), so Subjects hides its Ordered column and Not
-- ordered chip.
-- Still SECURITY INVOKER: row-level security decides what is read.
drop function public.list_children(uuid, uuid, uuid, int, boolean);
create function public.list_children(
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
  -- Only the orders with a line for a child on this page (at most p_limit children, 1,001 at most), in this job.
  paid_orders as (
    select distinct o.id
    from public.order_lines ol
    join public.orders o on o.studio_id = ol.studio_id and o.id = ol.order_id
    where (select sees_orders from job)
      and ol.studio_id = (select studio_id from job) and ol.job_id = p_job_id
      and ol.child_id in (select id from page)
      and o.status = 'paid' and o.fulfilment_status <> 'canceled'
  ),
  -- Each order's refund state once: whether it was refunded in full, and how many of each line were given back.
  live_orders as (
    select po.id, app.studio_order_refund_state(po.id) as refund_state from paid_orders po
  ),
  -- A child is ordered if one of their own lines in this job is in a live order and not given back in full (Seenu,
  -- Oct 14): a refund of a sibling's lines doesn't touch this child; a refund of all of this child's lines does.
  ordered as (
    select distinct ol.child_id
    from public.order_lines ol
    join live_orders lo on lo.id = ol.order_id
    where ol.studio_id = (select studio_id from job) and ol.job_id = p_job_id
      and ol.child_id in (select id from page)
      and not coalesce((lo.refund_state ->> 'fully_refunded')::boolean, false)
      and ol.quantity > coalesce((lo.refund_state -> 'lines' ->> ol.id::text)::int, 0)
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
                               then exists (select 1 from ordered o where o.child_id = p.id) end)
        order by lower(p.last_name), lower(p.first_name), p.id)
      from page p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'duplicates', (select count(*) from filtered f where f.duplicate));
$$;

revoke all on function public.list_children(uuid, uuid, uuid, int, boolean) from public, anon;
grant execute on function public.list_children(uuid, uuid, uuid, int, boolean) to authenticated;

-- ── Orders: several statuses at once ──────────────────────────────────────────────────────────────────────────────
-- As in 20261013100100, with p_statuses (any of them) in place of one p_status, for the Orders list's "Done" chip
-- (shipped, delivered or complete). Orders viewed as Paid or Printed still leave out those refunded in full, so Home's
-- links list what they count (code review N3).
drop function public.studio_orders(uuid, uuid, public.order_fulfilment, text, integer, uuid,
  public.shop_shipping_method);
create function public.studio_orders(p_studio_id uuid, p_job_id uuid default null,
  p_statuses public.order_fulfilment[] default null, p_reference text default null, p_limit integer default 50,
  p_cursor uuid default null, p_delivery public.shop_shipping_method default null) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'reference', o.reference, 'paid_at', o.paid_at, 'currency', o.currency,
      'total_cents', o.total_cents, 'shipping_method', o.shipping_method, 'fulfilment', o.fulfilment_status,
      'disputed', o.disputed_at is not null,
      'refund', app.studio_order_refund_state(o.id) ->> 'badge',
      'items', (select coalesce(sum(ol.quantity), 0) from public.order_lines ol
                where ol.order_id = o.id and ol.studio_id = o.studio_id),
      'children', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'first_name', c.first_name,
                     'last_initial', upper(left(c.last_name, 1))) order by c.first_name, c.last_name, c.id), '[]'::jsonb)
                   from public.children c
                   where c.studio_id = o.studio_id and c.id in (
                     select ol.child_id from public.order_lines ol
                     where ol.order_id = o.id and ol.studio_id = o.studio_id)))
    order by o.paid_at desc, o.id desc), '[]'::jsonb)
  from (select o.id, o.studio_id, o.reference, o.paid_at, o.currency, o.total_cents, o.shipping_method,
          o.fulfilment_status, o.disputed_at
        from public.orders o
        where o.studio_id = p_studio_id and o.status = 'paid'
          and (p_statuses is null or o.fulfilment_status = any (p_statuses))
          and (p_statuses is null or o.fulfilment_status not in ('paid', 'printed')
               or not coalesce((app.studio_order_refund_state(o.id) ->> 'fully_refunded')::boolean, false))
          and (p_delivery is null or o.shipping_method = p_delivery)
          and (p_reference is null or o.reference like upper(p_reference) || '%')
          and (p_job_id is null or exists (select 1 from public.order_lines ol
                where ol.order_id = o.id and ol.studio_id = o.studio_id and ol.job_id = p_job_id))
          and (p_cursor is null or (o.paid_at, o.id) < (
            select c.paid_at, c.id from public.orders c
            where c.id = p_cursor and c.studio_id = p_studio_id and c.status = 'paid'))
        order by o.paid_at desc, o.id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 101)) o;
$$;

revoke all on function public.studio_orders(uuid, uuid, public.order_fulfilment[], text, integer, uuid,
  public.shop_shipping_method) from public, anon, authenticated;
grant execute on function public.studio_orders(uuid, uuid, public.order_fulfilment[], text, integer, uuid,
  public.shop_shipping_method) to authenticated;

notify pgrst, 'reload schema';
