-- Phase 1, step 10: checkout (D59, D96, D97, D98, D104, D106, D24, D113; Seenu's answers 1–4 and Claude's calls 1–20
-- of Oct 13, 2026, every call for Seenu to review; ADR 0023, amending ADR 0006, 0016, 0019, 0020 and 0022). A forward
-- migration: 20261012700000 is merged.
--
-- A parent pays for the bag on Stripe's hosted checkout (D97). The bag is priced again from each job's current list
-- and copied into an order (ADR 0019's snapshot) before Stripe is asked for anything; Stripe's answer is checked
-- against that copy when the payment completes. Canadian charges are destination charges on behalf of the studio
-- (D106). Daybell's fee is a rate kept in this database (Seenu, answer 1), copied into each order and never changed
-- afterwards; Stripe's card fee is recovered from each sale once Stripe has said what it was (call 1). Every paid order
-- writes one balanced ledger transaction (ADR 0006) and one order.paid event (call 14).
--
-- Nothing here is reachable by browsers except owners' and admins' reads (call 15): parents work through the
-- SECURITY DEFINER shop functions keyed by their session's hash, Stripe's webhook and the cron through system
-- functions, owners through act_for_owner functions; all of them as the service role. Orders keep no parent email,
-- card or Stripe customer; the recipient's name and address are kept only for home delivery (call 2), in their own
-- table, owners and admins only, never in an event or a log.

-- ── Platform settings (Seenu, answer 1) ──────────────────────────────────────────────────────────────────────────
-- One row per regional database (the region is implied), in the app schema so the Data API can never reach it. Changed
-- only through set_platform_fee and set_card_fee_recovery (docs/platform-fee.md), each change kept in the history with
-- the role that made it. Only the database owner (Seenu, in the SQL editor) runs them: not the service role, so no bug
-- in the API can ever change a fee (security review S1).
create type public.card_fee_recovery as enum ('per_sale', 'monthly');

create table app.platform_settings (
  id boolean primary key default true check (id),
  -- Daybell's fee on product sales in basis points: 300 is 3% (D59). At most 20% (call 16).
  daybell_fee_bps integer not null check (daybell_fee_bps between 0 and 2000),
  -- How Stripe's card fee is taken from the studio: per sale (call 1). Monthly isn't built yet, so it is refused.
  card_fee_recovery public.card_fee_recovery not null check (card_fee_recovery = 'per_sale'),
  updated_at timestamptz not null default now()
);
comment on table app.platform_settings is
  'Daybell''s fee rate and card fee recovery method for this region (ADR 0023). Changed through set_platform_fee only.';
insert into app.platform_settings (daybell_fee_bps, card_fee_recovery) values (300, 'per_sale');

-- Append-only history: no personal data (a short note says why).
create table app.platform_settings_changes (
  id bigint generated always as identity primary key,
  setting text not null check (setting in ('daybell_fee_bps', 'card_fee_recovery')),
  old_value text not null,
  new_value text not null,
  note text not null check (char_length(note) between 1 and 200 and note = btrim(note)
    and note !~ '[\u0001-\u001F\u007F-\u009F]'),
  -- Who made it: the database role of the SQL editor's session (security review S1). Never a person's email.
  changed_by text not null default session_user check (char_length(changed_by) between 1 and 63),
  changed_at timestamptz not null default now()
);
comment on table app.platform_settings_changes is
  'Every change of the platform settings, with a note and the database role that made it. Append-only.';

create function app.guard_platform_settings() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') or tg_table_name = 'platform_settings_changes' then
    raise exception 'platform_settings_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger platform_settings_no_delete before delete on app.platform_settings
for each row execute function app.guard_platform_settings();
create trigger platform_settings_no_truncate before truncate on app.platform_settings
for each statement execute function app.guard_platform_settings();
create trigger platform_settings_changes_append_only before update or delete on app.platform_settings_changes
for each row execute function app.guard_platform_settings();
create trigger platform_settings_changes_no_truncate before truncate on app.platform_settings_changes
for each statement execute function app.guard_platform_settings();
revoke all on app.platform_settings, app.platform_settings_changes from public, anon, authenticated, service_role;

-- What new orders use now. Not secret and about no studio: Settings › Payouts shows the rate.
create function public.platform_fee_settings() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('daybell_fee_bps', s.daybell_fee_bps, 'card_fee_recovery', s.card_fee_recovery)
  from app.platform_settings s;
$$;

create function app.check_settings_note(p_note text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_note is null or char_length(p_note) not between 1 and 200 or p_note <> btrim(p_note)
     or p_note ~ '[\u0001-\u001F\u007F-\u009F]' then
    raise exception 'Say why in a note of 1 to 200 characters' using errcode = '22023';
  end if;
end;
$$;

-- Changes Daybell's fee for new orders only (each order keeps the rate it was made with). 0 to 2000 basis points.
create function public.set_platform_fee(p_bps integer, p_note text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old integer;
begin
  if p_bps is null or p_bps not between 0 and 2000 then
    raise exception 'The fee is 0 to 2000 basis points' using errcode = '22023';
  end if;
  perform app.check_settings_note(p_note);
  select s.daybell_fee_bps into v_old from app.platform_settings s for update;
  insert into app.platform_settings_changes (setting, old_value, new_value, note)
  values ('daybell_fee_bps', v_old::text, p_bps::text, p_note);
  update app.platform_settings s set daybell_fee_bps = p_bps, updated_at = now() where s.id;
end;
$$;

-- Changes how the card fee is recovered for new orders. Only per_sale exists until monthly recovery is built.
create function public.set_card_fee_recovery(p_method public.card_fee_recovery, p_note text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old public.card_fee_recovery;
begin
  if p_method is null then
    raise exception 'Choose a method' using errcode = '22023';
  end if;
  perform app.check_settings_note(p_note);
  select s.card_fee_recovery into v_old from app.platform_settings s for update;
  insert into app.platform_settings_changes (setting, old_value, new_value, note)
  values ('card_fee_recovery', v_old::text, p_method::text, p_note);
  update app.platform_settings s set card_fee_recovery = p_method, updated_at = now() where s.id;
end;
$$;

-- ── Taxes (Seenu, answer 2; calls 3–6) ────────────────────────────────────────────────────────────────────────────
-- The studio's business address is sent to Stripe as its tax head office (call 3); Daybell keeps only its province
-- and when it was set. Registrations: GST/HST, and PST in BC, SK or MB. Stripe's registrations take no number, so the
-- numbers are Daybell's to keep and to show on the order page (call 5). No registration means no tax (small supplier).
create type public.tax_registration_kind as enum ('gst_hst', 'pst');

create table public.studio_tax_settings (
  studio_id uuid primary key references public.studios (id) on delete restrict,
  -- Canada without Quebec at launch.
  head_office_province char(2) not null
    check (head_office_province in ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'SK', 'YT')),
  head_office_set_at timestamptz not null default now()
);
comment on table public.studio_tax_settings is
  'Whether the studio''s tax head office is set at Stripe, and its province. The address itself is only at Stripe.';

create table public.studio_tax_registrations (
  id uuid primary key default gen_random_uuid(),
  -- Restrict: money-adjacent, kept like orders (D125).
  studio_id uuid not null references public.studios (id) on delete restrict,
  kind public.tax_registration_kind not null,
  province char(2) check (province in ('BC', 'MB', 'SK')),
  -- GST/HST: 9 digits, RT and 4 digits. PST: letters, digits, spaces and dashes, as the province writes it.
  number text not null,
  stripe_registration_id text not null unique
    check (char_length(stripe_registration_id) <= 255 and stripe_registration_id ~ '^taxreg_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint studio_tax_registrations_province check ((kind = 'pst') = (province is not null)),
  constraint studio_tax_registrations_number check (
    case kind when 'gst_hst' then number ~ '^[0-9]{9}RT[0-9]{4}$'
              else number ~ '^[A-Z0-9]([A-Z0-9 -]{0,28}[A-Z0-9])?$' end),
  constraint studio_tax_registrations_ended check (ended_at is null or ended_at >= created_at)
);
-- One active registration of each kind (and province) per studio.
create unique index studio_tax_registrations_active_key on public.studio_tax_registrations
  (studio_id, kind, coalesce(province, '--')) where ended_at is null;
create index studio_tax_registrations_studio_idx on public.studio_tax_registrations (studio_id, created_at);
comment on table public.studio_tax_registrations is
  'The studio''s GST/HST and PST registrations (ADR 0023): the number as the studio typed it and Stripe''s id.';

-- A registration never changes but to end, once.
create function app.guard_tax_registration() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.studios s where s.id = old.studio_id) then
      raise exception 'tax_registration_fixed' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if (new.id, new.studio_id, new.kind, new.province, new.number, new.stripe_registration_id, new.created_at)
       is distinct from
     (old.id, old.studio_id, old.kind, old.province, old.number, old.stripe_registration_id, old.created_at)
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at) then
    raise exception 'tax_registration_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger studio_tax_registrations_guard before update or delete on public.studio_tax_registrations
for each row execute function app.guard_tax_registration();

-- Whether a studio charges tax: at least one active registration and a head office (call 4).
create function app.studio_collects_tax(p_studio_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.studio_tax_settings t where t.studio_id = p_studio_id)
    and exists (select 1 from public.studio_tax_registrations r
                where r.studio_id = p_studio_id and r.ended_at is null);
$$;

-- The owner's business address went to Stripe (Stripe first, then here; the set_payout_schedule pattern). One event.
create function public.set_tax_head_office(p_actor uuid, p_studio_id uuid, p_province text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_owner(p_actor, p_studio_id);
begin
  insert into public.studio_tax_settings as t (studio_id, head_office_province)
  values (p_studio_id, upper(p_province))
  on conflict (studio_id) do update set head_office_province = excluded.head_office_province, head_office_set_at = now();
  perform app.emit(p_studio_id, 'tax_settings.updated', p_studio_id,
    jsonb_build_object('fields', jsonb_build_array('head_office')));
  perform app.end_act_for(v_previous);
end;
$$;

-- A registration Stripe has made (Stripe first, then here). Named errors without values: head_office_required,
-- already_registered.
create function public.add_tax_registration(p_actor uuid, p_studio_id uuid, p_kind public.tax_registration_kind,
  p_province text, p_number text, p_stripe_registration_id text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_owner(p_actor, p_studio_id);
  v_id uuid;
begin
  if not exists (select 1 from public.studio_tax_settings t where t.studio_id = p_studio_id) then
    raise exception 'head_office_required' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tax_registrations:' || p_studio_id::text, 0));
  if exists (select 1 from public.studio_tax_registrations r
             where r.studio_id = p_studio_id and r.kind = p_kind and r.ended_at is null
               and r.province is not distinct from upper(p_province)) then
    raise exception 'already_registered' using errcode = 'P0001';
  end if;
  insert into public.studio_tax_registrations (studio_id, kind, province, number, stripe_registration_id)
  values (p_studio_id, p_kind, upper(p_province), p_number, p_stripe_registration_id)
  returning id into v_id;
  perform app.emit(p_studio_id, 'tax_registration.added', v_id,
    jsonb_build_object('kind', p_kind, 'province', upper(p_province)));
  perform app.end_act_for(v_previous);
  return v_id;
end;
$$;

-- Ends a registration (Stripe's is expired first). Not found (P0002) for another studio's or one already ended.
create function public.end_tax_registration(p_actor uuid, p_studio_id uuid, p_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_previous text := app.act_for_owner(p_actor, p_studio_id);
  v_row public.studio_tax_registrations;
begin
  update public.studio_tax_registrations r set ended_at = now()
  where r.id = p_id and r.studio_id = p_studio_id and r.ended_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform app.emit(p_studio_id, 'tax_registration.ended', v_row.id,
    jsonb_build_object('kind', v_row.kind, 'province', v_row.province));
  perform app.end_act_for(v_previous);
end;
$$;

-- ── Orders ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- pending: Stripe's checkout is open; paid: Stripe took the money; expired: the checkout was cancelled, replaced or ran
-- out (an expired order Stripe still reports paid becomes paid: Stripe is the truth); failed: not reached in Phase 1
-- (cards and wallets settle at once; Klarna later).
create type public.order_status as enum ('pending', 'paid', 'expired', 'failed');
create type public.order_line_content_kind as enum ('print', 'digital');

-- Card prefix "DBL" set on the studio's Stripe account (call 7): once, at its first checkout.
alter table public.payout_accounts add column card_prefix_set_at timestamptz;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Restrict: money records are kept 7 years (D125).
  studio_id uuid not null references public.studios (id) on delete restrict,
  -- Shown to parents and studios: 8 characters of Crockford's base32.
  reference text not null check (reference ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  -- The parent's session (pruned after 30 days: then only codes reach the order).
  shop_session_id uuid,
  status public.order_status not null default 'pending',
  currency char(3) not null check (currency in ('USD', 'CAD')),
  shipping_method public.shop_shipping_method,
  -- Whole cents (D96), as priced at checkout from the job's list.
  products_cents bigint not null check (products_cents between 0 and 1000000000),
  shipping_cents bigint not null check (shipping_cents between 0 and 100000),
  -- Stripe's, once paid.
  tax_cents bigint check (tax_cents between 0 and 1000000000),
  total_cents bigint check (total_cents between 0 and 2000000000),
  -- Daybell's fee: the rate used and the amount (half up, call 16), never changed afterwards.
  daybell_fee_bps integer not null check (daybell_fee_bps between 0 and 2000),
  daybell_fee_cents bigint not null check (daybell_fee_cents >= 0 and daybell_fee_cents <= products_cents),
  card_fee_recovery public.card_fee_recovery not null,
  -- Stripe's actual fee, once its balance transaction is known.
  stripe_fee_cents bigint check (stripe_fee_cents between 0 and 2000000000),
  -- Whether Stripe Tax was on for this checkout (the studio had a registration and a head office).
  tax_enabled boolean not null,
  -- The destination, as it was: the studio's own account.
  payout_account_id uuid not null,
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  -- Stripe ids only, never Stripe's objects.
  checkout_session_id text unique check (char_length(checkout_session_id) <= 255 and checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  checkout_expires_at timestamptz,
  payment_intent_id text unique check (char_length(payment_intent_id) <= 255 and payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  charge_id text check (char_length(charge_id) <= 255 and charge_id ~ '^(ch|py)_[A-Za-z0-9_]+$'),
  transfer_id text check (char_length(transfer_id) <= 255 and transfer_id ~ '^tr_[A-Za-z0-9_]+$'),
  fee_reversal_id text check (char_length(fee_reversal_id) <= 255 and fee_reversal_id ~ '^trr_[A-Za-z0-9_]+$'),
  balance_transaction_id text check (char_length(balance_transaction_id) <= 255 and balance_transaction_id ~ '^txn_[A-Za-z0-9_]+$'),
  -- SHA-256 of the priced bag: the same bag reuses its open checkout.
  bag_fingerprint text not null check (bag_fingerprint ~ '^[0-9a-f]{64}$'),
  -- When the confirmation page or Pay last asked Stripe about this order (at most every 5 and 3 seconds: security
  -- review S2).
  stripe_checked_at timestamptz,
  -- When Stripe said this checkout can't be paid any more (expired there, or paid). Until then an order Daybell expired
  -- is closed at Stripe by the next Pay, cancel or the cron, so a replaced checkout never stays payable (code review M2).
  stripe_closed_at timestamptz,
  -- The cron's backstops (code review S1, security review M4): its tries, the last error's code, when to try next
  -- (backing off), and a problem no retry can fix (never retried; support resolves it: docs/crons.md).
  backstop_attempts integer not null default 0 check (backstop_attempts between 0 and 1000000),
  backstop_error text check (backstop_error ~ '^[a-z_]{1,100}$'),
  backstop_next_at timestamptz,
  problem text check (problem ~ '^[a-z_]{1,100}$'),
  problem_at timestamptz,
  paid_at timestamptz,
  fees_settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_studio_id_id_key unique (studio_id, id),
  constraint orders_reference_key unique (studio_id, reference),
  constraint orders_session_fk foreign key (studio_id, shop_session_id)
    references public.shop_sessions (studio_id, id) on delete set null (shop_session_id),
  constraint orders_account_fk foreign key (studio_id, payout_account_id)
    references public.payout_accounts (studio_id, id) on delete restrict,
  constraint orders_paid check ((status = 'paid') = (paid_at is not null)),
  constraint orders_paid_facts check (paid_at is null or (tax_cents is not null and total_cents is not null
    and payment_intent_id is not null and total_cents = products_cents + shipping_cents + tax_cents)),
  constraint orders_settled check (fees_settled_at is null or (paid_at is not null and stripe_fee_cents is not null)),
  constraint orders_problem check ((problem is null) = (problem_at is null)),
  -- Only home delivery costs anything; school delivery and a bag with nothing to deliver are free.
  constraint orders_shipping check (coalesce(shipping_method = 'home', false) or shipping_cents = 0)
);
create index orders_studio_paid_idx on public.orders (studio_id, paid_at desc) where status = 'paid';
create index orders_session_idx on public.orders (shop_session_id, created_at) where shop_session_id is not null;
create index orders_pending_idx on public.orders (checkout_expires_at) where status = 'pending';
create index orders_unsettled_idx on public.orders (paid_at) where status = 'paid' and fees_settled_at is null;
create index orders_unclosed_idx on public.orders (shop_session_id)
  where checkout_session_id is not null and stripe_closed_at is null and status in ('pending', 'expired');
create index orders_problem_idx on public.orders (problem_at) where problem is not null;
comment on table public.orders is
  'A parent''s order (ADR 0023): the bag as priced at checkout, Daybell''s fee rate, Stripe ids and amounts. No parent '
  'email, card or customer. Money in whole cents (D96).';

create trigger orders_touch before update on public.orders
for each row execute function app.touch_updated_at();

-- What was sold, as it was sold (ADR 0019): the item's kind, name, size and price are copied, never looked up again.
-- No child name is copied: the studio's screens join the live roster. A child or photo erased later leaves the line
-- (D125: money records never block erasure).
create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete restrict,
  order_id uuid not null,
  position integer not null check (position between 1 and 1000),
  job_id uuid,
  child_id uuid,
  -- The pose; none for "all digitals".
  photo_id uuid,
  -- Ids as they were; no foreign key, so editing or deleting the list never touches an order (ADR 0019).
  price_list_id uuid not null,
  price_list_item_id uuid not null,
  kind public.price_item_kind not null,
  name text not null check (char_length(name) between 1 and 80),
  print_size public.print_size,
  unit_price_cents bigint not null check (unit_price_cents between 0 and 1000000),
  quantity integer not null check (quantity between 1 and 99),
  line_total_cents bigint not null,
  constraint order_lines_total check (line_total_cents = unit_price_cents * quantity),
  constraint order_lines_studio_id_id_key unique (studio_id, id),
  constraint order_lines_order_fk foreign key (studio_id, order_id)
    references public.orders (studio_id, id) on delete restrict,
  constraint order_lines_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete set null (job_id),
  constraint order_lines_child_fk foreign key (studio_id, child_id)
    references public.children (studio_id, id) on delete set null (child_id),
  constraint order_lines_photo_fk foreign key (studio_id, job_id, photo_id)
    references public.photos (studio_id, job_id, id) on delete set null (photo_id)
);
create index order_lines_order_idx on public.order_lines (order_id, position);
create index order_lines_job_idx on public.order_lines (studio_id, job_id);
create index order_lines_child_idx on public.order_lines (child_id) where child_id is not null;
create index order_lines_photo_idx on public.order_lines (photo_id) where photo_id is not null;
comment on table public.order_lines is 'An order''s lines as sold (ADR 0019 snapshot). Never a child''s name.';

-- A package's contents as sold, for fulfilment (step 11 queries prints by size).
create table public.order_line_contents (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete restrict,
  order_line_id uuid not null,
  position integer not null check (position between 1 and 100),
  line_kind public.order_line_content_kind not null,
  print_size public.print_size,
  quantity integer not null check (quantity between 1 and 99),
  constraint order_line_contents_line_fk foreign key (studio_id, order_line_id)
    references public.order_lines (studio_id, id) on delete restrict,
  constraint order_line_contents_size check ((line_kind = 'print') = (print_size is not null))
);
create index order_line_contents_line_idx on public.order_line_contents (order_line_id, position);
comment on table public.order_line_contents is 'What a package line held when it was sold.';

-- "All digitals", fixed at payment (call 9): the child's parent-visible portraits at that moment.
create table public.order_line_photos (
  studio_id uuid not null references public.studios (id) on delete restrict,
  order_line_id uuid not null,
  job_id uuid not null,
  photo_id uuid not null,
  position integer not null check (position between 1 and 100000),
  primary key (order_line_id, photo_id),
  constraint order_line_photos_line_fk foreign key (studio_id, order_line_id)
    references public.order_lines (studio_id, id) on delete restrict,
  -- Sold photos can't be binned, so they are never purged; erasing one takes its entitlement with it.
  constraint order_line_photos_photo_fk foreign key (studio_id, job_id, photo_id)
    references public.photos (studio_id, job_id, id) on delete cascade
);
create index order_line_photos_photo_idx on public.order_line_photos (photo_id);
create index order_line_photos_studio_idx on public.order_line_photos (studio_id);
comment on table public.order_line_photos is 'The photos an "all digitals" line unlocked, fixed when it was paid.';

-- Home delivery only (call 2): the recipient Stripe's checkout collected, for the studio's own fulfilment. Personal
-- data: owners and admins only, never in an event, a log or a URL. Purged 90 days after the order ships (step 11; a
-- launch blocker: security review N2). complete_order cleans each value first (app.clean_address_text), so the text
-- check below can never fail and Postgres never logs a failing row (security review M3).
create table public.order_shipping_addresses (
  order_id uuid primary key,
  studio_id uuid not null references public.studios (id) on delete restrict,
  recipient_name text not null check (char_length(recipient_name) between 1 and 200),
  line1 text not null check (char_length(line1) between 1 and 200),
  line2 text check (char_length(line2) between 1 and 200),
  city text not null check (char_length(city) between 1 and 100),
  province text check (char_length(province) between 1 and 100),
  postal_code text not null check (char_length(postal_code) between 1 and 20),
  -- Canada only (call 2).
  country char(2) not null check (country = 'CA'),
  created_at timestamptz not null default now(),
  constraint order_shipping_addresses_order_fk foreign key (studio_id, order_id)
    references public.orders (studio_id, id) on delete restrict,
  constraint order_shipping_addresses_text check (
    (recipient_name || line1 || coalesce(line2, '') || city || coalesce(province, '') || postal_code)
      !~ '[\u0001-\u001F\u007F-\u009F‪-‮⁦-⁩]')
);
create index order_shipping_addresses_studio_idx on public.order_shipping_addresses (studio_id);
comment on table public.order_shipping_addresses is
  'Where a home-delivery order ships (personal data; owners and admins only; purged 90 days after shipping, step 11).';

-- ── Paid downloads, made lazily (security review N1; ADR 0023 §10) ────────────────────────────────────────────────
-- download.jpg (full resolution, no watermark) is made only for a photo that has been sold: queued when its order is
-- paid, and again when a paid download finds it missing. One row per photo asked for, so a photo is queued at most
-- once every 5 minutes and 3 times in all; after that the download is refused as unavailable and alerted (code review
-- S4, security review S5). Ids, a time and a count only; nobody signed in reads it.
create table public.photo_download_requests (
  photo_id uuid primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  requests integer not null default 1 check (requests between 1 and 1000),
  requested_at timestamptz not null default now(),
  constraint photo_download_requests_photo_fk foreign key (studio_id, job_id, photo_id)
    references public.photos (studio_id, job_id, id) on delete cascade
);
create index photo_download_requests_studio_idx on public.photo_download_requests (studio_id);
comment on table public.photo_download_requests is
  'When each sold photo''s download.jpg was last asked for, and how often (ADR 0023). Service role only.';

-- ── Guards ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- An order's currency is its studio's region's (ADR 0006). The snapshot, the fee rate and the destination never change;
-- each Stripe id and paid amount is written once; the status moves pending → paid, expired or failed, and expired →
-- paid (Stripe took the money for a checkout Daybell had replaced). The session may only be forgotten (null).
create function app.guard_order() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.currency is distinct from (
      select case s.data_region when 'us' then 'USD' else 'CAD' end from public.studios s where s.id = new.studio_id) then
      raise exception 'order_currency' using errcode = 'check_violation';
    end if;
    if new.status <> 'pending' then
      raise exception 'order_fixed' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.id, new.studio_id, new.reference, new.currency, new.shipping_method, new.products_cents, new.shipping_cents,
      new.daybell_fee_bps, new.daybell_fee_cents, new.card_fee_recovery, new.tax_enabled, new.payout_account_id,
      new.stripe_account_id, new.bag_fingerprint, new.created_at)
     is distinct from
     (old.id, old.studio_id, old.reference, old.currency, old.shipping_method, old.products_cents, old.shipping_cents,
      old.daybell_fee_bps, old.daybell_fee_cents, old.card_fee_recovery, old.tax_enabled, old.payout_account_id,
      old.stripe_account_id, old.bag_fingerprint, old.created_at)
     or (new.shop_session_id is distinct from old.shop_session_id and new.shop_session_id is not null)
     or (old.checkout_session_id is not null and new.checkout_session_id is distinct from old.checkout_session_id)
     or (old.checkout_expires_at is not null and new.checkout_expires_at is distinct from old.checkout_expires_at)
     or (old.payment_intent_id is not null and new.payment_intent_id is distinct from old.payment_intent_id)
     or (old.charge_id is not null and new.charge_id is distinct from old.charge_id)
     or (old.transfer_id is not null and new.transfer_id is distinct from old.transfer_id)
     or (old.fee_reversal_id is not null and new.fee_reversal_id is distinct from old.fee_reversal_id)
     or (old.balance_transaction_id is not null and new.balance_transaction_id is distinct from old.balance_transaction_id)
     or (old.tax_cents is not null and new.tax_cents is distinct from old.tax_cents)
     or (old.total_cents is not null and new.total_cents is distinct from old.total_cents)
     or (old.stripe_fee_cents is not null and new.stripe_fee_cents is distinct from old.stripe_fee_cents)
     or (old.paid_at is not null and new.paid_at is distinct from old.paid_at)
     or (old.stripe_closed_at is not null and new.stripe_closed_at is distinct from old.stripe_closed_at)
     or (old.fees_settled_at is not null and new.fees_settled_at is distinct from old.fees_settled_at) then
    raise exception 'order_fixed' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('paid', 'expired', 'failed'))
    or (old.status = 'expired' and new.status = 'paid')) then
    raise exception 'order_status_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger orders_guard before insert or update on public.orders
for each row execute function app.guard_order();

-- Orders and what they sold are never deleted (D125): their studio is closed, not deleted (restrict).
create function app.guard_order_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order_fixed' using errcode = 'check_violation';
end;
$$;
create trigger orders_no_delete before delete on public.orders
for each row execute function app.guard_order_delete();
create trigger orders_no_truncate before truncate on public.orders
for each statement execute function app.guard_order_delete();

-- A line, its contents and its photos never change, except that an erased child, photo or job leaves a null behind.
create function app.guard_order_line() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
begin
  if tg_op = 'DELETE' then
    raise exception 'order_fixed' using errcode = 'check_violation';
  end if;
  for v_key in select jsonb_object_keys(v_old) loop
    if v_new -> v_key is distinct from v_old -> v_key
       and not (v_key in ('job_id', 'child_id', 'photo_id') and v_new -> v_key = 'null'::jsonb) then
      raise exception 'order_fixed' using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;
create trigger order_lines_guard before update or delete on public.order_lines
for each row execute function app.guard_order_line();
create trigger order_line_contents_guard before update or delete on public.order_line_contents
for each row execute function app.guard_order_line();
create trigger order_line_photos_guard before update on public.order_line_photos
for each row execute function app.guard_order_line();
create trigger order_lines_no_truncate before truncate on public.order_lines
for each statement execute function app.guard_order_delete();
create trigger order_line_contents_no_truncate before truncate on public.order_line_contents
for each statement execute function app.guard_order_delete();

-- ── Ledger transactions (amends ADR 0006) ─────────────────────────────────────────────────────────────────────────
-- A header per money movement: what it was and which order. unique (order_id, kind): a second webhook delivery can
-- never post an order twice. Entries' sign convention (ADR 0023): positive is a debit (money in hand or receivable),
-- negative a credit (owed or earned).
create type public.ledger_kind as enum ('order_paid');

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete restrict,
  kind public.ledger_kind not null,
  order_id uuid not null,
  created_at timestamptz not null default now(),
  constraint ledger_transactions_order_kind_key unique (order_id, kind),
  constraint ledger_transactions_order_fk foreign key (studio_id, order_id)
    references public.orders (studio_id, id) on delete restrict
);
create index ledger_transactions_studio_idx on public.ledger_transactions (studio_id, created_at desc);
comment on table public.ledger_transactions is
  'What each ledger transaction was (ADR 0023): its kind and order. Once per order and kind. Append-only.';
create trigger ledger_transactions_append_only before update or delete on public.ledger_transactions
for each row execute function app.guard_ledger_append_only();
create trigger ledger_transactions_no_truncate before truncate on public.ledger_transactions
for each statement execute function app.guard_ledger_append_only();

-- ── Row-level security (call 15: owners and admins read; nobody signed in writes) ─────────────────────────────────
alter table public.studio_tax_settings enable row level security;
alter table public.studio_tax_registrations enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_line_contents enable row level security;
alter table public.order_line_photos enable row level security;
alter table public.order_shipping_addresses enable row level security;
alter table public.ledger_transactions enable row level security;
-- No policy: the service role only.
alter table public.photo_download_requests enable row level security;
revoke all on public.photo_download_requests from anon, authenticated;
create policy "owners and admins read their studio's tax settings" on public.studio_tax_settings
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's tax registrations" on public.studio_tax_registrations
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's orders" on public.orders
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's order lines" on public.order_lines
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's order contents" on public.order_line_contents
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's order photos" on public.order_line_photos
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's shipping addresses" on public.order_shipping_addresses
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
create policy "owners and admins read their studio's ledger transactions" on public.ledger_transactions
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));
revoke all on public.studio_tax_settings, public.studio_tax_registrations, public.orders, public.order_lines,
  public.order_line_contents, public.order_line_photos, public.order_shipping_addresses, public.ledger_transactions
  from anon, authenticated;
grant select on public.studio_tax_settings, public.studio_tax_registrations, public.order_lines,
  public.order_line_contents, public.order_line_photos, public.order_shipping_addresses, public.ledger_transactions
  to authenticated;
-- Every column of orders but the parent's session (it names a device's shop session, which studios never see).
grant select (id, studio_id, reference, status, currency, shipping_method, products_cents, shipping_cents, tax_cents,
  total_cents, daybell_fee_bps, daybell_fee_cents, card_fee_recovery, stripe_fee_cents, tax_enabled, payout_account_id,
  stripe_account_id, checkout_session_id, checkout_expires_at, payment_intent_id, charge_id, transfer_id,
  fee_reversal_id, balance_transaction_id, bag_fingerprint, stripe_checked_at, stripe_closed_at, backstop_attempts,
  backstop_error, backstop_next_at, problem, problem_at, paid_at, fees_settled_at, created_at, updated_at)
  on public.orders to authenticated;

