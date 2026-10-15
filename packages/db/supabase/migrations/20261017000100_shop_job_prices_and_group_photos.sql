-- UI round 7: the parent shop sells at each job's own prices and sells group photos (D157, D156 C5; Seenu's answers of
-- Oct 14, 2026; ADR 0033, amending ADR 0022 and 0023). A forward migration after 20261017000000_job_shop.sql.
--
-- Every price the shop reads now comes from app.job_offer: the job's list items at this job's price, sold or not, and
-- the job's own products. A bag line and an order line name either a list item or a job's own product, never both.
-- A pose may be any photo the child's parents may see: their portraits, or the group photos of the groups the child is
-- in (D156: "every member can buy them"). All digitals unlocks both, portraits first (N6). A child with group photos
-- but no portrait is still unavailable (N7: app.shop_child_state is unchanged).

-- ── The bag: a list item or a job's own product ───────────────────────────────────────────────────────────────────
alter table public.shop_cart_lines
  add column job_item_id uuid,
  alter column item_id drop not null,
  alter column price_list_id drop not null,
  -- A job's product deleted leaves no line, as a list item does (shop_cart_lines_item_fk; MATCH SIMPLE: a line
  -- naming a job's product has no list item, and the other way round).
  add constraint shop_cart_lines_job_item_fk foreign key (studio_id, job_id, job_item_id, kind)
    references public.job_shop_items (studio_id, job_id, id, kind) on delete cascade,
  add constraint shop_cart_lines_one_item check (
    (item_id is null) <> (job_item_id is null) and (item_id is null) = (price_list_id is null));
-- Adding the same thing again still raises its quantity, whichever kind of item it is.
drop index public.shop_cart_lines_same_key;
create unique index shop_cart_lines_same_key on public.shop_cart_lines
  (session_id, child_id, coalesce(item_id, job_item_id), coalesce(photo_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index shop_cart_lines_job_item_idx on public.shop_cart_lines (job_item_id) where job_item_id is not null;

-- ── Orders: as sold, from a list item or a job's own product ──────────────────────────────────────────────────────
-- No key to the job's product (orders keep what they sold, ADR 0019), exactly as price_list_item_id. price_list_id is
-- the job's list at checkout either way.
alter table public.order_lines
  alter column price_list_item_id drop not null,
  add column job_item_id uuid,
  add constraint order_lines_one_item check ((price_list_item_id is null) <> (job_item_id is null));

-- ── The bag's rules, through the resolver ─────────────────────────────────────────────────────────────────────────
-- Whether a bag line can still be bought (ADR 0022 code review M2: one rule for the totals, delivery and quantities):
-- its item is sold by the job now (on the job's current list and not switched off, or the job's own product still
-- sold), its child's shop is open, and its pose (if any) is still one the child's parents may see: a portrait of the
-- child, or a group photo of a group the child is in (D156 C5). A child who leaves a group keeps the line, unavailable.
-- Callers that look at several lines resolve each job's offer once (security review L1) and pass whether the line's
-- item is offered and sold (shop_line_available_with); one line alone asks the resolver here.
create function app.shop_line_available_with(p_line public.shop_cart_lines, p_sold boolean) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(p_sold, false)
    and app.shop_child_state(p_line.child_id) = 'open'
    and (p_line.photo_id is null or exists (
      select 1 from app.parent_visible_photos(p_line.job_id, p_line.child_id, true) p
      where p.id = p_line.photo_id and p.place in ('child', 'group_photo')));
$$;

create or replace function app.shop_line_available(p_line public.shop_cart_lines) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.shop_line_available_with(p_line, exists (
    select 1 from app.job_offer(p_line.job_id) o
    where o.item_id = coalesce(p_line.item_id, p_line.job_item_id) and o.sold
      and o.source = case when p_line.item_id is null then 'job' else 'list' end));
$$;

-- Whether a bag line needs delivery: a print, or a package holding prints (a list's or the job's own).
create or replace function app.shop_line_physical(p_line public.shop_cart_lines) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_line.kind = 'print' or (p_line.kind = 'package' and (
    exists (select 1 from public.price_list_package_lines pk
            where pk.package_item_id = p_line.item_id and pk.studio_id = p_line.studio_id and pk.line_kind = 'print')
    or exists (select 1 from public.job_shop_package_lines pk
               where pk.job_item_id = p_line.job_item_id and pk.studio_id = p_line.studio_id
                 and pk.line_kind = 'print')));
$$;

-- What a child's job sells now (as in 20261012700000): the job's list (currency, home shipping fee) and every item the
-- job sells, at its price, in the screen order (app.job_offer: the list's items, then the job's own, by group), with
-- package contents. Items switched off for the job aren't offered. Nothing unless the state is open.
create or replace function public.shop_price_list(p_session_hash text, p_child_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_child public.children := app.shop_session_child(v, p_child_id);
  v_state text := app.shop_child_state(v_child.id);
begin
  if v_state <> 'open' then
    return jsonb_build_object('state', v_state);
  end if;
  return (
    select jsonb_build_object('state', v_state, 'currency', l.currency, 'home_shipping_cents', l.home_shipping_cents,
      'deliver_to_school', j.deliver_to_school,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', o.item_id, 'kind', o.kind, 'name', o.name, 'description', o.description,
            'print_size', o.print_size, 'price_cents', o.price_cents, 'contents', o.contents)
          order by o.ord)
        from app.job_offer(j.id) o where o.sold), '[]'::jsonb))
    from public.jobs j join public.price_lists l on l.id = j.price_list_id and l.studio_id = j.studio_id
    where j.id = v_child.job_id and j.studio_id = v.studio_id);
