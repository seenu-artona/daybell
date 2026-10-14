-- Phase 1, step 11: orders and refunds (D25, D59, D127, D96, D113, D92, D91; Seenu's answers 1–4 of the brief and Q2,
-- Q4–Q6 of the architect's plan, Oct 13, 2026; Claude's calls for Seenu to review; ADR 0024, amending ADR 0006, 0021,
-- 0022 and 0023). A forward migration: 20261013000000 is merged.
--
-- Fulfilment: a paid order moves Paid → Printed → Shipped (home, with tracking) or Delivered to school; a digital-only
-- order is Complete at payment; a parent's cancel makes it Canceled. Owners, admins and staff fulfil (answer 4); owners
-- and admins undo one step with a reason. Refunds (answers 1, 3): by line, a custom amount before tax, or a parent's
-- cancel; Daybell sets every amount (Q1): the parent is refunded with no Stripe flags, then one transfer reversal of
-- what the studio gives back (the refund less Daybell's fee on it, pro rata at the order's rate). A shortfall (the
-- card fee already reversed leaves too little in the transfer) is a studio receivable, recovered from the studio's next
-- settled sale, absorbed by Daybell after 180 days without a settled sale (Q2). Each refund Stripe accepts writes one
-- balanced ledger transaction; a refund that fails after the studio's share was taken back sends that share back (Q7).
-- Staff see orders, totals and fees; never Home's money, the ledger or refunds (Q4). Home delivery addresses and
-- tracking numbers are purged 90 days after shipping, at the latest 365 days after payment (a launch blocker from step
-- 10). A refund made outside Daybell (the Stripe Dashboard) flags the order, rings the bell and stops fulfilment until
-- an owner or admin marks it checked.

-- ── Types ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create type public.order_fulfilment as enum ('paid', 'printed', 'shipped', 'delivered', 'complete', 'canceled');
create type public.shipping_carrier as enum ('canada_post', 'purolator', 'ups', 'fedex', 'other');
-- lines: by line item and quantity; custom: an amount of products before tax (Q3); cancel: a parent's, everything left.
create type public.refund_kind as enum ('lines', 'custom', 'cancel');
-- requested: written, not yet accepted by Stripe; pending and succeeded: Stripe's; failed: Stripe couldn't refund (or
-- refused at once); canceled: never reached Stripe (Stripe refused the request), nothing happened.
create type public.refund_status as enum ('requested', 'pending', 'succeeded', 'failed', 'canceled');
-- A fixed list, never free text (no personal data).
create type public.refund_reason as enum ('parent_asked', 'damaged', 'wrong_item', 'quality', 'duplicate', 'other');
create type public.status_undo_reason as enum ('marked_by_mistake', 'reprint_needed', 'wrong_tracking', 'other');

-- ── Orders: fulfilment and tracking ───────────────────────────────────────────────────────────────────────────────
alter table public.orders
  add column fulfilment_status public.order_fulfilment,
  add column printed_at timestamptz,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column canceled_at timestamptz,
  add column disputed_at timestamptz,
  add column carrier public.shipping_carrier,
  -- Letters, digits, spaces and dashes (the API trims and upper-cases it). Never in an event or a log.
  add column tracking_number text check (tracking_number ~ '^[A-Za-z0-9 -]{4,40}$'),
  -- Only with "other": the carrier's own tracking page, https only.
  add column tracking_url text check (char_length(tracking_url) <= 500 and tracking_url ~ '^https://[^[:space:]]+$'),
  add column ship_to_purged_at timestamptz,
  -- A refund made outside Daybell (security review S5): stamped once; fulfilment stops until an owner or admin marks it
  -- checked.
  add column external_refund_at timestamptz,
  add column external_refund_checked_at timestamptz;

-- A line that needs printing: a print, or a package holding a print.
create function app.order_line_physical(p_line public.order_lines) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_line.kind = 'print' or (p_line.kind = 'package' and exists (
    select 1 from public.order_line_contents c
    where c.order_line_id = p_line.id and c.studio_id = p_line.studio_id and c.line_kind = 'print'));
$$;

create function app.order_physical(p_order_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.order_lines ol where ol.order_id = p_order_id and app.order_line_physical(ol));
$$;

-- Existing paid orders: Paid, or Complete when nothing is to be printed.
update public.orders o
set fulfilment_status = (case when app.order_physical(o.id) then 'paid' else 'complete' end)::public.order_fulfilment
where o.status = 'paid';

alter table public.orders
  add constraint orders_fulfilment check ((status = 'paid') = (fulfilment_status is not null)),
  add constraint orders_printed check ((fulfilment_status in ('printed', 'shipped', 'delivered')) = (printed_at is not null)),
  add constraint orders_shipped check ((fulfilment_status = 'shipped') = (shipped_at is not null)),
  add constraint orders_delivered check ((fulfilment_status = 'delivered') = (delivered_at is not null)),
  add constraint orders_canceled check ((fulfilment_status = 'canceled') = (canceled_at is not null)),
  -- Shipped means a carrier and a tracking number (Claude's call); both only for home delivery.
  -- (The purge clears the tracking number with the address: code review B2.)
  add constraint orders_tracking check (fulfilment_status <> 'shipped'
    or (carrier is not null and (tracking_number is not null or ship_to_purged_at is not null))),
  add constraint orders_external_refund check (external_refund_checked_at is null or external_refund_at is not null),
  add constraint orders_tracking_home check ((carrier is null and tracking_number is null) or shipping_method = 'home'),
  add constraint orders_tracking_url check (tracking_url is null or carrier = 'other');

create index orders_fulfilment_idx on public.orders (studio_id, fulfilment_status, paid_at desc) where status = 'paid';
create index orders_purge_idx on public.orders (paid_at) where ship_to_purged_at is null and shipping_method = 'home';

-- On payment (complete_order): Paid, or Complete when nothing is to be printed (Claude's call: digital-only orders are
-- complete at payment). Before the fulfilment guard (triggers fire by name).
create function app.on_order_paid() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    new.fulfilment_status := (case when app.order_physical(new.id) then 'paid' else 'complete' end)::public.order_fulfilment;
  end if;
  return new;
end;
$$;
create trigger orders_fulfilment_paid before update of status on public.orders
for each row execute function app.on_order_paid();

-- The fulfilment status moves only Paid → Printed → Shipped (home) or Delivered (school), and Paid → Canceled; one step back only
-- through undo_order_status (app.fulfilment_undo set for the statement), and Canceled → Paid only when the cancel's
-- refund failed (app.fulfilment_restore). The times are the database's own, set here; nobody writes them.
create function app.guard_order_fulfilment() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from public.order_fulfilment := old.fulfilment_status;
  v_to public.order_fulfilment := new.fulfilment_status;
  v_undo boolean := coalesce(current_setting('app.fulfilment_undo', true), '') = 'on';
  v_restore boolean := coalesce(current_setting('app.fulfilment_restore', true), '') = 'on';
begin
  new.printed_at := old.printed_at;
  new.shipped_at := old.shipped_at;
  new.delivered_at := old.delivered_at;
  new.canceled_at := old.canceled_at;
  if v_to is not distinct from v_from then
    return new;
  end if;
  if v_from is null and new.status = 'paid' and old.status is distinct from 'paid' and v_to in ('paid', 'complete') then
    return new;
  elsif v_from = 'paid' and v_to = 'printed' then
    new.printed_at := now();
  elsif v_from = 'printed' and v_to = 'shipped' and new.shipping_method = 'home' then
    new.shipped_at := now();
  elsif v_from = 'printed' and v_to = 'delivered' and new.shipping_method = 'school' then
    new.delivered_at := now();
  elsif v_from = 'paid' and v_to = 'canceled' then
    new.canceled_at := now();
  elsif v_undo and v_from = 'printed' and v_to = 'paid' then
    new.printed_at := null;
  elsif v_undo and v_from = 'shipped' and v_to = 'printed' then
    new.shipped_at := null;
  elsif v_undo and v_from = 'delivered' and v_to = 'printed' then
    new.delivered_at := null;
  elsif v_restore and v_from = 'canceled' and v_to = 'paid' then
    new.canceled_at := null;
  else
    raise exception 'order_fulfilment_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger orders_guard_fulfilment before update on public.orders
for each row execute function app.guard_order_fulfilment();

-- ── Refunds ───────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  -- Restrict: money records are kept 7 years (D125).
  studio_id uuid not null references public.studios (id) on delete restrict,
  order_id uuid not null,
  -- The caller's idempotency key (the studio's dialog makes one; each parent's cancel attempt gets its own): the same
  -- request is the same refund. Never an order's id (begin_refund refuses it).
  request_id uuid not null,
  kind public.refund_kind not null,
  reason public.refund_reason,
  -- Whole cents (D96), fixed when the refund is written (ADR 0024 §split).
  products_cents bigint not null check (products_cents between 0 and 1000000000),
  shipping_cents bigint not null check (shipping_cents between 0 and 100000),
  tax_cents bigint not null check (tax_cents between 0 and 1000000000),
  amount_cents bigint not null check (amount_cents between 1 and 2000000000),
  -- Daybell's fee given back: its share of the refunded products at the order's rate (answer 1).
  daybell_fee_cents bigint not null check (daybell_fee_cents >= 0),
  currency char(3) not null check (currency in ('USD', 'CAD')),
  status public.refund_status not null default 'requested',
  stripe_refund_id text unique check (char_length(stripe_refund_id) <= 255 and stripe_refund_id ~ '^(re|pyr)_[A-Za-z0-9_]+$'),
  -- What was taken back from the studio's transfer (null until done), and what of the studio's share is still owed
  -- (Q2: recovered from its next settled sale, else absorbed after 180 days without one).
  reversal_cents bigint check (reversal_cents >= 0),
  stripe_reversal_id text check (char_length(stripe_reversal_id) <= 255 and stripe_reversal_id ~ '^trr_[A-Za-z0-9_]+$'),
  unrecovered_cents bigint not null default 0 check (unrecovered_cents >= 0),
  absorbed_cents bigint not null default 0 check (absorbed_cents >= 0),
  absorbed_at timestamptz,
  -- The owner or admin who asked; null for a parent's cancel. No foreign key: erasing a person never touches money.
  actor_id uuid,
  -- Stripe's failure reason or Daybell's code, never a message.
  failure_code text check (failure_code ~ '^[a-z_]{1,100}$'),
  backstop_attempts integer not null default 0 check (backstop_attempts between 0 and 1000000),
  backstop_error text check (backstop_error ~ '^[a-z_]{1,100}$'),
  backstop_next_at timestamptz,
  problem text check (problem ~ '^[a-z_]{1,100}$'),
  problem_at timestamptz,
  -- Stripe failed the refund after the studio's share was taken back: the share sent back to the studio's account by a
  -- transfer (Q7), once.
  returned_cents bigint check (returned_cents > 0),
  stripe_return_transfer_id text check (char_length(stripe_return_transfer_id) <= 255
    and stripe_return_transfer_id ~ '^tr_[A-Za-z0-9_]+$'),
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  settled_at timestamptz,
  failed_at timestamptz,
  constraint order_refunds_studio_id_id_key unique (studio_id, id),
  constraint order_refunds_request_key unique (studio_id, request_id),
  constraint order_refunds_order_fk foreign key (studio_id, order_id)
    references public.orders (studio_id, id) on delete restrict,
  constraint order_refunds_amount check (amount_cents = products_cents + shipping_cents + tax_cents),
  constraint order_refunds_fee check (daybell_fee_cents <= amount_cents),
  constraint order_refunds_accepted check (status not in ('pending', 'succeeded')
    or (stripe_refund_id is not null and accepted_at is not null)),
  constraint order_refunds_settled check (status <> 'succeeded' or settled_at is not null),
  constraint order_refunds_failed check ((status = 'failed') = (failed_at is not null)),
  constraint order_refunds_reversal check (stripe_reversal_id is null or reversal_cents > 0),
  constraint order_refunds_unrecovered check (unrecovered_cents + absorbed_cents + coalesce(reversal_cents, 0)
    <= amount_cents - daybell_fee_cents),
  constraint order_refunds_cancel_reason check (kind <> 'cancel' or (reason = 'parent_asked' and actor_id is null)),
  constraint order_refunds_problem check ((problem is null) = (problem_at is null)),
  constraint order_refunds_absorbed check ((absorbed_cents > 0) = (absorbed_at is not null)),
  constraint order_refunds_returned check ((returned_at is null) = (stripe_return_transfer_id is null)
    and (returned_at is null) = (returned_cents is null) and (returned_at is null or status = 'failed'))
);
create index order_refunds_order_idx on public.order_refunds (order_id, created_at);
create index order_refunds_studio_idx on public.order_refunds (studio_id, created_at desc);
create index order_refunds_due_idx on public.order_refunds (coalesce(backstop_next_at, created_at))
  where problem is null and (status = 'requested' or (status in ('pending', 'succeeded') and reversal_cents is null)
    or status = 'pending');