-- ── The webhook inbox (amends ADR 0020) ───────────────────────────────────────────────────────────────────────────
-- Checkout's events are the platform's own (destination charges): no connected account. Two more types.
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
      'checkout.session.expired'
    ));

-- The inbox for a checkout event: the order is the one Stripe's session names (its metadata, read from Stripe), and
-- the session must be that order's (a session Daybell hadn't attached yet is attached here: the route may have stopped
-- between Stripe's answer and saving it). Recorded with the order's studio and destination account, then claimed with
-- the same lease as record_stripe_event. Null for an order this database doesn't hold (404: Stripe tries again). An
-- event whose checkout isn't the order's, or whose id is already recorded for another studio or type, can never
-- succeed: it is recorded as processed with event_mismatch (when it is new) and answered {mismatch: true}, which the
-- webhook acknowledges and alerts on rather than letting Stripe retry for days (security review S3).
create function public.record_order_stripe_event(p_event_id text, p_type text, p_order_id uuid,
  p_checkout_session_id text, p_livemode boolean, p_created timestamptz)
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
  if p_type not in ('checkout.session.completed', 'checkout.session.expired')
     or coalesce(p_checkout_session_id, '') !~ '^cs_[A-Za-z0-9_]{1,250}$' then
    raise exception 'Checkout events only' using errcode = '22023';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null then
    return null;
  end if;
  if v_order.checkout_session_id is null then
    update public.orders o set checkout_session_id = p_checkout_session_id where o.id = v_order.id;
  elsif v_order.checkout_session_id <> p_checkout_session_id then
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

