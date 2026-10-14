-- D150 People (ADR 0028; Seenu's answers of Oct 14, 2026): a client's contacts, the studio's clients with their main
-- contact and jobs, and every child across the studio's jobs with the D148 "ordered" rule from one shared helper.
-- D96: the new table has studio_id, a composite studio foreign key and row-level security like clients (members read,
-- owners and admins write); every change writes an event with field names only, never names, emails or phones (D113).
-- A forward migration: rows already on staging survive, and backfills write no events (as in 20261011050000).

-- ── Client contacts ───────────────────────────────────────────────────────────────────────────────────────────────
-- The people a studio works with at each client. One of them may be the client's main contact. Personal data: never in
-- events, logs or URLs. The limits are the client's own contact columns', so the two always fit each other.
create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  client_id uuid not null,
  first_name text check (char_length(first_name) between 1 and 60),
  last_name text check (char_length(last_name) between 1 and 60),
  role text check (char_length(role) between 1 and 60),
  email text check (
    char_length(email) <= 254 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  phone text check (char_length(phone) between 1 and 30),
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A contact is someone: a name, an email or a phone.
  constraint client_contacts_not_empty check (coalesce(first_name, last_name, email, phone) is not null),
  constraint client_contacts_studio_id_id_key unique (studio_id, id),
  -- The client, in the same studio (composite studio FKs, ADR 0008); a contact goes with its client.
  constraint client_contacts_client_fk foreign key (studio_id, client_id)
    references public.clients (studio_id, id) on delete cascade
);
-- At most one main contact per client.
create unique index client_contacts_one_main_key on public.client_contacts (studio_id, client_id) where is_main;
create index client_contacts_studio_client_idx on public.client_contacts (studio_id, client_id);
comment on table public.client_contacts is
  'The people a studio works with at each client (D150). Personal data. The main one is mirrored on the client.';

-- Backfill (no events, see the top): each client's contact person becomes its main contact.
insert into public.client_contacts (studio_id, client_id, first_name, last_name, phone, email, is_main, created_at,
  updated_at)
select c.studio_id, c.id, c.contact_first_name, c.contact_last_name, c.contact_phone, c.contact_email, true,
  c.created_at, c.updated_at
from public.clients c
where coalesce(c.contact_first_name, c.contact_last_name, c.contact_phone, c.contact_email) is not null;

create trigger client_contacts_touch before update on public.client_contacts
for each row execute function app.touch_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────────────────────────────────────────
-- Like clients: everyone on the team reads; owners and admins add and edit. Nobody deletes directly: a main contact
-- goes only when its client's contact person is cleared (the sync below).
alter table public.client_contacts enable row level security;
create policy "members read their studio's client contacts" on public.client_contacts
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add client contacts" on public.client_contacts
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit client contacts" on public.client_contacts
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));
revoke all on public.client_contacts from anon, authenticated;
grant select on public.client_contacts to authenticated;
-- A contact never moves studio or client.
grant insert (studio_id, client_id, first_name, last_name, role, email, phone, is_main)
  on public.client_contacts to authenticated;
grant update (first_name, last_name, role, email, phone, is_main) on public.client_contacts to authenticated;

-- ── One main contact, kept in step with the client ────────────────────────────────────────────────────────────────
-- Seenu's answer 3 (ADR 0028): the public Client.contact* fields stay, and editing a client's contact and editing its
-- main contact stay consistent. The contacts table is the record; the client's contact columns mirror its main
-- contact, and the database keeps the two in step inside the same statement, whichever side was written:
-- - a contact made main takes over from the client's previous main (that one stays, no longer main);
-- - a change to a main contact (or which contact is main) is copied to the client's contact columns;
-- - a change to the client's contact columns (the client form, POST and PATCH /clients) is copied to its main contact,
--   which is added if the client had none and removed if all four are cleared.
-- pg_trigger_depth() tells the two directions apart: a copy made by one side's trigger (depth 2) is not copied back.