create index order_refunds_shortfall_idx on public.order_refunds (studio_id, accepted_at) where unrecovered_cents > 0;
create index order_refunds_return_idx on public.order_refunds (failed_at) where status = 'failed' and returned_at is null;
comment on table public.order_refunds is
  'A refund of an order (ADR 0024): its amounts in whole cents, Daybell''s fee given back, Stripe''s ids, the studio''s '
  'transfer reversal and any shortfall. Never deleted (D125); no personal data.';

-- Which lines a refund gave back, and how many (a custom refund has none: it doesn't touch quantities, Q3).
create table public.order_refund_lines (
  refund_id uuid not null,
  studio_id uuid not null references public.studios (id) on delete restrict,
  order_line_id uuid not null,
  quantity integer not null check (quantity between 1 and 99),
  products_cents bigint not null check (products_cents between 0 and 100000000),
  primary key (refund_id, order_line_id),
  constraint order_refund_lines_refund_fk foreign key (studio_id, refund_id)
    references public.order_refunds (studio_id, id) on delete restrict,
  constraint order_refund_lines_line_fk foreign key (studio_id, order_line_id)
    references public.order_lines (studio_id, id) on delete restrict
);
create index order_refund_lines_line_idx on public.order_refund_lines (order_line_id);
create index order_refund_lines_studio_idx on public.order_refund_lines (studio_id);
comment on table public.order_refund_lines is 'The lines and quantities a refund gave back (ADR 0024).';

-- A refund's shortfall recovered from a later sale's transfer (Q2): one reversal per refund and sale.
create table public.order_refund_recoveries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete restrict,
  refund_id uuid not null,
  -- The later sale whose transfer it came from.
  order_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 2000000000),
  stripe_reversal_id text not null check (char_length(stripe_reversal_id) <= 255 and stripe_reversal_id ~ '^trr_[A-Za-z0-9_]+$'),
  created_at timestamptz not null default now(),
  constraint order_refund_recoveries_key unique (refund_id, order_id),
  constraint order_refund_recoveries_refund_fk foreign key (studio_id, refund_id)
    references public.order_refunds (studio_id, id) on delete restrict,
  constraint order_refund_recoveries_order_fk foreign key (studio_id, order_id)
    references public.orders (studio_id, id) on delete restrict
);
create index order_refund_recoveries_studio_idx on public.order_refund_recoveries (studio_id);
create index order_refund_recoveries_order_idx on public.order_refund_recoveries (order_id);
comment on table public.order_refund_recoveries is
  'A refund''s shortfall taken back from the studio''s next settled sale (ADR 0024; Q2). Append-only.';

-- Counted actions (Claude's calls): a parent's cancels (5 a session an hour), "Download all" and print-file zips (10 a
-- session or person an hour, and 20 an order an hour across everyone: security review S4). Ids and times only; nobody
-- signed in reads it.
create table public.order_action_attempts (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  -- The shop session, the signed-in person or (zip_order) the order. No foreign key: a pruned session or an erased
  -- person leaves nothing.
  subject_id uuid not null,
  action text not null check (action in ('cancel', 'zip', 'zip_order')),
  created_at timestamptz not null default now()
);
create index order_action_attempts_subject_idx on public.order_action_attempts (subject_id, action, created_at);
create index order_action_attempts_created_idx on public.order_action_attempts (created_at);
comment on table public.order_action_attempts is
  'When a parent cancelled or anyone asked for a zip (rate limits, ADR 0024). Service role only.';

-- A refund's amounts, kind and lines never change; its status moves only forward; each Stripe id and the reversal are
-- written once; what is still owed only goes down. Never deleted.
create function app.guard_order_refund() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'refund_fixed' using errcode = 'check_violation';
  end if;
  if (new.id, new.studio_id, new.order_id, new.request_id, new.kind, new.reason, new.products_cents,
      new.shipping_cents, new.tax_cents, new.amount_cents, new.daybell_fee_cents, new.currency, new.actor_id,
      new.created_at)
     is distinct from
     (old.id, old.studio_id, old.order_id, old.request_id, old.kind, old.reason, old.products_cents,
      old.shipping_cents, old.tax_cents, old.amount_cents, old.daybell_fee_cents, old.currency, old.actor_id,
      old.created_at)
     or (old.stripe_refund_id is not null and new.stripe_refund_id is distinct from old.stripe_refund_id)
     or (old.reversal_cents is not null and new.reversal_cents is distinct from old.reversal_cents)
     or (old.stripe_reversal_id is not null and new.stripe_reversal_id is distinct from old.stripe_reversal_id)
     or (old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
     or (old.settled_at is not null and new.settled_at is distinct from old.settled_at)
     or (old.failed_at is not null and new.failed_at is distinct from old.failed_at)
     or (old.absorbed_at is not null and (new.absorbed_at, new.absorbed_cents) is distinct from (old.absorbed_at, old.absorbed_cents))
     or (old.reversal_cents is not null and new.unrecovered_cents > old.unrecovered_cents)
     or (old.returned_at is not null and (new.returned_at, new.returned_cents, new.stripe_return_transfer_id)
         is distinct from (old.returned_at, old.returned_cents, old.stripe_return_transfer_id)) then
    raise exception 'refund_fixed' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'requested' and new.status in ('pending', 'succeeded', 'failed', 'canceled'))
    or (old.status = 'pending' and new.status in ('succeeded', 'failed'))
    or (old.status = 'succeeded' and new.status = 'failed')) then
    raise exception 'refund_status_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger order_refunds_guard before update or delete on public.order_refunds
for each row execute function app.guard_order_refund();

-- A new refund is in its order's currency (the region's, ADR 0006), asked for and not yet anything at Stripe.
create function app.guard_order_refund_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from (select o.currency from public.orders o
                                    where o.id = new.order_id and o.studio_id = new.studio_id) then
    raise exception 'refund_currency' using errcode = 'check_violation';
  end if;
  if new.status <> 'requested' or new.stripe_refund_id is not null or new.reversal_cents is not null
     or new.accepted_at is not null or new.unrecovered_cents <> 0 or new.absorbed_cents <> 0
     or new.returned_at is not null then
    raise exception 'refund_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger order_refunds_guard_insert before insert on public.order_refunds
for each row execute function app.guard_order_refund_insert();
create trigger order_refunds_no_truncate before truncate on public.order_refunds
for each statement execute function app.guard_order_delete();
create trigger order_refund_lines_guard before update or delete on public.order_refund_lines
for each row execute function app.guard_order_line();
create trigger order_refund_lines_no_truncate before truncate on public.order_refund_lines
for each statement execute function app.guard_order_delete();
create trigger order_refund_recoveries_guard before update or delete on public.order_refund_recoveries
for each row execute function app.guard_order_line();
create trigger order_refund_recoveries_no_truncate before truncate on public.order_refund_recoveries
for each statement execute function app.guard_order_delete();

-- ── The ledger (amends ADR 0006 and 0023) ─────────────────────────────────────────────────────────────────────────
-- A refund's transactions name it: an order has one order_paid transaction, and each refund one of each kind.
alter table public.ledger_transactions add column refund_id uuid;
alter table public.ledger_transactions
  add constraint ledger_transactions_refund_fk foreign key (studio_id, refund_id)
    references public.order_refunds (studio_id, id) on delete restrict,
  add constraint ledger_transactions_refund_kind check ((refund_id is null) = (kind = 'order_paid')),
  drop constraint ledger_transactions_order_kind_key;
create unique index ledger_transactions_order_kind_key on public.ledger_transactions (order_id, kind)
  where refund_id is null;
create unique index ledger_transactions_refund_kind_key on public.ledger_transactions (refund_id, kind)
  where refund_id is not null;

-- settle_order_fees as in 20261013000000, its once-per-order insert naming the new partial unique index.
create or replace function public.settle_order_fees(p_order_id uuid, p_transfer_id text, p_stripe_fee_cents bigint,
  p_fee_currency text, p_balance_transaction_id text, p_fee_reversal_id text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_txn uuid;
  v_studio_cents bigint;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.status <> 'paid' then
    raise exception 'not_paid' using errcode = 'P0001';
  end if;
  if v_order.fees_settled_at is not null then
    return 'already_settled';
  end if;
  if upper(coalesce(p_fee_currency, '')) <> v_order.currency then
    raise exception 'fee_currency' using errcode = 'P0001';
  end if;
  if p_stripe_fee_cents is null or p_stripe_fee_cents < 0 or p_stripe_fee_cents > v_order.total_cents then
    raise exception 'The fee is 0 to the order''s total' using errcode = '22023';
  end if;
  if coalesce(p_transfer_id, '') !~ '^tr_[A-Za-z0-9_]{1,250}$'
     or (v_order.transfer_id is not null and v_order.transfer_id <> p_transfer_id) then
    raise exception 'checkout_mismatch' using errcode = 'P0001';
  end if;
  insert into public.ledger_transactions (studio_id, kind, order_id)
  values (v_order.studio_id, 'order_paid', v_order.id)
  on conflict (order_id, kind) where refund_id is null do nothing
  returning id into v_txn;
  if v_txn is null then
    return 'already_settled';
  end if;
  v_studio_cents := v_order.total_cents - v_order.tax_cents - v_order.daybell_fee_cents - p_stripe_fee_cents;
  insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency)
  select v_order.studio_id, v_txn, x.account, x.amount, v_order.currency
  from (values
    ('parent_payments'::public.ledger_account, v_order.total_cents),
    ('tax_payable'::public.ledger_account, -v_order.tax_cents),
    ('daybell_fees'::public.ledger_account, -v_order.daybell_fee_cents),
    ('payment_fees'::public.ledger_account, -p_stripe_fee_cents),
    ('studio_payable'::public.ledger_account, -v_studio_cents)) x (account, amount)
  where x.amount <> 0;
  update public.orders o
  set transfer_id = p_transfer_id, stripe_fee_cents = p_stripe_fee_cents, fees_settled_at = now(),
    balance_transaction_id = p_balance_transaction_id, fee_reversal_id = p_fee_reversal_id
  where o.id = v_order.id;
  return 'settled';
end;
$$;

-- ── The bell (amends ADR 0021) ────────────────────────────────────────────────────────────────────────────────────
alter table public.notifications add column order_id uuid;
alter table public.notifications
  add constraint notifications_order_fk foreign key (studio_id, order_id)
    references public.orders (studio_id, id) on delete cascade;
create index notifications_order_idx on public.notifications (order_id) where order_id is not null;

create or replace function app.guard_notification_read() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.studio_id, new.user_id, new.event_id, new.kind, new.job_id, new.batch_id, new.order_id, new.data,
      new.created_at)
       is distinct from
     (old.id, old.studio_id, old.user_id, old.event_id, old.kind, old.job_id, old.batch_id, old.order_id, old.data,
      old.created_at) then
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

-- Who hears about each kind (the same as packages/core NOTIFICATION_AUDIENCE): a new order goes to the people who
-- fulfil it (owners, admins and staff); a failed refund, a dispute and a refund made outside Daybell to owners and
-- admins (who refund, answer 3).
create or replace function app.notification_audience(p_kind public.notification_kind) returns public.studio_role[]
language sql immutable
set search_path = ''
as $$
  select case p_kind
    when 'job_selling' then '{owner,admin,photographer,staff}'::public.studio_role[]
    when 'job_closed' then '{owner,admin,photographer,staff}'::public.studio_role[]
    when 'payouts_active' then '{owner,admin}'::public.studio_role[]
    when 'payouts_restricted' then '{owner,admin}'::public.studio_role[]
    when 'order_paid' then '{owner,admin,staff}'::public.studio_role[]
    when 'refund_failed' then '{owner,admin}'::public.studio_role[]
    when 'dispute_opened' then '{owner,admin}'::public.studio_role[]
    when 'refund_external' then '{owner,admin}'::public.studio_role[]
    else '{owner,admin,photographer}'::public.studio_role[]
  end;
$$;

-- One notification about an order per member in the kind's audience. An order that isn't the studio's makes none.
create function app.notify_order(p_event_id bigint, p_studio_id uuid, p_kind public.notification_kind,
  p_order_id uuid) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (studio_id, user_id, event_id, kind, order_id)
  select p_studio_id, m.user_id, p_event_id, p_kind, p_order_id
  from public.studio_members m
  where m.studio_id = p_studio_id and m.role = any (app.notification_audience(p_kind))
    and exists (select 1 from public.orders o where o.id = p_order_id and o.studio_id = p_studio_id)
  on conflict do nothing;
$$;

create or replace function app.notify_from_event() returns trigger
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
  elsif new.type = 'order.paid' and new.subject_id is not null then
    perform app.notify_order(new.id, new.studio_id, 'order_paid', new.subject_id);
  elsif new.type = 'order.refund_failed' and new.subject_id is not null then
    perform app.notify_order(new.id, new.studio_id, 'refund_failed', new.subject_id);
  elsif new.type = 'order.dispute_opened' and new.subject_id is not null then
    perform app.notify_order(new.id, new.studio_id, 'dispute_opened', new.subject_id);
  elsif new.type = 'order.external_refund' and new.subject_id is not null then
    perform app.notify_order(new.id, new.studio_id, 'refund_external', new.subject_id);
  end if;
  return null;