-- ── Checkout: the bag becomes an order ────────────────────────────────────────────────────────────────────────────
-- 8 random characters of Crockford's base32 (32 divides 256: no bias), unique in the studio.
create function app.new_order_reference(p_studio_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_ref text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_ref := '';
    for i in 0..7 loop
      v_ref := v_ref || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.orders o where o.studio_id = p_studio_id and o.reference = v_ref);
  end loop;
  return v_ref;
end;
$$;

-- Daybell's fee: products × rate, half up, in whole cents (call 16; packages/core daybellFeeCents is the same rule).
create function app.daybell_fee_cents(p_products bigint, p_bps integer) returns bigint
language sql immutable
set search_path = ''
as $$
  select (p_products * p_bps + 5000) / 10000;
$$;

-- The smallest charge Stripe takes in CAD and USD (call 13): 50 cents, before tax. Free orders aren't offered.
create function app.min_charge_cents(p_currency text) returns bigint
language sql immutable
set search_path = ''
as $$
  select 50::bigint;
$$;

-- A checkout Stripe may still take payment for: made, not yet said closed by Stripe (expired there, or paid), not
-- past its expiry (24 hours at most), and not paid here. Daybell's own "expired" doesn't close it at Stripe: until
-- stripe_closed_at is set, the next Pay, cancel or the cron closes it there (code review M2, security review M1).
create function app.checkout_unclosed(p_order public.orders) returns boolean
language sql stable
set search_path = ''
as $$
  select p_order.checkout_session_id is not null and p_order.stripe_closed_at is null
    and p_order.status in ('pending', 'expired')
    and coalesce(p_order.checkout_expires_at, p_order.created_at + interval '1 day') > now();