-- Before a contact becomes main, the client's current main one steps down (so the unique index never refuses it).
-- SECURITY INVOKER: the step-down is the caller's own update, so row-level security and the column grants apply to
-- it; someone who can't edit the studio's contacts steps nobody down (and their own write is refused anyway). The
-- client-side sync (on_client_contact_columns) runs it as that function's owner, as before.
create function app.client_contact_take_main() returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if new.is_main and (tg_op = 'INSERT' or not old.is_main) then
    update public.client_contacts k set is_main = false
    where k.studio_id = new.studio_id and k.client_id = new.client_id and k.is_main and k.id <> new.id;
  end if;
  return new;
end;
$$;
create trigger client_contacts_take_main before insert or update of is_main on public.client_contacts
for each row execute function app.client_contact_take_main();

-- The client's contact columns become its main contact's (or empty, without one). Only when they differ, so an
-- unchanged client isn't touched.
create function app.mirror_main_contact(p_studio_id uuid, p_client_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.clients c
  set contact_first_name = m.first_name, contact_last_name = m.last_name, contact_phone = m.phone,
    contact_email = m.email
  from (select k.first_name, k.last_name, k.phone, k.email
        from (select 1) one
        left join public.client_contacts k
          on k.studio_id = p_studio_id and k.client_id = p_client_id and k.is_main) m
  where c.studio_id = p_studio_id and c.id = p_client_id
    and (c.contact_first_name, c.contact_last_name, c.contact_phone, c.contact_email)
      is distinct from (m.first_name, m.last_name, m.phone, m.email);
$$;

-- Events (D96): contact.created, contact.updated {fields} and contact.deleted, with the contact's id as subject and
-- field names only (D113). Then, for a change people made to contacts (depth 1), the client's mirror.
create function app.on_client_contact_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
  v_studio uuid;
  v_client uuid;
  -- Whether the client's main contact may have changed: a main one added, changed or removed, or one made main or not.
  v_main boolean;
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'contact.created', new.id, '{}'::jsonb);
    v_studio := new.studio_id;
    v_client := new.client_id;
    v_main := new.is_main;
  elsif tg_op = 'UPDATE' then
    v_fields := array_remove(array[
      case when new.first_name is distinct from old.first_name then 'first_name' end,
      case when new.last_name is distinct from old.last_name then 'last_name' end,
      case when new.role is distinct from old.role then 'role' end,
      case when new.email is distinct from old.email then 'email' end,
      case when new.phone is distinct from old.phone then 'phone' end,
      case when new.is_main is distinct from old.is_main then 'is_main' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'contact.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
    v_studio := new.studio_id;
    v_client := new.client_id;
    v_main := new.is_main or old.is_main;
  else
    -- Not while the studio itself is being deleted (its events go with it).
    if not exists (select 1 from public.studios s where s.id = old.studio_id) then
      return old;
    end if;
    perform app.emit(old.studio_id, 'contact.deleted', old.id, '{}'::jsonb);
    v_studio := old.studio_id;
    v_client := old.client_id;
    v_main := old.is_main;
  end if;

  if pg_trigger_depth() = 1 and v_main
     and exists (select 1 from public.clients c where c.studio_id = v_studio and c.id = v_client) then
    perform app.mirror_main_contact(v_studio, v_client);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger client_contacts_events after insert or update or delete on public.client_contacts
for each row execute function app.on_client_contact_change();

-- A change to a client's contact columns made by people (depth 1) goes to its main contact.
create function app.on_client_contact_columns() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.contact_first_name, new.contact_last_name, new.contact_phone, new.contact_email)
     is not distinct from (old.contact_first_name, old.contact_last_name, old.contact_phone, old.contact_email) then
    return null;
  end if;
  if coalesce(new.contact_first_name, new.contact_last_name, new.contact_phone, new.contact_email) is null then
    delete from public.client_contacts k where k.studio_id = new.studio_id and k.client_id = new.id and k.is_main;
  elsif exists (select 1 from public.client_contacts k
                where k.studio_id = new.studio_id and k.client_id = new.id and k.is_main) then
    update public.client_contacts k
    set first_name = new.contact_first_name, last_name = new.contact_last_name, phone = new.contact_phone,
      email = new.contact_email
    where k.studio_id = new.studio_id and k.client_id = new.id and k.is_main;
  else
    insert into public.client_contacts (studio_id, client_id, first_name, last_name, phone, email, is_main)
    values (new.studio_id, new.id, new.contact_first_name, new.contact_last_name, new.contact_phone,
      new.contact_email, true);
  end if;
  return null;
end;
$$;
create trigger clients_contact_sync
after insert or update of contact_first_name, contact_last_name, contact_phone, contact_email on public.clients
for each row execute function app.on_client_contact_columns();

-- client.updated, as in 20261011050000, except that a mirror copy from a contact (depth 2) lists no contact columns:
-- that change is the contact's own event.
create or replace function app.on_client_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
  v_people boolean := pg_trigger_depth() = 1;
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'client.created', new.id, '{}'::jsonb);
  else
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.notes is distinct from old.notes then 'notes' end,
      case when new.address_line1 is distinct from old.address_line1 then 'address_line1' end,
      case when new.address_line2 is distinct from old.address_line2 then 'address_line2' end,
      case when new.city is distinct from old.city then 'city' end,
      case when new.region_code is distinct from old.region_code then 'region_code' end,
      case when new.postal_code is distinct from old.postal_code then 'postal_code' end,
      case when new.country is distinct from old.country then 'country' end,
      case when v_people and new.contact_first_name is distinct from old.contact_first_name then 'contact_first_name' end,
      case when v_people and new.contact_last_name is distinct from old.contact_last_name then 'contact_last_name' end,
      case when v_people and new.contact_phone is distinct from old.contact_phone then 'contact_phone' end,
      case when v_people and new.contact_email is distinct from old.contact_email then 'contact_email' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'client.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app.client_contact_take_main(), app.mirror_main_contact(uuid, uuid),
  app.on_client_contact_change(), app.on_client_contact_columns() from public;