end;
$$;

-- The bag, priced now (as in 20261012700000): each line at the job's own price (app.job_offer), its item's current
-- name and size; a line whose item the job no longer sells (switched off, or off the list after a swap) keeps the
-- list item's name and price to show, marked unavailable. item_id is whichever item the line names.
create or replace function public.shop_cart(p_session_hash text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash);
  v_currency text := (select case s.data_region when 'us' then 'USD' else 'CAD' end
                      from public.studios s where s.id = v.studio_id);
begin
  return (
    with kids as (
      select sc.child_id, sc.job_id, sc.added_at
      from public.shop_session_children sc where sc.session_id = v.id and sc.studio_id = v.studio_id
    ), offers as (
      -- Each job's offer once (security review L1), not once per line.
      select x.job_id, o.item_id, o.source, o.name, o.print_size, o.price_cents, o.sold
      from (select distinct l.job_id from public.shop_cart_lines l
            where l.session_id = v.id and l.studio_id = v.studio_id) x
      cross join lateral app.job_offer(x.job_id) o
    ), lines as (
      select l.*, k.added_at, coalesce(o.name, i.name) as name, coalesce(o.print_size, i.print_size) as print_size,
        coalesce(o.price_cents, i.price_cents) as price_cents, ph.width, ph.height,
        app.shop_line_physical(l) as physical, app.shop_line_available_with(l, o.sold) as available
      from public.shop_cart_lines l
      join kids k on k.child_id = l.child_id
      left join offers o on o.job_id = l.job_id and o.item_id = coalesce(l.item_id, l.job_item_id)
        and o.source = case when l.item_id is null then 'job' else 'list' end
      left join public.price_list_items i on i.id = l.item_id and i.studio_id = l.studio_id
      left join public.photos ph on ph.id = l.photo_id and ph.studio_id = l.studio_id
      where l.session_id = v.id and l.studio_id = v.studio_id
    )
    select jsonb_build_object(
      'studio_id', v.studio_id,
      'currency', v_currency,
      'shipping_method', v.shipping_method,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', x.id, 'child_id', x.child_id, 'job_id', x.job_id, 'item_id', coalesce(x.item_id, x.job_item_id),
            'kind', x.kind, 'name', x.name, 'print_size', x.print_size, 'price_cents', x.price_cents,
            'currency', v_currency, 'quantity', x.quantity, 'photo_id', x.photo_id, 'width', x.width,
            'height', x.height, 'physical', x.physical, 'available', x.available)
          order by x.added_at, x.child_id, x.created_at, x.id)
        from lines x), '[]'::jsonb),
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object('job_id', j.id, 'deliver_to_school', j.deliver_to_school,
            'home_shipping_cents', pl.home_shipping_cents, 'currency', pl.currency) order by j.id)
        from public.jobs j join public.price_lists pl on pl.id = j.price_list_id and pl.studio_id = j.studio_id
        where j.studio_id = v.studio_id and j.id in (select x.job_id from lines x)), '[]'::jsonb)));