$$;

-- Starts paying for the session's bag (ADR 0023 §5.1). The session is locked, so two taps can't make two orders. Every
-- line is priced again from its job's current list, with the bag's own rules (shop_line_available, shop_line_physical,
-- core cartTotals). Named refusals without values: bag_empty, shop_closed (a child's shop closed or is a draft),
-- line_unavailable (anything else that can't be bought now: the parent removes it first), choose_delivery,
-- not_accepting (the studio's payouts aren't Active with card payments on), below_minimum (call 13), checkout_limit
-- (10 new checkouts a session an hour). The same bag as a pending order whose checkout is still open (or not yet
-- made, under 45 seconds ago) reuses it, asking Stripe about it at most every 3 seconds (stripe_check; security review
-- S2); otherwise the session's other pending orders expire here and a new order is written with its lines and package
-- contents. Either way every other checkout of the session that Stripe hasn't closed is returned as superseded, so the
-- API closes each at Stripe before making or reusing one: a Stripe failure part way leaves them in the list for the
-- next Pay, cancel or the cron (code review M2, security review M1). Returns what the API needs to ask Stripe for the
-- checkout: amounts, names, kinds and Stripe's destination; never a child's name. A line whose item or list is gone is
-- unavailable (code review N4).
create function public.shop_checkout_begin(p_session_hash text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
  v_lines jsonb;
  v_needed boolean;
  v_home bigint;
  v_school boolean;
  v_method public.shop_shipping_method;
  v_shipping bigint;
  v_products bigint;
  v_currency text;
  v_account record;
  v_settings app.platform_settings;
  v_tax boolean;
  v_fingerprint text;
  v_existing record;
  v_superseded jsonb;
  v_check boolean := true;
  v_order uuid;
  v_reference text;
  v_studio_name text;
begin
  select coalesce(jsonb_agg(x.line order by x.added_at, x.child_id, x.created_at, x.id), '[]'::jsonb)
  into v_lines
  from (
    select l.id, l.child_id, l.created_at, sc.added_at,
      jsonb_build_object('cart_line_id', l.id, 'job_id', l.job_id, 'child_id', l.child_id, 'photo_id', l.photo_id,
        'price_list_id', l.price_list_id, 'item_id', l.item_id, 'kind', l.kind, 'name', i.name,
        'print_size', i.print_size, 'unit_price_cents', i.price_cents, 'quantity', l.quantity,
        'physical', app.shop_line_physical(l),
        'available', i.id is not null and pl.id is not null and app.shop_line_available(l),
        'closed', app.shop_child_state(l.child_id) = 'closed',
        'home_shipping_cents', pl.home_shipping_cents, 'deliver_to_school', j.deliver_to_school) as line
    from public.shop_cart_lines l
    join public.shop_session_children sc on sc.session_id = l.session_id and sc.child_id = l.child_id
      and sc.studio_id = l.studio_id
    -- Left joins: a line whose item, job or list is gone is refused as unavailable, never dropped silently.
    left join public.price_list_items i on i.id = l.item_id and i.studio_id = l.studio_id
    left join public.jobs j on j.id = l.job_id and j.studio_id = l.studio_id
    left join public.price_lists pl on pl.id = j.price_list_id and pl.studio_id = j.studio_id
    where l.session_id = v.id and l.studio_id = v.studio_id) x;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'bag_empty' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(v_lines) e
             where not (e.value ->> 'available')::boolean and (e.value ->> 'closed')::boolean) then
    raise exception 'shop_closed' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(v_lines) e where not (e.value ->> 'available')::boolean) then
    raise exception 'line_unavailable' using errcode = 'P0001';
  end if;

  -- Delivery (call 9 of ADR 0022): one home fee per bag, the highest; school only when every such job delivers there.
  select coalesce(bool_or((e.value ->> 'physical')::boolean), false),
    coalesce(max((e.value ->> 'home_shipping_cents')::bigint) filter (where (e.value ->> 'physical')::boolean), 0),
    coalesce(bool_and((e.value ->> 'deliver_to_school')::boolean) filter (where (e.value ->> 'physical')::boolean),
      false)
  into v_needed, v_home, v_school
  from jsonb_array_elements(v_lines) e;
  v_method := case when not v_needed then null when not v_school then 'home' else v.shipping_method end;
  if v_needed and v_method is null then
    raise exception 'choose_delivery' using errcode = 'P0001';
  end if;
  v_shipping := case when v_method = 'home' then v_home else 0 end;

  select a.id, a.stripe_account_id into v_account from public.payout_accounts a
  where a.studio_id = v.studio_id and a.status = 'active' and a.charges_enabled;
  if v_account.id is null then
    raise exception 'not_accepting' using errcode = 'P0001';
  end if;

  v_currency := (select case s.data_region when 'us' then 'USD' else 'CAD' end
                 from public.studios s where s.id = v.studio_id);
  select coalesce(sum((e.value ->> 'unit_price_cents')::bigint * (e.value ->> 'quantity')::int), 0) into v_products
  from jsonb_array_elements(v_lines) e;
  if v_products + v_shipping < app.min_charge_cents(v_currency) then
    raise exception 'below_minimum' using errcode = 'P0001';
  end if;

  select * into v_settings from app.platform_settings s;
  v_tax := app.studio_collects_tax(v.studio_id);
  v_fingerprint := encode(extensions.digest(jsonb_build_object(
      'lines', (select jsonb_agg(e.value - 'physical' - 'available' - 'closed' - 'home_shipping_cents'
                                 - 'deliver_to_school' - 'cart_line_id' order by e.ordinality)
                from jsonb_array_elements(v_lines) with ordinality e),
      'method', v_method, 'shipping', v_shipping, 'account', v_account.stripe_account_id,
      'bps', v_settings.daybell_fee_bps, 'tax', v_tax)::text, 'sha256'), 'hex');
  v_studio_name := (select s.name from public.studios s where s.id = v.studio_id);

  -- The same bag: its order, while Stripe's checkout is open for 5 minutes more, or not yet made and less than 45
  -- seconds old (a retry: Stripe's checkout expiry is fixed at the order's creation plus 32 minutes, so a retried
  -- request is the same one and still at least 30 minutes ahead, as Stripe requires: code review S5).
  select o.id, o.reference, o.checkout_session_id, o.created_at into v_existing from public.orders o
  where o.studio_id = v.studio_id and o.shop_session_id = v.id and o.status = 'pending'
    and o.bag_fingerprint = v_fingerprint
    and ((o.checkout_session_id is not null and o.checkout_expires_at > now() + interval '5 minutes')
      or (o.checkout_session_id is null and o.created_at > now() - interval '45 seconds'))
  order by o.created_at desc limit 1;
  if v_existing.id is not null then
    v_order := v_existing.id;
    v_reference := v_existing.reference;
    -- Pay asks Stripe about a reused order at most every 3 seconds, so one code can't use up Daybell's shared Stripe
    -- rate limit (security review S2).
    update public.orders o set stripe_checked_at = now()
    where o.id = v_order and (o.stripe_checked_at is null or o.stripe_checked_at < now() - interval '3 seconds');
    v_check := found;
  else
    if (select count(*) from public.orders o
        where o.studio_id = v.studio_id and o.shop_session_id = v.id
          and o.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'checkout_limit' using errcode = 'P0001';
    end if;
    -- Replaced here; still open at Stripe until the API closes them (below).
    update public.orders o set status = 'expired'
    where o.studio_id = v.studio_id and o.shop_session_id = v.id and o.status = 'pending';

    v_reference := app.new_order_reference(v.studio_id);
    insert into public.orders (studio_id, reference, shop_session_id, currency, shipping_method, products_cents,
      shipping_cents, daybell_fee_bps, daybell_fee_cents, card_fee_recovery, tax_enabled, payout_account_id,
      stripe_account_id, bag_fingerprint)
    values (v.studio_id, v_reference, v.id, v_currency, v_method, v_products, v_shipping,
      v_settings.daybell_fee_bps, app.daybell_fee_cents(v_products, v_settings.daybell_fee_bps),
      v_settings.card_fee_recovery, v_tax, v_account.id, v_account.stripe_account_id, v_fingerprint)
    returning id into v_order;
    insert into public.order_lines (studio_id, order_id, position, job_id, child_id, photo_id, price_list_id,
      price_list_item_id, kind, name, print_size, unit_price_cents, quantity, line_total_cents)
    select v.studio_id, v_order, e.ordinality, (e.value ->> 'job_id')::uuid, (e.value ->> 'child_id')::uuid,
      (e.value ->> 'photo_id')::uuid, (e.value ->> 'price_list_id')::uuid, (e.value ->> 'item_id')::uuid,
      (e.value ->> 'kind')::public.price_item_kind, e.value ->> 'name', (e.value ->> 'print_size')::public.print_size,
      (e.value ->> 'unit_price_cents')::bigint, (e.value ->> 'quantity')::int,
      (e.value ->> 'unit_price_cents')::bigint * (e.value ->> 'quantity')::int
    from jsonb_array_elements(v_lines) with ordinality e;
    insert into public.order_line_contents (studio_id, order_line_id, position, line_kind, print_size, quantity)
    select v.studio_id, ol.id, row_number() over (partition by ol.id order by pk.position, pk.id),
      pk.line_kind::public.order_line_content_kind, pk.print_size, pk.quantity
    from public.order_lines ol
    join public.price_list_package_lines pk on pk.package_item_id = ol.price_list_item_id
      and pk.studio_id = ol.studio_id
    where ol.order_id = v_order and ol.studio_id = v.studio_id and ol.kind = 'package';
  end if;

  -- Every other checkout of the session that Stripe hasn't closed, oldest first.
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'checkout_session_id', o.checkout_session_id)
                            order by o.created_at, o.id), '[]'::jsonb)
  into v_superseded
  from public.orders o
  where o.studio_id = v.studio_id and o.shop_session_id = v.id and o.id <> v_order and app.checkout_unclosed(o);

  return jsonb_build_object(
    'outcome', case when v_existing.id is not null then 'reuse' else 'created' end,
    'order_id', v_order, 'reference', v_reference,
    'created_at', (select o.created_at from public.orders o where o.id = v_order),
    'checkout_session_id', v_existing.checkout_session_id,
    'stripe_check', v_check,
    'superseded', v_superseded,
    'studio_id', v.studio_id, 'studio_name', v_studio_name, 'currency', v_currency,
    'stripe_account_id', v_account.stripe_account_id,
    'card_prefix_set', (select a.card_prefix_set_at is not null from public.payout_accounts a where a.id = v_account.id),
    'tax_enabled', v_tax, 'shipping_method', v_method, 'shipping_cents', v_shipping, 'products_cents', v_products,
    'daybell_fee_cents', app.daybell_fee_cents(v_products, v_settings.daybell_fee_bps),
    'lines', (select jsonb_agg(jsonb_build_object('kind', e.value -> 'kind', 'name', e.value -> 'name',
                'print_size', e.value -> 'print_size', 'unit_price_cents', e.value -> 'unit_price_cents',
                'quantity', e.value -> 'quantity') order by e.ordinality)
              from jsonb_array_elements(v_lines) with ordinality e));
