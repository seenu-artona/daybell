# 0023 — Checkout: orders, Stripe's hosted checkout, fees, tax and downloads

- Status: Proposed with the step 10 PR. Every choice marked "Claude's call, Seenu to review" is provisional until Seenu
  reviews it (section 17 lists them all).
- Amends:
  - 0006: ledger transactions get a header table (`ledger_transactions`, once per order and kind) and a sign convention.
  - 0016: a fifth stored file per photo, `download.jpg`, made by the image worker; a separate AWS role signs it.
    `photos.sold_at` is now set.
  - 0019: orders copy what they sell (the snapshot is built).
  - 0020: a third webhook destination (the platform's own checkout events), two more inbox types, up to six signing
    secrets, and Daybell's fee rate moves into the database.
  - 0022: the bag gets Pay; a closed child's paid orders are still reachable; "Your orders".
- Decisions implemented: D59, D96, D97, D98, D104, D106, D24, D113, D92, D91, D112.
- Decisions touched: D60 (full resolution only after payment), D85 (archiving vs downloads), D125 (money records kept 7
  years), D56 (payout fees still not charged here), D116 (charcoal), D127 (Home's sales numbers, step 11), D75 (the
  first-order celebration, follow-up), D143 (payouts must be Active), D10.
- Inputs: the Phase 1 spec step 10, Seenu's answers 1–4 of Oct 13, 2026, the architect's plan and its 20 questions,
  Claude's calls 1–20 on them (Oct 13), and stripe-node 22.6.2's type definitions.

## Context

The spec: "Stripe hosted checkout with the studio's branding and Stripe Tax; Canadian charges made on behalf of the
studio; Stripe events queued with duplicate protection; ledger entries for sale, tax, Daybell's 3% and Stripe fees;
confirmation page with download buttons; downloads also found by re-entering the code". Phase 1's goal: a parent "buys
a package, a print and a download, and pays with a test card".

## 1. Seenu's answers (Oct 13, 2026)

1. **Daybell's fee is a setting**, not code: basis points per regional database (300 = 3%), changed by Seenu with SQL
   (`docs/platform-fee.md`); each order records the rate it used and never changes. Stripe's card fee is recovered
   from each sale; the recovery method is a setting too (per sale now, monthly later). The studio sees both.
2. **Tax with Stripe Tax using the studio's registrations**: GST/HST and PST numbers in Settings; no registration
   means no tax (small supplier). **Needs a tax-adviser check before real launch.**
3. **Cards, Apple Pay and Google Pay.** Klarna later.
4. **Stripe sends the receipt email**, studio-branded. The order page shows the downloads. No Daybell emails yet.

## 2. Stripe facts: checked and not checked

docs.stripe.com could not be fetched from here. Every parameter Daybell sends is typed with stripe-node 22.6.2's own
types (`Stripe.Checkout.SessionCreateParams` and the resource methods' params), so **the compiler checks each field
name and value against that version** ("types" below). Behaviour the types can't show is **unverified**, with the
page to check before staging is trusted:

| Fact | Status | Where to check |
|---|---|---|
| Checkout create takes `ui_mode: "hosted_page"`, `wallet_options.link.display: "never"`, `automatic_tax.liability {type: "account", account}`, `branding_settings {display_name, button_color}`, `custom_text.submit.message`, `payment_intent_data {on_behalf_of, transfer_data.destination, application_fee_amount, statement_descriptor_suffix, description, metadata}`, `shipping_address_collection`, `shipping_options[].shipping_rate_data` with `tax_behavior` and `tax_code`, `line_items[].price_data.product_data.tax_code`, `customer_creation`, `expires_at` | types | — |
| `expires_at` is 30 minutes to 24 hours after creation | types (JSDoc) | — |
| `statement_descriptor_suffix` is joined to the account's statement descriptor prefix | types (JSDoc) | https://docs.stripe.com/get-started/account/statement-descriptors |
| The session reads: `amount_subtotal` (items before tax), `shipping_cost.amount_subtotal` (shipping before tax), `total_details.amount_tax`, `amount_total`, `collected_information.shipping_details`, `customer_details.email`, `payment_intent` expandable to `latest_charge.balance_transaction` | types | — |
| `transfers.createReversal`/`listReversals`, `paymentIntents.update {receipt_email}`, `accounts.update {settings.card_payments.statement_descriptor_prefix}`, `tax.settings.update {head_office.address}`, `tax.registrations.create` (CA `standard` and `province_standard {province}`), `tax.registrations.update {expires_at: "now"}` | types | — |
| With `on_behalf_of` the studio is the merchant of record, settles in CAD and its statement descriptor, branding and receipts settings apply | **unverified** | https://docs.stripe.com/connect/destination-charges |
| Stripe's processing fee for a destination charge is on the platform's balance transaction for the charge | **unverified** | https://docs.stripe.com/payments/balance-transactions |
| A partial reversal of a destination charge's transfer recovers the fee from the studio, even when it takes the studio's balance negative (Daybell carries losses, ADR 0020) | **unverified** | https://docs.stripe.com/connect/destination-charges#transfer-reversals |
| `automatic_tax.liability` of the studio's account uses its registrations and head office; with none, Stripe Tax stays "pending" | **unverified** | https://docs.stripe.com/tax/connect |
| Canadian registration types and the province codes Stripe takes (BC, MB, SK) | **unverified** | https://docs.stripe.com/tax/registering |
| Stripe Tax's per-transaction charge is billed to the platform (Daybell absorbs it for now, call 1) | **unverified** | https://docs.stripe.com/tax/pricing |
| Apple Pay and Google Pay appear under `card` on hosted Checkout once on in the Dashboard | **unverified** | https://docs.stripe.com/apple-pay, https://docs.stripe.com/google-pay |
| Setting `receipt_email` after payment sends the receipt, with the studio's branding under `on_behalf_of` | **unverified** | https://docs.stripe.com/receipts |
| Checkout collects the billing address Stripe Tax needs by itself (`billing_address_collection` left at its default) | **unverified** | https://docs.stripe.com/tax/checkout |
| Descriptor rules: prefix plus suffix fit 22 characters; Latin letters, digits and spaces; no `< > \ ' " *` | **unverified** | https://docs.stripe.com/get-started/account/statement-descriptors |
| v1 `accounts.update` of a v2 account's card prefix applies to the v2 account | **unverified** | https://docs.stripe.com/connect/accounts-v2 |
| The `Stripe-Context` header (stripe-node's `stripeContext`) acts on the connected account for v1 Tax endpoints (payouts use it already) | **unverified** | https://docs.stripe.com/connect/authentication |
| `branding_settings.display_name` takes a 120-character studio name; `button_color` a hex colour | **unverified** | https://docs.stripe.com/payments/checkout/customization |
| C$0.50 / US$0.50 is the smallest charge | **unverified** | https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts |
| The tax codes in `packages/config/src/tax-codes.ts` exist and mean what their names say | **unverified** (and an adviser's call) | https://docs.stripe.com/tax/tax-codes |
| Checkout's events are the platform's own (no `account`), on a "Your account" snapshot destination; Stripe retries for about 3 days | **unverified** | https://docs.stripe.com/webhooks |

## 3. Platform settings (answer 1)

- `app.platform_settings`, one row per regional database (in the `app` schema: the Data API can't reach it):
  `daybell_fee_bps` (0–2000; call 16) and `card_fee_recovery` (`per_sale` only until monthly recovery is built).
- `app.platform_settings_changes`: every change with its old and new value and a note. Append-only.
- `set_platform_fee(bps, note)` and `set_card_fee_recovery(method, note)`: service role and the database owner only.
  Runbook: `docs/platform-fee.md`. `platform_fee_settings()` reads the current values (Settings › Payouts shows the
  rate from it; `packages/config` `DAYBELL_FEE_BASIS_POINTS` is only the launch value now).

## 4. Data model (forward migration `20261013000000_checkout.sql`)

- `orders`: the snapshot's totals (`products_cents`, `shipping_cents`), `tax_cents` and `total_cents` once paid,
  Daybell's fee (`daybell_fee_bps` and `daybell_fee_cents`, fixed at creation), `card_fee_recovery`, `stripe_fee_cents`
  once known, `tax_enabled`, the destination (`payout_account_id`, `stripe_account_id`), Stripe ids only, the bag's
  fingerprint, `reference` (8 Crockford base32 characters), the parent's `shop_session_id` (set null when the session
  is pruned; browsers can't read the column). Status `pending → paid | expired | failed`, and `expired → paid` when
  Stripe took the money for a checkout Daybell had replaced (Stripe is the truth). A guard keeps the snapshot, the fee
  and the destination fixed and writes each Stripe id and paid amount once. Never deleted (D125).
- `order_lines` (as sold: kind, name, size, price, quantity, child, pose, job, list and item ids, no FK to the list),
  `order_line_contents` (a package's contents), `order_line_photos` ("all digitals", fixed at payment; call 9).
  A child, photo or job erased later leaves a null, never blocks erasure.
- `order_shipping_addresses`: home delivery's recipient (call 2), owners and admins only.
- `ledger_transactions`: `unique (order_id, kind)`.
- `studio_tax_settings` (the head office's province and when it was set) and `studio_tax_registrations` (kind,
  province, the number as typed, Stripe's id; one active per kind and province).
- `payout_accounts.card_prefix_set_at`.
- Row-level security on every new table: owners and admins read (call 15); nobody signed in writes. Everything else
  goes through SECURITY DEFINER functions with an empty `search_path`, granted to the service role only:
  `shop_checkout_begin`, `shop_checkout_attach`, `shop_pending_checkouts`, `complete_order`, `expire_order`,
  `settle_order_fees`, `record_order_stripe_event`, `shop_orders`, `shop_order`, `shop_order_verify`,
  `shop_download_photo`, `stale_checkouts`, `unsettled_orders`, `mark_card_prefix_set`, the tax functions
  (`act_for_owner`) and the platform settings. `job_orders` and `studio_order` are SECURITY INVOKER (row-level security
  decides).

## 5. Starting checkout (`POST /api/v1/shop/checkout`)

1. Montréal only (`assertFunctionRegion`), payout regions only (`assertPayoutRegion`: US refused), the shop's request
   budget. No body: the bag is priced by the database.
2. `shop_checkout_begin` locks the session, prices every line from its job's current list with the bag's own rules,
   and refuses with `bag_empty`, `shop_closed`, `line_unavailable`, `choose_delivery`, `not_accepting` (payouts not
   Active with card payments on), `below_minimum` (call 13), or `checkout_limit` (10 new checkouts a session an hour,
   429). Delivery follows ADR 0022's rule.
3. **Reuse and supersede.** The same bag (same fingerprint: lines, prices, delivery, destination, fee rate, tax on)
   reuses its pending order while Stripe's checkout is open for 5 more minutes, or, if no checkout was saved, for a
   minute (a retry). Otherwise the session's other pending orders expire and their Stripe checkouts are handed back:
   the API expires each at Stripe **before** making the new one, and one Stripe says was paid becomes the parent's order
   (409 `shop.alreadyPaid` with `fields.orderId`). Two open checkouts for one bag are never both payable.
4. The card prefix "DBL" is set on the studio's account at its first checkout (call 7); a failure never stops a parent.
5. Stripe's checkout is created with the key `daybell-checkout-{order}`. Its expiry is fixed from the order's creation
   (31 minutes after), so a retried create sends the same parameters (Stripe refuses a reused key with others).
6. `shop_checkout_attach` saves it; the URL is checked (`checkout.stripe.com/` for the real driver, this deployment's
   fake page for the fake) and answered. The page goes there.
7. `POST /api/v1/shop/checkout/cancel` (back from Stripe without paying): every open checkout of the gallery is expired
   at Stripe and here; one paid meanwhile is completed instead.

## 6. Session parameters (`apps/web/lib/checkout/stripe-params.ts`)

Payment mode, hosted page, `locale: auto`, cards only (wallets through them), Link never (call 19), no customer (D24),
`expires_at` as above, `client_reference_id` and metadata = Daybell's ids (order, studio, region). Lines: the item's
name, price before tax (`tax_behavior: exclusive`), quantity, a tax code per kind. Home delivery: Canadian addresses
and one fixed shipping rate named from the locale file. Stripe Tax on with the studio liable only with a registration
and a head office. `payment_intent_data`: `on_behalf_of` and destination = the studio (D106), the application fee =
Daybell's fee (call 1), description and `custom_text.submit.message` = "Payments processed by Daybell for {studio}"
(D104), the statement suffix from the studio's name (`statementSuffix`: capitals, digits and spaces, at a word, to fit
22 with "DBL* "). Branding: the studio's name and the charcoal button from the design tokens (call 8). Never a child's
name, a photo, an email or anything the browser sent.

## 7. Completing (`apps/web/lib/checkout/complete.ts`)

One function for the webhook, the confirmation page and the cron:
1. Read the checkout from Stripe with `payment_intent.latest_charge.balance_transaction` expanded.
2. Complete and paid: `complete_order` checks Stripe's answer against the snapshot (the checkout, mode, currency,
   subtotal, shipping, tax only with Stripe Tax on, total = subtotal + shipping + tax, destination, application fee, a
   Canadian recipient for home delivery). A mismatch raises `checkout_mismatch` and changes nothing. Otherwise: paid,
   the recipient kept (home), "all digitals" fixed, every photo sold marked (`sold_at`: can't be binned), the bag's
   bought lines removed, one `order.paid` event with no actor. Again: `already_paid`, or `already_settled`.
3. The first time only, `receipt_email` is set on the payment from the email the parent typed at Stripe (call 18),
   held in memory for that call only. A failure is logged by name; the order is paid either way.
4. Once the balance transaction exists: Stripe's fee is reversed from the studio's transfer (once per order: an
   earlier reversal is found by its metadata, the key is `daybell-fee-recovery-{order}`), then `settle_order_fees`
   writes the ledger (section 8). Until then the order is paid with its fees pending.

**Webhook, platform branch** (`stripe-webhook.ts`): a snapshot event with no `account` whose type is
`checkout.session.completed` or `.expired`. Signature, mode, ids and time checked; `assertPayoutFunctionRegion` before
any Stripe call (D113); the checkout read again; routed by its metadata's region; a checkout without Daybell's order id
is acknowledged and left alone; `record_order_stripe_event` records it once for the order Stripe names (attaching a
checkout the API hadn't saved yet; 404 for an order this database doesn't hold); the metadata's studio must be the
order's. Fee pending is retried (500); a mismatch is permanent (200, `stripe_webhook_permanent_failure`); expired
expires the order.

**Confirmation page** (`GET /api/v1/shop/orders/{id}`): for the gallery's own pending order, asks Stripe at most every
5 seconds (`shop_order_verify` stamps the time), so the page is right when the webhook is late.

**Cron backstop** (`/api/v1/internal/cron/jobs`, payout regions with Stripe set up): paid orders unsettled after 10
minutes are completed again; checkouts that ran out two hours ago are expired after asking Stripe.

## 8. Fees and the ledger (call 1; ADR 0006)

- **Card fee recovery, option B (call 1):** the application fee is Daybell's % only; once Stripe's fee is known it is
  recovered exactly with a partial transfer reversal. The studio sees Daybell's fee and the card fee on the order.
  Stripe Tax's per-transaction charge is absorbed by Daybell for now (flagged).
- **Sign convention:** positive is a debit (money in hand or receivable), negative a credit (owed or earned).
- One transaction per paid order, written with Stripe's fee: `parent_payments +total`, `tax_payable −tax`,
  `daybell_fees −fee`, `payment_fees −Stripe's fee`, `studio_payable −(total − tax − fee − Stripe's fee)`, zero lines
  left out, in the order's (the region's) currency. Example: products 10,000, shipping 1,195, HST 1,455, total 12,650,
  3% is 300, Stripe's fee 397: +12,650, −1,455, −300, −397, −10,498. What reaches the studio's balance is
  total − 3% − Stripe's fee = 11,953 (tax included: the studio remits it). `packages/core` `orderLedger` and
  `studioReceivesCents` pin the identity.
- Daybell's fee is `round_half_up(products × bps / 10000)` (call 16), the same in SQL and TypeScript.
- **No FK from `ledger_entries.transaction_id` to the header** (deviation from the plan): the step 5 test inserts
  header-less transactions, and later non-order money movements may too. The header and its entries are written by one
  function in one statement, and pgTAP checks them together.

## 9. Tax (answer 2; calls 3–6)

- Settings › Taxes (owners and admins read; the owner changes, call 6): the business address goes to Stripe as the tax
  head office (`tax.settings.update`, in the studio's account; call 3); Daybell keeps its province only. Then GST/HST
  (`standard`) and PST in BC, MB or SK (`province_standard`). Stripe first, then the database; checked first so Stripe
  isn't asked what would be refused; the idempotency key holds the number's hash, never the number.
- Stripe Tax is on for a checkout only with a head office and a registration; otherwise no tax.
- The numbers are shown on the parent's order page (full view; call 5). Not on Stripe's receipt (no field in the
  registration API types).
- **Placeholders until a tax adviser checks them (call 4):** place of supply from the billing or shipping address
  (also for school delivery), general tax codes per kind (a package mixing prints and a digital is "tangible goods"),
  shipping taxable. **Needs a tax-adviser check before real launch.**

## 10. Downloads (calls 10, 11)

- Parents download `download.jpg`: the original at full resolution, upright, sRGB with its profile, every other bit of
  metadata stripped (no EXIF, GPS, camera serial), JPEG quality 92 with full colour. Never the original.
- The image worker makes it with the previews (`processOriginal` returns it; `runPhotoJob` stores it). **Backfill** for
  photos processed before this step: when a paid download is missing, the API queues `{photoId, make: "download"}`
  (S3: the photo-events queue; local driver: in this process) and answers 409 `shop.downloadPreparing` with
  Retry-After 20; the worker's `runDownloadJob` makes only the file for a ready photo and reports nothing.
- `GET /api/v1/shop/orders/{id}/downloads/{photo}`: `shop_download_photo` must unlock it (a paid order the gallery
  may see, a digital line it shows); the link is signed for 5 minutes by a separate role, `AWS_DOWNLOAD_ROLE_ARN`,
  which may read `*/download.jpg` only (the app's usual role still never reads a full-resolution file), with
  `Content-Disposition: attachment; filename="daybell-{reference}-{n}.jpg"` (no name).
- Paid downloads stay while the file exists (archiving later); a later Do not publish, or the shop closing, doesn't
  take them back (call 11).

## 11. Who sees an order

- **Parents (call 12):** the full order (lines, prices, totals, tax numbers) for the session that paid or one holding
  every child on it; otherwise only their own children's lines, with no amounts; never an email, an address or a last
  name. Children are named (first name, last initial) only while their shop is open (ADR 0022 M1). Pending and expired
  orders only to their own session. "Your orders" (`/shop/orders`) lists them; re-entering a code finds them again.
- **Studios (call 15):** owners and admins, on the job's Shop tab until step 11's Orders tab: reference, date,
  children (full names), items, total, tax, Daybell's fee with its rate, the card fee ("Pending" until known), paid to
  the studio; the lines and, for home delivery, the recipient.

## 12. Events (call 14)

`order.paid {line_count, shipping_method}` with no actor; `tax_settings.updated {fields}`,
`tax_registration.added|ended {kind, province}`. Never amounts, numbers, names or addresses. Pending and expired orders
write none (the parent's own state, like the bag).

## 13. Region and privacy (D113, children's privacy)

Every new route runs in yul1 (`preferredRegion` and `assertFunctionRegion`); the webhook checks the payout regions'
function regions before any Stripe call. Orders, tax numbers, recipients and the ledger stay in the Canadian
database; downloads are signed in ca-central-1. Stripe receives the email the parent types at Stripe (needed for the
receipt), the recipient for home delivery, the studio's name, item names and Daybell's ids: never a child's name or a
photo. Logs hold fixed names, event types and codes only. The cron and queue messages carry ids only.

## 14. The fake driver (development, CI and end-to-end tests)

`STRIPE_DRIVER=fake` keeps checkouts in memory; its hosted page is `/dev/stripe-checkout?session=` (email, the test
card 4242…, the address for home delivery), whose Pay tells Daybell through the real webhook with a signed
`checkout.session.completed` (`POST /api/dev-stripe/checkout`). Tax 13% with Stripe Tax on, fee 2.9% + 30¢. Refused on
Vercel three ways, like the onboarding page: `next.config.ts`, `stripeSettings()`, and 404 from the page and the route.

## 15. Tests

- pgTAP 022 (145): shape and grants, platform settings, tax functions, every refusal, the snapshot, reuse and
  supersede, attach, the fee setting applying to new orders only, completion and its checks, idempotency (one event,
  one sold mark, bag lines removed), the ledger once and balanced in CAD, expiry, the inbox, parents' views and
  downloads, **cross-studio and cross-session leak tests**, studio reads by role, the cron's backstops, no personal
  data in events. pgTAP 023: CAD only, Quebec and Ontario PST refused.
- Core: fee rounding, the ledger identity, statement suffix, references, blockers, tax formats. API: enums and refusals
  equal to the migration's, inputs, routes. Storage, image pipeline, image worker: the download and the backfill.
- Web: the parameter builder, the real and fake drivers, checkout, cancel, order page, downloads, studio orders and
  taxes routes, the webhook's platform branch, the cron backstops, the screens (jsdom), the fake routes' 404s.
- e2e: `shop-checkout.spec.ts` (phone) and `phase1-orders.spec.ts` (desktop). `shop-gallery.spec.ts` now expects Pay.

## 16. Deviations from the architect's plan

- Tax routes are `/studio/taxes`, `/studio/taxes/head-office`, `/studio/taxes/registrations[/id]` (the head office
  needed its own route).
- No ledger header FK (section 8).
- `job_orders` pages by an order id cursor (the repository's convention), not a time.
- An unsaved checkout is reused for a minute, not 20 (Stripe's fixed expiry, section 5).
- The fake checkout's route is `/api/dev-stripe/checkout`, not an action of `/api/dev-stripe` (that one needs a
  signed-in owner; parents aren't signed in).
- "Your orders" is linked from the shop's ⋯ menu only, not from the galleries page (that would cost every visit a
  request); the confirmation page links to it.

## 17. Claude's calls, Seenu to review

From the architect's questions (Oct 13): 1 fee recovery by transfer reversal, Stripe Tax's charge absorbed; 2 Stripe
collects the Canadian home-delivery address, copied into the order (owners and admins), purged 90 days after shipping
(step 11); 3 business address as the tax head office; 4 test-mode tax placeholders; 5 tax numbers on Daybell's order
page; 6 tax registrations are the owner's; 7 "DBL" prefix and the studio's name as suffix; 8 the studio's name and
charcoal (logos later); 9 "all digitals" fixed at payment; 10 `download.jpg`, a download-only role, a backfill; 11 paid
downloads stay; 12 full view for the payer or all children, else that child's lines without amounts; 13 no orders
below C$0.50, no free orders; 14 only `order.paid` writes an event; 15 owners and admins only until step 11; 16 half
up, 0–20%; 17 a checkout started before closing can be paid in its 30 minutes; 18 `receipt_email` set after completion,
in memory only; 19 Link off; 20 zip "Download all" and Home's sales numbers in step 11.

Made while building (also for review):
- The checkout expires 31 minutes after the order is made; an unsaved checkout is reused for a minute.
- 10 new checkouts per gallery an hour (429).
- An order Daybell expired that Stripe reports paid becomes paid.
- `failed` is in the status list but not reached in Phase 1.
- A child on an order is named to parents only while their shop is open.
- Download links last 5 minutes; a download being prepared asks to try again in 20 seconds.
- The card prefix is set at a studio's first checkout, not at onboarding.
- Daybell keeps only the head office's province.
- The Pay button reads "Pay securely"; the total is shown before tax ("+ tax"), as the bag already did.
- The order page polls 1, 2, 4, 8, 15 seconds, then offers Try again.
- The fake's tax (13%) and fee (2.9% + 30¢) are fixed test values.

## Rejected

- Embedded checkout or Elements: card data would be in Daybell's pages (D97).
- Trusting the browser's prices, or the bag's priced read: the database prices again at checkout (ADR 0019).
- Storing Stripe's payloads or customer objects.
- Estimating Stripe's fee in the application fee (option A): inexact twice.
- A running-balance column: balances are sums of ledger lines (ADR 0006).
- Separate charges and transfers: D106 says destination charges on behalf of the studio.
- Downloading the original: it carries EXIF and GPS.

## Follow-ups

- Refunds give the 3% back (step 11); the Orders tab and fulfilment (step 11); purge recipients 90 days after shipping
  (step 11); zip "Download all"; Home's sales numbers (D127); the first-order celebration (D75).
- Monthly card fee recovery; payout fees (D56); Klarna (`checkout.session.async_payment_*`).
- US payments (D106's US setup).
- Pruning the webhook inbox; showing `order.paid` in the activity log.
- Archived originals vs paid downloads (D85).
- A tax adviser's check of codes, place of supply and shipping; a logo upload for branding.

## Flagged for Seenu

- Stripe (`docs/stripe-staging.md`, section 6): the third webhook destination ("Your account", snapshot,
  `checkout.session.completed` and `.expired`) and its secret; Stripe Tax on; Apple Pay and Google Pay on; receipts on
  for successful payments; check the unverified facts in section 2.
- AWS (`docs/aws-staging-photos.md`, section 13): the download role, `AWS_DOWNLOAD_ROLE_ARN` in Vercel, and the
  worker's permission to write `download.jpg`; redeploy the worker.
- Confirm the Stripe fee placeholders in `packages/config/src/payout-fees.ts` and the tax codes.