end;
$$;
drop trigger events_notify on public.events;
create trigger events_notify after insert on public.events
for each row when (new.type in ('job.selling', 'job.closed', 'payout_account.status_changed', 'photos.tagged',
  'order.paid', 'order.refund_failed', 'order.dispute_opened', 'order.external_refund'))
execute function app.notify_from_event();

-- ── Row-level security (Seenu, Q4) ────────────────────────────────────────────────────────────────────────────────
-- Staff fulfil, so they read orders, their lines and, for home delivery, where they ship. Refunds, the ledger and the
-- event log stay with owners and admins. Nobody signed in writes; the shop session stays ungranted.
drop policy "owners and admins read their studio's orders" on public.orders;
drop policy "owners and admins read their studio's order lines" on public.order_lines;
drop policy "owners and admins read their studio's order contents" on public.order_line_contents;
drop policy "owners and admins read their studio's order photos" on public.order_line_photos;
drop policy "owners and admins read their studio's shipping addresses" on public.order_shipping_addresses;
create policy "owners, admins and staff read their studio's orders" on public.orders
  for select to authenticated using (app.has_role(studio_id, '{owner,admin,staff}'));
create policy "owners, admins and staff read their studio's order lines" on public.order_lines
  for select to authenticated using (app.has_role(studio_id, '{owner,admin,staff}'));
create policy "owners, admins and staff read their studio's order contents" on public.order_line_contents
  for select to authenticated using (app.has_role(studio_id, '{owner,admin,staff}'));
create policy "owners, admins and staff read their studio's order photos" on public.order_line_photos
  for select to authenticated using (app.has_role(studio_id, '{owner,admin,staff}'));
create policy "owners, admins and staff read their studio's shipping addresses" on public.order_shipping_addresses
  for select to authenticated using (app.has_role(studio_id, '{owner,admin,staff}'));

alter table public.order_refunds enable row level security;
alter table public.order_refund_lines enable row level security;
alter table public.order_refund_recoveries enable row level security;
alter table public.order_action_attempts enable row level security;
create policy "owners and admins read their studio's refunds" on public.order_refunds
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's refund lines" on public.order_refund_lines
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's refund recoveries" on public.order_refund_recoveries
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
revoke all on public.order_refunds, public.order_refund_lines, public.order_refund_recoveries,
  public.order_action_attempts from anon, authenticated;
grant select on public.order_refunds, public.order_refund_lines, public.order_refund_recoveries to authenticated;
grant select (fulfilment_status, printed_at, shipped_at, delivered_at, canceled_at, disputed_at, carrier,
  tracking_number, tracking_url, ship_to_purged_at, external_refund_at, external_refund_checked_at)
  on public.orders to authenticated;

-- ── The webhook inbox (amends ADR 0020, 0023) ─────────────────────────────────────────────────────────────────────
alter table public.stripe_events drop constraint stripe_events_type_check;
alter table public.stripe_events
  add constraint stripe_events_type_check
    check (type in (
      'account.updated',
      'capability.updated',
      'payout.created',
      'payout.updated',
      'payout.paid',
      'payout.failed',
      'payout.canceled',
      'v2.core.account.updated',
      'v2.core.account[requirements].updated',
      'v2.core.account[configuration.merchant].updated',
      'v2.core.account[configuration.merchant].capability_status_updated',
      'v2.core.account[configuration.recipient].updated',
      'v2.core.account[configuration.recipient].capability_status_updated',
      'checkout.session.completed',
      'checkout.session.expired',
      'charge.refunded',
      'refund.updated',
      'refund.failed',
      'charge.dispute.created'
    ));

-- ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- Acting for p_actor, who must have one of p_roles in the studio; refused (42501) before anything is read. act_for
-- refuses staff, who fulfil orders (answer 4).
create function app.act_for_roles(p_actor uuid, p_studio_id uuid, p_roles public.studio_role[]) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('request.jwt.claim.sub', true);
begin
  if p_actor is null or p_studio_id is null then
    raise exception 'Not allowed for your role' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if not app.has_role(p_studio_id, p_roles) then
    raise exception 'Not allowed for your role' using errcode = '42501';
  end if;
  return coalesce(v_previous, '');
end;
$$;

-- What an order's refunds have given back so far: written but not failed or abandoned (so a refund in flight counts,
-- and two refunds at once can never give back more than was paid).
create function app.order_refunded(p_order_id uuid)
returns table (products bigint, shipping bigint, tax bigint, fee bigint, amount bigint, accepted_amount bigint,
  in_flight bigint)
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(r.products_cents), 0)::bigint, coalesce(sum(r.shipping_cents), 0)::bigint,
    coalesce(sum(r.tax_cents), 0)::bigint, coalesce(sum(r.daybell_fee_cents), 0)::bigint,
    coalesce(sum(r.amount_cents), 0)::bigint,
    coalesce(sum(r.amount_cents) filter (where r.status in ('pending', 'succeeded')), 0)::bigint,
    count(*) filter (where r.status = 'requested')
  from public.order_refunds r
  where r.order_id = p_order_id and r.status in ('requested', 'pending', 'succeeded');
$$;

-- How many of a line's items refunds have given back (custom refunds give back none).
create function app.order_line_refunded_quantity(p_line_id uuid) returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(rl.quantity), 0)::integer
  from public.order_refund_lines rl
  join public.order_refunds r on r.id = rl.refund_id and r.studio_id = rl.studio_id
  where rl.order_line_id = p_line_id and r.status in ('requested', 'pending', 'succeeded');
$$;

-- refunded: everything paid was given back; partly_refunded: some of it; null: none (refunds Stripe accepted only).
create function app.order_refund_badge(p_order public.orders) returns text
language sql stable security definer
set search_path = ''
as $$
  select case when x.accepted_amount = 0 then null
              when x.accepted_amount >= p_order.total_cents then 'refunded'
              else 'partly_refunded' end
  from app.order_refunded(p_order.id) x;
$$;

-- Whether nothing is left to refund (fulfilment stops).
create function app.order_fully_refunded(p_order public.orders) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select x.products >= p_order.products_cents and x.shipping >= p_order.shipping_cents
  from app.order_refunded(p_order.id) x;
$$;

-- For the studio's own reads (SECURITY INVOKER functions under row-level security): an order's refund badge, whether
-- a refund is in flight, and how many of each line were given back. No amounts, so staff may see them (they print what
-- is left; Q4). Null for anyone who isn't an owner, admin or staff of the order's studio.
create function app.studio_order_refund_state(p_order_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'badge', app.order_refund_badge(o),
    'in_flight', (select x.in_flight > 0 from app.order_refunded(o.id) x),
    'fully_refunded', app.order_fully_refunded(o),
    'lines', coalesce((select jsonb_object_agg(ol.id, app.order_line_refunded_quantity(ol.id))
                       from public.order_lines ol where ol.order_id = o.id and ol.studio_id = o.studio_id), '{}'::jsonb))
  from public.orders o
  where o.id = p_order_id and app.has_role(o.studio_id, '{owner,admin,staff}');
$$;

-- Counts an action for a subject (a parent's session or a signed-in person) and refuses it past p_limit an hour.
create function app.take_order_action(p_studio_id uuid, p_subject_id uuid, p_action text, p_limit integer)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('order_action:' || p_subject_id::text || ':' || p_action, 0));
  delete from public.order_action_attempts a
  where a.subject_id = p_subject_id and a.action = p_action and a.created_at < now() - interval '1 hour';
  if (select count(*) from public.order_action_attempts a
      where a.subject_id = p_subject_id and a.action = p_action) >= p_limit then
    return false;
  end if;
  insert into public.order_action_attempts (studio_id, subject_id, action) values (p_studio_id, p_subject_id, p_action);
  return true;
end;
$$;

-- Emits an event as p_actor (null: nobody, e.g. a parent's cancel or the webhook), then puts the caller back.
create function app.emit_as(p_actor uuid, p_studio_id uuid, p_type text, p_subject_id uuid, p_data jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_actor::text, ''), true);
  perform set_config('request.jwt.claims', '', true);
  perform app.emit(p_studio_id, p_type, p_subject_id, p_data);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
end;
$$;

-- ── Fulfilment (answer 4: owners, admins and staff) ───────────────────────────────────────────────────────────────
-- Marks one paid order Printed, Shipped (home delivery, with a carrier and tracking number; a link only for "other")
-- or Delivered to school. Named refusals without values: order_not_paid, order_canceled, order_refunded (nothing left
-- to deliver), external_refund (a refund made outside Daybell not yet checked by an owner or admin), refund_in_flight
-- (a refund not yet accepted by Stripe: a parent's cancel may be on its way),
-- wrong_delivery (shipping a school order or delivering a home one), tracking_required, status_invalid (not the next
-- step). Another studio's order is not found. Events: order.printed, order.shipped {carrier}, order.delivered: never the
-- tracking number.
create function public.mark_order_status(p_actor uuid, p_studio_id uuid, p_order_id uuid,
  p_status public.order_fulfilment, p_carrier public.shipping_carrier default null,
  p_tracking_number text default null, p_tracking_url text default null) returns public.order_fulfilment
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin,staff}');
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.id = p_order_id and o.studio_id = p_studio_id for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.status <> 'paid' then
    raise exception 'order_not_paid' using errcode = 'P0001';
  end if;
  if v_order.fulfilment_status = 'canceled' then
    raise exception 'order_canceled' using errcode = 'P0001';
  end if;
  if app.order_fully_refunded(v_order) then
    raise exception 'order_refunded' using errcode = 'P0001';
  end if;
  if v_order.external_refund_at is not null and v_order.external_refund_checked_at is null then
    raise exception 'external_refund' using errcode = 'P0001';
  end if;
  if (select x.in_flight from app.order_refunded(v_order.id) x) > 0 then
    raise exception 'refund_in_flight' using errcode = 'P0001';
  end if;
  if p_status = 'printed' then
    if v_order.fulfilment_status <> 'paid' then
      raise exception 'status_invalid' using errcode = 'P0001';
    end if;
    update public.orders o set fulfilment_status = 'printed' where o.id = v_order.id;
    perform app.emit(p_studio_id, 'order.printed', v_order.id, '{}'::jsonb);
  elsif p_status = 'shipped' then
    if v_order.shipping_method is distinct from 'home' then
      raise exception 'wrong_delivery' using errcode = 'P0001';
    end if;
    if v_order.fulfilment_status <> 'printed' then
      raise exception 'status_invalid' using errcode = 'P0001';
    end if;
    if p_carrier is null or coalesce(p_tracking_number, '') = '' then
      raise exception 'tracking_required' using errcode = 'P0001';
    end if;
    if (p_tracking_url is not null and p_carrier <> 'other')
       or p_tracking_number !~ '^[A-Za-z0-9 -]{4,40}$'
       or (p_tracking_url is not null and (char_length(p_tracking_url) > 500 or p_tracking_url !~ '^https://[^[:space:]]+$')) then
      raise exception 'Check the tracking details' using errcode = '22023';
    end if;
    update public.orders o
    set fulfilment_status = 'shipped', carrier = p_carrier, tracking_number = p_tracking_number,
      tracking_url = p_tracking_url
    where o.id = v_order.id;
    perform app.emit(p_studio_id, 'order.shipped', v_order.id, jsonb_build_object('carrier', p_carrier));
  elsif p_status = 'delivered' then
    if v_order.shipping_method is distinct from 'school' then
      raise exception 'wrong_delivery' using errcode = 'P0001';
    end if;
    if v_order.fulfilment_status <> 'printed' then
      raise exception 'status_invalid' using errcode = 'P0001';
    end if;
    update public.orders o set fulfilment_status = 'delivered' where o.id = v_order.id;
    perform app.emit(p_studio_id, 'order.delivered', v_order.id, '{}'::jsonb);
  else
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  perform app.end_act_for(v_previous);
  return p_status;
end;
$$;

-- Bulk: Mark printed or Mark delivered to school for up to 100 orders, each on its own (one refused doesn't stop the
-- others). Per order: "ok", or the refusal's name ("not_found" for another studio's or an unknown order).
create function public.mark_orders_status(p_actor uuid, p_studio_id uuid, p_order_ids uuid[],
  p_status public.order_fulfilment) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin,staff}');
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_outcome text;
begin
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 100
     or cardinality(p_order_ids) <> (select count(distinct x) from unnest(p_order_ids) x)
     or p_status not in ('printed', 'delivered') then
    raise exception 'Send 1 to 100 orders, printed or delivered' using errcode = '22023';
  end if;
  foreach v_id in array p_order_ids loop
    begin
      perform public.mark_order_status(p_actor, p_studio_id, v_id, p_status);
      v_outcome := 'ok';
    exception
      when sqlstate 'P0001' then v_outcome := sqlerrm;
      when sqlstate 'P0002' then v_outcome := 'not_found';
    end;
    v_out := v_out || jsonb_build_array(jsonb_build_object('order_id', v_id, 'outcome', v_outcome));
  end loop;
  perform app.end_act_for(v_previous);
  return v_out;