end;
$$;

-- Saves the checkout Stripe made for the session's pending order. The same id again is fine; another is refused
-- (checkout_attached), and an order that isn't this session's pending one is not found.
create function public.shop_checkout_attach(p_session_hash text, p_order_id uuid, p_checkout_session_id text,
  p_expires_at timestamptz) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_current text;
begin
  if coalesce(p_checkout_session_id, '') !~ '^cs_[A-Za-z0-9_]{1,250}$' or p_expires_at is null
     or p_expires_at > now() + interval '25 hours' then
    raise exception 'Send the checkout and when it expires' using errcode = '22023';
  end if;
  select o.checkout_session_id into v_current from public.orders o
  where o.id = p_order_id and o.studio_id = v.studio_id and o.shop_session_id = v.id and o.status = 'pending'
  for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_current is null then
    update public.orders o set checkout_session_id = p_checkout_session_id, checkout_expires_at = p_expires_at
    where o.id = p_order_id and o.studio_id = v.studio_id;
  elsif v_current <> p_checkout_session_id then
    raise exception 'checkout_attached' using errcode = 'P0001';
  elsif (select o.checkout_expires_at from public.orders o where o.id = p_order_id) is null then
    -- Attached by the webhook before the API saved it: the expiry arrives now.
    update public.orders o set checkout_expires_at = p_expires_at where o.id = p_order_id and o.studio_id = v.studio_id;
  end if;
end;
$$;

-- The session's pending orders, and its replaced ones whose checkouts Stripe hasn't closed yet, with their Stripe
-- checkouts ("Payment canceled": the API closes each at Stripe, then here).
create function public.shop_pending_checkouts(p_session_hash text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('order_id', o.id, 'checkout_session_id', o.checkout_session_id)
                                    order by o.created_at)
                   from public.orders o
                   where o.studio_id = v.studio_id and o.shop_session_id = v.id
                     and (o.status = 'pending' or app.checkout_unclosed(o))), '[]'::jsonb);
end;
$$;

