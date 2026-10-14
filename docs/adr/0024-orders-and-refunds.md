# 0024 — Orders and refunds: fulfilment, refunds at Stripe, parent cancel, zips and Home numbers

- Status: Proposed with the step 11 PR. Every choice marked "Claude's call" is provisional until Seenu reviews it
  (section 17 lists them all).
- Amends:
  - 0006: three ledger kinds (`order_refunded`, `refund_failed`, `refund_shortfall`); `ledger_transactions.refund_id`,
    unique per (order, kind) for the sale and per (refund, kind) for refunds.
  - 0021: four bell kinds (`order_paid`, `refund_failed`, `dispute_opened`, `refund_external`) pointing at an order;
    the jobs cron runs hourly on Vercel (Pro plan), the GitHub workflow is retired and the cron routes no longer accept
    `GITHUB_CRON_SECRET` (security review S2).
  - 0022: the parent's order page shows its status and tracking, Cancel order and Download all; the bag badge is right
    after paying.
  - 0023: orders get a fulfilment status; staff now read orders (Seenu's answer 4); destination C gains four events;
    downloads leave out fully refunded lines; the job's Shop tab loses its temporary orders card.
- Decisions implemented: D25, D59, D127, D96, D113, D92, D91.
- Decisions touched: D98 (the card fee isn't returned), D106, D24 (no parent accounts: the paying session cancels),
  D60, D125 (refunds and ledger never deleted), D112/D116, D75, D10.
- Inputs: the Phase 1 spec step 11, Seenu's answers 1–4 and Q1–Q6 of Oct 13, 2026, the architect's plan (Q7–Q19 "as
  recommended"), the step 11 code and security reviews and the orchestrator's decisions on them (section 18), and
  stripe-node 22.6.2's type definitions.

## Context

The spec: "an Orders list and order page; statuses Paid, Printed, Shipped (with tracking) or Delivered to school; full
and partial refunds that return Daybell's fee and write ledger entries; Home numbers show real sales". Done when a
studio "marks one order printed and shipped with tracking, another delivered to school, and refunds part of one", and
"sees the sale on Home, the bell notification, the ledger entries and the payout pending in Stripe".

## 1. Seenu's answers (Oct 13, 2026)

1. On a refund the studio bears Stripe's card fee (Stripe keeps it). Daybell's fee on the refunded products goes back to
   the studio, pro rata, at the rate recorded on the order.
2. A parent can cancel from the order page for a full automatic refund until the order is Printed.
3. Owners and admins refund.
4. Owners, admins and staff mark orders Printed, Shipped or Delivered to school. Photographers can't (prices aren't
   their business, as in GotPhoto).
- Q1: Daybell sets exact amounts: refund the parent with **no flags**, then one transfer reversal of G−a (Claude's call
  on the mechanism).
- Q2: a shortfall is a studio receivable, recovered by an extra transfer reversal from the studio's next settled sale;
  Daybell absorbs it after 180 days without one (section 6: the clock restarts at each settled sale).
- The address purge's hard cap is **365 days** after payment (Seenu).
- Q3: a custom amount is products before tax; tax is added pro rata; it changes no quantities or downloads.
- Q4: staff see orders, their totals and fees; never Home money, the ledger or refunds.
- Q5: only the session that paid can cancel. Q6: digital-only orders can't be canceled by the parent (they ask the
  studio); mixed orders can until Printed.

## 2. Stripe facts

Checked in stripe-node 22.6.2's types: `refunds.create` takes `payment_intent`, `amount`, `metadata`, `reason`
(`duplicate`, `fraudulent`, `requested_by_customer`); a Refund has `status` (pending, requires_action, succeeded,
failed, canceled) and `failure_reason`; `transfers.createReversal(id, {amount, metadata})`; the events
`charge.refunded`, `refund.updated`, `refund.failed`, `charge.dispute.created`.

Why not Stripe's flags: `refund_application_fee` refunds the fee in proportion to the **gross** refunded (Daybell's fee
is on products only), and `reverse_transfer` reverses in proportion to the amount refunded, colliding with step 10's
card-fee reversal (the transfer no longer holds T). On the step 10 order (products 10,000, shipping 1,195, tax 1,455,
T 12,650, Daybell's fee D 300, Stripe's fee F 397) a full refund needs T−D = 12,350 back from the studio, but only
T−F = 12,253 is left on the transfer: a shortfall of F−D = 97 on almost every full refund.