-- ── Contacts list ─────────────────────────────────────────────────────────────────────────────────────────────────
-- People › Contacts: by client name, the main contact first, then by last and first name, in pages after p_after (a
-- contact's id). p_q (from a POST body, never a URL) matches a name or email; p_main_only keeps main contacts;
-- p_client_id one client's. total counts every match. SECURITY INVOKER: row-level security decides what is read.
create function public.list_client_contacts(
  p_studio_id uuid, p_q text default null, p_main_only boolean default false, p_client_id uuid default null,
  p_after uuid default null, p_limit int default 50
) returns jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  -- The API sends at most 120 characters; anything longer is refused before it is searched.
  if char_length(p_q) > 120 then
    raise exception 'list_client_contacts_q' using errcode = '22023';
  end if;
  return (
    with base as (
      select k.id, k.client_id, c.name as client_name, k.first_name, k.last_name, k.role, k.email, k.phone, k.is_main,
        k.created_at, k.updated_at,
        lower(c.name) as s1, not k.is_main as s2, lower(coalesce(k.last_name, '')) as s3,
        lower(coalesce(k.first_name, '')) as s4
      from public.client_contacts k
      join public.clients c on c.studio_id = k.studio_id and c.id = k.client_id
      where k.studio_id = p_studio_id
        and (not coalesce(p_main_only, false) or k.is_main)
        and (p_client_id is null or k.client_id = p_client_id)
        and (nullif(btrim(p_q), '') is null
             or position(lower(btrim(p_q)) in lower(concat_ws(' ', k.first_name, k.last_name, k.email))) > 0)
    ),
    anchor as (
      select lower(c.name) as s1, k.client_id, not k.is_main as s2, lower(coalesce(k.last_name, '')) as s3,
        lower(coalesce(k.first_name, '')) as s4, k.id
      from public.client_contacts k
      join public.clients c on c.studio_id = k.studio_id and c.id = k.client_id
      where k.studio_id = p_studio_id and k.id = p_after
    ),
    page as (
      select b.* from base b
      where p_after is null
         or (b.s1, b.client_id, b.s2, b.s3, b.s4, b.id)
            > (select a.s1, a.client_id, a.s2, a.s3, a.s4, a.id from anchor a)
      order by b.s1, b.client_id, b.s2, b.s3, b.s4, b.id
      limit greatest(least(coalesce(p_limit, 50), 101), 1)
    )
    select jsonb_build_object(
      'contacts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'client_id', p.client_id, 'client_name', p.client_name, 'first_name', p.first_name,
          'last_name', p.last_name, 'role', p.role, 'email', p.email, 'phone', p.phone, 'is_main', p.is_main,
          'created_at', p.created_at, 'updated_at', p.updated_at)
          order by p.s1, p.client_id, p.s2, p.s3, p.s4, p.id)
        from page p), '[]'::jsonb),
      'total', (select count(*) from base))
  );