end;
$$;

-- Adds to the bag (as in 20261012700000): the item must be one the child's job sells now (item_unavailable: off the
-- list, switched off, or another job's product); the pose any photo the child's parents may see, a portrait or a group
-- photo of a group the child is in (photo_unavailable otherwise: another child's, another group's). The same item and
-- pose again adds to its quantity. Returns the line's id.
create or replace function public.shop_cart_add(p_session_hash text, p_child_id uuid, p_item_id uuid,
  p_photo_id uuid, p_quantity integer)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
  v_child public.children := app.shop_session_child(v, p_child_id);
  v_state text := app.shop_child_state(v_child.id);
  v_item record;
  v_list uuid;
  v_id uuid;
begin
  if p_quantity is null or p_quantity not between 1 and 99 then
    raise exception 'A quantity is 1 to 99' using errcode = '22023';
  end if;
  if v_state = 'closed' then
    raise exception 'shop_closed' using errcode = 'P0001';
  elsif v_state <> 'open' then
    raise exception 'photo_unavailable' using errcode = 'P0001';
  end if;
  select o.item_id, o.source, o.kind into v_item from app.job_offer(v_child.job_id) o
  where o.item_id = p_item_id and o.sold;
  if v_item.item_id is null then
    raise exception 'item_unavailable' using errcode = 'P0001';
  end if;
  v_list := case when v_item.source = 'list'
                 then (select j.price_list_id from public.jobs j where j.id = v_child.job_id and j.studio_id = v.studio_id)
            end;
  if (v_item.kind = 'digital_all') <> (p_photo_id is null)
     or (v_item.kind in ('digital_single', 'digital_all') and p_quantity <> 1) then
    raise exception 'A pose for everything but all digitals; digital downloads once' using errcode = '22023';
  end if;
  if p_photo_id is not null and not exists (
    select 1 from app.parent_visible_photos(v_child.job_id, v_child.id, true) p
    where p.id = p_photo_id and p.place in ('child', 'group_photo')) then
    raise exception 'photo_unavailable' using errcode = 'P0001';
  end if;
  if (select count(*) from public.shop_cart_lines l where l.session_id = v.id and l.studio_id = v.studio_id) >= 100
     and not exists (select 1 from public.shop_cart_lines l
                     where l.session_id = v.id and l.studio_id = v.studio_id and l.child_id = v_child.id
                       and coalesce(l.item_id, l.job_item_id) = v_item.item_id
                       and l.photo_id is not distinct from p_photo_id) then
    raise exception 'bag_full' using errcode = 'P0001';
  end if;
  insert into public.shop_cart_lines as l (studio_id, session_id, child_id, job_id, price_list_id, item_id,
    job_item_id, kind, photo_id, quantity)
  values (v.studio_id, v.id, v_child.id, v_child.job_id, v_list,
    case when v_item.source = 'list' then v_item.item_id end,
    case when v_item.source = 'job' then v_item.item_id end,
    v_item.kind, p_photo_id, p_quantity)
  on conflict (session_id, child_id, coalesce(item_id, job_item_id),
    coalesce(photo_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set quantity = case when l.kind in ('digital_single', 'digital_all') then 1
                                else least(l.quantity + excluded.quantity, 99) end
  returning l.id into v_id;
  return v_id;
end;
$$;

-- Changes a line's quantity (as in 20261012700000), only while it can still be bought: shop_closed, item_unavailable
-- (the job no longer sells it) or photo_unavailable.
create or replace function public.shop_cart_set_quantity(p_session_hash text, p_line_id uuid, p_quantity integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
  v_line public.shop_cart_lines;
  v_offered boolean;
begin
  select * into v_line from public.shop_cart_lines l
  where l.id = p_line_id and l.session_id = v.id and l.studio_id = v.studio_id;
  if v_line.id is null then
    raise exception 'Line not found' using errcode = 'P0002';
  end if;
  if p_quantity is null or p_quantity not between 1 and 99
     or (v_line.kind in ('digital_single', 'digital_all') and p_quantity <> 1) then
    raise exception 'A quantity is 1 to 99; a digital download once' using errcode = '22023';
  end if;
  v_offered := exists (select 1 from app.job_offer(v_line.job_id) o
                       where o.item_id = coalesce(v_line.item_id, v_line.job_item_id) and o.sold
                         and o.source = case when v_line.item_id is null then 'job' else 'list' end);
  if not app.shop_line_available_with(v_line, v_offered) then
    if app.shop_child_state(v_line.child_id) = 'closed' then
      raise exception 'shop_closed' using errcode = 'P0001';
    elsif not v_offered then
      raise exception 'item_unavailable' using errcode = 'P0001';
    end if;
    raise exception 'photo_unavailable' using errcode = 'P0001';
  end if;
  update public.shop_cart_lines l set quantity = p_quantity where l.id = v_line.id and l.studio_id = v.studio_id;
end;
$$;

-- Chooses delivery (as in 20261012700000), judging lines that can still be bought with each job's offer resolved once.
create or replace function public.shop_set_shipping(p_session_hash text, p_method public.shop_shipping_method)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.shop_sessions := app.shop_session_row(p_session_hash, true);
  v_any boolean;
  v_blocked boolean;
begin
  if p_method is null then
    raise exception 'Choose home or school' using errcode = '22023';
  end if;
  with offers as (
    select x.job_id, o.item_id, o.source, o.sold
    from (select distinct l.job_id from public.shop_cart_lines l
          where l.session_id = v.id and l.studio_id = v.studio_id) x
    cross join lateral app.job_offer(x.job_id) o
  ), lines as (
    select app.shop_line_physical(l) and app.shop_line_available_with(l, o.sold) as delivers, j.deliver_to_school
    from public.shop_cart_lines l
    join public.jobs j on j.id = l.job_id and j.studio_id = l.studio_id
    left join offers o on o.job_id = l.job_id and o.item_id = coalesce(l.item_id, l.job_item_id)
      and o.source = case when l.item_id is null then 'job' else 'list' end
    where l.session_id = v.id and l.studio_id = v.studio_id
  )
  select coalesce(bool_or(x.delivers), false), coalesce(bool_or(x.delivers and not x.deliver_to_school), false)
  into v_any, v_blocked
  from lines x;
  if p_method = 'school' and (not v_any or v_blocked) then
    raise exception 'school_delivery_off' using errcode = 'P0001';
  end if;
  update public.shop_sessions s set shipping_method = p_method where s.id = v.id and s.studio_id = v.studio_id;
end;
$$;

-- ── Checkout (as in 20261013000000, through the resolver) ─────────────────────────────────────────────────────────
-- Every line priced again at the job's own price (app.job_offer); the bag's fingerprint names the job's product when
-- a line has one; each order line copies either the list item's id or the job's product's id, and a package's
-- contents from whichever it is. Everything else is unchanged.
create or replace function public.shop_checkout_begin(p_session_hash text) returns jsonb
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
    with offers as (
      -- Each job's offer once (security review L1), not once per line.
      select x.job_id, o.item_id, o.source, o.name, o.print_size, o.price_cents, o.sold
      from (select distinct l.job_id from public.shop_cart_lines l
            where l.session_id = v.id and l.studio_id = v.studio_id) x
      cross join lateral app.job_offer(x.job_id) o
    )
    select l.id, l.child_id, l.created_at, sc.added_at,
      jsonb_build_object('cart_line_id', l.id, 'job_id', l.job_id, 'child_id', l.child_id, 'photo_id', l.photo_id,
        'price_list_id', j.price_list_id, 'item_id', l.item_id, 'job_item_id', l.job_item_id, 'kind', l.kind,
        'name', o.name, 'print_size', o.print_size, 'unit_price_cents', o.price_cents, 'quantity', l.quantity,
        'physical', app.shop_line_physical(l),
        'available', o.item_id is not null and pl.id is not null and app.shop_line_available_with(l, o.sold),
        'closed', app.shop_child_state(l.child_id) = 'closed',
        'home_shipping_cents', pl.home_shipping_cents, 'deliver_to_school', j.deliver_to_school) as line
    from public.shop_cart_lines l
    join public.shop_session_children sc on sc.session_id = l.session_id and sc.child_id = l.child_id
      and sc.studio_id = l.studio_id
    -- Left joins: a line whose item, job or list is gone is refused as unavailable, never dropped silently.
    left join public.jobs j on j.id = l.job_id and j.studio_id = l.studio_id
    left join public.price_lists pl on pl.id = j.price_list_id and pl.studio_id = j.studio_id
    left join offers o on o.job_id = l.job_id and o.item_id = coalesce(l.item_id, l.job_item_id) and o.sold
      and o.source = case when l.item_id is null then 'job' else 'list' end
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

  select o.id, o.reference, o.checkout_session_id, o.created_at into v_existing from public.orders o
  where o.studio_id = v.studio_id and o.shop_session_id = v.id and o.status = 'pending'
    and o.bag_fingerprint = v_fingerprint
    and ((o.checkout_session_id is not null and o.checkout_expires_at > now() + interval '5 minutes')
      or (o.checkout_session_id is null and o.created_at > now() - interval '45 seconds'))
  order by o.created_at desc limit 1;
  if v_existing.id is not null then
    v_order := v_existing.id;
    v_reference := v_existing.reference;
    update public.orders o set stripe_checked_at = now()
    where o.id = v_order and (o.stripe_checked_at is null or o.stripe_checked_at < now() - interval '3 seconds');
    v_check := found;
  else
    if (select count(*) from public.orders o
        where o.studio_id = v.studio_id and o.shop_session_id = v.id
          and o.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'checkout_limit' using errcode = 'P0001';
    end if;
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
      price_list_item_id, job_item_id, kind, name, print_size, unit_price_cents, quantity, line_total_cents)
    select v.studio_id, v_order, e.ordinality, (e.value ->> 'job_id')::uuid, (e.value ->> 'child_id')::uuid,
      (e.value ->> 'photo_id')::uuid, (e.value ->> 'price_list_id')::uuid, (e.value ->> 'item_id')::uuid,
      (e.value ->> 'job_item_id')::uuid,
      (e.value ->> 'kind')::public.price_item_kind, e.value ->> 'name', (e.value ->> 'print_size')::public.print_size,
      (e.value ->> 'unit_price_cents')::bigint, (e.value ->> 'quantity')::int,
      (e.value ->> 'unit_price_cents')::bigint * (e.value ->> 'quantity')::int
    from jsonb_array_elements(v_lines) with ordinality e;
    insert into public.order_line_contents (studio_id, order_line_id, position, line_kind, print_size, quantity)
    select v.studio_id, c.order_line_id, row_number() over (partition by c.order_line_id order by c.position, c.id),
      c.line_kind::public.order_line_content_kind, c.print_size, c.quantity
    from (
      select ol.id as order_line_id, pk.position, pk.id, pk.line_kind, pk.print_size, pk.quantity
      from public.order_lines ol
      join public.price_list_package_lines pk on pk.package_item_id = ol.price_list_item_id
        and pk.studio_id = ol.studio_id
      where ol.order_id = v_order and ol.studio_id = v.studio_id and ol.kind = 'package'
      union all
      select ol.id, pk.position, pk.id, pk.line_kind, pk.print_size, pk.quantity
      from public.order_lines ol
      join public.job_shop_package_lines pk on pk.job_item_id = ol.job_item_id and pk.studio_id = ol.studio_id
      where ol.order_id = v_order and ol.studio_id = v.studio_id and ol.kind = 'package') c;
  end if;

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

-- Stripe took the money (as in 20261013000000): "all digitals" is fixed to every photo the child's parents may see
-- now, their portraits first, then the group photos of their groups, each in tagging order (D156 C5, N6); the bag
-- loses what was bought, whichever kind of item each line named. Everything else is unchanged.
create or replace function public.complete_order(p_order_id uuid, p_facts jsonb) returns text
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
  select ol.studio_id, ol.id, ol.job_id, p.id,
    row_number() over (partition by ol.id order by p.place = 'group_photo', p.ord)
  from public.order_lines ol
  cross join lateral app.parent_visible_photos(ol.job_id, ol.child_id, true) p
  where ol.order_id = v_order.id and ol.studio_id = v_order.studio_id and ol.kind = 'digital_all'
    and ol.child_id is not null and ol.job_id is not null and p.place in ('child', 'group_photo');

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
    and l.child_id = ol.child_id
    and l.item_id is not distinct from ol.price_list_item_id and l.job_item_id is not distinct from ol.job_item_id
    and l.photo_id is not distinct from ol.photo_id;

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

revoke all on function app.shop_line_available_with(public.shop_cart_lines, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