end;
$$;

-- Corrects a shipped order's carrier, tracking number or link (not once the purge has cleared them). Event
-- order.tracking_changed {carrier}.
create function public.set_order_tracking(p_actor uuid, p_studio_id uuid, p_order_id uuid,
  p_carrier public.shipping_carrier, p_tracking_number text, p_tracking_url text default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin,staff}');
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.id = p_order_id and o.studio_id = p_studio_id for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.fulfilment_status is distinct from 'shipped' or v_order.ship_to_purged_at is not null then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  if p_carrier is null or coalesce(p_tracking_number, '') = '' then
    raise exception 'tracking_required' using errcode = 'P0001';
  end if;
  if (p_tracking_url is not null and p_carrier <> 'other') or p_tracking_number !~ '^[A-Za-z0-9 -]{4,40}$'
     or (p_tracking_url is not null and (char_length(p_tracking_url) > 500 or p_tracking_url !~ '^https://[^[:space:]]+$')) then
    raise exception 'Check the tracking details' using errcode = '22023';
  end if;
  update public.orders o set carrier = p_carrier, tracking_number = p_tracking_number, tracking_url = p_tracking_url
  where o.id = v_order.id;
  perform app.emit(p_studio_id, 'order.tracking_changed', v_order.id, jsonb_build_object('carrier', p_carrier));
  perform app.end_act_for(v_previous);
end;
$$;

-- One step back, with a reason from the fixed list (owners and admins; Claude's call): Printed → Paid, Shipped →
-- Printed, Delivered → Printed. Event order.status_reverted {from, to, reason}.
create function public.undo_order_status(p_actor uuid, p_studio_id uuid, p_order_id uuid,
  p_reason public.status_undo_reason) returns public.order_fulfilment
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin}');
  v_order public.orders;
  v_to public.order_fulfilment;
begin
  if p_reason is null then
    raise exception 'Choose a reason' using errcode = '22023';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id and o.studio_id = p_studio_id for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  v_to := case v_order.fulfilment_status when 'printed' then 'paid' when 'shipped' then 'printed'
            when 'delivered' then 'printed' end;
  if v_to is null then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  perform set_config('app.fulfilment_undo', 'on', true);
  update public.orders o set fulfilment_status = v_to where o.id = v_order.id;
  perform set_config('app.fulfilment_undo', '', true);
  perform app.emit(p_studio_id, 'order.status_reverted', v_order.id,
    jsonb_build_object('from', v_order.fulfilment_status, 'to', v_to, 'reason', p_reason));
  perform app.end_act_for(v_previous);
  return v_to;
end;
$$;

-- ── Refunds (answers 1–3; Q1–Q3) ──────────────────────────────────────────────────────────────────────────────────
-- What a refund gives back (ADR 0024 §split; packages/core refundSplit is the same rule): products p (the lines' unit
-- price × quantity, or the custom amount), shipping s (all that's left, or none), tax x = round_half_up(tax × (p + s)
-- / (products + shipping)) and Daybell's fee a = round_half_up(p × rate), each no more than is left; the refund that
-- leaves nothing takes the exact remainders. Refusals: over_refund (more than is left, of a line or in all),
-- nothing_to_refund.
create function app.refund_split(p_order public.orders, p_kind public.refund_kind, p_lines jsonb,
  p_custom_cents bigint, p_shipping boolean)
returns table (products bigint, shipping bigint, tax bigint, fee bigint, lines jsonb)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_done record;
  v_p bigint;
  v_s bigint;
  v_lines jsonb := '[]'::jsonb;
  v_left_p bigint;
  v_left_s bigint;
  v_base bigint;
begin
  select * into v_done from app.order_refunded(p_order.id);
  v_left_p := p_order.products_cents - v_done.products;
  v_left_s := p_order.shipping_cents - v_done.shipping;
  if p_kind = 'cancel' then
    v_p := v_left_p;
    v_s := v_left_s;
    select coalesce(jsonb_agg(jsonb_build_object('line_id', ol.id, 'quantity', ol.quantity - q.done,
             'products_cents', ol.unit_price_cents * (ol.quantity - q.done)) order by ol.position), '[]'::jsonb)
    into v_lines
    from public.order_lines ol
    cross join lateral (select app.order_line_refunded_quantity(ol.id) as done) q
    where ol.order_id = p_order.id and ol.studio_id = p_order.studio_id and ol.quantity > q.done;
  elsif p_kind = 'lines' then
    -- No lines with the shipping left is a shipping-only refund (code review S5).
    if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 100
       or (jsonb_array_length(p_lines) = 0 and not coalesce(p_shipping, false)) then
      raise exception 'Choose 1 to 100 lines' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_lines) e
      left join public.order_lines ol on ol.id = (e.value ->> 'line_id')::uuid and ol.order_id = p_order.id
        and ol.studio_id = p_order.studio_id
      where ol.id is null or jsonb_typeof(e.value -> 'quantity') is distinct from 'number'
         or (e.value ->> 'quantity')::int < 1
         or (e.value ->> 'quantity')::int > ol.quantity - app.order_line_refunded_quantity(ol.id))
       or (select count(distinct e.value ->> 'line_id') from jsonb_array_elements(p_lines) e)
          <> jsonb_array_length(p_lines) then
      raise exception 'over_refund' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('line_id', ol.id, 'quantity', (e.value ->> 'quantity')::int,
             'products_cents', ol.unit_price_cents * (e.value ->> 'quantity')::int) order by ol.position), '[]'::jsonb),
      coalesce(sum(ol.unit_price_cents * (e.value ->> 'quantity')::int), 0)
    into v_lines, v_p
    from jsonb_array_elements(p_lines) e
    join public.order_lines ol on ol.id = (e.value ->> 'line_id')::uuid and ol.studio_id = p_order.studio_id;
    v_s := case when coalesce(p_shipping, false) then v_left_s else 0 end;
  elsif p_kind = 'custom' then
    if p_custom_cents is null or p_custom_cents < 0 then
      raise exception 'A custom amount is whole cents' using errcode = '22023';
    end if;
    v_p := p_custom_cents;
    v_s := case when coalesce(p_shipping, false) then v_left_s else 0 end;
  end if;
  if v_p > v_left_p or v_s > v_left_s then
    raise exception 'over_refund' using errcode = 'P0001';
  end if;
  if v_p + v_s = 0 then
    raise exception 'nothing_to_refund' using errcode = 'P0001';
  end if;
  v_base := p_order.products_cents + p_order.shipping_cents;
  if v_done.products + v_p = p_order.products_cents and v_done.shipping + v_s = p_order.shipping_cents then
    -- Nothing will be left: the exact remainders, so the refunds add up to what was paid.
    return query select v_p, v_s, p_order.tax_cents - v_done.tax, p_order.daybell_fee_cents - v_done.fee, v_lines;
  else
    return query select v_p, v_s,
      least((p_order.tax_cents * (v_p + v_s) * 2 + v_base) / (v_base * 2), p_order.tax_cents - v_done.tax),
      least(app.daybell_fee_cents(v_p, p_order.daybell_fee_bps), p_order.daybell_fee_cents - v_done.fee),
      v_lines;
  end if;
end;
$$;

-- Writes a refund as asked; the API then asks Stripe (lib/orders/refunds.ts). Refused until the order's fees are
-- settled (fees_pending: the card fee's reversal must come first, so the studio's share is known).
create function app.write_refund(p_order public.orders, p_request_id uuid, p_kind public.refund_kind,
  p_reason public.refund_reason, p_actor uuid, p_lines jsonb, p_custom_cents bigint, p_shipping boolean)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_split record;
  v_id uuid;
begin
  if p_order.fees_settled_at is null then
    raise exception 'fees_pending' using errcode = 'P0001';
  end if;
  select * into v_split from app.refund_split(p_order, p_kind, p_lines, p_custom_cents, p_shipping);
  insert into public.order_refunds (studio_id, order_id, request_id, kind, reason, products_cents, shipping_cents,
    tax_cents, amount_cents, daybell_fee_cents, currency, actor_id)
  values (p_order.studio_id, p_order.id, p_request_id, p_kind, p_reason, v_split.products, v_split.shipping,
    v_split.tax, v_split.products + v_split.shipping + v_split.tax, v_split.fee, p_order.currency, p_actor)
  returning id into v_id;
  insert into public.order_refund_lines (refund_id, studio_id, order_line_id, quantity, products_cents)
  select v_id, p_order.studio_id, (e.value ->> 'line_id')::uuid, (e.value ->> 'quantity')::int,
    (e.value ->> 'products_cents')::bigint
  from jsonb_array_elements(v_split.lines) e;
  return v_id;
end;
$$;

-- A studio's refund (owners and admins, answer 3): by line (with or without the shipping left) or a custom amount of
-- products before tax (Q3). The same request id again answers the same refund (created: false). Refusals:
-- order_not_paid, fees_pending, over_refund, nothing_to_refund. Another studio's order is not found. A request id
-- that is an order's id is refused (22023): it could collide with nothing else today, but request ids are the caller's
-- own (security review note 4).
create function public.begin_refund(p_actor uuid, p_studio_id uuid, p_order_id uuid, p_request_id uuid,
  p_kind public.refund_kind, p_lines jsonb, p_custom_cents bigint, p_shipping boolean,
  p_reason public.refund_reason) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin}');
  v_order public.orders;
  v_existing uuid;
  v_id uuid;
begin
  if p_request_id is null or p_kind is null or p_kind = 'cancel'
     or exists (select 1 from public.orders o where o.id = p_request_id) then
    raise exception 'A request id, and lines or a custom amount' using errcode = '22023';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id and o.studio_id = p_studio_id for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  select r.id into v_existing from public.order_refunds r
  where r.studio_id = p_studio_id and r.request_id = p_request_id;
  if v_existing is not null then
    if (select r.order_id from public.order_refunds r where r.id = v_existing) <> p_order_id then
      raise exception 'Order not found' using errcode = 'P0002';
    end if;
    perform app.end_act_for(v_previous);
    return jsonb_build_object('refund_id', v_existing, 'created', false);
  end if;
  if v_order.status <> 'paid' then
    raise exception 'order_not_paid' using errcode = 'P0001';
  end if;
  v_id := app.write_refund(v_order, p_request_id, p_kind, p_reason, p_actor, p_lines, p_custom_cents, p_shipping);
  perform app.end_act_for(v_previous);
  return jsonb_build_object('refund_id', v_id, 'created', true);
end;
$$;