Not checked (to confirm on staging): whether Stripe Tax records a Checkout refund's tax reversal by itself or Daybell
must call `tax.transactions.createReversal`; whether a reversal can take a connected balance negative; whether account
debits work for v2 Express accounts in Canada; Stripe's refund time limit; the carriers' tracking URLs
(`CARRIER_TRACKING_URLS_CONFIRMED = false` in `packages/config/src/carriers.ts`); that a concurrent request with the
same idempotency key is a 409 `idempotency_key_in_use` sent as an `invalid_request_error` (Daybell treats any 409, or
that code, as "may have happened"); that `transfers.create` to a v2 Express connected account in Canada works for
sending a failed refund's share back (section 5), and `transfers.list` by `transfer_group`.

## 3. Fulfilment

`orders.fulfilment_status`: paid → printed → shipped (home delivery, carrier and tracking number required) or
delivered (school delivery); `complete` at payment when no line is physical; `canceled` by the parent's cancel. A
trigger guards every move; undo goes back one step with a reason (owner or admin; `marked_by_mistake`,
`reprint_needed`, `wrong_tracking`, `other`). Bulk Mark printed / Mark delivered to school takes up to 100 orders and
answers each one's result. A refund Stripe hasn't accepted blocks Printed (`refund_in_flight`), and so does a refund
made outside Daybell until an owner or admin marks it checked (`external_refund`, section 13). Tracking: Canada Post,
Purolator, UPS, FedEx or Other (with an optional https link); the number is normalized and the link built from the
carrier's template. The parent sees the tracking only on the session that paid (security review B1): another household
holding the same access code sees the order, never where its parcel goes.

## 4. Refund mechanics (Q1, Q3)

The split (`app.refund_split`, mirrored by core `refundSplit` for the dialog's live summary):

- products p = unit price × quantity per line, or the custom pre-tax amount; shipping s = all remaining shipping or 0;
- tax x = round_half_up(tax × (p+s) / (products+shipping)); gross G = p+s+x;
- Daybell's fee returned a = round_half_up(p × bps / 10,000);
- each part is capped by what is left; the refund that empties the order takes the exact remainders.

Stripe calls, resumable from any step (`runRefund`, used by the route, the parent's cancel, the webhook and the cron):

1. `refunds.create({payment_intent, amount: G, metadata: ids only, reason})`, key `daybell-refund-{id}`, no
   `reverse_transfer`, no `refund_application_fee`, never `fraudulent`. A refund an earlier try made is found first by
   its metadata (keys expire after 24 hours). `reason`: `requested_by_customer` for a parent's cancel or "The parent
   asked", `duplicate` for "Duplicate order", none otherwise.
2. `transfers.createReversal(transfer, {amount: min(G−a, remaining)})`, key `daybell-refund-reversal-{id}`, where
   remaining = the transfer's amount − `amount_reversed`, read from Stripe. `unrecovered_cents` = (G−a) − reversed.
   An earlier reversal for the refund is always looked up by its metadata **before** the remaining amount is read
   (code review B1): a first try may have emptied the transfer and lost its answer, and must never turn the whole share
   into a shortfall.

Stripe refusing a refund outright (`invalid_request_error`) cancels it only after the payment's refunds are listed
again and none carries this refund's id (security review S1); a 409 is never a refusal. A Stripe refund whose Daybell
refund was already given up is a permanent problem for support, alerted, and flags the order like an outside refund.

Refunds wait until the order's fees are settled (409, Retry-After 30). A refund not yet accepted already counts against
what is left, so two quick refunds can't give back more than was paid (the order page offers Refund again once it is
accepted). The request carries an id made when the dialog opens, unique per studio, so a double tap is one refund;
after a refusal the next try gets a new id (code review N2). A request id equal to an order's id is refused. By item
with no items but the shipping is a shipping-only refund (code review S5).

## 5. The ledger (ADR 0006)

One balanced `order_refunded` transaction per refund, written when Stripe accepts it (positive is a debit):

| Account | Amount |
|---|---|
| `refunds` | −G |
| `tax_payable` | +x |
| `daybell_fees` | +a |
| `studio_payable` | +(G−x−a) |

Zero lines are left out. Worked example on the step 10 order: refund 1 (one print at 2,000): −2,260 / +260 / +60 /
+1,940, reversal 2,200. The cancel of the rest: −10,390 / +1,195 / +240 / +8,955; reversal needed 10,150, remaining
10,053, shortfall 97. Across the order `studio_payable` ends at +397 = F: the studio bore the card fee (answer 1).

A refund Stripe accepted and then failed gets a mirroring `refund_failed` transaction (every amount × −1), rings owners'
and admins' bell, and frees what it held. What the studio had already given back for it (its reversal and any shortfall
recovered from later sales) is sent back to its account by a transfer (Q7): `transfers.create` with the key
`daybell-refund-return-{refund}` and transfer group of the same name (an earlier one is found by it first), recorded
once on the refund (`returned_cents`, `stripe_return_transfer_id`; event `order.refund_share_returned`), retried by the
cron. That transfer writes no ledger transaction of its own: the ledger records what is owed, and the `refund_failed`
mirror already gives the studio its share back; the transfer settles it, as the sale's transfer and the reversals do
(none of which are journalled, ADR 0006 and 0023). A shortfall Daybell absorbs writes `refund_shortfall`:
`studio_payable` −U, `daybell_fees` +U.