-- The facts Stripe's checkout session gives once paid (the API reads them from Stripe; never the payload).
create type app.checkout_facts as (
  checkout_session_id text, payment_intent_id text, charge_id text, transfer_id text, livemode boolean, currency text,
  amount_subtotal bigint, amount_shipping bigint, amount_tax bigint, amount_total bigint, destination text,
  on_behalf_of text, application_fee_amount bigint, shipping jsonb);

-- A recipient's text as the studio keeps it: control and bidi characters taken out (a control character becomes a
-- space), trimmed, at most p_max characters; null when nothing is left. So the address's text check can never fail,
-- and Postgres never logs a failing row holding a name or an address (security review M3).
create function app.clean_address_text(p_text text, p_max integer) returns text
language sql immutable
set search_path = ''
as $$
  select nullif(btrim(left(btrim(regexp_replace(regexp_replace(coalesce(p_text, ''),
    '[\u0001-\u001F\u007F-\u009F]', ' ', 'g'), '[\u200E\u200F\u202A-\u202E\u2066-\u2069]', '', 'g')), p_max)), '');
$$;

-- Stripe took the money (ADR 0023 §5.2): checked against the snapshot (session, mode, currency, amounts, destination,
-- the merchant of record (on_behalf_of: security review N5), Daybell's fee), then paid, once, and its checkout marked
-- closed at Stripe. A mismatch raises checkout_mismatch and changes nothing (support resolves it). The
-- recipient's address is kept for home delivery, cleaned first (app.clean_address_text); "all digitals" is fixed to the child's visible portraits now (call
-- 9); every photo sold is marked (so it can't be binned); the bag loses what was bought; one order.paid event with no
-- actor (call 14). A second call for a paid order changes nothing and answers already_paid, or already_settled once
-- Stripe's fee is settled (so the API asks Stripe nothing more).
create function public.complete_order(p_order_id uuid, p_facts jsonb) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  f app.checkout_facts;
  v_livemode boolean;
  v_ship jsonb;
  v_previous text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if jsonb_typeof(p_facts) is distinct from 'object' then
    raise exception 'The facts must be an object' using errcode = '22023';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.status = 'paid' then
    return case when v_order.fees_settled_at is null then 'already_paid' else 'already_settled' end;
  end if;
  f := jsonb_populate_record(null::app.checkout_facts, p_facts);
  -- The recipient as it will be kept: cleaned, so checking it here is checking what is stored.
  v_ship := case when jsonb_typeof(f.shipping) = 'object' then jsonb_build_object(
      'name', app.clean_address_text(f.shipping ->> 'name', 200),
      'line1', app.clean_address_text(f.shipping ->> 'line1', 200),
      'line2', app.clean_address_text(f.shipping ->> 'line2', 200),
      'city', app.clean_address_text(f.shipping ->> 'city', 100),
      'state', app.clean_address_text(f.shipping ->> 'state', 100),
      'postal_code', app.clean_address_text(f.shipping ->> 'postal_code', 20),
      'country', f.shipping ->> 'country') end;
  select a.livemode into v_livemode from public.payout_accounts a where a.id = v_order.payout_account_id;
  if v_order.status not in ('pending', 'expired')
     or f.checkout_session_id is distinct from v_order.checkout_session_id
     or f.livemode is distinct from v_livemode
     or upper(f.currency) is distinct from v_order.currency
     or f.amount_subtotal is distinct from v_order.products_cents
     or coalesce(f.amount_shipping, 0) is distinct from v_order.shipping_cents
     or f.amount_tax is null or f.amount_tax < 0 or (not v_order.tax_enabled and f.amount_tax <> 0)
     or f.amount_total is distinct from v_order.products_cents + v_order.shipping_cents + f.amount_tax
     or f.destination is distinct from v_order.stripe_account_id
     or f.on_behalf_of is distinct from v_order.stripe_account_id
     or f.application_fee_amount is distinct from v_order.daybell_fee_cents
     or coalesce(f.payment_intent_id, '') !~ '^pi_[A-Za-z0-9_]{1,250}$'
     or (f.charge_id is not null and f.charge_id !~ '^(ch|py)_[A-Za-z0-9_]{1,250}$')
     or (f.transfer_id is not null and f.transfer_id !~ '^tr_[A-Za-z0-9_]{1,250}$')
     or (v_order.shipping_method = 'home' and (v_ship is null
         or coalesce(v_ship ->> 'country', '') <> 'CA' or v_ship ->> 'name' is null or v_ship ->> 'line1' is null
         or v_ship ->> 'city' is null or v_ship ->> 'postal_code' is null)) then
    raise exception 'checkout_mismatch' using errcode = 'P0001';
  end if;

  update public.orders o
  set status = 'paid', tax_cents = f.amount_tax, total_cents = f.amount_total, payment_intent_id = f.payment_intent_id,
    charge_id = f.charge_id, transfer_id = f.transfer_id, paid_at = now(),
    stripe_closed_at = coalesce(o.stripe_closed_at, now())
  where o.id = v_order.id;

  if v_order.shipping_method = 'home' then
    insert into public.order_shipping_addresses (order_id, studio_id, recipient_name, line1, line2, city, province,
      postal_code, country)
    values (v_order.id, v_order.studio_id, v_ship ->> 'name', v_ship ->> 'line1', v_ship ->> 'line2',
      v_ship ->> 'city', v_ship ->> 'state', v_ship ->> 'postal_code', 'CA');
  end if;

  insert into public.order_line_photos (studio_id, order_line_id, job_id, photo_id, position)
  select ol.studio_id, ol.id, ol.job_id, p.id, row_number() over (partition by ol.id order by p.ord)
  from public.order_lines ol
  cross join lateral app.parent_visible_photos(ol.job_id, ol.child_id, null) p
  where ol.order_id = v_order.id and ol.studio_id = v_order.studio_id and ol.kind = 'digital_all'
    and ol.child_id is not null and ol.job_id is not null and p.place = 'child';

  update public.photos p set sold_at = now()
  where p.studio_id = v_order.studio_id and p.sold_at is null
    and p.id in (select ol.photo_id from public.order_lines ol
                 where ol.order_id = v_order.id and ol.studio_id = v_order.studio_id and ol.photo_id is not null
                 union
                 select lp.photo_id from public.order_line_photos lp
                 join public.order_lines ol on ol.id = lp.order_line_id and ol.studio_id = lp.studio_id
                 where ol.order_id = v_order.id and lp.studio_id = v_order.studio_id);

  delete from public.shop_cart_lines l
  using public.order_lines ol
  where ol.order_id = v_order.id and ol.studio_id = v_order.studio_id
    and l.session_id = v_order.shop_session_id and l.studio_id = v_order.studio_id
    and l.child_id = ol.child_id and l.item_id = ol.price_list_item_id
    and l.photo_id is not distinct from ol.photo_id;

  -- Nobody did it: auth.uid() reads either setting, so both are blanked for the event and put back.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform app.emit(v_order.studio_id, 'order.paid', v_order.id, jsonb_build_object(
    'line_count', (select count(*) from public.order_lines ol where ol.order_id = v_order.id),
    'shipping_method', v_order.shipping_method));
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform app.end_act_for(v_previous);
  return 'paid';
end;
$$;

-- A checkout that won't be paid: cancelled, replaced or run out. Called only once Stripe has closed the checkout (or
-- there is none), so it is marked closed at Stripe too (code review M2). A pending order expires; an expired one is
-- only marked closed; a paid one is left alone. True when the status changed.
create function public.expire_order(p_order_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
begin
  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if v_status is null or v_status not in ('pending', 'expired') then
    return false;
  end if;
  update public.orders o set status = 'expired',
    stripe_closed_at = case when o.checkout_session_id is null then o.stripe_closed_at
                            else coalesce(o.stripe_closed_at, now()) end
  where o.id = p_order_id;
  return v_status = 'pending';
end;
$$;

-- Stripe's fee is known (and, per sale, recovered from the studio's transfer: call 1): the order's one ledger
-- transaction, balanced in whole cents in the order's currency (ADR 0006; ADR 0023 §fees):
--   parent_payments +total, tax_payable −tax, daybell_fees −Daybell's fee, payment_fees −Stripe's fee,
--   studio_payable −(the rest). Zero lines are left out.
-- tax_payable is the tax collected for the studio and passed through to it: Stripe's transfer to the studio holds it,
-- and the studio remits it (D106). So what reaches the studio's balance is studio_payable + tax_payable, and
-- reconciling against transfers adds the two (security review N3).
-- Once: the header's unique (order_id, kind) makes a second call already_settled. Refusals: not_paid, fee_currency
-- (Stripe's fee in another currency: never expected, support resolves it), checkout_mismatch (another transfer).
create function public.settle_order_fees(p_order_id uuid, p_transfer_id text, p_stripe_fee_cents bigint,
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
  on conflict (order_id, kind) do nothing
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

-- The card prefix "DBL" is on the studio's Stripe account (call 7).
create function public.mark_card_prefix_set(p_stripe_account_id text) returns void
language sql security definer
set search_path = ''
as $$
  update public.payout_accounts a set card_prefix_set_at = coalesce(a.card_prefix_set_at, now())
  where a.stripe_account_id = p_stripe_account_id;
$$;

-- A backstop's try failed (the cron), or an order hit a problem no retry can fix (any path): the code is kept, the next
-- try backs off (1, 2, 4 … minutes, at most 6 hours), and a permanent problem takes the order out of the backstops for
-- good until support resolves it (code review S1, security review M4). Codes only, never a message.
create function public.note_checkout_failure(p_order_id uuid, p_code text, p_permanent boolean) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(p_code, '') !~ '^[a-z_]{1,100}$' or p_permanent is null then
    raise exception 'A code and whether it is permanent' using errcode = '22023';
  end if;
  update public.orders o
  set backstop_attempts = least(o.backstop_attempts + 1, 1000000), backstop_error = p_code,
    backstop_next_at = now() + least(interval '1 minute' * power(2, least(o.backstop_attempts, 10)),
                                     interval '6 hours'),
    problem = case when p_permanent then coalesce(o.problem, p_code) else o.problem end,
    problem_at = case when p_permanent then coalesce(o.problem_at, now()) else o.problem_at end
  where o.id = p_order_id;
end;
$$;

-- The jobs cron's backstops (ids only), oldest due first, never an order with a problem or still backing off: pending
-- orders whose checkout ran out two hours ago (or was never made), replaced orders whose checkout Stripe hasn't
-- closed (code review M2), and paid orders whose fees aren't settled after 10 minutes.
create function public.stale_checkouts(p_limit integer) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('order_id', x.id, 'checkout_session_id', x.checkout_session_id))
                   from (select o.id, o.checkout_session_id from public.orders o
                         where o.problem is null and (o.backstop_next_at is null or o.backstop_next_at <= now())
                           and ((o.status = 'pending'
                                 and (o.checkout_expires_at < now() - interval '2 hours'
                                   or (o.checkout_expires_at is null and o.created_at < now() - interval '2 hours')))
                             or (o.status = 'expired' and app.checkout_unclosed(o)))
                         order by coalesce(o.backstop_next_at, o.created_at), o.id limit p_limit) x), '[]'::jsonb);