-- A parent's cancel (answer 2; Q5, Q6): only the session that paid, while the order is Paid (not yet Printed; never a
-- digital-only order, which is Complete) and something is left to refund. Everything left, shipping included. Every
-- try counts against 5 a session an hour (cancel_limit; security review S3), a repeat included. While a cancel is live
-- (asked, pending or made) the same cancel is answered (created: false, with its status and whether it has waited 30
-- seconds or more, so the API asks Stripe again only then); after one failed or Stripe refused it, the parent may try
-- again: each try is its own refund with its own request id (code review S1). Refusals: cannot_cancel, cancel_limit,
-- fees_pending. An order this session can't see is not found.
create function public.shop_order_cancel_begin(p_session_hash text, p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
  v_order public.orders;
  v_live public.order_refunds;
  v_id uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id and o.studio_id = v.studio_id for update;
  if v_order.id is null or app.shop_order_view(v, v_order) is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.shop_session_id is distinct from v.id then
    raise exception 'cannot_cancel' using errcode = 'P0001';
  end if;
  if not app.take_order_action(v.studio_id, v.id, 'cancel', 5) then
    raise exception 'cancel_limit' using errcode = 'P0001';
  end if;
  select * into v_live from public.order_refunds r
  where r.studio_id = v_order.studio_id and r.order_id = v_order.id and r.kind = 'cancel'
    and r.status in ('requested', 'pending', 'succeeded')
  order by r.created_at desc limit 1;
  if v_live.id is not null then
    return jsonb_build_object('refund_id', v_live.id, 'created', false, 'status', v_live.status,
      'stale', v_live.created_at < now() - interval '30 seconds');
  end if;
  if v_order.status <> 'paid' or v_order.fulfilment_status <> 'paid' or app.order_fully_refunded(v_order)
     or (select x.in_flight from app.order_refunded(v_order.id) x) > 0 then
    raise exception 'cannot_cancel' using errcode = 'P0001';
  end if;
  v_id := app.write_refund(v_order, gen_random_uuid(), 'cancel', 'parent_asked', null, null, null, true);
  return jsonb_build_object('refund_id', v_id, 'created', true, 'status', 'requested', 'stale', false);
end;
$$;

-- What the API needs to ask Stripe about a refund: amounts, ids and state (never a name). return_needed_cents: what
-- the studio gave back for a refund Stripe then failed (its reversal and any shortfall recovered from later sales),
-- not yet sent back (Q7).
create function public.refund_for_stripe(p_refund_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('refund_id', r.id, 'order_id', r.order_id, 'studio_id', r.studio_id, 'kind', r.kind,
    'reason', r.reason, 'status', r.status, 'amount_cents', r.amount_cents, 'daybell_fee_cents', r.daybell_fee_cents,
    'currency', r.currency, 'stripe_refund_id', r.stripe_refund_id, 'reversal_cents', r.reversal_cents,
    'reversal_needed_cents', r.amount_cents - r.daybell_fee_cents, 'payment_intent_id', o.payment_intent_id,
    'transfer_id', o.transfer_id, 'stripe_account_id', o.stripe_account_id, 'returned_at', r.returned_at,
    'return_needed_cents', case when r.status = 'failed' and r.returned_at is null
      then coalesce(r.reversal_cents, 0) + (select coalesce(sum(x.amount_cents), 0) from public.order_refund_recoveries x
                                            where x.refund_id = r.id) else 0 end)
  from public.order_refunds r join public.orders o on o.id = r.order_id and o.studio_id = r.studio_id
  where r.id = p_refund_id;
$$;

-- The refund's ledger transaction (ADR 0024 §ledger; sign convention of ADR 0023): refunds −amount, tax_payable +tax,
-- daybell_fees +Daybell's fee given back, studio_payable +(the rest: what the studio gives back of its share). Zero
-- lines left out. p_sign −1 writes the mirror (refund_failed).
create function app.write_refund_ledger(p_refund public.order_refunds, p_kind public.ledger_kind, p_sign integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_txn uuid;
begin
  insert into public.ledger_transactions (studio_id, kind, order_id, refund_id)
  values (p_refund.studio_id, p_kind, p_refund.order_id, p_refund.id)
  on conflict (refund_id, kind) where refund_id is not null do nothing
  returning id into v_txn;
  if v_txn is null then
    return;
  end if;
  insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency)
  select p_refund.studio_id, v_txn, x.account, x.amount * p_sign, p_refund.currency
  from (values
    ('refunds'::public.ledger_account, -p_refund.amount_cents),
    ('tax_payable'::public.ledger_account, p_refund.tax_cents),
    ('daybell_fees'::public.ledger_account, p_refund.daybell_fee_cents),
    ('studio_payable'::public.ledger_account,
      p_refund.amount_cents - p_refund.tax_cents - p_refund.daybell_fee_cents)) x (account, amount)
  where x.amount <> 0;
end;
$$;

-- Stripe made the refund (pending or succeeded; failed or canceled at once is a failure): its id, the ledger
-- transaction, a parent's cancel cancels the order, and order.refunded {kind, reason, line_count, full} (no amounts),
-- attributed to whoever asked. Again with the same Stripe id: the status as it is. Another Stripe id: refund_mismatch.
create function public.refund_accepted(p_refund_id uuid, p_stripe_refund_id text, p_stripe_status text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.order_refunds;
  v_order public.orders;
  v_status public.refund_status;
begin
  if coalesce(p_stripe_refund_id, '') !~ '^(re|pyr)_[A-Za-z0-9_]{1,250}$' then
    raise exception 'A Stripe refund id' using errcode = '22023';
  end if;
  select * into v from public.order_refunds r where r.id = p_refund_id for update;
  if v.id is null then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;
  if v.status <> 'requested' then
    if v.stripe_refund_id is distinct from p_stripe_refund_id then
      raise exception 'refund_mismatch' using errcode = 'P0001';
    end if;
    return v.status::text;
  end if;
  if p_stripe_status in ('failed', 'canceled') then
    update public.order_refunds r set status = 'failed', stripe_refund_id = p_stripe_refund_id, failed_at = now(),
      failure_code = 'stripe_' || p_stripe_status
    where r.id = v.id;
    perform app.emit_as(null, v.studio_id, 'order.refund_failed', v.order_id, jsonb_build_object('kind', v.kind));
    return 'failed';
  end if;
  v_status := case when p_stripe_status = 'succeeded' then 'succeeded' else 'pending' end;
  update public.order_refunds r
  set status = v_status, stripe_refund_id = p_stripe_refund_id, accepted_at = now(),
    settled_at = case when v_status = 'succeeded' then now() end
  where r.id = v.id
  returning * into v;
  perform app.write_refund_ledger(v, 'order_refunded', 1);
  select * into v_order from public.orders o where o.id = v.order_id for update;
  if v.kind = 'cancel' and v_order.fulfilment_status = 'paid' then
    update public.orders o set fulfilment_status = 'canceled' where o.id = v_order.id;
    perform app.emit_as(null, v.studio_id, 'order.canceled', v.order_id, '{}'::jsonb);
  end if;
  perform app.emit_as(v.actor_id, v.studio_id, 'order.refunded', v.order_id, jsonb_build_object(
    'kind', v.kind, 'reason', v.reason,
    'line_count', (select count(*) from public.order_refund_lines rl where rl.refund_id = v.id),
    'full', app.order_fully_refunded(v_order)));
  return v_status::text;
end;
$$;

-- The studio's share was taken back from its transfer: p_cents (at most what it owes: the refund less Daybell's fee
-- on it), by p_reversal_id (none when nothing could be taken). What couldn't be is the shortfall (Q2). Once.
create function public.refund_recovered(p_refund_id uuid, p_reversal_id text, p_cents bigint) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.order_refunds;
  v_needed bigint;
begin
  select * into v from public.order_refunds r where r.id = p_refund_id for update;
  if v.id is null then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;
  if v.reversal_cents is not null then
    return v.unrecovered_cents;
  end if;
  v_needed := v.amount_cents - v.daybell_fee_cents;
  if v.status not in ('pending', 'succeeded') or p_cents is null or p_cents < 0 or p_cents > v_needed
     or ((p_cents > 0) <> (p_reversal_id is not null))
     or (p_reversal_id is not null and p_reversal_id !~ '^trr_[A-Za-z0-9_]{1,250}$') then
    raise exception 'The reversal is 0 to what the studio gives back' using errcode = '22023';
  end if;
  update public.order_refunds r
  set reversal_cents = p_cents, stripe_reversal_id = p_reversal_id, unrecovered_cents = v_needed - p_cents
  where r.id = v.id;
  return v_needed - p_cents;
end;
$$;

-- Stripe finished a pending refund. Event order.refund_settled (no amounts).
create function public.refund_settled(p_refund_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.order_refunds;
begin
  select * into v from public.order_refunds r where r.id = p_refund_id for update;
  if v.id is null then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;
  if v.status = 'pending' then
    update public.order_refunds r set status = 'succeeded', settled_at = now() where r.id = v.id;
    perform app.emit_as(null, v.studio_id, 'order.refund_settled', v.order_id, '{}'::jsonb);
    return 'succeeded';
  end if;
  return v.status::text;
end;
$$;

-- Stripe couldn't refund (after accepting it): the mirror of its ledger transaction (so the studio's share is its
-- own again), a cancelled order back to Paid, nothing more to recover, and order.refund_failed {kind}, which rings the
-- bell (owners and admins). What the studio already gave back is sent back by the API (refund_share_returned; Q7).
create function public.refund_failed(p_refund_id uuid, p_code text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.order_refunds;
  v_order public.orders;
begin
  if coalesce(p_code, '') !~ '^[a-z_]{1,100}$' then
    raise exception 'A code' using errcode = '22023';
  end if;
  select * into v from public.order_refunds r where r.id = p_refund_id for update;
  if v.id is null then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;
  if v.status in ('failed', 'canceled') then
    return v.status::text;
  end if;
  if v.status = 'requested' then
    raise exception 'not_accepted' using errcode = 'P0001';
  end if;
  update public.order_refunds r
  set status = 'failed', failed_at = now(), failure_code = p_code, unrecovered_cents = 0
  where r.id = v.id;
  perform app.write_refund_ledger(v, 'refund_failed', -1);
  select * into v_order from public.orders o where o.id = v.order_id for update;
  if v.kind = 'cancel' and v_order.fulfilment_status = 'canceled' then
    perform set_config('app.fulfilment_restore', 'on', true);
    update public.orders o set fulfilment_status = 'paid' where o.id = v_order.id;
    perform set_config('app.fulfilment_restore', '', true);
  end if;
  perform app.emit_as(null, v.studio_id, 'order.refund_failed', v.order_id, jsonb_build_object('kind', v.kind));
  return 'failed';
end;
$$;

-- Stripe refused the request outright, so nothing happened: the refund is canceled with the code. Only before Stripe
-- accepted it.
create function public.refund_abandoned(p_refund_id uuid, p_code text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(p_code, '') !~ '^[a-z_]{1,100}$' then
    raise exception 'A code' using errcode = '22023';
  end if;
  update public.order_refunds r set status = 'canceled', failure_code = p_code
  where r.id = p_refund_id and r.status = 'requested';
end;
$$;

-- What the studio gave back for a refund Stripe then failed was sent back to its account (Q7): the transfer's id and
-- amount, once. The ledger already gave the share back (refund_failed's mirror); like the sale's transfer and the
-- reversals, the transfer settles it. Event order.refund_share_returned (no amounts).
create function public.refund_share_returned(p_refund_id uuid, p_transfer_id text, p_cents bigint) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.order_refunds;
begin
  if coalesce(p_transfer_id, '') !~ '^tr_[A-Za-z0-9_]{1,250}$' or p_cents is null or p_cents < 1 then
    raise exception 'A transfer and its amount' using errcode = '22023';
  end if;
  select * into v from public.order_refunds r where r.id = p_refund_id for update;
  if v.id is null then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;
  if v.returned_at is not null then
    return;
  end if;
  if v.status <> 'failed' then
    raise exception 'not_failed' using errcode = 'P0001';
  end if;
  update public.order_refunds r
  set returned_cents = p_cents, stripe_return_transfer_id = p_transfer_id, returned_at = now()
  where r.id = v.id;
  perform app.emit_as(null, v.studio_id, 'order.refund_share_returned', v.order_id, '{}'::jsonb);
end;
$$;

-- A backstop's try failed, or a problem no retry can fix: as note_checkout_failure, on the refund.
create function public.note_refund_failure(p_refund_id uuid, p_code text, p_permanent boolean) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(p_code, '') !~ '^[a-z_]{1,100}$' or p_permanent is null then
    raise exception 'A code and whether it is permanent' using errcode = '22023';
  end if;
  update public.order_refunds r
  set backstop_attempts = least(r.backstop_attempts + 1, 1000000), backstop_error = p_code,
    backstop_next_at = now() + least(interval '1 minute' * power(2, least(r.backstop_attempts, 10)), interval '6 hours'),
    problem = case when p_permanent then coalesce(r.problem, p_code) else r.problem end,
    problem_at = case when p_permanent then coalesce(r.problem_at, now()) else r.problem_at end
  where r.id = p_refund_id;
end;
$$;

-- The jobs cron's refund backstop (ids only), oldest due first, never one with a problem or backing off: refunds Stripe
-- hasn't accepted after a minute, accepted ones whose reversal isn't done, pending ones to ask Stripe about, and failed
-- ones whose share the studio gave back hasn't been sent back yet (Q7).
create function public.refunds_to_retry(p_limit integer) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('refund_id', x.id))
                   from (select r.id from public.order_refunds r
                         where r.problem is null and (r.backstop_next_at is null or r.backstop_next_at <= now())
                           and ((r.status = 'requested' and r.created_at < now() - interval '1 minute')
                             or (r.status in ('pending', 'succeeded') and r.reversal_cents is null
                                 and r.accepted_at < now() - interval '1 minute')
                             or (r.status = 'pending' and r.accepted_at < now() - interval '1 hour')
                             or (r.status = 'failed' and r.returned_at is null
                                 and (coalesce(r.reversal_cents, 0) > 0 or exists (
                                   select 1 from public.order_refund_recoveries x where x.refund_id = r.id))))
                         order by coalesce(r.backstop_next_at, r.created_at), r.id limit p_limit) x), '[]'::jsonb);
end;
$$;

-- ── Shortfalls (Q2) ───────────────────────────────────────────────────────────────────────────────────────────────
-- What the studio still owes from earlier refunds, oldest first, that a newly settled sale p_order_id (its transfer)
-- may pay back: the same studio, accepted before the sale was paid, not yet tried on this sale.
create function public.refund_shortfalls_for_sale(p_order_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('refund_id', r.id, 'unrecovered_cents', r.unrecovered_cents)
                            order by r.accepted_at, r.id), '[]'::jsonb)
  from public.orders o
  join public.order_refunds r on r.studio_id = o.studio_id and r.unrecovered_cents > 0 and r.absorbed_at is null
    and r.accepted_at < o.paid_at and r.order_id <> o.id
  where o.id = p_order_id and o.status = 'paid' and o.fees_settled_at is not null and o.transfer_id is not null
    and not exists (select 1 from public.order_refund_recoveries x where x.refund_id = r.id and x.order_id = o.id);
$$;

-- Part of a shortfall taken back from a later sale's transfer: recorded once per refund and sale; what is owed goes
-- down. Event order.shortfall_recovered on the refunded order (no amounts). Returns what is still owed.
create function public.refund_shortfall_recovered(p_refund_id uuid, p_order_id uuid, p_cents bigint,
  p_reversal_id text) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.order_refunds;
  v_sale public.orders;
begin
  select * into v from public.order_refunds r where r.id = p_refund_id for update;
  select * into v_sale from public.orders o where o.id = p_order_id;
  if v.id is null or v_sale.id is null or v_sale.studio_id <> v.studio_id then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.order_refund_recoveries x where x.refund_id = v.id and x.order_id = v_sale.id) then
    return v.unrecovered_cents;
  end if;
  if p_cents is null or p_cents < 1 or p_cents > v.unrecovered_cents
     or coalesce(p_reversal_id, '') !~ '^trr_[A-Za-z0-9_]{1,250}$' then
    raise exception 'The recovery is 1 cent to what is owed' using errcode = '22023';
  end if;
  insert into public.order_refund_recoveries (studio_id, refund_id, order_id, amount_cents, stripe_reversal_id)
  values (v.studio_id, v.id, v_sale.id, p_cents, p_reversal_id);
  update public.order_refunds r set unrecovered_cents = r.unrecovered_cents - p_cents where r.id = v.id;
  perform app.emit_as(null, v.studio_id, 'order.shortfall_recovered', v.order_id, '{}'::jsonb);
  return v.unrecovered_cents - p_cents;