## 6. Shortfalls (Q2)

`order_refund_recoveries` records each extra reversal (`daybell-shortfall-{refund}-{sale}` key) taken from a newly
settled sale's transfer, oldest shortfall first, as far as the transfer goes; an earlier recovery from the same sale is
found first, even when it emptied the transfer (code review B1). Recovery runs right after a sale settles and in the
hourly cron (`refund_shortfalls_due`, each sale once). Daybell absorbs what is left only after **180 days without a
settled sale**: the clock starts at the refund and restarts at each of the studio's later settled sales (Q2 as written;
code review S2). A refund with a problem set is never absorbed (support looks first).

## 7. Parent cancel (answer 2, Q5, Q6)

"Cancel order" on the parent's order page while the order is Paid, has a physical line and its fees are settled, with
a confirm step. Only the session that paid. Every try counts against 5 a session an hour (`cancel_limit`), a repeat
included (security review S3). A full refund including shipping; on acceptance the order is Canceled
(`order.canceled`). While a cancel is live the same cancel is answered, and Stripe is asked again only if it has waited
30 seconds (the cron finishes it otherwise). Each try has its own request id, never the order's: after a cancel failed
(the order is Paid again) or Stripe refused it, the parent may cancel again as a new refund (code review S1).

## 8. Downloads and zips

Fully refunded lines lose their downloads; custom refunds change nothing. Zips stream from `yul1` out of
`ca-central-1` (D113), one file at a time, in store mode (`archiver` 7.0.1), read with the download role:

- parent's **Download all**: `daybell-{reference}.zip`, entries named as single downloads;
- studio's **print files** (owner, admin, staff): `daybell-{reference}-print-files.zip` with
  `{reference}-{position}-{size}-x{quantity}.jpg` and a `manifest.csv` with no names (formula-guarded cells).

Every file must exist first: a missing one is queued and the request answered 409 with Retry-After, never a partial
zip. At most 500 files; 10 zips a session or person an hour and 20 an order an hour across every session and person
(security review S4), counted only when a zip is streamed, never on a 409 (code review N1); `maxDuration` 300;
`no-store`. A browser that goes away (the request's signal, or the stream cancelled) aborts the archive and destroys the
file being read, so no storage stream is held open.

## 9. Roles (answers 3, 4; Q4)

| | Owner, admin | Staff | Photographer |
|---|---|---|---|
| Orders list and order page (totals, fees, address) | yes | yes | no |
| Mark printed, shipped, delivered; tracking; bulk; print files | yes | yes | no |
| Undo a step | yes | no | no |
| Refunds, refund history, ledger | yes | no | no |
| Home's money | yes | no (To do only) | no |

## 10. Home (D127)

Today, this week (from Monday) and this season (from August 1), in the browser's time zone: sales after refunds,
Daybell's fee and the average order from the ledger, and orders counted when they were paid (a sale whose Stripe fee
comes late counts at once; code review N5), in the region's currency. "Families ordered" is dropped. To do: orders to
print, to ship and to take to school, each linked to the list filtered by status and delivery; filtered by Paid or
Printed the list leaves out fully refunded orders, so it shows what the count counts (code review N3).

## 11. Bell, activity and events (D96)

