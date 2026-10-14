# Daybell's fee and card fee recovery (Phase 1 step 10)

How Seenu changes Daybell's fee rate, or how Stripe's card fee is recovered, without a deploy (ADR 0023 section 3;
D59, D98; Seenu's answer 1). Each regional database (US and Canada, D113) has its own settings, so a change is made in
each region that should have it.

## What the settings are

| Setting | Launch value | Allowed | Used by |
|---|---|---|---|
| `daybell_fee_bps` | `300` (3% of product sales) | 0 to 2000 basis points (0% to 20%; Claude's call 16) | New orders, fixed on each order when it is created |
| `card_fee_recovery` | `per_sale` | `per_sale` only until monthly recovery is built | New orders, fixed on each order |

An order keeps the rate and method it was created with, so a change never alters an order already made, paid or not.
Settings › Stripe shows owners the current rate. `DAYBELL_FEE_BASIS_POINTS` in `packages/config` is only the launch
value now; changing it does nothing to orders.

Daybell's fee is taken on products only (never shipping or tax), rounded half up to the cent:
`round(products_cents × bps / 10000)`.

## Changing the fee

Supabase › the region's project › **SQL Editor** (it runs as `postgres`). Only the database owner can run these
functions: not the service role (so no bug in the API could ever change a fee) and never signed-in users. Each change
is kept with the database role that made it (`changed_by`):

```sql
select public.set_platform_fee(350, 'Moving to 3.5% from 1 Dec, as announced on 1 Nov');
```

- The first argument is basis points: `300` is 3%, `350` is 3.5%, `0` is no fee.
- The note (1 to 200 characters, no line breaks, no leading or trailing spaces) says why. Never put a studio's or a
  person's details in it.
- It takes effect for checkouts started from then on. A checkout already open keeps its order's rate.

## Changing card fee recovery

```sql
select public.set_card_fee_recovery('per_sale', 'Why it changed');
```

Only `per_sale` is accepted for now (after each payment Daybell takes Stripe's card fee back from the studio's
transfer, ADR 0023). `monthly` is reserved for later and is refused until it is built.

## Reading the current values and the history

```sql
select public.platform_fee_settings();

select setting, old_value, new_value, note, changed_by, changed_at
from app.platform_settings_changes
order by changed_at desc;
```

The history is append-only: rows can't be changed or deleted, and the settings row can't be deleted.

## Before changing the rate in production

- Tell studios first, as their agreement requires (D59). The change doesn't announce itself.
- Make the same change in both regions, unless the difference is intended.
- Only Seenu changes production settings.