end;
$$;

-- The cron's retries of recovery: each open shortfall with the studio's latest settled sale after it that hasn't been
-- tried for it, and that sale's transfer (ids only).
create function public.refund_shortfalls_due(p_limit integer) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('refund_id', x.refund_id, 'order_id', x.order_id,
      'transfer_id', x.transfer_id))
    from (select r.id as refund_id, s.id as order_id, s.transfer_id
          from public.order_refunds r
          cross join lateral (
            select o.id, o.transfer_id from public.orders o
            where o.studio_id = r.studio_id and o.status = 'paid' and o.fees_settled_at is not null
              and o.transfer_id is not null and o.paid_at > r.accepted_at and o.id <> r.order_id
              and not exists (select 1 from public.order_refund_recoveries x
                              where x.refund_id = r.id and x.order_id = o.id)
            order by o.paid_at desc, o.id limit 1) s
          where r.unrecovered_cents > 0 and r.absorbed_at is null and r.problem is null
          order by r.accepted_at, r.id limit p_limit) x), '[]'::jsonb);
end;
$$;

-- Shortfalls still owed after 180 days without a settled sale to recover them from are absorbed by Daybell (Q2: the
-- clock starts at the refund and again at each of the studio's later settled sales; code review S2): a
-- refund_shortfall transaction, studio_payable −owed (the studio no longer owes it) and daybell_fees +owed (Daybell's
-- loss), and order.shortfall_absorbed (no amounts). Never a refund with a problem (support looks first). Up to p_limit
-- at a time; returns how many.
create function public.absorb_refund_shortfalls(p_limit integer) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.order_refunds;
  v_txn uuid;
  v_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  for v in
    select * from public.order_refunds r
    where r.unrecovered_cents > 0 and r.absorbed_at is null and r.problem is null
      and r.status in ('pending', 'succeeded')
      and greatest(r.accepted_at, (select max(o.paid_at) from public.orders o
                                   where o.studio_id = r.studio_id and o.status = 'paid'
                                     and o.fees_settled_at is not null and o.id <> r.order_id))
          < now() - interval '180 days'
    order by r.accepted_at, r.id limit p_limit
    for update skip locked
  loop
    insert into public.ledger_transactions (studio_id, kind, order_id, refund_id)
    values (v.studio_id, 'refund_shortfall', v.order_id, v.id)
    on conflict (refund_id, kind) where refund_id is not null do nothing
    returning id into v_txn;
    if v_txn is not null then
      insert into public.ledger_entries (studio_id, transaction_id, account, amount_cents, currency)
      values (v.studio_id, v_txn, 'studio_payable', -v.unrecovered_cents, v.currency),
             (v.studio_id, v_txn, 'daybell_fees', v.unrecovered_cents, v.currency);
    end if;
    update public.order_refunds r
    set absorbed_cents = v.unrecovered_cents, absorbed_at = now(), unrecovered_cents = 0
    where r.id = v.id;
    perform app.emit_as(null, v.studio_id, 'order.shortfall_absorbed', v.order_id, '{}'::jsonb);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ── Stripe's events about payments (amends ADR 0023) ──────────────────────────────────────────────────────────────
-- The inbox for a refund or dispute event: the order Stripe's payment names (its metadata, read from Stripe), whose
-- payment must be that one. Recorded with the order's studio and destination, then claimed (record_order_stripe_event's
-- lease). Null for an order this database doesn't hold; a payment that isn't the order's is a permanent mismatch.
create function public.record_payment_stripe_event(p_event_id text, p_type text, p_order_id uuid,
  p_payment_intent_id text, p_livemode boolean, p_created timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_claimed bigint;
  v_lease uuid;
  v_row record;
begin
  if p_type not in ('charge.refunded', 'refund.updated', 'refund.failed', 'charge.dispute.created')
     or coalesce(p_payment_intent_id, '') !~ '^pi_[A-Za-z0-9_]{1,250}$' then
    raise exception 'Payment events only' using errcode = '22023';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id;
  if v_order.id is null then
    return null;
  end if;
  if v_order.payment_intent_id is distinct from p_payment_intent_id then
    insert into public.stripe_events (stripe_event_id, type, stripe_account_id, studio_id, livemode, stripe_created_at,
      processed_at, last_error)
    values (p_event_id, p_type, v_order.stripe_account_id, v_order.studio_id, p_livemode, p_created, now(),
      'event_mismatch')
    on conflict (stripe_event_id) do nothing;
    return jsonb_build_object('mismatch', true, 'studio_id', v_order.studio_id, 'order_id', v_order.id);
  end if;
  insert into public.stripe_events (stripe_event_id, type, stripe_account_id, studio_id, livemode, stripe_created_at)
  values (p_event_id, p_type, v_order.stripe_account_id, v_order.studio_id, p_livemode, p_created)
  on conflict (stripe_event_id) do nothing;
  select e.id, e.studio_id, e.type, e.processed_at into v_row
  from public.stripe_events e where e.stripe_event_id = p_event_id;
  if v_row.studio_id is distinct from v_order.studio_id or v_row.type is distinct from p_type then
    return jsonb_build_object('mismatch', true, 'studio_id', v_order.studio_id, 'order_id', v_order.id);
  end if;
  update public.stripe_events e
  set processing_started_at = now(), attempts = e.attempts + 1, lease_token = gen_random_uuid()
  where e.id = v_row.id and e.processed_at is null
    and (e.processing_started_at is null or e.processing_started_at < now() - interval '2 minutes')
  returning e.id, e.lease_token into v_claimed, v_lease;
  return jsonb_build_object('inbox_id', v_row.id, 'studio_id', v_order.studio_id, 'order_id', v_order.id,
    'mismatch', false, 'processed', v_row.processed_at is not null, 'claimed', v_claimed is not null,
    'lease', v_lease);
end;
$$;

-- Which of Daybell's refunds a Stripe refund is (by Daybell's id in its metadata, checked against the order): the
-- refund's id, or null when it isn't one of this order's (made outside Daybell).
create function public.refund_by_stripe(p_order_id uuid, p_refund_id uuid, p_stripe_refund_id text) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select r.id from public.order_refunds r
  where r.order_id = p_order_id and r.id = p_refund_id
    and (r.stripe_refund_id is null or r.stripe_refund_id = p_stripe_refund_id);
$$;

-- A dispute was opened on the order's payment (a flag only in Phase 1): stamped once, and order.dispute_opened rings
-- the bell for owners and admins. True the first time.
create function public.order_disputed(p_order_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid;
begin
  update public.orders o set disputed_at = now()
  where o.id = p_order_id and o.status = 'paid' and o.disputed_at is null
  returning o.studio_id into v_studio;
  if v_studio is null then
    return false;
  end if;
  perform app.emit_as(null, v_studio, 'order.dispute_opened', p_order_id, '{}'::jsonb);
  return true;
end;
$$;

-- A refund made outside Daybell (the Stripe Dashboard; security review S5): the order is flagged once, fulfilment stops
-- and order.external_refund rings owners' and admins' bell. True the first time.
create function public.order_external_refund(p_order_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid;
begin
  update public.orders o set external_refund_at = now()
  where o.id = p_order_id and o.status = 'paid' and o.external_refund_at is null
  returning o.studio_id into v_studio;
  if v_studio is null then
    return false;
  end if;
  perform app.emit_as(null, v_studio, 'order.external_refund', p_order_id, '{}'::jsonb);
  return true;
end;
$$;

-- An owner or admin checked a refund made outside Daybell (in Stripe and with the parent): fulfilment may go on. Event
-- order.external_refund_checked. Refused (status_invalid) when nothing is flagged or it was already checked.
create function public.check_external_refund(p_actor uuid, p_studio_id uuid, p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin}');
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.id = p_order_id and o.studio_id = p_studio_id for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.external_refund_at is null or v_order.external_refund_checked_at is not null then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  update public.orders o set external_refund_checked_at = now() where o.id = v_order.id;
  perform app.emit(p_studio_id, 'order.external_refund_checked', v_order.id, '{}'::jsonb);
  perform app.end_act_for(v_previous);
end;
$$;

-- ── Downloads: refunded lines lose theirs (Claude's call) ─────────────────────────────────────────────────────────
-- As in 20261013000000, but a line every item of which was given back unlocks nothing. Custom refunds give back no
-- items, so they leave downloads alone (Q3).
create or replace function app.order_line_downloads(p_line public.order_lines)
returns table (photo_id uuid, job_id uuid, n bigint)
language sql stable security definer
set search_path = ''
as $$
  select p_line.photo_id, p_line.job_id, 1::bigint
  where p_line.photo_id is not null and p_line.job_id is not null
    and app.order_line_refunded_quantity(p_line.id) < p_line.quantity
    and (p_line.kind = 'digital_single' or (p_line.kind = 'package' and exists (
      select 1 from public.order_line_contents c
      where c.order_line_id = p_line.id and c.studio_id = p_line.studio_id and c.line_kind = 'digital')))
  union all
  select lp.photo_id, lp.job_id, lp.position::bigint from public.order_line_photos lp
  where p_line.kind = 'digital_all' and lp.order_line_id = p_line.id and lp.studio_id = p_line.studio_id
    and app.order_line_refunded_quantity(p_line.id) < p_line.quantity;
$$;

-- ── What parents see (amends ADR 0023 §11) ────────────────────────────────────────────────────────────────────────
-- Whether this session may cancel the order now (answer 2; Q5, Q6).
create function app.shop_can_cancel(p_session public.shop_sessions, p_order public.orders) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(p_order.shop_session_id = p_session.id and p_order.status = 'paid'
    and p_order.fulfilment_status = 'paid' and not app.order_fully_refunded(p_order)
    and (select x.in_flight = 0 from app.order_refunded(p_order.id) x), false);
$$;

create or replace function public.shop_orders(p_session_hash text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'reference', x.reference, 'status', x.status,
        'fulfilment', x.fulfilment_status, 'refund', case when x.status = 'paid' then app.order_refund_badge(x.o) end,
        'paid_at', x.paid_at, 'created_at', x.created_at, 'view', x.view,
        'children', (select coalesce(jsonb_agg(app.shop_order_child(k.child_id) order by k.first_position), '[]'::jsonb)
                     from (select ol.child_id, min(ol.position) as first_position
                           from app.shop_order_lines(v, x.o, x.view) ol
                           where ol.child_id is not null group by ol.child_id) k),
        'downloads', case when x.status = 'paid' then (
                       select count(*) from app.shop_order_lines(v, x.o, x.view) ol
                       cross join lateral app.order_line_downloads(ol) d) else 0 end)
      order by coalesce(x.paid_at, x.created_at) desc, x.id)
    from (
      select o.id, o.reference, o.status, o.fulfilment_status, o.paid_at, o.created_at, o as o,
        app.shop_order_view(v, o) as view
      from public.orders o
      where o.studio_id = v.studio_id
        and (o.status = 'paid' or (o.status = 'pending' and o.shop_session_id = v.id
                                   and o.created_at > now() - interval '2 hours'))
        and (o.shop_session_id = v.id or exists (
          select 1 from public.order_lines ol
          join public.shop_session_children sc on sc.child_id = ol.child_id and sc.studio_id = ol.studio_id
          where ol.order_id = o.id and ol.studio_id = o.studio_id and sc.session_id = v.id))
      order by coalesce(o.paid_at, o.created_at) desc, o.id
      limit 50) x
    where x.view is not null), '[]'::jsonb);
end;
$$;