Bell: `order_paid` (owner, admin, staff), `refund_failed`, `dispute_opened` and `refund_external` (owner, admin).
Activity: order paid, printed, shipped, delivered, refunded, canceled. Events through the outbox: `order.paid`,
`order.printed`, `order.shipped` (carrier only), `order.delivered`, `order.tracking_changed`, `order.status_reverted`,
`order.refunded` (kind, reason, line count, full), `order.refund_settled`, `order.refund_failed`,
`order.refund_share_returned`, `order.canceled`, `order.dispute_opened`, `order.external_refund`,
`order.external_refund_checked`, `order.shortfall_recovered`, `order.shortfall_absorbed`, `order.address_purged`. Never
amounts, names, emails, codes, addresses or tracking numbers (pgTAP checks).

## 12. Address purge (step 10's launch blocker)

A home delivery address is deleted 90 days after shipping; 90 days after payment when the order was canceled or fully
refunded without shipping; and at most **365 days** after payment whatever happened (the hard cap, Seenu). The tracking
number and link go with it (they lead to the address; code review B2); the carrier stays. The order keeps
`ship_to_purged_at`; the studio sees "Address removed", and tracking can't be put back. Stripe keeps its own copy of the
Checkout shipping details under its retention.

## 13. Webhook (destination C)

`charge.refunded`, `refund.updated`, `refund.failed`, `charge.dispute.created`: ids checked, region asserted before any
Stripe call, the refund or dispute read again from Stripe, the order found from the payment's metadata, recorded once
(`record_payment_stripe_event`). A dispute only flags the order. A refund made outside Daybell (the Stripe Dashboard)
is kept as the permanent problem `external_refund`, alerted, and flags the order (`orders.external_refund_at`, once):
the order page says so, owners' and admins' bell rings (`refund_external`), and Printed, Shipped and Delivered are
refused until an owner or admin marks it checked (`POST /orders/{id}/external-refund/checked`; security review S5).
Daybell's books don't include such a refund; the banner says so. Every destination's URL is exactly
`https://daybell.vercel.app/api/v1/webhooks/stripe`, no bypass parameter (docs/stripe-staging.md).

## 14. Cron

