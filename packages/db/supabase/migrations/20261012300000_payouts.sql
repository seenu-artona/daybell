-- Phase 1, step 7: payouts with Stripe Connect (D56, D98, D106, D143, D96, D113; Seenu's answers 1–4 and Q1–Q6 and
-- Claude's calls Q0, Q4, Q7–Q17 of Oct 12, 2026; ADR 0020). A forward migration: 20261012200000 is merged.
--
-- Each studio has at most one Stripe connected account (Accounts v1 with controller properties: Stripe collects the
-- requirements, Daybell carries losses and pays Stripe's fees, Express dashboard; Q1, Q2). Daybell keeps a copy of
-- what it needs and nothing more: Stripe ids, flags, counts, Stripe's reason codes, the payout schedule, and each
-- payout's amount, status and dates. Never bank details, last-4 digits, names, emails, addresses or descriptors.
--
-- Nobody signed in writes any of it: Stripe ids and status must never be chosen by a browser. The API writes through
-- the SECURITY DEFINER functions below as the service role: the owner's own actions act for them (app.act_for) and
-- are re-checked as owner here (Seenu, answer 1); Stripe's webhooks and the status refresh use the system functions.
-- Owners and admins read; photographers, staff and anon read nothing.
--
-- Events carry ids, Stripe's status words and intervals only; never Stripe ids or amounts (D96). A sync that changes
-- nothing writes no event. Each copy remembers when Daybell asked Stripe for it (stripe_fetched_at), and an older
-- answer never overwrites a newer one, whatever order concurrent webhooks and refreshes finish in. Payouts write no ledger entries in this step (Q10): they move the studio's own Stripe
-- balance to its bank; the ledger starts with sales in Phase 3 (ADR 0006).

create type public.payout_account_status as enum ('needs_info', 'pending_verification', 'active', 'restricted');
-- As Stripe names them. 'manual' is mirrored only so a copy never fails; Daybell never offers it.
create type public.payout_interval as enum ('daily', 'weekly', 'monthly', 'manual');
-- Every day Stripe can name; studios pick Monday to Friday (Seenu, Q6).
create type public.payout_weekday as enum ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');
create type public.payout_status as enum ('pending', 'in_transit', 'paid', 'failed', 'canceled');
create type public.payout_method as enum ('standard', 'instant');

-- ── Payout accounts ───────────────────────────────────────────────────────────────────────────────────────────────
create table public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  -- Restrict: a studio with a Stripe account is closed, never deleted (D125; Claude's call Q16).
  studio_id uuid not null unique references public.studios (id) on delete restrict,
  stripe_account_id text not null unique
    check (char_length(stripe_account_id) <= 255 and stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  -- The studio's region's country (us → US, ca → CA), checked by app.guard_payout_account.
  country char(2) not null check (country in ('US', 'CA')),
  livemode boolean not null,
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  -- Stripe's requirements.disabled_reason code (e.g. requirements.past_due), never free text.
  disabled_reason text check (disabled_reason ~ '^[a-z_.]{1,100}$'),
  -- Counts of Stripe's requirement lists; the field names themselves are not kept.
  currently_due_count integer not null default 0 check (currently_due_count between 0 and 1000),
  past_due_count integer not null default 0 check (past_due_count between 0 and 1000),
  pending_verification_count integer not null default 0 check (pending_verification_count between 0 and 1000),
  requirements_deadline timestamptz,
  -- Worked out by the API with core's payoutAccountStatus, so later steps (selling) can read it here.
  status public.payout_account_status not null,
  -- The schedule as Stripe has it (Seenu, answer 3 and Q6): weekly by default (D56).
  payout_interval public.payout_interval not null,
  weekly_anchor public.payout_weekday,
  monthly_anchor smallint check (monthly_anchor between 1 and 31),
  delay_days smallint not null check (delay_days between 0 and 365),
  -- When Daybell asked Stripe for the copy above (just before the call): an older answer is never written over it.
  stripe_fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets payouts reference an account together with its studio (ADR 0008).
  constraint payout_accounts_studio_id_id_key unique (studio_id, id),
  constraint payout_accounts_weekly check ((payout_interval = 'weekly') = (weekly_anchor is not null)),
  constraint payout_accounts_monthly check ((payout_interval = 'monthly') = (monthly_anchor is not null))
);
comment on table public.payout_accounts is
  'A studio''s Stripe connected account (ADR 0020): ids, flags, counts and the schedule only; never bank details.';

-- ── Payouts ───────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete restrict,
  payout_account_id uuid not null,
  stripe_payout_id text not null unique
    check (char_length(stripe_payout_id) <= 255 and stripe_payout_id ~ '^po_[A-Za-z0-9]+$'),
  -- Whole cents in the payout's currency, which is always the studio's region's (D96, D106).
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  currency char(3) not null check (currency in ('USD', 'CAD')),
  status public.payout_status not null,
  method public.payout_method not null,
  -- Made by the schedule (true) or by hand on Stripe (false).
  automatic boolean not null,
  arrival_date date not null,
  -- Stripe's failure code (e.g. account_closed), never its message.
  failure_code text check (failure_code ~ '^[a-z_]{1,100}$'),
  stripe_created_at timestamptz not null,
  -- When Daybell asked Stripe for this copy: an older answer (in_transit after paid) is never written over it.
  stripe_fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A payout belongs to its studio's own account.
  constraint payouts_account_fk foreign key (studio_id, payout_account_id)
    references public.payout_accounts (studio_id, id) on delete restrict
);
create index payouts_studio_arrival_idx on public.payouts (studio_id, arrival_date desc, stripe_created_at desc);
create index payouts_account_idx on public.payouts (payout_account_id);
comment on table public.payouts is
  'A copy of each Stripe payout to a studio''s bank: amount, status and dates; never the bank, description or trace id.';

create trigger payout_accounts_touch before update on public.payout_accounts
for each row execute function app.touch_updated_at();
create trigger payouts_touch before update on public.payouts
for each row execute function app.touch_updated_at();

-- ── Stripe webhook inbox (D96: "Stripe events queued with duplicate protection") ─────────────────────────────────
-- One row per Stripe event that belongs to a studio in this database, written once its account is known. Only the
-- event's id, type, account and times: never its payload (the API fetches the object from Stripe again instead).
-- processing_started_at is a short lease, so two deliveries of one event never process at the same time; lease_token
-- names the delivery holding it, and only that delivery can finish the event (one whose lease ran out can't clear
-- another's). Processed rows are kept 90 days (Claude's call Q17; pruning is a follow-up).
create table public.stripe_events (
  id bigint generated always as identity primary key,
  stripe_event_id text not null unique
    check (char_length(stripe_event_id) <= 255 and stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null check (type ~ '^[a-z_]+(\.[a-z_]+)+$' and char_length(type) <= 100),
  stripe_account_id text not null
    check (char_length(stripe_account_id) <= 255 and stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  studio_id uuid not null references public.studios (id) on delete cascade,
  livemode boolean not null,
  stripe_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  lease_token uuid,
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  -- An error code name only, never a message.
  last_error text check (last_error ~ '^[a-z_]{1,100}$')
);
create index stripe_events_studio_idx on public.stripe_events (studio_id);
create index stripe_events_processed_idx on public.stripe_events (processed_at) where processed_at is not null;
comment on table public.stripe_events is
  'Stripe webhook inbox: event ids and times only, never payloads. Service role only.';

-- ── Stripe call budget (ADR 0020) ─────────────────────────────────────────────────────────────────────────────────
-- Requests that call Stripe for a studio (refresh, onboarding and dashboard links, the schedule) are counted per
-- studio in one-minute windows, so one session looping on a button can't use up the platform's shared Stripe rate
-- limit for every studio. In the database (no extra service), one row per studio; ids and counts only.
create table public.stripe_call_budget (
  studio_id uuid primary key references public.studios (id) on delete cascade,
  window_start timestamptz not null,
  calls integer not null check (calls between 0 and 1000000)
);
comment on table public.stripe_call_budget is
  'Calls to Stripe per studio in the current minute (rate limit, ADR 0020). Service role only.';

-- ── Guards ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The account's country is the studio's region's, and an account's studio, Stripe id, country and mode never change.
create function app.guard_payout_account() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.country is distinct from (
    select case s.data_region when 'us' then 'US' else 'CA' end from public.studios s where s.id = new.studio_id) then
    raise exception 'payout_country' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.studio_id, new.stripe_account_id, new.country, new.livemode)
       is distinct from (old.studio_id, old.stripe_account_id, old.country, old.livemode) then
    raise exception 'payout_account_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger payout_accounts_guard before insert or update on public.payout_accounts
for each row execute function app.guard_payout_account();

-- A payout is in the studio's region's currency (CAD for Canadian studios, D106), and never moves or changes kind.
create function app.guard_payout() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from (
    select case s.data_region when 'us' then 'USD' else 'CAD' end from public.studios s where s.id = new.studio_id) then
    raise exception 'payout_currency' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.studio_id, new.payout_account_id, new.stripe_payout_id, new.currency, new.method)
       is distinct from (old.studio_id, old.payout_account_id, old.stripe_payout_id, old.currency, old.method) then
    raise exception 'payout_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger payouts_guard before insert or update on public.payouts
for each row execute function app.guard_payout();

-- ── Events (D96) ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Attributed to the owner for their own actions (app.act_for); null for Stripe's webhooks and status refreshes.
create function app.on_payout_account_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'payout_account.created', new.id, jsonb_build_object('country', new.country));
    return new;
  end if;
  if new.status is distinct from old.status then
    perform app.emit(new.studio_id, 'payout_account.status_changed', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if (new.payout_interval, new.weekly_anchor, new.monthly_anchor, new.delay_days)
       is distinct from (old.payout_interval, old.weekly_anchor, old.monthly_anchor, old.delay_days) then
    perform app.emit(new.studio_id, 'payout_account.schedule_changed', new.id,
      jsonb_build_object('from', old.payout_interval, 'to', new.payout_interval));
  end if;
  return new;
end;
$$;
create trigger payout_accounts_events after insert or update on public.payout_accounts
for each row execute function app.on_payout_account_change();

create function app.on_payout_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'payout.created', new.id,
      jsonb_build_object('status', new.status, 'method', new.method));
  elsif new.status is distinct from old.status then
    perform app.emit(new.studio_id, 'payout.status_changed', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;
create trigger payouts_events after insert or update on public.payouts
for each row execute function app.on_payout_change();

-- ── Row-level security ────────────────────────────────────────────────────────────────────────────────────────────
alter table public.payout_accounts enable row level security;
alter table public.payouts enable row level security;
alter table public.stripe_events enable row level security;
alter table public.stripe_call_budget enable row level security;
create policy "owners and admins read their studio's payout account" on public.payout_accounts
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's payouts" on public.payouts
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
-- stripe_events and stripe_call_budget: no policy at all; only the service role uses them.
revoke all on public.payout_accounts, public.payouts, public.stripe_events, public.stripe_call_budget
  from anon, authenticated;
grant select on public.payout_accounts, public.payouts to authenticated;

-- ── Writes (service role only) ────────────────────────────────────────────────────────────────────────────────────
create type app.payout_facts as (
  details_submitted boolean, charges_enabled boolean, payouts_enabled boolean, disabled_reason text,
  currently_due_count integer, past_due_count integer, pending_verification_count integer,
  requirements_deadline timestamptz);
create type app.payout_schedule as (
  payout_interval public.payout_interval, weekly_anchor public.payout_weekday, monthly_anchor smallint,
  delay_days smallint);
create type app.payout_row as (
  stripe_payout_id text, amount_cents bigint, currency text, status public.payout_status,
  method public.payout_method, automatic boolean, arrival_date date, failure_code text,
  stripe_created_at timestamptz);

-- Acting for p_actor, who must be the studio's owner (Seenu, answer 1); refused (42501) before anything is read.
create function app.act_for_owner(p_actor uuid, p_studio_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for(p_actor, p_studio_id);
begin
  if not app.has_role(p_studio_id, '{owner}') then
    raise exception 'Owners only' using errcode = '42501';
  end if;
  return v_previous;
end;
$$;

-- Records the studio's Stripe account once it exists at Stripe. Calling it again with the same account is harmless;
-- another account for the same studio is refused (already_connected): no disconnect or replace in Phase 1 (Q16).
create function public.create_payout_account(p_actor uuid, p_studio_id uuid, p_stripe_account_id text,
  p_livemode boolean, p_facts jsonb, p_schedule jsonb, p_status public.payout_account_status,
  p_fetched_at timestamptz default now())
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_owner(p_actor, p_studio_id);
  v_existing record;
  v_facts app.payout_facts;
  v_schedule app.payout_schedule;
  v_id uuid;
begin
  if jsonb_typeof(p_facts) is distinct from 'object' or jsonb_typeof(p_schedule) is distinct from 'object' then
    raise exception 'Facts and schedule must be objects' using errcode = '22023';
  end if;
  -- One account per studio, even for two owners at once.
  perform pg_advisory_xact_lock(hashtextextended('payout_accounts:' || p_studio_id::text, 0));
  select a.id, a.stripe_account_id into v_existing from public.payout_accounts a where a.studio_id = p_studio_id;
  if v_existing.id is not null then
    if v_existing.stripe_account_id is distinct from p_stripe_account_id then
      raise exception 'already_connected' using errcode = 'P0001';
    end if;
    perform app.end_act_for(v_previous);
    return v_existing.id;
  end if;
  v_facts := jsonb_populate_record(null::app.payout_facts, p_facts);
  v_schedule := jsonb_populate_record(null::app.payout_schedule, p_schedule);
  insert into public.payout_accounts (studio_id, stripe_account_id, country, livemode, details_submitted,
    charges_enabled, payouts_enabled, disabled_reason, currently_due_count, past_due_count,
    pending_verification_count, requirements_deadline, status, payout_interval, weekly_anchor, monthly_anchor,
    delay_days, stripe_fetched_at)
  select p_studio_id, p_stripe_account_id, case s.data_region when 'us' then 'US' else 'CA' end, p_livemode,
    coalesce(v_facts.details_submitted, false), coalesce(v_facts.charges_enabled, false),
    coalesce(v_facts.payouts_enabled, false), v_facts.disabled_reason, coalesce(v_facts.currently_due_count, 0),
    coalesce(v_facts.past_due_count, 0), coalesce(v_facts.pending_verification_count, 0),
    v_facts.requirements_deadline, p_status, v_schedule.payout_interval, v_schedule.weekly_anchor,
    v_schedule.monthly_anchor, v_schedule.delay_days, p_fetched_at
  from public.studios s where s.id = p_studio_id
  returning id into v_id;
  perform app.end_act_for(v_previous);
  return v_id;
end;
$$;

-- Saves the schedule Stripe answered with after the owner changed it (Stripe first, then here), unless a newer copy
-- of the account has been saved meanwhile.
create function public.set_payout_schedule(p_actor uuid, p_studio_id uuid, p_schedule jsonb,
  p_fetched_at timestamptz default now()) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_owner(p_actor, p_studio_id);
  v_schedule app.payout_schedule;
begin
  if jsonb_typeof(p_schedule) is distinct from 'object' then
    raise exception 'The schedule must be an object' using errcode = '22023';
  end if;
  if not exists (select 1 from public.payout_accounts a where a.studio_id = p_studio_id) then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  v_schedule := jsonb_populate_record(null::app.payout_schedule, p_schedule);
  update public.payout_accounts a
  set payout_interval = v_schedule.payout_interval, weekly_anchor = v_schedule.weekly_anchor,
    monthly_anchor = v_schedule.monthly_anchor, delay_days = v_schedule.delay_days, stripe_fetched_at = p_fetched_at
  where a.studio_id = p_studio_id and a.stripe_fetched_at <= p_fetched_at;
  perform app.end_act_for(v_previous);
end;
$$;

-- The webhook's inbox: records the event once (duplicates add nothing) and claims it for processing. Null when the
-- account isn't one of this database's studios' (the webhook answers 404 so Stripe tries again: the account may be
-- being created this very moment). claimed is false while another delivery holds the two-minute lease; when true,
-- lease is the token finish_stripe_event needs.
create function public.record_stripe_event(p_event_id text, p_type text, p_stripe_account_id text,
  p_livemode boolean, p_created timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select a.studio_id from public.payout_accounts a where a.stripe_account_id = p_stripe_account_id);
  v_claimed bigint;
  v_lease uuid;
  v_row record;
begin
  if v_studio is null then
    return null;
  end if;
  insert into public.stripe_events (stripe_event_id, type, stripe_account_id, studio_id, livemode, stripe_created_at)
  values (p_event_id, p_type, p_stripe_account_id, v_studio, p_livemode, p_created)
  on conflict (stripe_event_id) do nothing;
  select e.id, e.stripe_account_id, e.processed_at into v_row
  from public.stripe_events e where e.stripe_event_id = p_event_id;
  -- An event id never moves to another account.
  if v_row.stripe_account_id is distinct from p_stripe_account_id then
    raise exception 'event_mismatch' using errcode = '22023';
  end if;
  update public.stripe_events e
  set processing_started_at = now(), attempts = e.attempts + 1, lease_token = gen_random_uuid()
  where e.id = v_row.id and e.processed_at is null
    and (e.processing_started_at is null or e.processing_started_at < now() - interval '2 minutes')
  returning e.id, e.lease_token into v_claimed, v_lease;
  return jsonb_build_object('inbox_id', v_row.id, 'studio_id', v_studio,
    'processed', v_row.processed_at is not null, 'claimed', v_claimed is not null, 'lease', v_lease);
end;
$$;

-- Ends processing, by the delivery holding the lease only: done (no error); failed with an error code name, freeing
-- the lease for Stripe's next try; or failed for good (p_permanent: an object that can never be copied), recorded and
-- not tried again. False when the lease isn't (or is no longer) this delivery's: nothing is changed.
create function public.finish_stripe_event(p_inbox_id bigint, p_lease uuid, p_error_code text,
  p_permanent boolean default false) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.stripe_events e
  set processed_at = case when p_error_code is null or p_permanent then now() else e.processed_at end,
    last_error = p_error_code, processing_started_at = null, lease_token = null
  where e.id = p_inbox_id and e.lease_token = p_lease and e.processed_at is null;
  return found;
end;
$$;

-- Copies an account's facts, status and schedule as Stripe had them at p_fetched_at. An answer older than the saved
-- copy is skipped; one that changes nothing only moves stripe_fetched_at on (no event). Returns the studio, or null
-- for an account this database doesn't know.
create function public.sync_payout_account(p_stripe_account_id text, p_facts jsonb, p_schedule jsonb,
  p_status public.payout_account_status, p_fetched_at timestamptz default now())
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_facts app.payout_facts;
  v_schedule app.payout_schedule;
begin
  if jsonb_typeof(p_facts) is distinct from 'object' or jsonb_typeof(p_schedule) is distinct from 'object' then
    raise exception 'Facts and schedule must be objects' using errcode = '22023';
  end if;
  v_facts := jsonb_populate_record(null::app.payout_facts, p_facts);
  v_schedule := jsonb_populate_record(null::app.payout_schedule, p_schedule);
  update public.payout_accounts a
  set details_submitted = coalesce(v_facts.details_submitted, false),
    charges_enabled = coalesce(v_facts.charges_enabled, false),
    payouts_enabled = coalesce(v_facts.payouts_enabled, false),
    disabled_reason = v_facts.disabled_reason,
    currently_due_count = coalesce(v_facts.currently_due_count, 0),
    past_due_count = coalesce(v_facts.past_due_count, 0),
    pending_verification_count = coalesce(v_facts.pending_verification_count, 0),
    requirements_deadline = v_facts.requirements_deadline,
    status = p_status,
    payout_interval = v_schedule.payout_interval, weekly_anchor = v_schedule.weekly_anchor,
    monthly_anchor = v_schedule.monthly_anchor, delay_days = v_schedule.delay_days, stripe_fetched_at = p_fetched_at
  where a.stripe_account_id = p_stripe_account_id and a.stripe_fetched_at <= p_fetched_at;
  return (select a.studio_id from public.payout_accounts a where a.stripe_account_id = p_stripe_account_id);
end;
$$;

-- Copies one payout as Stripe had it at p_fetched_at, in the account's studio (never one the caller names); an answer
-- older than the saved copy is skipped. Returns the payout's id, or null for an account this database doesn't know. A
-- payout id never moves to another account.
create function public.sync_payout(p_stripe_account_id text, p_payout jsonb,
  p_fetched_at timestamptz default now()) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_account record;
  v_payout app.payout_row;
  v_id uuid;
begin
  if jsonb_typeof(p_payout) is distinct from 'object' then
    raise exception 'The payout must be an object' using errcode = '22023';
  end if;
  select a.id, a.studio_id into v_account from public.payout_accounts a where a.stripe_account_id = p_stripe_account_id;
  if v_account.id is null then
    return null;
  end if;
  v_payout := jsonb_populate_record(null::app.payout_row, p_payout);
  insert into public.payouts as p (studio_id, payout_account_id, stripe_payout_id, amount_cents, currency, status,
    method, automatic, arrival_date, failure_code, stripe_created_at, stripe_fetched_at)
  values (v_account.studio_id, v_account.id, v_payout.stripe_payout_id, v_payout.amount_cents,
    upper(v_payout.currency), v_payout.status, v_payout.method, v_payout.automatic, v_payout.arrival_date,
    v_payout.failure_code, v_payout.stripe_created_at, p_fetched_at)
  on conflict (stripe_payout_id) do update
  set amount_cents = excluded.amount_cents, status = excluded.status, automatic = excluded.automatic,
    arrival_date = excluded.arrival_date, failure_code = excluded.failure_code,
    stripe_fetched_at = excluded.stripe_fetched_at
  where p.payout_account_id = excluded.payout_account_id and p.stripe_fetched_at <= excluded.stripe_fetched_at;
  v_id := (select p.id from public.payouts p
           where p.stripe_payout_id = v_payout.stripe_payout_id and p.payout_account_id = v_account.id);
  if v_id is null then
    raise exception 'payout_mismatch' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- Counts one call to Stripe for the studio in the current minute; false once the minute's p_limit is used up (the
-- route answers 429 and calls nothing). Fixed one-minute windows.
create function public.take_stripe_call(p_studio_id uuid, p_limit integer) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_calls integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  insert into public.stripe_call_budget as b (studio_id, window_start, calls)
  values (p_studio_id, date_trunc('minute', now()), 1)
  on conflict (studio_id) do update
  set calls = case when b.window_start = excluded.window_start then least(b.calls + 1, 1000000) else 1 end,
    window_start = excluded.window_start
  returning b.calls into v_calls;
  return v_calls <= p_limit;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.guard_payout_account(), app.guard_payout(), app.on_payout_account_change(),
  app.on_payout_change(), app.act_for_owner(uuid, uuid) from public;
revoke all on type app.payout_facts, app.payout_schedule, app.payout_row from public;
-- Writes: the service role only (route handlers), never browsers (ADR 0020).
revoke all on function
  public.create_payout_account(uuid, uuid, text, boolean, jsonb, jsonb, public.payout_account_status, timestamptz),
  public.set_payout_schedule(uuid, uuid, jsonb, timestamptz),
  public.record_stripe_event(text, text, text, boolean, timestamptz),
  public.finish_stripe_event(bigint, uuid, text, boolean),
  public.sync_payout_account(text, jsonb, jsonb, public.payout_account_status, timestamptz),
  public.sync_payout(text, jsonb, timestamptz),
  public.take_stripe_call(uuid, integer)
  from public, anon, authenticated;
grant execute on function
  public.create_payout_account(uuid, uuid, text, boolean, jsonb, jsonb, public.payout_account_status, timestamptz),
  public.set_payout_schedule(uuid, uuid, jsonb, timestamptz),
  public.record_stripe_event(text, text, text, boolean, timestamptz),
  public.finish_stripe_event(bigint, uuid, text, boolean),
  public.sync_payout_account(text, jsonb, jsonb, public.payout_account_status, timestamptz),
  public.sync_payout(text, jsonb, timestamptz),
  public.take_stripe_call(uuid, integer)
  to service_role;

notify pgrst, 'reload schema';
