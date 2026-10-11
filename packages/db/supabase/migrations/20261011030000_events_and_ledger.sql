-- Phase 0, step 5: event log (outbox), activity log, money ledger (D96).

-- ── Event log ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Every change to studio data writes one event in the same transaction (the outbox pattern). Later, a background job
-- (Trigger.dev) publishes unpublished events to webhooks, emails and integrations; the activity log reads them now.
-- Events hold IDs and small facts only, never names, emails or photos (children's privacy).
create table public.events (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+\.[a-z_]+$'),
  actor_id uuid references auth.users (id) on delete set null,
  subject_id uuid,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  occurred_at timestamptz not null default now(),
  published_at timestamptz
);
create index events_studio_time_idx on public.events (studio_id, occurred_at desc);
create index events_unpublished_idx on public.events (id) where published_at is null;
comment on table public.events is 'Outbox + activity log. IDs and small facts only; no personal data.';

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant select on public.events to authenticated;
create policy "owners and admins read their studio's activity" on public.events
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));

-- Writes come only from database triggers and functions.
create function app.emit(p_studio_id uuid, p_type text, p_subject_id uuid, p_data jsonb default '{}'::jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.events (studio_id, type, actor_id, subject_id, data)
  values (p_studio_id, p_type, (select auth.uid()), p_subject_id, coalesce(p_data, '{}'::jsonb));
$$;
revoke all on function app.emit(uuid, text, uuid, jsonb) from public;

-- Events never change once written (only the publisher stamps published_at).
create function app.guard_event_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.published_at is distinct from old.published_at
     and (new.id, new.studio_id, new.type, new.actor_id, new.subject_id, new.data, new.occurred_at)
       is not distinct from (old.id, old.studio_id, old.type, old.actor_id, old.subject_id, old.data, old.occurred_at) then
    return new;
  end if;
  raise exception 'Events cannot be changed' using errcode = 'check_violation';
end;
$$;
create trigger events_immutable before update on public.events
for each row execute function app.guard_event_immutable();

-- Triggers that record what happened.
create function app.on_studio_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.id, 'studio.created', new.id, jsonb_build_object('region', new.data_region));
  elsif new.name is distinct from old.name or new.slug is distinct from old.slug then
    perform app.emit(new.id, 'studio.updated', new.id,
      jsonb_build_object('fields', to_jsonb(array_remove(array[
        case when new.name is distinct from old.name then 'name' end,
        case when new.slug is distinct from old.slug then 'slug' end], null))));
  end if;
  return new;
end;
$$;
create trigger studios_events after insert or update on public.studios
for each row execute function app.on_studio_change();

create function app.on_member_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'member.joined', new.user_id, jsonb_build_object('role', new.role));
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform app.emit(new.studio_id, 'member.role_changed', new.user_id,
      jsonb_build_object('from', old.role, 'to', new.role));
  elsif tg_op = 'DELETE' and exists (select 1 from public.studios s where s.id = old.studio_id) then
    perform app.emit(old.studio_id, 'member.removed', old.user_id, jsonb_build_object('role', old.role));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger studio_members_events after insert or update or delete on public.studio_members
for each row execute function app.on_member_change();

create function app.on_invite_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.emit(new.studio_id, 'invite.created', new.id, jsonb_build_object('role', new.role));
  elsif tg_op = 'UPDATE' and new.accepted_at is not null and old.accepted_at is null then
    perform app.emit(new.studio_id, 'invite.accepted', new.id, jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' and old.accepted_at is null and exists (select 1 from public.studios s where s.id = old.studio_id) then
    perform app.emit(old.studio_id, 'invite.withdrawn', old.id, jsonb_build_object('role', old.role));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger studio_invites_events after insert or update or delete on public.studio_invites
for each row execute function app.on_invite_change();

revoke all on function app.guard_event_immutable(), app.on_studio_change(), app.on_member_change(),
  app.on_invite_change() from public;

-- ── Money ledger ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Double-entry: every money movement is one transaction of two or more lines in whole cents that sum to zero, in one
-- currency. Phase 3 (payments) writes here; nothing writes yet. Balances are always sums of lines, never stored totals.
create type public.ledger_account as enum (
  'parent_payments',   -- money parents paid (via Stripe)
  'studio_payable',    -- owed to the studio
  'daybell_fees',      -- Daybell's 3% of product sales
  'payment_fees',      -- Stripe processing and Stripe Tax
  'tax_payable',       -- sales tax / GST / HST collected
  'refunds',           -- money returned to parents
  'lab_costs'          -- print lab charges
);

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studios (id) on delete restrict,
  transaction_id uuid not null,
  account public.ledger_account not null,
  amount_cents bigint not null check (amount_cents <> 0),
  currency char(3) not null check (currency in ('USD', 'CAD')),
  memo text check (char_length(memo) <= 200),
  occurred_at timestamptz not null default now()
);
create index ledger_entries_txn_idx on public.ledger_entries (transaction_id);
create index ledger_entries_studio_idx on public.ledger_entries (studio_id, occurred_at desc);
comment on table public.ledger_entries is 'Double-entry money ledger in whole cents (D96). Append-only.';

alter table public.ledger_entries enable row level security;
revoke all on public.ledger_entries from anon, authenticated;
grant select on public.ledger_entries to authenticated;
create policy "owners and admins read their studio's ledger" on public.ledger_entries
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));

-- Append-only: corrections are new reversing transactions, never edits.
create function app.guard_ledger_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Ledger entries are append-only; post a reversing transaction instead' using errcode = 'check_violation';
end;
$$;
create trigger ledger_append_only before update or delete on public.ledger_entries
for each row execute function app.guard_ledger_append_only();
create trigger ledger_no_truncate before truncate on public.ledger_entries
for each statement execute function app.guard_ledger_append_only();

-- Checked at commit, so a transaction's lines can be inserted one by one.
create function app.check_ledger_transaction() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v record;
begin
  select count(*) as lines, sum(amount_cents) as total, count(distinct currency) as currencies,
         count(distinct studio_id) as studios
    into v from public.ledger_entries where transaction_id = new.transaction_id;
  if v.lines < 2 or v.total <> 0 or v.currencies <> 1 or v.studios <> 1 then
    raise exception 'Ledger transaction % must have 2+ lines in one currency and studio, summing to zero', new.transaction_id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
create constraint trigger ledger_balanced after insert on public.ledger_entries
deferrable initially deferred
for each row execute function app.check_ledger_transaction();

revoke all on function app.guard_ledger_append_only(), app.check_ledger_transaction() from public;

notify pgrst, 'reload schema';