The jobs cron is hourly on Vercel (`7 * * * *`; Pro plan) and `.github/workflows/jobs-cron.yml` is removed. It adds the
address purge, refund retries (including sending a failed refund's share back) and shortfall recovery and absorption;
the response adds `retriedRefunds`, `purgedAddresses` and `absorbedShortfalls` (docs/crons.md). Since it moves money,
it accepts Vercel's `CRON_SECRET` only: the `GITHUB_CRON_SECRET` branch is removed from the code and the config schema
(security review S2), and Seenu deletes the stored copies (docs/crons.md).

## 15. Tests

Core (split rounding and remainders, balanced ledger, transitions, tracking, sales ranges across DST, zip names);
pgTAP 024 (230: RLS and grants, transitions and refusals, roles, refund idempotency, over-refund, fees pending,
remainders, ledger, failures and the share sent back, cancel rules and retries, the cancel limit on repeats, request
ids, shipping-only refunds, downloads after refunds, the purge at 89 and 91 days and the 365-day cap with tracking
cleared, tracking for the paying session only, outside refunds, shortfall absorption without a sale, zip limits per
session and order, bell audiences, events without personal data, cross-studio and cross-session leaks) and 025 (CAD
only); routes (refund parameters, reversal cap and shortfall, resume after a lost write, refusals listed again, 409s,
webhook types, zips and disconnects, cron, roles, cancel repeats, outside refunds); screens (list, badges, delivery
filter, bulk selection, refund dialog including shipping-only and new ids, cancel, tracking, the bag refresh, Home for
staff, fulfilment blocked by an outside refund); e2e desktop and phone (CI).

## 16. Deviations from the architect's plan

- `address_purged_at` is named `ship_to_purged_at`: step 10's privacy test refuses any column named like an address.
- Refund tables are readable by owners and admins only (Q4 over the plan's "the same as orders").
- Two more tables: `order_refund_recoveries` (Q2's extra reversals) and `order_action_attempts` (cancel and zip
  limits).
- More functions than listed: `shop_download_all_request`, `refund_by_stripe`, `refund_settled`, `refund_abandoned`,
  `refund_shortfalls_for_sale`, `refund_shortfall_recovered`, `refund_shortfalls_due`, `absorb_refund_shortfalls`,
  `app.emit_as`.
- Ledger transactions and entries carry their ids in the order's API (stable row keys).
- After the reviews (section 18): `order_external_refund`, `check_external_refund`, `refund_share_returned`,
  `shop_zip_take` and `order_zip_take`; orders gain `external_refund_at` and `external_refund_checked_at`, refunds
  `returned_cents`, `stripe_return_transfer_id` and `returned_at`; `studio_orders` gains a delivery filter.

## 17. Claude's calls, Seenu to review

- The week starts on Monday; the season starts on August 1.
- A refund made outside Daybell is flagged once per order; once checked, a later one on the same order isn't flagged
  again (it is still kept as the order's problem and alerted).
- "Duplicate order" is sent to Stripe as `duplicate`.
- The refund mechanism of Q1 (no flags, one reversal of G−a).

## Rejected

- Stripe's `reverse_transfer` and `refund_application_fee` (section 2).
- Account debits for shortfalls (unverified for v2 Express accounts in Canada).
- Free-text refund reasons (personal data).
- Searching orders by name (never names in URLs).

## Follow-ups

- Confirm Stripe Tax's handling of refunds, the carriers' tracking URLs and the share-return transfer on staging.
- Download all buffers the zip in the browser before saving (a blob); a direct link would stream to disk.
- `next` 16.3.8 (security advisories in 16.3.6), in its own PR once it is two weeks old (Oct 14).

## Launch to-dos

- **A separate production project before launch.** Staging is Vercel's Production environment (`main`, at
  `https://daybell.vercel.app`), so the guard that refuses a live Stripe key outside `VERCEL_ENV=production` doesn't
  separate staging from production: staging would accept a live key. Until a real production project exists, staging
  keeps test keys by process only (code review S3; security review note 6). Test and live must never share a
  deployment's database, keys or webhook secrets.

## 18. Review fixes (Oct 13)

Code review: B1 (an earlier reversal found before the remaining amount is read, refunds and shortfalls), B2 (the purge
cap is 365 days; tracking cleared with the address), S1 (each cancel try its own refund; a parent may cancel again
after a failed or refused one), S2 (absorption after 180 days without a settled sale; never with a problem), S3
(staging's Vercel scope and the live-key guard: docs/stripe-staging.md and the launch to-do above), S4 (typed screen
fixtures; the no-badge case tested), S5 (shipping-only refunds by item), N1 (a 409 never counts against the zip
limit), N2 (a new request id after a refusal), N3 (To do links filter by delivery and match their counts), N5 (orders
counted when paid), and the orchestrator's Q7 (a failed refund's share sent back). Security review: B1 (tracking for the
paying session only), S1 (a refusal believed only after the refunds are listed again; a 409 is never a refusal; a
Stripe refund of a refund given up is alerted), S2 (`GITHUB_CRON_SECRET` removed), S3 (cancel repeats counted and
not sent to Stripe while fresh), S4 (20 zips an order an hour; zips stop when the browser goes away), S5 (refunds made
outside Daybell flag the order, ring the bell and stop fulfilment until checked), note 4 (an order's id refused as a
request id). Left as they are, as decided: N4, N6, the staff refund badge (staff must know not to ship refunded items)
and `next` 16.3.8 (a follow-up).

## 19. Times in the viewer's time zone (Oct 13)

Staging showed a 12:03 PM Vancouver payment as "Oct 13, 2026, 7:03 PM" and a refund made on Oct 13 local as Oct 14:
next-intl has no time zone in the app's config, so `format.dateTime` used the server's (UTC). Moments are now formatted
in the browser's zone by `app/_components/local-time.tsx` (D91, D96): `<LocalTime value />` renders a
`<time dateTime>` for table cells (the ledger, the refunds table, the orders list), and `useLocalDateTime()` formats
dates inside sentences (the order page's paid, canceled, disputed, outside-refund and address-removed dates; the
shop's Your orders; Home's "since"; the review sets; team invitations' expiry; job closing moments). The zone comes from
`useSyncExternalStore` with no server value, so the server and the hydrating render show no time (the same on both, no
hydration mismatch) and the browser fills it in at once; these screens load their data in the browser anyway. Home's
`?tz=` uses the same `viewerTimeZone()`. Calendar dates (picture day, the last day to order, a photo's capture time)
keep `timeZone: "UTC"`. The activity log shows relative times ("2 hours ago"), which don't depend on the zone. No new
dependency.