end;
$$;
revoke all on function public.list_client_contacts(uuid, text, boolean, uuid, uuid, int) from public, anon;
grant execute on function public.list_client_contacts(uuid, text, boolean, uuid, uuid, int) to authenticated;

-- ── Clients list: main contact and jobs ───────────────────────────────────────────────────────────────────────────
-- People › Clients' columns for a page of clients: the main contact (name and role), how many jobs, and the latest job
-- by picture day. No money (Seenu's answer 1). SECURITY INVOKER.
create function public.client_list_details(p_studio_id uuid, p_client_ids uuid[]) returns jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  -- A page of clients is at most 101 (the API asks for 100 at most); a longer list is refused.
  if cardinality(p_client_ids) > 101 then
    raise exception 'client_list_details_ids' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', c.id,
      'job_count', (select count(*) from public.jobs j
                    where j.studio_id = c.studio_id and j.client_id = c.id),
      'latest_job', (select jsonb_build_object('id', j.id, 'name', j.name, 'picture_day', j.picture_day)
                     from public.jobs j where j.studio_id = c.studio_id and j.client_id = c.id
                     order by j.picture_day desc, j.created_at desc, j.id desc limit 1),
      'main_contact', (select jsonb_build_object('id', k.id, 'first_name', k.first_name, 'last_name', k.last_name,
                         'role', k.role, 'email', k.email)
                       from public.client_contacts k
                       where k.studio_id = c.studio_id and k.client_id = c.id and k.is_main))), '[]'::jsonb)
    from public.clients c
    where c.studio_id = p_studio_id and c.id = any (p_client_ids)
  );
end;
$$;
revoke all on function public.client_list_details(uuid, uuid[]) from public, anon;
grant execute on function public.client_list_details(uuid, uuid[]) to authenticated;

-- ── "Ordered": one rule, one place (D148) ─────────────────────────────────────────────────────────────────────────
-- Which of p_child_ids have ordered: a paid order, neither canceled nor refunded in full, has a line of the child's own
-- in the child's job that wasn't given back in full (Seenu, Oct 14: a refund of a sibling's lines doesn't touch this
-- child; part of a line's quantity given back still counts). As list_children had it (20261014000000), now shared by
-- list_children and list_studio_children so the two can't drift. SECURITY INVOKER: row-level security lets only
-- owners, admins and staff read orders, and studio_order_refund_state answers only them; callers still decide who
-- sees the answer (null for everyone else).
create function app.ordered_children(p_studio_id uuid, p_child_ids uuid[]) returns table (child_id uuid)
language sql stable
set search_path = ''
as $$
  with live_orders as (
    select o.id, app.studio_order_refund_state(o.id) as refund_state
    from public.orders o
    where o.studio_id = p_studio_id and o.status = 'paid' and o.fulfilment_status <> 'canceled'
      and exists (select 1 from public.order_lines ol
                  where ol.studio_id = o.studio_id and ol.order_id = o.id and ol.child_id = any (p_child_ids))
  )
  select distinct ol.child_id
  from public.order_lines ol
  join live_orders lo on lo.id = ol.order_id
  join public.children c on c.studio_id = ol.studio_id and c.id = ol.child_id and c.job_id = ol.job_id
  where ol.studio_id = p_studio_id and ol.child_id = any (p_child_ids)
    and not coalesce((lo.refund_state ->> 'fully_refunded')::boolean, false)
    and ol.quantity > coalesce((lo.refund_state -> 'lines' ->> ol.id::text)::int, 0);
$$;
revoke all on function app.ordered_children(uuid, uuid[]) from public;
grant execute on function app.ordered_children(uuid, uuid[]) to authenticated;

-- list_children as in 20261014000000, its has_paid_order now from app.ordered_children (same rule, same answers).
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
                               then exists (select 1 from ordered o where o.child_id = p.id) end)
        order by lower(p.last_name), lower(p.first_name), p.id)
      from page p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'duplicates', (select count(*) from filtered f where f.duplicate));