end;
$$;

create function public.unsettled_orders(p_limit integer) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'The limit must be 1 to 1000' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('order_id', x.id, 'checkout_session_id', x.checkout_session_id))
                   from (select o.id, o.checkout_session_id from public.orders o
                         where o.status = 'paid' and o.fees_settled_at is null
                           and o.paid_at < now() - interval '10 minutes'
                           and o.problem is null and (o.backstop_next_at is null or o.backstop_next_at <= now())
                         order by coalesce(o.backstop_next_at, o.paid_at), o.id limit p_limit) x), '[]'::jsonb);
end;
$$;

-- ── What parents see of orders (call 12) ──────────────────────────────────────────────────────────────────────────
-- full: the session that paid, or one holding every child in the order; child: one holding some of its children (their
-- lines only, no totals or prices, never an email); null: nothing. Pending and expired orders only to their own session.
create function app.shop_order_view(p_session public.shop_sessions, p_order public.orders) returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_order.studio_id <> p_session.studio_id then null
    when p_order.shop_session_id = p_session.id then 'full'
    when p_order.status <> 'paid' then null
    when not exists (select 1 from public.order_lines ol
                     where ol.order_id = p_order.id and ol.studio_id = p_order.studio_id
                       and (ol.child_id is null or not exists (
                         select 1 from public.shop_session_children sc
                         where sc.session_id = p_session.id and sc.studio_id = p_session.studio_id
                           and sc.child_id = ol.child_id))) then 'full'
    when exists (select 1 from public.order_lines ol
                 join public.shop_session_children sc on sc.child_id = ol.child_id and sc.studio_id = ol.studio_id
                 where ol.order_id = p_order.id and ol.studio_id = p_order.studio_id
                   and sc.session_id = p_session.id) then 'child'
    else null
  end;
$$;

-- The lines a view shows: every line for full, the session's children's for child.
create function app.shop_order_lines(p_session public.shop_sessions, p_order public.orders, p_view text)
returns setof public.order_lines
language sql stable security definer
set search_path = ''
as $$
  select ol.* from public.order_lines ol
  where ol.order_id = p_order.id and ol.studio_id = p_order.studio_id
    and (p_view = 'full' or exists (select 1 from public.shop_session_children sc
                                    where sc.session_id = p_session.id and sc.studio_id = p_session.studio_id
                                      and sc.child_id = ol.child_id))
  order by ol.position;
$$;

-- A paid line's downloads, in order: the pose of a single download or a package with a digital, or the photos "all
-- digitals" unlocked. Never for prints. Paid downloads stay while the file exists (call 11).
create function app.order_line_downloads(p_line public.order_lines) returns table (photo_id uuid, job_id uuid, n bigint)
language sql stable security definer
set search_path = ''
as $$
  select p_line.photo_id, p_line.job_id, 1::bigint
  where p_line.photo_id is not null and p_line.job_id is not null
    and (p_line.kind = 'digital_single' or (p_line.kind = 'package' and exists (
      select 1 from public.order_line_contents c
      where c.order_line_id = p_line.id and c.studio_id = p_line.studio_id and c.line_kind = 'digital')))
  union all
  select lp.photo_id, lp.job_id, lp.position::bigint from public.order_line_photos lp
  where p_line.kind = 'digital_all' and lp.order_line_id = p_line.id and lp.studio_id = p_line.studio_id;
$$;

-- A child as parents see them on an order: first name and last initial while their shop is open; only an id
-- otherwise (security review M1 of ADR 0022: a stale card never reveals a name).
create function app.shop_order_child(p_child_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'state', st.state) || case when st.state = 'open' then
      jsonb_build_object('first_name', c.first_name, 'last_initial', upper(left(c.last_name, 1))) else '{}'::jsonb end
  from public.children c cross join lateral (select app.shop_child_state(c.id) as state) st
  where c.id = p_child_id;
$$;

-- "Your orders": the paid orders this session may see, and its own checkouts of the last 2 hours. Newest first, at most
-- 50. Ids, references, dates, the view and the children shown; no amounts.
create function public.shop_orders(p_session_hash text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'reference', x.reference, 'status', x.status,
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
      select o.id, o.reference, o.status, o.paid_at, o.created_at, o as o, app.shop_order_view(v, o) as view
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

-- One order as this session may see it (P0002 otherwise): the lines it shows with their package contents and, once
-- paid, their downloads; for the full view the amounts and the studio's tax registration numbers at the time (call 5).
create function public.shop_order(p_session_hash text, p_order_id uuid) returns jsonb
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
    'paid_at', v_order.paid_at, 'created_at', v_order.created_at, 'currency', v_order.currency,
    'studio_name', (select s.name from public.studios s where s.id = v_order.studio_id),
    'shipping_method', case when v_full then v_order.shipping_method end,
    'totals', case when v_full then jsonb_build_object('products_cents', v_order.products_cents,
      'shipping_cents', v_order.shipping_cents, 'tax_cents', v_order.tax_cents, 'total_cents', v_order.total_cents)
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

-- The session's own pending order to check with Stripe, at most every 5 seconds (the confirmation page): its
-- checkout's id, or null (not pending, not this session's, or asked too recently).
create function public.shop_order_verify(p_session_hash text, p_order_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_checkout text;
begin
  update public.orders o set stripe_checked_at = now()
  where o.id = p_order_id and o.studio_id = v.studio_id and o.shop_session_id = v.id and o.status = 'pending'
    and o.checkout_session_id is not null
    and (o.stripe_checked_at is null or o.stripe_checked_at < now() - interval '5 seconds')
  returning o.checkout_session_id into v_checkout;
  return v_checkout;
end;
$$;

-- One download this session may have (P0002 otherwise): a paid order it may see, a line it shows, a photo that line
-- unlocked. Ids for the storage key, the order's reference and the photo's number in the order, for a nameless file.
create function public.shop_download_photo(p_session_hash text, p_order_id uuid, p_photo_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_order public.orders;
  v_view text;
  v_found jsonb;
begin
  select * into v_order from public.orders o
  where o.id = p_order_id and o.studio_id = v.studio_id and o.status = 'paid';
  v_view := case when v_order.id is null then null else app.shop_order_view(v, v_order) end;
  if v_view is not null then
    select jsonb_build_object('studio_id', v_order.studio_id, 'job_id', d.job_id, 'photo_id', d.photo_id,
             'reference', v_order.reference, 'n', d.number)
    into v_found
    from (select x.photo_id, x.job_id, row_number() over (order by x.position, x.n) as number
          from (select ol.position, dl.photo_id, dl.job_id, dl.n
                from app.shop_order_lines(v, v_order, v_view) ol
                cross join lateral app.order_line_downloads(ol) dl) x) d
    where d.photo_id = p_photo_id
    limit 1;
  end if;
  if v_found is null then
    raise exception 'Download not found' using errcode = 'P0002';
  end if;
  return v_found;
end;
$$;

-- Asks for a sold photo's download.jpg (security review N1, S5; code review S4): queued (the caller sends the queue
-- message, ids only), waiting (asked under 5 minutes ago: the worker has it), or unavailable (the photo isn't ready, or
-- was asked for 3 times and more than 5 minutes ago and still isn't there: the caller alerts).
create function app.claim_download_request(p_studio_id uuid, p_job_id uuid, p_photo_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text;
  v_row public.photo_download_requests;
begin
  select p.status::text into v_status from public.photos p
  where p.id = p_photo_id and p.studio_id = p_studio_id and p.job_id = p_job_id;
  if v_status is distinct from 'ready' then
    return 'unavailable';
  end if;
  insert into public.photo_download_requests (photo_id, studio_id, job_id)
  values (p_photo_id, p_studio_id, p_job_id)
  on conflict (photo_id) do nothing;
  if found then
    return 'queued';
  end if;
  select * into v_row from public.photo_download_requests r where r.photo_id = p_photo_id for update;
  if v_row.requested_at > now() - interval '5 minutes' then
    return 'waiting';
  end if;
  if v_row.requests >= 3 then
    return 'unavailable';
  end if;
  update public.photo_download_requests r set requests = r.requests + 1, requested_at = now()
  where r.photo_id = p_photo_id;
  return 'queued';
end;
$$;

-- A paid download this session may have whose file isn't there yet (P0002 as shop_download_photo otherwise).
create function public.shop_download_request(p_session_hash text, p_order_id uuid, p_photo_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_found jsonb := public.shop_download_photo(p_session_hash, p_order_id, p_photo_id);
begin
  return app.claim_download_request((v_found ->> 'studio_id')::uuid, (v_found ->> 'job_id')::uuid,
    p_photo_id);
end;
$$;

-- A paid order's photos whose download.jpg has never been asked for (ready ones only), marked asked: the caller queues
-- each (ids only). Lazily, so a full-resolution file exists only for photos that were sold (security review N1).
create function public.order_downloads_to_make(p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ids jsonb;
begin
  with wanted as (
    select distinct d.photo_id, d.job_id, o.studio_id
    from public.orders o
    join public.order_lines ol on ol.order_id = o.id and ol.studio_id = o.studio_id
    cross join lateral app.order_line_downloads(ol) d
    join public.photos p on p.id = d.photo_id and p.studio_id = o.studio_id and p.job_id = d.job_id
    where o.id = p_order_id and o.status = 'paid' and p.status = 'ready'),
  made as (
    insert into public.photo_download_requests (photo_id, studio_id, job_id)
    select w.photo_id, w.studio_id, w.job_id from wanted w
    on conflict (photo_id) do nothing
    returning photo_id)
  select coalesce(jsonb_agg(m.photo_id order by m.photo_id), '[]'::jsonb) into v_ids from made m;
  return v_ids;
end;
$$;

-- ── What studios see of orders (call 15: owners and admins; SECURITY INVOKER, so row-level security applies) ───────
-- A job's paid orders, newest first, a page at a time (after the order p_cursor): reference, amounts, Daybell's fee and
-- the rate used, Stripe's fee (null until known), what reaches the studio, items, and the children (full names: the
-- studio may see them; ADR 0022 call 2 is for parents only).
create function public.job_orders(p_studio_id uuid, p_job_id uuid, p_limit integer default 50,
  p_cursor uuid default null) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'reference', o.reference, 'paid_at', o.paid_at, 'currency', o.currency,
      'products_cents', o.products_cents, 'shipping_cents', o.shipping_cents, 'tax_cents', o.tax_cents,
      'total_cents', o.total_cents, 'daybell_fee_bps', o.daybell_fee_bps, 'daybell_fee_cents', o.daybell_fee_cents,
      'stripe_fee_cents', o.stripe_fee_cents, 'shipping_method', o.shipping_method,
      'items', (select coalesce(sum(ol.quantity), 0) from public.order_lines ol
                where ol.order_id = o.id and ol.studio_id = o.studio_id),
      'children', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'first_name', c.first_name,
                     'last_name', c.last_name) order by c.last_name, c.first_name, c.id), '[]'::jsonb)
                   from public.children c
                   where c.studio_id = o.studio_id and c.id in (
                     select ol.child_id from public.order_lines ol
                     where ol.order_id = o.id and ol.studio_id = o.studio_id)))
    order by o.paid_at desc, o.id desc), '[]'::jsonb)
  -- Named columns: browsers can't read an order's shop session.
  from (select o.id, o.studio_id, o.reference, o.paid_at, o.currency, o.products_cents, o.shipping_cents, o.tax_cents,
          o.total_cents, o.daybell_fee_bps, o.daybell_fee_cents, o.stripe_fee_cents, o.shipping_method
        from public.orders o
        where o.studio_id = p_studio_id and o.status = 'paid'
          and exists (select 1 from public.order_lines ol
                      where ol.order_id = o.id and ol.studio_id = o.studio_id and ol.job_id = p_job_id)
          and (p_cursor is null or (o.paid_at, o.id) < (
            select c.paid_at, c.id from public.orders c
            where c.id = p_cursor and c.studio_id = p_studio_id and c.status = 'paid'))
        order by o.paid_at desc, o.id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 100)) o;
