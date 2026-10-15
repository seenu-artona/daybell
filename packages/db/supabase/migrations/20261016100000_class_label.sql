-- UI round 6: the roster's class field is named by the job's template (Seenu's answer to ADR 0030 call 29, Oct 14,
-- 2026; replaces D137's "Group" wording for non-school jobs). A template says what its jobs call the class field
-- (Class, Team, Homeroom…), free text of 1 to 30 characters, "Class" unless changed; a new job copies it like the
-- template's other rules. Subjects' column, chips, record, QR card text and import mapping read the job's label.
-- A forward migration: 20261015000000 is merged.

-- ── Templates ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.job_templates
  add column class_label text not null default 'Class'
    check (char_length(class_label) between 1 and 30 and class_label = btrim(class_label)
      and class_label !~ '[[:cntrl:]]');
comment on column public.job_templates.class_label is
  'What new jobs call the roster''s class field (Class, Team, Homeroom…). Copied onto each new job.';

grant insert (class_label) on public.job_templates to authenticated;
grant update (class_label) on public.job_templates to authenticated;

-- ── Jobs: their own copy, made when the job is ────────────────────────────────────────────────────────────────────
alter table public.jobs
  add column class_label text not null default 'Class'
    check (char_length(class_label) between 1 and 30 and class_label = btrim(class_label)
      and class_label !~ '[[:cntrl:]]');
comment on column public.jobs.class_label is
  'What this job calls the roster''s class field, copied from its template when it was made. Set by the database.';

-- Jobs made before this keep the word they showed: Team for sports, Class for the rest (no job says "Group" any more;
-- ADR 0030, call 29). Not a change anyone made, so their updated_at stays.
alter table public.jobs disable trigger jobs_touch;
update public.jobs set class_label = 'Team' where type = 'sports';
alter table public.jobs enable trigger jobs_touch;

-- A new job copies its template's label (the one chosen, else the studio's default); without one, "Class". Nobody
-- sets a job's label directly (no column grant): the template decides.
create or replace function app.apply_job_template() returns trigger
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
    new.class_label := 'Class';
    new.deliver_to_school := coalesce(new.deliver_to_school, false);
    return new;
  end if;
  new.template_id := v_template.id;
  new.qr_cards_days_before := v_template.qr_cards_days_before;
  new.shop_opens := v_template.shop_opens;
  new.shop_opens_days := v_template.shop_opens_days;
  new.shop_closes_days := v_template.shop_closes_days;
  new.class_label := v_template.class_label;
  new.template_rules := jsonb_build_object(
    'qr_cards_days_before', v_template.qr_cards_days_before,
    'shop_opens', v_template.shop_opens,
    'shop_opens_days', v_template.shop_opens_days,
    'shop_closes_days', v_template.shop_closes_days);
  if new.price_list_id is null then
    new.price_list_id := v_template.price_list_id;
  end if;
  -- The job's own choice wins, even false (code review M3); left out, the template's.
  new.deliver_to_school := coalesce(new.deliver_to_school, v_template.deliver_to_school, false);
  return new;
end;
$$;
revoke all on function app.apply_job_template() from public;

-- The label never changes after the job is made, whoever writes (the service role included).
create function app.guard_job_class_label() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.class_label is distinct from old.class_label then
    raise exception 'job_class_label_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger jobs_guard_class_label before update of class_label on public.jobs
for each row execute function app.guard_job_class_label();
revoke all on function app.guard_job_class_label() from public;

-- job_template.updated names class_label when it changes (field names only, D96).
create or replace function app.on_job_template_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  -- Only the seeding inside studio creation is silent; a change made by the database for someone (a deleted price list
  -- leaving a template on the studio's default) still writes job_template.updated (D96).
  if tg_op = 'INSERT' and pg_trigger_depth() > 1 then
    return new;
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
      case when new.deliver_to_school is distinct from old.deliver_to_school then 'deliver_to_school' end,
      case when new.class_label is distinct from old.class_label then 'class_label' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job_template.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  elsif exists (select 1 from public.studios s where s.id = old.studio_id) then
    perform app.emit(old.studio_id, 'job_template.deleted', old.id, '{}'::jsonb);
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function app.on_job_template_change() from public;

-- Settings › Templates reads the label too (its return type changes, so it is made again).
drop function public.list_job_templates(uuid);
create function public.list_job_templates(p_studio_id uuid)
returns table (id uuid, name text, is_default boolean, used_by bigint, qr_cards_days_before smallint,
  shop_opens public.shop_opens_rule, shop_opens_days smallint, shop_closes_days smallint, price_list_id uuid,
  deliver_to_school boolean, class_label text, created_at timestamptz, updated_at timestamptz)
language sql stable
set search_path = ''
as $$
  select t.id, t.name, t.id = s.default_job_template_id,
    (select count(*) from public.jobs j where j.studio_id = t.studio_id and j.template_id = t.id),
    t.qr_cards_days_before, t.shop_opens, t.shop_opens_days, t.shop_closes_days, t.price_list_id,
    t.deliver_to_school, t.class_label, t.created_at, t.updated_at
  from public.job_templates t
  join public.studios s on s.id = t.studio_id
  where t.studio_id = p_studio_id
  order by t.id = s.default_job_template_id desc, lower(t.name), t.id
  limit 200;
$$;
revoke all on function public.list_job_templates(uuid) from public, anon;
grant execute on function public.list_job_templates(uuid) to authenticated;

notify pgrst, 'reload schema';