-- As in 20261013000000, with the fulfilment status, the refund badge, whether this session may cancel, each line's
-- refunded quantity, and the tracking once shipped for the session that paid only (security review B1: another
-- household holding the same code must never follow the parcel).
create or replace function public.shop_order(p_session_hash text, p_order_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_order public.orders;
  v_view text;
  v_full boolean;
begin
  select * into v_order from public.orders o where o.id = p_order_id and o.studio_id = v.studio_id;
  v_view := case when v_order.id is null then null else app.shop_order_view(v, v_order) end;
  if v_view is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  v_full := v_view = 'full';
  return jsonb_build_object(
    'id', v_order.id, 'reference', v_order.reference, 'status', v_order.status, 'view', v_view,
    'fulfilment', v_order.fulfilment_status,
    'refund', case when v_order.status = 'paid' then app.order_refund_badge(v_order) end,
    'can_cancel', v_order.status = 'paid' and app.shop_can_cancel(v, v_order),
    'tracking', case when v_order.shop_session_id = v.id and v_order.fulfilment_status = 'shipped'
                       and v_order.tracking_number is not null then jsonb_build_object(
      'carrier', v_order.carrier, 'number', v_order.tracking_number, 'url', v_order.tracking_url) end,
    'paid_at', v_order.paid_at, 'created_at', v_order.created_at, 'currency', v_order.currency,
    'studio_name', (select s.name from public.studios s where s.id = v_order.studio_id),
    'shipping_method', case when v_full then v_order.shipping_method end,
    'totals', case when v_full then jsonb_build_object('products_cents', v_order.products_cents,
      'shipping_cents', v_order.shipping_cents, 'tax_cents', v_order.tax_cents, 'total_cents', v_order.total_cents,
      'refunded_cents', (select x.accepted_amount from app.order_refunded(v_order.id) x))
      end,
    'registrations', case when v_full and v_order.status = 'paid' and v_order.tax_enabled then coalesce((
      select jsonb_agg(jsonb_build_object('kind', r.kind, 'province', r.province, 'number', r.number)
                       order by r.kind, r.province)
      from public.studio_tax_registrations r
      where r.studio_id = v_order.studio_id and r.created_at <= v_order.paid_at
        and (r.ended_at is null or r.ended_at > v_order.paid_at)), '[]'::jsonb) else '[]'::jsonb end,
    'children', (select coalesce(jsonb_agg(app.shop_order_child(k.child_id) order by k.first_position), '[]'::jsonb)
                 from (select ol.child_id, min(ol.position) as first_position
                       from app.shop_order_lines(v, v_order, v_view) ol
                       where ol.child_id is not null group by ol.child_id) k),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', ol.id, 'child_id', ol.child_id, 'kind', ol.kind, 'name', ol.name, 'print_size', ol.print_size,
        'quantity', ol.quantity,
        'refunded_quantity', case when v_order.status = 'paid' then app.order_line_refunded_quantity(ol.id) else 0 end,
        'unit_price_cents', case when v_full then ol.unit_price_cents end,
        'line_total_cents', case when v_full then ol.line_total_cents end,
        'contents', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.line_kind, 'print_size', c.print_size,
                       'quantity', c.quantity) order by c.position), '[]'::jsonb)
                     from public.order_line_contents c
                     where c.order_line_id = ol.id and c.studio_id = ol.studio_id),
        'downloads', case when v_order.status = 'paid' then (
                       select coalesce(jsonb_agg(d.photo_id order by d.n), '[]'::jsonb)
                       from app.order_line_downloads(ol) d) else '[]'::jsonb end)
        order by ol.position), '[]'::jsonb)
      from app.shop_order_lines(v, v_order, v_view) ol));
end;
$$;

-- "Download all" (Claude's call): every download this session may have from a paid order, numbered as the single
-- downloads are (so the zip's files have the same names). Not counted: shop_zip_take counts a zip only when it is
-- streamed (code review N1). Not found otherwise.
create function public.shop_order_download_all(p_session_hash text, p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_order public.orders;
  v_view text;
begin
  select * into v_order from public.orders o
  where o.id = p_order_id and o.studio_id = v.studio_id and o.status = 'paid';
  v_view := case when v_order.id is null then null else app.shop_order_view(v, v_order) end;
  if v_view is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('studio_id', v_order.studio_id, 'reference', v_order.reference,
    'files', coalesce((select jsonb_agg(jsonb_build_object('job_id', d.job_id, 'photo_id', d.photo_id, 'n', d.number)
                                        order by d.number)
                       from (select x.photo_id, x.job_id, row_number() over (order by x.position, x.n) as number
                             from (select ol.position, dl.photo_id, dl.job_id, dl.n
                                   from app.shop_order_lines(v, v_order, v_view) ol
                                   cross join lateral app.order_line_downloads(ol) dl) x) d), '[]'::jsonb));
end;
$$;

-- A zip about to be streamed, counted: at most 10 a session an hour and 20 an order an hour across every session and
-- person (security review S4). Refusal: zip_limit. Not found for an order this session can't see.
create function public.shop_zip_take(p_session_hash text, p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_order public.orders;
begin
  select * into v_order from public.orders o
  where o.id = p_order_id and o.studio_id = v.studio_id and o.status = 'paid';
  if v_order.id is null or app.shop_order_view(v, v_order) is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if not app.take_order_action(v.studio_id, v.id, 'zip', 10)
     or not app.take_order_action(v.studio_id, v_order.id, 'zip_order', 20) then
    raise exception 'zip_limit' using errcode = 'P0001';
  end if;
end;
$$;

-- The files "Download all" found missing, asked for (as shop_download_request, each at most every 5 minutes and 3
-- times): which to queue, and how many can't be made.
create function public.shop_download_all_request(p_session_hash text, p_order_id uuid, p_photo_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_order public.orders;
  v_view text;
  v_file record;
  v_claim text;
  v_queued jsonb := '[]'::jsonb;
  v_unavailable integer := 0;
begin
  if p_photo_ids is null or cardinality(p_photo_ids) not between 1 and 500 then
    raise exception 'Send 1 to 500 photos' using errcode = '22023';
  end if;
  select * into v_order from public.orders o
  where o.id = p_order_id and o.studio_id = v.studio_id and o.status = 'paid';
  v_view := case when v_order.id is null then null else app.shop_order_view(v, v_order) end;
  if v_view is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  for v_file in
    select distinct dl.photo_id, dl.job_id
    from app.shop_order_lines(v, v_order, v_view) ol cross join lateral app.order_line_downloads(ol) dl
    where dl.photo_id = any (p_photo_ids)
  loop
    v_claim := app.claim_download_request(v_order.studio_id, v_file.job_id, v_file.photo_id);
    if v_claim = 'queued' then
      v_queued := v_queued || to_jsonb(v_file.photo_id);
    elsif v_claim = 'unavailable' then
      v_unavailable := v_unavailable + 1;
    end if;
  end loop;
  return jsonb_build_object('queued', v_queued, 'unavailable', v_unavailable);
end;
$$;

-- ── Print files (owners, admins and staff; Claude's call) ─────────────────────────────────────────────────────────
-- The paid order's lines to print, with what is left of each after refunds, for the studio's own printing: the pose,
-- the item, its size or a package's prints. Not counted: order_zip_take counts a zip when it is streamed. Never a name.
create function public.order_print_files(p_actor uuid, p_studio_id uuid, p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin,staff}');
  v_order public.orders;
  v_out jsonb;
begin
  select * into v_order from public.orders o
  where o.id = p_order_id and o.studio_id = p_studio_id and o.status = 'paid';
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  select jsonb_build_object('reference', v_order.reference,
    'files', coalesce(jsonb_agg(jsonb_build_object('position', ol.position, 'job_id', ol.job_id,
               'photo_id', ol.photo_id, 'kind', ol.kind, 'name', ol.name, 'print_size', ol.print_size,
               'quantity', ol.quantity - app.order_line_refunded_quantity(ol.id),
               'contents', (select coalesce(jsonb_agg(jsonb_build_object('print_size', c.print_size,
                              'quantity', c.quantity) order by c.position), '[]'::jsonb)
                            from public.order_line_contents c
                            where c.order_line_id = ol.id and c.studio_id = ol.studio_id and c.line_kind = 'print'))
               order by ol.position), '[]'::jsonb))
  into v_out
  from public.order_lines ol
  where ol.order_id = v_order.id and ol.studio_id = p_studio_id and app.order_line_physical(ol)
    and ol.quantity > app.order_line_refunded_quantity(ol.id);
  perform app.end_act_for(v_previous);
  return v_out;
end;
$$;

-- Print files about to be streamed, counted: at most 10 a person an hour and 20 an order an hour (zip_limit).
create function public.order_zip_take(p_actor uuid, p_studio_id uuid, p_order_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin,staff}');
begin
  if not exists (select 1 from public.orders o
                 where o.id = p_order_id and o.studio_id = p_studio_id and o.status = 'paid') then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if not app.take_order_action(p_studio_id, p_actor, 'zip', 10)
     or not app.take_order_action(p_studio_id, p_order_id, 'zip_order', 20) then
    raise exception 'zip_limit' using errcode = 'P0001';
  end if;
  perform app.end_act_for(v_previous);
end;
$$;

-- The print files found missing, asked for (as shop_download_request): which to queue, and how many can't be made.
create function public.order_print_files_to_make(p_actor uuid, p_studio_id uuid, p_order_id uuid,
  p_photo_ids uuid[]) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_roles(p_actor, p_studio_id, '{owner,admin,staff}');
  v_file record;
  v_claim text;
  v_queued jsonb := '[]'::jsonb;
  v_unavailable integer := 0;
begin
  if p_photo_ids is null or cardinality(p_photo_ids) not between 1 and 500 then
    raise exception 'Send 1 to 500 photos' using errcode = '22023';
  end if;
  for v_file in
    select distinct ol.photo_id, ol.job_id from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.studio_id = ol.studio_id
    where o.id = p_order_id and o.studio_id = p_studio_id and o.status = 'paid' and ol.photo_id = any (p_photo_ids)
      and ol.job_id is not null and app.order_line_physical(ol)
  loop
    v_claim := app.claim_download_request(p_studio_id, v_file.job_id, v_file.photo_id);
    if v_claim = 'queued' then
      v_queued := v_queued || to_jsonb(v_file.photo_id);
    elsif v_claim = 'unavailable' then
      v_unavailable := v_unavailable + 1;
    end if;
  end loop;
  perform app.end_act_for(v_previous);
  return jsonb_build_object('queued', v_queued, 'unavailable', v_unavailable);
end;
$$;

-- ── What studios see (SECURITY INVOKER: row-level security decides; Q4) ───────────────────────────────────────────
-- The studio's paid orders, newest first, a page at a time (after the order p_cursor), optionally one job's, one
-- fulfilment status's, one delivery's or references starting with p_reference: reference, date, children (first name
-- and last initial), items, total, fulfilment, delivery and the refund badge. Filtered by Paid or Printed (what is
-- waiting), fully refunded orders are left out, so Home's To do links list what they count (code review N3).
create function public.studio_orders(p_studio_id uuid, p_job_id uuid default null,
  p_status public.order_fulfilment default null, p_reference text default null, p_limit integer default 50,
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
          and (p_status is null or o.fulfilment_status = p_status)
          and (p_status is null or p_status not in ('paid', 'printed')
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

-- One paid order: as in 20261013000000, with its fulfilment, tracking, each line's refunded quantity, the refund badge,
-- its refunds and what is left to refund (owners and admins: row-level security), and its ledger (owners and admins).
create or replace function public.studio_order(p_studio_id uuid, p_order_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'reference', o.reference, 'paid_at', o.paid_at, 'currency', o.currency,
    'products_cents', o.products_cents, 'shipping_cents', o.shipping_cents, 'tax_cents', o.tax_cents,
    'total_cents', o.total_cents, 'daybell_fee_bps', o.daybell_fee_bps, 'daybell_fee_cents', o.daybell_fee_cents,
    'stripe_fee_cents', o.stripe_fee_cents, 'shipping_method', o.shipping_method,
    'fees_settled', o.fees_settled_at is not null,
    'fulfilment', o.fulfilment_status, 'printed_at', o.printed_at, 'shipped_at', o.shipped_at,
    'delivered_at', o.delivered_at, 'canceled_at', o.canceled_at, 'disputed_at', o.disputed_at,
    'ship_to_purged_at', o.ship_to_purged_at,
    'external_refund_at', o.external_refund_at, 'external_refund_checked_at', o.external_refund_checked_at,
    'tracking', case when o.carrier is not null and o.tracking_number is not null then jsonb_build_object(
      'carrier', o.carrier, 'number', o.tracking_number, 'url', o.tracking_url) end,
    'refund_state', app.studio_order_refund_state(o.id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', ol.id, 'kind', ol.kind, 'name', ol.name, 'print_size', ol.print_size, 'quantity', ol.quantity,
        'unit_price_cents', ol.unit_price_cents, 'line_total_cents', ol.line_total_cents, 'photo_id', ol.photo_id,
        'job_id', ol.job_id, 'physical', app.order_line_physical(ol),
        'child', (select jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name)
                  from public.children c where c.id = ol.child_id and c.studio_id = ol.studio_id),
        'contents', (select coalesce(jsonb_agg(jsonb_build_object('kind', ct.line_kind, 'print_size', ct.print_size,
                       'quantity', ct.quantity) order by ct.position), '[]'::jsonb)
                     from public.order_line_contents ct
                     where ct.order_line_id = ol.id and ct.studio_id = ol.studio_id))
        order by ol.position), '[]'::jsonb)
      from public.order_lines ol where ol.order_id = o.id and ol.studio_id = o.studio_id),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'reason', r.reason, 'status', r.status, 'products_cents', r.products_cents,
        'shipping_cents', r.shipping_cents, 'tax_cents', r.tax_cents, 'amount_cents', r.amount_cents,
        'daybell_fee_cents', r.daybell_fee_cents, 'unrecovered_cents', r.unrecovered_cents,
        'created_at', r.created_at, 'failure_code', r.failure_code,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('line_id', rl.order_line_id, 'quantity', rl.quantity)),
                    '[]'::jsonb) from public.order_refund_lines rl where rl.refund_id = r.id))
        order by r.created_at, r.id), '[]'::jsonb)
      from public.order_refunds r where r.order_id = o.id and r.studio_id = o.studio_id),
    'refundable', (select jsonb_build_object(
        'products_cents', o.products_cents - coalesce(sum(r.products_cents), 0),
        'shipping_cents', o.shipping_cents - coalesce(sum(r.shipping_cents), 0),
        'tax_cents', o.tax_cents - coalesce(sum(r.tax_cents), 0),
        'daybell_fee_cents', o.daybell_fee_cents - coalesce(sum(r.daybell_fee_cents), 0),
        'refunded_cents', coalesce(sum(r.amount_cents) filter (where r.status in ('pending', 'succeeded')), 0))
      from public.order_refunds r
      where r.order_id = o.id and r.studio_id = o.studio_id and r.status in ('requested', 'pending', 'succeeded')),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'created_at', t.created_at,
        'entries', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'account', e.account,
                      'amount_cents', e.amount_cents)
                      order by e.id), '[]'::jsonb)
                    from public.ledger_entries e where e.transaction_id = t.id and e.studio_id = t.studio_id))
        order by t.created_at, t.id), '[]'::jsonb)
      from public.ledger_transactions t where t.order_id = o.id and t.studio_id = o.studio_id),
    'ship_to', (select jsonb_build_object('name', a.recipient_name, 'line1', a.line1, 'line2', a.line2,
                  'city', a.city, 'province', a.province, 'postal_code', a.postal_code, 'country', a.country)
                from public.order_shipping_addresses a where a.order_id = o.id and a.studio_id = o.studio_id))
  from public.orders o
  where o.id = p_order_id and o.studio_id = p_studio_id and o.status = 'paid';