$$;

-- ── Subjects across all jobs ──────────────────────────────────────────────────────────────────────────────────────
-- People › Subjects: one row per child per job (a child belongs to one job), by last and first name, in pages after
-- p_after (a child's id). Filters: p_q (from a POST body, never a URL) in the child's name, p_show 'ordered' or
-- 'notOrdered' (D148, owners, admins and staff only), p_job_id, p_client_id (the job's client). total and jobs count
-- every match and the jobs they are in. has_paid_order is null for anyone who doesn't see orders. SECURITY INVOKER.
create function public.list_studio_children(
  p_studio_id uuid, p_q text default null, p_show text default null, p_job_id uuid default null,
  p_client_id uuid default null, p_after uuid default null, p_limit int default 50
) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_sees boolean := coalesce(app.has_role(p_studio_id, '{owner,admin,staff}'), false);
  v_q text := nullif(lower(btrim(p_q)), '');
begin
  if p_show is not null and p_show not in ('ordered', 'notOrdered') then
    raise exception 'list_studio_children_show' using errcode = '22023';
  end if;
  if p_show is not null and not v_sees then
    raise exception 'Owners, admins and staff only' using errcode = '42501';
  end if;
  return (
    with base as (
      select c.id, c.job_id, j.name as job_name, c.first_name, c.last_name, g.name as group_name
      from public.children c
      join public.jobs j on j.studio_id = c.studio_id and j.id = c.job_id
      left join public.job_groups g on g.studio_id = c.studio_id and g.id = c.group_id
      where c.studio_id = p_studio_id
        and (p_job_id is null or c.job_id = p_job_id)
        and (p_client_id is null or j.client_id = p_client_id)
        and (v_q is null or position(v_q in lower(c.first_name || ' ' || c.last_name)) > 0)
    ),
    -- Only for the Ordered and Not ordered chips: every match's answer, to filter by.
    ordered_all as (
      select o.child_id from app.ordered_children(p_studio_id, array(select b.id from base b)) o
      where p_show is not null
    ),
    filtered as (
      select b.* from base b
      where p_show is null
         or (p_show = 'ordered' and b.id in (select oa.child_id from ordered_all oa))
         or (p_show = 'notOrdered' and b.id not in (select oa.child_id from ordered_all oa))
    ),
    anchor as (
      select lower(c.last_name) as ln, lower(c.first_name) as fn, c.id
      from public.children c where c.studio_id = p_studio_id and c.id = p_after
    ),
    page as (
      select f.* from filtered f
      where p_after is null
         or (lower(f.last_name), lower(f.first_name), f.id) > (select a.ln, a.fn, a.id from anchor a)
      order by lower(f.last_name), lower(f.first_name), f.id
      limit greatest(least(coalesce(p_limit, 50), 101), 1)
    ),
    ordered_page as (
      select o.child_id from app.ordered_children(p_studio_id, array(select p.id from page p)) o where v_sees
    )
    select jsonb_build_object(
      'subjects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'job_id', p.job_id, 'job_name', p.job_name, 'first_name', p.first_name,
          'last_name', p.last_name, 'group_name', p.group_name,
          'has_paid_order', case when v_sees then exists (select 1 from ordered_page op where op.child_id = p.id) end)
          order by lower(p.last_name), lower(p.first_name), p.id)
        from page p), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'jobs', (select count(distinct f.job_id) from filtered f))
  );
end;
$$;
revoke all on function public.list_studio_children(uuid, text, text, uuid, uuid, uuid, int) from public, anon;
grant execute on function public.list_studio_children(uuid, text, text, uuid, uuid, uuid, int) to authenticated;

-- ── Saved chips for the People lists ──────────────────────────────────────────────────────────────────────────────
-- save_list_filters as in 20261014000000, with the People lists' keys (the same list as the API's LIST_FILTER_KEYS):
-- Contacts takes a client, Subjects a job or a client; Clients has only the All chip.
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

notify pgrst, 'reload schema';