$$;

-- One paid order with its lines (children's full names), package contents and, for home delivery, where it ships.
create function public.studio_order(p_studio_id uuid, p_order_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'reference', o.reference, 'paid_at', o.paid_at, 'currency', o.currency,
    'products_cents', o.products_cents, 'shipping_cents', o.shipping_cents, 'tax_cents', o.tax_cents,
    'total_cents', o.total_cents, 'daybell_fee_bps', o.daybell_fee_bps, 'daybell_fee_cents', o.daybell_fee_cents,
    'stripe_fee_cents', o.stripe_fee_cents, 'shipping_method', o.shipping_method,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', ol.id, 'kind', ol.kind, 'name', ol.name, 'print_size', ol.print_size, 'quantity', ol.quantity,
        'unit_price_cents', ol.unit_price_cents, 'line_total_cents', ol.line_total_cents, 'photo_id', ol.photo_id,
        'job_id', ol.job_id,
        'child', (select jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name)
                  from public.children c where c.id = ol.child_id and c.studio_id = ol.studio_id),
        'contents', (select coalesce(jsonb_agg(jsonb_build_object('kind', ct.line_kind, 'print_size', ct.print_size,
                       'quantity', ct.quantity) order by ct.position), '[]'::jsonb)
                     from public.order_line_contents ct
                     where ct.order_line_id = ol.id and ct.studio_id = ol.studio_id))
        order by ol.position), '[]'::jsonb)
      from public.order_lines ol where ol.order_id = o.id and ol.studio_id = o.studio_id),
    'ship_to', (select jsonb_build_object('name', a.recipient_name, 'line1', a.line1, 'line2', a.line2,
                  'city', a.city, 'province', a.province, 'postal_code', a.postal_code, 'country', a.country)
                from public.order_shipping_addresses a where a.order_id = o.id and a.studio_id = o.studio_id))
  from public.orders o
  where o.id = p_order_id and o.studio_id = p_studio_id and o.status = 'paid';
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.guard_platform_settings(), app.check_settings_note(text), app.guard_tax_registration(),
  app.studio_collects_tax(uuid), app.guard_order(), app.guard_order_delete(), app.guard_order_line(),
  app.new_order_reference(uuid), app.daybell_fee_cents(bigint, integer), app.min_charge_cents(text),
  app.shop_order_view(public.shop_sessions, public.orders),
  app.shop_order_lines(public.shop_sessions, public.orders, text), app.order_line_downloads(public.order_lines),
  app.shop_order_child(uuid), app.checkout_unclosed(public.orders), app.clean_address_text(text, integer),
  app.claim_download_request(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on type app.checkout_facts from public;
revoke all on function
  public.platform_fee_settings(),
  public.set_platform_fee(integer, text),
  public.set_card_fee_recovery(public.card_fee_recovery, text),
  public.set_tax_head_office(uuid, uuid, text),
  public.add_tax_registration(uuid, uuid, public.tax_registration_kind, text, text, text),
  public.end_tax_registration(uuid, uuid, uuid),
  public.record_order_stripe_event(text, text, uuid, text, boolean, timestamptz),
  public.shop_checkout_begin(text),
  public.shop_checkout_attach(text, uuid, text, timestamptz),
  public.shop_pending_checkouts(text),
  public.complete_order(uuid, jsonb),
  public.expire_order(uuid),
  public.settle_order_fees(uuid, text, bigint, text, text, text),
  public.mark_card_prefix_set(text),
  public.stale_checkouts(integer),
  public.unsettled_orders(integer),
  public.shop_orders(text),
  public.shop_order(text, uuid),
  public.shop_order_verify(text, uuid),
  public.shop_download_photo(text, uuid, uuid),
  public.shop_download_request(text, uuid, uuid),
  public.order_downloads_to_make(uuid),
  public.note_checkout_failure(uuid, text, boolean),
  public.job_orders(uuid, uuid, integer, uuid),
  public.studio_order(uuid, uuid)
  from public, anon, authenticated;
-- Daybell's fee and its recovery method: the database owner only, from the SQL editor (security review S1).
revoke all on function public.set_platform_fee(integer, text),
  public.set_card_fee_recovery(public.card_fee_recovery, text)
  from service_role;
-- Parents, Stripe's webhook, owners' Stripe-first writes and the cron: the service role only (the API's routes).
grant execute on function
  public.platform_fee_settings(),
  public.set_tax_head_office(uuid, uuid, text),
  public.add_tax_registration(uuid, uuid, public.tax_registration_kind, text, text, text),
  public.end_tax_registration(uuid, uuid, uuid),
  public.record_order_stripe_event(text, text, uuid, text, boolean, timestamptz),
  public.shop_checkout_begin(text),
  public.shop_checkout_attach(text, uuid, text, timestamptz),
  public.shop_pending_checkouts(text),
  public.complete_order(uuid, jsonb),
  public.expire_order(uuid),
  public.settle_order_fees(uuid, text, bigint, text, text, text),
  public.mark_card_prefix_set(text),
  public.stale_checkouts(integer),
  public.unsettled_orders(integer),
  public.shop_orders(text),
  public.shop_order(text, uuid),
  public.shop_order_verify(text, uuid),
  public.shop_download_photo(text, uuid, uuid),
  public.shop_download_request(text, uuid, uuid),
  public.order_downloads_to_make(uuid),
  public.note_checkout_failure(uuid, text, boolean)
  to service_role;
-- Owners' and admins' reads under row-level security; the fee rate for Settings › Payouts.
grant execute on function public.job_orders(uuid, uuid, integer, uuid), public.studio_order(uuid, uuid),
  public.platform_fee_settings()
  to authenticated;

notify pgrst, 'reload schema';
