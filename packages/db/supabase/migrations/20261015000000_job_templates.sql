-- UI round 5: job templates, a job's own copy of their rules, the job's Progress facts and numbers, and a person's
-- orders and record on Subjects (D151, D152, D153, D154; Seenu, Oct 14, 2026; ADR 0029). A forward migration:
-- 20261014100100 is merged.
--
-- A job template holds the rules a new job starts with (D154): when its QR cards should be ready (days before picture
-- day), when its shop opens (when its photos are checked, or days after picture day), when its shop closes (days after
-- it opens, or by hand), its price list and whether school delivery is offered. Jobs copy those values when they are
-- created and keep a snapshot of what they were given, so a later change to the template never touches an existing
-- job, and a job's own changes show as "Changed for this job · Undo" (D152). One default template per studio, seeded
-- from today's behaviour; existing jobs are linked to nothing (ADR 0029, call 1).

-- ── Job templates ─────────────────────────────────────────────────────────────────────────────────────────────────
create type public.shop_opens_rule as enum ('photos_checked', 'after_picture_day');

create table public.job_templates (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  -- Null: no day is planned for the cards.
  qr_cards_days_before smallint check (qr_cards_days_before between 0 and 60),
  shop_opens public.shop_opens_rule not null default 'photos_checked',
  shop_opens_days smallint check (shop_opens_days between 0 and 180),
  -- Null: the shop closes when someone closes it.
  shop_closes_days smallint check (shop_closes_days between 1 and 365),
  -- Null: the studio's default price list when the job is made.
  price_list_id uuid,
  deliver_to_school boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_templates_opens_days check ((shop_opens = 'after_picture_day') = (shop_opens_days is not null)),
  constraint job_templates_studio_id_id_key unique (studio_id, id),
  -- A deleted price list leaves the template on the studio's default.
  constraint job_templates_price_list_fk foreign key (studio_id, price_list_id)
    references public.price_lists (studio_id, id) on delete set null (price_list_id)
);
create index job_templates_studio_name_idx on public.job_templates (studio_id, lower(name), id);
create index job_templates_price_list_idx on public.job_templates (studio_id, price_list_id)
  where price_list_id is not null;
comment on table public.job_templates is
  'The rules a new job starts with (D154; ADR 0029). Jobs copy them when created; changes apply to new jobs only.';

create trigger job_templates_touch before update on public.job_templates
for each row execute function app.touch_updated_at();

-- Everyone on the team reads templates; owners and admins add, change and delete them.
alter table public.job_templates enable row level security;
create policy "members read their studio's job templates" on public.job_templates
  for select to authenticated using (app.is_member(studio_id));
