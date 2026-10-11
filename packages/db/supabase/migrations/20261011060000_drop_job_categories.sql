-- Phase 1, step 1c: job categories are removed; the job type carries that meaning (D133; ADR 0010).
-- A forward migration: 20261011050000 is deployed. Earlier job_category.* events stay as written (events are
-- immutable); the activity log never showed them.

-- The job event trigger reads category_id, so it is replaced first.
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
      case when new.status is distinct from old.status then 'status' end,
      case when new.picture_day is distinct from old.picture_day then 'picture_day' end,
      case when new.client_id is distinct from old.client_id then 'client_id' end,
      case when new.internal_number is distinct from old.internal_number then 'internal_number' end,
      case when new.subjects_expected is distinct from old.subjects_expected then 'subjects_expected' end], null);
    if cardinality(v_fields) > 0 then
      perform app.emit(new.studio_id, 'job.updated', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
    end if;
  end if;
  return new;
end;
$$;

-- Dropping the column also drops jobs_category_fk, jobs_studio_category_idx and its column grants.
alter table public.jobs drop column category_id;

drop trigger studios_seed_job_categories on public.studios;
drop function app.seed_job_categories();

-- Dropping the table also drops its policies, grants, index and its touch and event triggers.
drop table public.job_categories;
drop function app.on_job_category_change();

notify pgrst, 'reload schema';