$$;

-- Home's numbers (D127; owners and admins: the ledger's row-level security): today, this week (from Monday) and this
-- season (from August 1), in the person's time zone: sales after refunds (what parents paid less what was refunded)
-- and Daybell's fee net of refunds, from the ledger; and orders counted when they were paid, so a sale whose Stripe
-- fee comes late is counted at once (code review N5); in the region's currency.
create function public.studio_sales(p_studio_id uuid, p_tz text) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_local timestamp;
  v_starts jsonb;
begin
  if p_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz) then
    raise exception 'A time zone, e.g. America/Toronto' using errcode = '22023';
  end if;
  v_local := now() at time zone p_tz;
  v_starts := jsonb_build_object(
    'today', date_trunc('day', v_local) at time zone p_tz,
    'week', date_trunc('week', v_local) at time zone p_tz,
    'season', make_timestamp(extract(year from v_local)::int - case when extract(month from v_local) < 8 then 1 else 0 end,
      8, 1, 0, 0, 0) at time zone p_tz);
  return jsonb_build_object(
    'currency', (select case s.data_region when 'us' then 'USD' else 'CAD' end from public.studios s
                 where s.id = p_studio_id),
    'ranges', (select jsonb_object_agg(r.key, jsonb_build_object(
        'start', r.value #>> '{}',
        'sales_cents', (select coalesce(sum(e.amount_cents), 0) from public.ledger_entries e
                        where e.studio_id = p_studio_id and e.account in ('parent_payments', 'refunds')
                          and e.occurred_at >= (r.value #>> '{}')::timestamptz),
        'orders', (select count(*) from public.orders o
                   where o.studio_id = p_studio_id and o.status = 'paid'
                     and o.paid_at >= (r.value #>> '{}')::timestamptz),
        'daybell_fee_cents', (select -coalesce(sum(e.amount_cents), 0) from public.ledger_entries e
                              join public.ledger_transactions t on t.id = e.transaction_id and t.studio_id = e.studio_id
                              where e.studio_id = p_studio_id and e.account = 'daybell_fees'
                                and t.kind in ('order_paid', 'order_refunded', 'refund_failed')
                                and e.occurred_at >= (r.value #>> '{}')::timestamptz)))
      from jsonb_each(v_starts) r));
end;
$$;

-- Home's To do (owners, admins and staff): paid orders waiting to be printed, printed ones waiting to ship (home) and
-- to go to school, never fully refunded or cancelled ones.
create function public.studio_order_todo(p_studio_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'to_print', count(*) filter (where o.fulfilment_status = 'paid'),
    'to_ship', count(*) filter (where o.fulfilment_status = 'printed' and o.shipping_method = 'home'),
    'to_deliver', count(*) filter (where o.fulfilment_status = 'printed' and o.shipping_method = 'school'))
  from public.orders o
  where o.studio_id = p_studio_id and o.status = 'paid' and o.fulfilment_status in ('paid', 'printed')
    and not coalesce((app.studio_order_refund_state(o.id) ->> 'fully_refunded')::boolean, false);
$$;

-- ── The address purge (step 10's launch blocker; Claude's calls) ──────────────────────────────────────────────────
-- Home delivery recipients go 90 days after the order shipped; or, never shipped, 90 days after payment once the order
-- is cancelled or fully refunded; and, whatever happened, 365 days after payment (the hard cap, Seenu). The tracking
-- number and link go with the address (they lead to it; code review B2); the carrier stays. The order keeps when
-- (ship_to_purged_at); one order.address_purged event each, with no actor. Up to p_limit a run (the jobs cron), the
-- rest next time. Also drops counted actions older than a day. Returns how many addresses went.
create function public.purge_shipping_addresses(p_limit integer) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v record;
  v_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  for v in
    select o.id, o.studio_id from public.orders o
    join public.order_shipping_addresses a on a.order_id = o.id and a.studio_id = o.studio_id
    where o.shipped_at < now() - interval '90 days'
       or (o.paid_at < now() - interval '90 days'
           and (o.fulfilment_status = 'canceled' or app.order_fully_refunded(o)))
       or o.paid_at < now() - interval '365 days'
    order by o.paid_at, o.id
    limit p_limit
    for update of o skip locked
  loop
    delete from public.order_shipping_addresses a where a.order_id = v.id and a.studio_id = v.studio_id;
    update public.orders o set ship_to_purged_at = now(), tracking_number = null, tracking_url = null where o.id = v.id;
    perform app.emit_as(null, v.studio_id, 'order.address_purged', v.id, '{}'::jsonb);
    v_count := v_count + 1;
  end loop;
  delete from public.order_action_attempts a where a.created_at < now() - interval '1 day';
  return v_count;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.order_line_physical(public.order_lines), app.order_physical(uuid), app.on_order_paid(),
  app.guard_order_fulfilment(), app.guard_order_refund(), app.guard_order_refund_insert(), app.notify_order(bigint, uuid, public.notification_kind, uuid),
  app.act_for_roles(uuid, uuid, public.studio_role[]), app.order_refunded(uuid),
  app.order_line_refunded_quantity(uuid), app.order_refund_badge(public.orders),
  app.order_fully_refunded(public.orders), app.studio_order_refund_state(uuid),
  app.take_order_action(uuid, uuid, text, integer), app.emit_as(uuid, uuid, text, uuid, jsonb),
  app.refund_split(public.orders, public.refund_kind, jsonb, bigint, boolean),
  app.write_refund(public.orders, uuid, public.refund_kind, public.refund_reason, uuid, jsonb, bigint, boolean),
  app.write_refund_ledger(public.order_refunds, public.ledger_kind, integer),
  app.shop_can_cancel(public.shop_sessions, public.orders)
  from public, anon, authenticated;
-- The studio's reads (SECURITY INVOKER) call these as the signed-in person: the refund state checks their role itself;
-- whether a line is to be printed reveals nothing the line doesn't.
grant execute on function app.studio_order_refund_state(uuid), app.order_line_physical(public.order_lines)
  to authenticated;
revoke all on function
  public.mark_order_status(uuid, uuid, uuid, public.order_fulfilment, public.shipping_carrier, text, text),
  public.mark_orders_status(uuid, uuid, uuid[], public.order_fulfilment),
  public.set_order_tracking(uuid, uuid, uuid, public.shipping_carrier, text, text),
  public.undo_order_status(uuid, uuid, uuid, public.status_undo_reason),
  public.begin_refund(uuid, uuid, uuid, uuid, public.refund_kind, jsonb, bigint, boolean, public.refund_reason),
  public.shop_order_cancel_begin(text, uuid),
  public.refund_for_stripe(uuid),
  public.refund_accepted(uuid, text, text),
  public.refund_recovered(uuid, text, bigint),
  public.refund_settled(uuid),
  public.refund_failed(uuid, text),
  public.refund_abandoned(uuid, text),
  public.refund_share_returned(uuid, text, bigint),
  public.note_refund_failure(uuid, text, boolean),
  public.refunds_to_retry(integer),
  public.refund_shortfalls_for_sale(uuid),
  public.refund_shortfall_recovered(uuid, uuid, bigint, text),
  public.refund_shortfalls_due(integer),
  public.absorb_refund_shortfalls(integer),
  public.record_payment_stripe_event(text, text, uuid, text, boolean, timestamptz),
  public.refund_by_stripe(uuid, uuid, text),
  public.order_disputed(uuid),
  public.order_external_refund(uuid),
  public.check_external_refund(uuid, uuid, uuid),
  public.shop_order_download_all(text, uuid),
  public.shop_zip_take(text, uuid),
  public.shop_download_all_request(text, uuid, uuid[]),
  public.order_print_files(uuid, uuid, uuid),
  public.order_zip_take(uuid, uuid, uuid),
  public.order_print_files_to_make(uuid, uuid, uuid, uuid[]),
  public.purge_shipping_addresses(integer),
  public.studio_orders(uuid, uuid, public.order_fulfilment, text, integer, uuid, public.shop_shipping_method),
  public.studio_sales(uuid, text),
  public.studio_order_todo(uuid)
  from public, anon, authenticated;
-- Owners', admins' and staff's writes (acting for them, the role checked again), parents' cancel and zips, Stripe's
-- webhook and the cron: the service role only (the API's routes).
grant execute on function
  public.mark_order_status(uuid, uuid, uuid, public.order_fulfilment, public.shipping_carrier, text, text),
  public.mark_orders_status(uuid, uuid, uuid[], public.order_fulfilment),
  public.set_order_tracking(uuid, uuid, uuid, public.shipping_carrier, text, text),
  public.undo_order_status(uuid, uuid, uuid, public.status_undo_reason),
  public.begin_refund(uuid, uuid, uuid, uuid, public.refund_kind, jsonb, bigint, boolean, public.refund_reason),
  public.shop_order_cancel_begin(text, uuid),
  public.refund_for_stripe(uuid),
  public.refund_accepted(uuid, text, text),
  public.refund_recovered(uuid, text, bigint),
  public.refund_settled(uuid),
  public.refund_failed(uuid, text),
  public.refund_abandoned(uuid, text),
  public.refund_share_returned(uuid, text, bigint),
  public.note_refund_failure(uuid, text, boolean),
  public.refunds_to_retry(integer),
  public.refund_shortfalls_for_sale(uuid),
  public.refund_shortfall_recovered(uuid, uuid, bigint, text),
  public.refund_shortfalls_due(integer),
  public.absorb_refund_shortfalls(integer),
  public.record_payment_stripe_event(text, text, uuid, text, boolean, timestamptz),
  public.refund_by_stripe(uuid, uuid, text),
  public.order_disputed(uuid),
  public.order_external_refund(uuid),
  public.check_external_refund(uuid, uuid, uuid),
  public.shop_order_download_all(text, uuid),
  public.shop_zip_take(text, uuid),
  public.shop_download_all_request(text, uuid, uuid[]),
  public.order_print_files(uuid, uuid, uuid),
  public.order_zip_take(uuid, uuid, uuid),
  public.order_print_files_to_make(uuid, uuid, uuid, uuid[]),
  public.purge_shipping_addresses(integer)
  to service_role;
-- The studio's reads under row-level security.
grant execute on function public.studio_orders(uuid, uuid, public.order_fulfilment, text, integer, uuid,
  public.shop_shipping_method),
  public.studio_sales(uuid, text), public.studio_order_todo(uuid)
  to authenticated;

notify pgrst, 'reload schema';