create policy "owners and admins add job templates" on public.job_templates
  for insert to authenticated with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins edit job templates" on public.job_templates
  for update to authenticated
  using (app.has_role(studio_id, '{owner,admin}'))
  with check (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins delete job templates" on public.job_templates
  for delete to authenticated using (app.has_role(studio_id, '{owner,admin}'));

-- A template never moves studio; ids and timestamps are the database's.
revoke all on public.job_templates from anon, authenticated;
grant select, delete on public.job_templates to authenticated;
grant insert (studio_id, name, qr_cards_days_before, shop_opens, shop_opens_days, shop_closes_days, price_list_id,
  deliver_to_school) on public.job_templates to authenticated;
grant update (name, qr_cards_days_before, shop_opens, shop_opens_days, shop_closes_days, price_list_id,
  deliver_to_school) on public.job_templates to authenticated;

-- ── The studio's default template ─────────────────────────────────────────────────────────────────────────────────
-- One pointer, like the default price list (ADR 0019): switching is one update, and `no action` keeps the default
-- from being deleted while deleting the studio still works.
alter table public.studios
  add column default_job_template_id uuid,
  add constraint studios_default_job_template_fk foreign key (id, default_job_template_id)
    references public.job_templates (studio_id, id);
comment on column public.studios.default_job_template_id is 'The template new jobs get unless one is chosen (D154).';
grant update (default_job_template_id) on public.studios to authenticated;

-- Once a studio has a default template it always has one.
create function app.guard_studio_job_template() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.default_job_template_id is not null and new.default_job_template_id is null then
    raise exception 'default_job_template_required' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger studios_guard_job_template before update of default_job_template_id on public.studios
for each row execute function app.guard_studio_job_template();

-- The studio's first template, from today's defaults (ADR 0029, call 1): no day planned for the cards, the shop opens
-- once the photos are checked (by hand, as today), no automatic closing, the studio's default price list, no school
-- delivery. Its name is the studio's to change. Returns the template's id.
create function app.seed_job_template(p_studio_id uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_template uuid;
begin
  insert into public.job_templates (studio_id, name) values (p_studio_id, 'Standard') returning id into v_template;
  update public.studios s set default_job_template_id = v_template
  where s.id = p_studio_id and s.default_job_template_id is null;
  return v_template;
end;
$$;
revoke all on function app.seed_job_template(uuid) from public;

-- Backfill before the event triggers exist, so it writes no events.
select app.seed_job_template(s.id) from public.studios s where s.default_job_template_id is null;

-- New studios get theirs inside studio creation (pg_trigger_depth() > 1 for its rows: no events).
create function app.on_studio_created_seed_job_template() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.seed_job_template(new.id);
  return new;
end;
$$;
create trigger studios_seed_job_template after insert on public.studios
for each row execute function app.on_studio_created_seed_job_template();

-- ── Events (D96): ids and field names only ────────────────────────────────────────────────────────────────────────
create function app.on_job_template_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'job_template.created', new.id, '{}'::jsonb);
  elsif tg_op = 'UPDATE' then
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.qr_cards_days_before is distinct from old.qr_cards_days_before then 'qr_cards_days_before' end,
      case when new.shop_opens is distinct from old.shop_opens then 'shop_opens' end,
      case when new.shop_opens_days is distinct from old.shop_opens_days then 'shop_opens_days' end,
      case when new.shop_closes_days is distinct from old.shop_closes_days then 'shop_closes_days' end,
      case when new.price_list_id is distinct from old.price_list_id then 'price_list_id' end,
      case when new.deliver_to_school is distinct from old.deliver_to_school then 'deliver_to_school' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job_template.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  elsif exists (select 1 from public.studios s where s.id = old.studio_id) then
    perform app.emit(old.studio_id, 'job_template.deleted', old.id, '{}'::jsonb);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger job_templates_events after insert or update or delete on public.job_templates
for each row execute function app.on_job_template_change();

-- job_template.made_default: the studio's default changed (not the first one, set when the studio is created).
create function app.on_default_job_template_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.emit(new.id, 'job_template.made_default', new.default_job_template_id);
  return new;
end;
$$;
create trigger studios_default_job_template_event after update of default_job_template_id on public.studios
for each row when (old.default_job_template_id is not null
  and new.default_job_template_id is distinct from old.default_job_template_id)
execute function app.on_default_job_template_change();

revoke all on function app.guard_studio_job_template(), app.on_studio_created_seed_job_template(),
  app.on_job_template_change(), app.on_default_job_template_change() from public;

-- ── Jobs: their own copy of the rules ─────────────────────────────────────────────────────────────────────────────
-- template_rules is what the template gave the job when it was made (null for jobs made before templates, which have
-- nothing to go back to); opened_at is when the shop first opened, from which "closes N days after opening" counts.
alter table public.jobs
  add column template_id uuid,
  add column qr_cards_days_before smallint check (qr_cards_days_before between 0 and 60),
  add column shop_opens public.shop_opens_rule not null default 'photos_checked',
  add column shop_opens_days smallint check (shop_opens_days between 0 and 180),
  add column shop_closes_days smallint check (shop_closes_days between 1 and 365),
  add column template_rules jsonb check (template_rules is null or (
    jsonb_typeof(template_rules) = 'object'
    and template_rules - array['qr_cards_days_before', 'shop_opens', 'shop_opens_days', 'shop_closes_days'] = '{}'::jsonb)),
  add column opened_at timestamptz,
  add constraint jobs_opens_days check ((shop_opens = 'after_picture_day') = (shop_opens_days is not null)),
  -- Deleting a template leaves its jobs with their own copy (template changes never reach existing jobs anyway).
  add constraint jobs_template_fk foreign key (studio_id, template_id)
    references public.job_templates (studio_id, id) on delete set null (template_id);
create index jobs_studio_template_idx on public.jobs (studio_id, template_id) where template_id is not null;
comment on column public.jobs.template_rules is
  'The rules the job''s template gave it when it was made (D154): its own changes are the differences. Never changes.';
comment on column public.jobs.opened_at is 'When the shop first opened (draft to selling). Set by the database.';

-- The template is chosen when the job is made; the rules are the job's own to change afterwards. The snapshot and the
-- opening moment are the database's.
grant insert (template_id) on public.jobs to authenticated;
grant update (qr_cards_days_before, shop_opens, shop_opens_days, shop_closes_days) on public.jobs to authenticated;

-- A new job copies its template (the one chosen, else the studio's default): the rules, the snapshot, and the price
-- list and school delivery unless the job names its own. Runs before jobs_default_price_list (triggers fire by name),
-- which fills in the studio's default list when neither names one.
create function app.apply_job_template() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_template public.job_templates%rowtype;
begin
  select t.* into v_template from public.job_templates t
  where t.studio_id = new.studio_id
    and t.id = coalesce(new.template_id,
      (select s.default_job_template_id from public.studios s where s.id = new.studio_id));
  new.opened_at := null;
  if not found then
    -- A template of another studio (the composite key refuses it next), or a studio with none.
    new.template_rules := null;
    return new;
  end if;
  new.template_id := v_template.id;
  new.qr_cards_days_before := v_template.qr_cards_days_before;
  new.shop_opens := v_template.shop_opens;
  new.shop_opens_days := v_template.shop_opens_days;
  new.shop_closes_days := v_template.shop_closes_days;
  new.template_rules := jsonb_build_object(
    'qr_cards_days_before', v_template.qr_cards_days_before,
    'shop_opens', v_template.shop_opens,
    'shop_opens_days', v_template.shop_opens_days,
    'shop_closes_days', v_template.shop_closes_days);
  if new.price_list_id is null then
    new.price_list_id := v_template.price_list_id;
  end if;
  new.deliver_to_school := new.deliver_to_school or v_template.deliver_to_school;
  return new;
end;
$$;
create trigger jobs_apply_template before insert on public.jobs
for each row execute function app.apply_job_template();

-- The snapshot and the template never change after the job is made, whoever writes.
create function app.guard_job_template() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.template_rules is distinct from old.template_rules
     or (new.template_id is distinct from old.template_id and new.template_id is not null) then
    raise exception 'job_template_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger jobs_guard_template before update of template_id, template_rules on public.jobs
for each row execute function app.guard_job_template();

-- When a draft's shop first opens: the moment is kept, and "closes N days after opening" becomes the closing date,
-- unless one is already set (ADR 0029, call 4). Reopening a closed shop sets neither.
create function app.apply_job_opening() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'selling' then
    new.opened_at := coalesce(old.opened_at, now());
    if new.closes_at is null and new.shop_closes_days is not null then
      new.closes_at := new.opened_at + make_interval(days => new.shop_closes_days);
    end if;
  elsif new.opened_at is distinct from old.opened_at then
    new.opened_at := old.opened_at;
  end if;
  return new;
end;
$$;
create trigger jobs_apply_opening before update of status, opened_at on public.jobs
for each row execute function app.apply_job_opening();

revoke all on function app.apply_job_template(), app.guard_job_template(), app.apply_job_opening() from public;

-- job.updated names the rules that changed too (job.created is unchanged: its template is on the job).
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
      -- Not when the shop opens or closes: job.selling and job.closed say so.
      case when new.closes_at is distinct from old.closes_at and new.status = old.status then 'closes_at' end,
      case when new.qr_cards_days_before is distinct from old.qr_cards_days_before then 'qr_cards_days_before' end,
      case when new.shop_opens is distinct from old.shop_opens then 'shop_opens' end,
      case when new.shop_opens_days is distinct from old.shop_opens_days then 'shop_opens_days' end,
      case when new.shop_closes_days is distinct from old.shop_closes_days then 'shop_closes_days' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;

-- ── Settings › Templates: the list with how many jobs use each ────────────────────────────────────────────────────
-- SECURITY INVOKER: row-level security decides (members read templates and jobs). The default first, then by name.
create function public.list_job_templates(p_studio_id uuid)
returns table (id uuid, name text, is_default boolean, used_by bigint, qr_cards_days_before smallint,
  shop_opens public.shop_opens_rule, shop_opens_days smallint, shop_closes_days smallint, price_list_id uuid,
  deliver_to_school boolean, created_at timestamptz, updated_at timestamptz)
language sql stable
set search_path = ''
as $$
  select t.id, t.name, t.id = s.default_job_template_id,
    (select count(*) from public.jobs j where j.studio_id = t.studio_id and j.template_id = t.id),
    t.qr_cards_days_before, t.shop_opens, t.shop_opens_days, t.shop_closes_days, t.price_list_id,
    t.deliver_to_school, t.created_at, t.updated_at
  from public.job_templates t
  join public.studios s on s.id = t.studio_id
  where t.studio_id = p_studio_id
  order by t.id = s.default_job_template_id desc, lower(t.name), t.id
  limit 200;
$$;
revoke all on function public.list_job_templates(uuid) from public, anon;
grant execute on function public.list_job_templates(uuid) to authenticated;

-- ── A job's Progress: when each step happened, and who did it ─────────────────────────────────────────────────────
-- From the event log (D152): the job made, its first subject (an import or one added by hand), the last QR card
-- print, the first upload, the last tagging review, the shop's first opening and its last closing. Who did it (a team
-- member's id) only for owners and admins; everyone on the team gets the dates. SECURITY DEFINER, because the event
-- log is for owners and admins only, with one membership check and studio_id on every read (ADR 0017's pattern);
-- read-only, empty search_path, not for anon or PUBLIC. Another studio's job, or an outsider, gets no rows.
create function public.job_progress_facts(p_studio_id uuid, p_job_id uuid)
returns table (step text, happened_at timestamptz, actor_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_manager boolean;
  v_first_child uuid;
begin
  if p_studio_id is null or p_job_id is null or not (select app.is_member(p_studio_id))
     or not exists (select 1 from public.jobs j where j.studio_id = p_studio_id and j.id = p_job_id) then
    return;
  end if;
  v_manager := (select app.has_role(p_studio_id, '{owner,admin}'));
  select c.id into v_first_child from public.children c
  where c.studio_id = p_studio_id and c.job_id = p_job_id
  order by c.created_at, c.id
  limit 1;
  return query
  with picks (step, happened_at, actor_id) as (
    (select 'createJob', e.occurred_at, e.actor_id from public.events e
     where e.studio_id = p_studio_id and e.subject_id = p_job_id and e.type = 'job.created'
     order by e.id limit 1)
    union all
    (select 'addRoster', e.occurred_at, e.actor_id from public.events e
     where e.studio_id = p_studio_id
       and ((e.subject_id = p_job_id and e.type = 'roster.imported')
         or (v_first_child is not null and e.subject_id = v_first_child and e.type = 'child.created'))
     order by e.occurred_at, e.id limit 1)
    union all
    (select 'printQrCards', e.occurred_at, e.actor_id from public.events e
     where e.studio_id = p_studio_id and e.subject_id = p_job_id and e.type = 'qr_cards.printed'
     order by e.id desc limit 1)
    union all
    (select 'uploadPhotos', e.occurred_at, e.actor_id from public.events e
     where e.studio_id = p_studio_id and e.subject_id = p_job_id and e.type = 'photos.uploaded'
     order by e.id limit 1)
    union all
    (select 'reviewTagging', e.occurred_at, e.actor_id from public.events e
     where e.studio_id = p_studio_id and e.subject_id = p_job_id and e.type = 'tagging.reviewed'
     order by e.id desc limit 1)
    union all
    (select 'startSelling', e.occurred_at, e.actor_id from public.events e
     where e.studio_id = p_studio_id and e.subject_id = p_job_id and e.type = 'job.selling'
     order by e.id limit 1)
    union all
    (select 'closeShop', e.occurred_at, e.actor_id from public.events e
     where e.studio_id = p_studio_id and e.subject_id = p_job_id and e.type = 'job.closed'
     order by e.id desc limit 1)
  )
  select p.step, p.happened_at, case when v_manager then p.actor_id end from picks p;
end;
$$;
revoke all on function public.job_progress_facts(uuid, uuid) from public, anon;
grant execute on function public.job_progress_facts(uuid, uuid) to authenticated;

-- ── A job's numbers: Sales and Subjects ordered (D152, owners and admins) ─────────────────────────────────────────
-- Sales by Home's rule (studio_sales): what parents paid less what was refunded, from the ledger, for the paid orders
-- with a line in this job (as the job's Orders tab lists them); those orders counted, and the first one's payment
-- time. Subjects ordered by D148's rule (app.ordered_children) over everyone on the job's roster. SECURITY INVOKER (the
-- ledger and orders are owners' and admins' to read), and refused (42501) for anyone else, so a staff member can't
-- get a half answer. Another studio's job is all zeros: every read is filtered by the studio.
create function public.job_sales(p_studio_id uuid, p_job_id uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_children uuid[];
begin
  if p_studio_id is null or p_job_id is null or not app.has_role(p_studio_id, '{owner,admin}') then
    raise exception 'Owners and admins only' using errcode = '42501';
  end if;
  v_children := array(select c.id from public.children c where c.studio_id = p_studio_id and c.job_id = p_job_id);
  return (
    with job_orders as (
      select o.id, o.paid_at from public.orders o
      where o.studio_id = p_studio_id and o.status = 'paid'
        and exists (select 1 from public.order_lines ol
                    where ol.studio_id = o.studio_id and ol.order_id = o.id and ol.job_id = p_job_id))
    select jsonb_build_object(
      'currency', (select case s.data_region when 'us' then 'USD' else 'CAD' end from public.studios s
                   where s.id = p_studio_id),
      'sales_cents', (select coalesce(sum(e.amount_cents), 0) from public.ledger_entries e
                      join public.ledger_transactions t on t.id = e.transaction_id and t.studio_id = e.studio_id
                      where e.studio_id = p_studio_id and e.account in ('parent_payments', 'refunds')
                        and t.order_id in (select jo.id from job_orders jo)),
      'orders', (select count(*) from job_orders),
      'first_paid_at', (select min(jo.paid_at) from job_orders jo),
      'subjects', cardinality(v_children),
      'subjects_ordered', (select count(*) from app.ordered_children(p_studio_id, v_children)))
  );
end;
$$;
revoke all on function public.job_sales(uuid, uuid) from public, anon;
grant execute on function public.job_sales(uuid, uuid) to authenticated;

-- ── A person on Subjects: their QR card's first print and when they were photographed (D153) ──────────────────────
-- SECURITY INVOKER: row-level security decides (members read cards, photos and tags). The card's row is made at its
-- first print; "photographed" is the camera's day of the earliest ready photo tagged to them, outside the bin.
create function public.child_record_facts(p_studio_id uuid, p_child_id uuid)
returns table (card_printed_at timestamptz, photographed_on date)
language sql stable
set search_path = ''
as $$
  select
    (select q.created_at from public.qr_cards q where q.studio_id = c.studio_id and q.child_id = c.id),
    (select min(p.captured_at)::date from public.photo_tags t
     join public.photos p on p.studio_id = t.studio_id and p.job_id = t.job_id and p.id = t.photo_id
     where t.studio_id = c.studio_id and t.job_id = c.job_id and t.child_id = c.id and t.place = 'child'
       and p.status = 'ready' and p.binned_at is null)
  from public.children c
  where c.studio_id = p_studio_id and c.id = p_child_id;
$$;
revoke all on function public.child_record_facts(uuid, uuid) from public, anon;
grant execute on function public.child_record_facts(uuid, uuid) to authenticated;

-- ── Orders: one person's (D153) ───────────────────────────────────────────────────────────────────────────────────
-- As in 20261014000000, with p_child_id: only orders with a line for that person.
drop function public.studio_orders(uuid, uuid, public.order_fulfilment[], text, integer, uuid,
  public.shop_shipping_method);
create function public.studio_orders(p_studio_id uuid, p_job_id uuid default null,
  p_statuses public.order_fulfilment[] default null, p_reference text default null, p_limit integer default 50,
  p_cursor uuid default null, p_delivery public.shop_shipping_method default null, p_child_id uuid default null)
returns jsonb
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
          and (p_child_id is null or exists (select 1 from public.order_lines ol
                where ol.order_id = o.id and ol.studio_id = o.studio_id and ol.child_id = p_child_id))
          and (p_cursor is null or (o.paid_at, o.id) < (
            select c.paid_at, c.id from public.orders c
            where c.id = p_cursor and c.studio_id = p_studio_id and c.status = 'paid'))
        order by o.paid_at desc, o.id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 101)) o;
$$;
revoke all on function public.studio_orders(uuid, uuid, public.order_fulfilment[], text, integer, uuid,
  public.shop_shipping_method, uuid) from public, anon, authenticated;
grant execute on function public.studio_orders(uuid, uuid, public.order_fulfilment[], text, integer, uuid,
  public.shop_shipping_method, uuid) to authenticated;

-- ── Subjects' chips (D153): Possible duplicates and No photos move to "+ Add filter", so they can be saved ────────
-- As in 20261014100100, with job_subjects' duplicates and noPhotos.
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
