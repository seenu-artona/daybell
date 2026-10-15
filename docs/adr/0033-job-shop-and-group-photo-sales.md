# 0033 — Job › Shop: this job's prices, job-only products, Settings › Shop, and selling group photos

- Status: Proposed with UI round 7 (branch `ui/round7-shop`). Every call under "Calls for Seenu" is provisional until
  Seenu reviews it (CLAUDE.md rule 7: nothing decided is changed silently). 0032 is taken by the DRM spike on another
  branch.
- Decisions implemented: D157 (Job › Shop, Settings › Shop, the parent shop's order), D156 C5 (selling group photos);
  Seenu's answers of Oct 14, 2026 (below).
- Decisions touched: D36, D59, D104 (price lists, ADR 0019), D96 (studio separation, money, events, words in files),
  D113 (regions), D92 (API first), D91 (WCAG 2.2 AA), D112 (tokens), D152 (dates, Close shop and numbers stay on
  Overview), D62 (parents see only the studio's logo), D60 (what parents see), D24.
- Amends:
  - 0019: a job's price list is no longer the whole story: a job can change a list item's price, switch it off, or add
    products of its own; the shared list never changes. Every price read goes through one resolver.
  - 0021: Start selling's "Price list chosen" means "the job sells at least one item".
  - 0022: group photos can be bought (a pose may be a group photo); the bag stores either a list item or a job item.
  - 0023: an order line names either a list item or a job item; "all digitals" holds group photos too.
  - 0030: C5 is built: every member can buy a group's photos.

## D157 (verbatim)

> Job › Shop shows the job's price list (from the template; Change swaps it) as one table: Product, Price list, This
> job, Sold switch. For this job only, a studio can change a price (click, type, Enter; type the list price back to
> undo), switch an item off (row dimmed), or Add a product that exists only for this job (Price list column shows —).
> The shared price list never changes; one line says 'N changes for this job'; no per-row labels and no
> adjust-all-prices. Side: Delivery (free delivery to the school switch, as built; home shipping from the list) and
> 'More for this job' marked Soon: Early bird and coupons, Prepay, Yearbook pose, Reorders. Dates, Close shop and
> numbers stay on Overview (D152). Settings gains a Shop section (Look, Shop address, Checkout, Policies; Coupons and
> Gift cards Soon); parent email wording stays in Templates › Messages. Parent shop: portraits then group photos; any
> product works with a group photo and All digitals includes them; parents see only the studio's logo (D62).

Shopify pattern (Seenu): overrides are rows keyed by (job, price list item); resolution is job override, else list
price; job-only items live on the job.

## Seenu's answers (Oct 14, 2026)

- **B1 Swapping the list** drops the old list's changes for this job, after a confirm that names how many ("N changes
  for this job will be removed"). Job-only products stay with the job.
- **B2 Job-only products** are packages and prints only (a package with its own contents). The single download and
  All digitals stay one per list (they can be repriced or switched off). They are edited with the same item dialog,
  plus Remove; the Sold switch works on them. At most 100 per job.
- **N4 The price cell** saves on blur (like Shopify) and on Enter; Escape puts the saved price back.
- **B3a Look:** a logo upload is Soon; the card shows the studio's name as parents see it.
- **B3b–d Shop address, Checkout, Policies** are read-only facts: the one `/shop` address with a Copy button; how
  checkout works today and the refund and cancel rules as built, with links to Taxes, Stripe and Price lists.
- **B3e Settings › Shop** is visible to everyone, read-only (like Templates), after Templates in the section list.
- **B3f** The menu's "Shop (Soon)" item stays (for promotions and reports later).
- **N7** A child with group photos but no portrait stays unavailable (unchanged).

## What changed

**Data** (`20261017000000_job_shop.sql`, `20261017000100_shop_job_prices_and_group_photos.sql`, forward only).

- `job_price_overrides` (`studio_id`, `job_id`, `price_list_id`, `price_list_item_id`, `price_cents` null or
  0–1,000,000, `sold` default true, timestamps), primary key (job, item): a row only while something differs from the
  list (a price, or the item switched off: `price_cents is not null or not sold`). Composite keys to the studio's job
  and to the item **on the job's list** (both cascade, so deleting an item or a job takes its changes with it).
- `job_shop_items` (`studio_id`, `job_id`, kind `package` or `print` only, name 1–80 and description ≤ 500 with the
  price list's text rules, `print_size` exactly for prints, `price_cents` 0–1,000,000, `sold` default true, `position`
  0–10,000, timestamps) and `job_shop_package_lines` (as `price_list_package_lines`: at most 20 lines, at most one
  digital, at least one line checked at commit). At most 100 job-only products per job, under an advisory lock.
- Row-level security: members read; owners and admins write. The guards are SECURITY DEFINER and refuse a signed-in
  person who isn't an owner or admin of the row's studio with 42501 **before anything is read**, then lock the job's
  row `FOR SHARE` and refuse a closed job (`job_closed`) and an item that isn't on the job's current list
  (`not_on_list`); studio, job, list and item never change on a row. The share lock means a list swap and a price
  change take turns: whichever commits second sees the other.
- `app.job_offer(job)`: **the one resolver**. Every item the job can sell: the list's items with this job's price (the
  override, else the list's) and whether it is sold, then the job's own products, each with its contents, the list's
  price (null for a job-only product) and the screen order (kind group, list items first, then position). The bag,
  checkout, the shop's prices, Job › Shop and Start selling's check all read it; nothing reads a list price directly.
- Functions (SECURITY INVOKER, so row-level security applies, unless noted): `set_job_price(job, item, price, sold)`
  (the list's price typed back clears the price; a row whose price and Sold match the list is deleted),
  `reset_job_price(job, item)`, `save_job_item(job, item, fields, lines)` (one transaction, the price list editor's
  rules), `delete_job_item(job, item)`, and `job_shop(studio, job)` (SECURITY DEFINER with a membership check and
  `studio_id` on every read, because it reads through the resolver).
- Swapping a job's list deletes the old list's changes (a trigger on `jobs`, B1); job-only products stay.
- Events (ids and field names only, never amounts): `job_price.changed {job_id, price_list_item_id, fields}`,
  `job_price.reset {job_id, price_list_item_id}`, `job_item.created {job_id, kind}`, `job_item.updated {job_id,
  fields}` (`contents` once per package per transaction, as price lists), `job_item.deleted {job_id, kind}`. Rows
  deleted with their parent (a job, a list item, a list swap) write none: `job.updated {fields: ["price_list_id"]}`
  already says the list changed. No ledger entries: no money moves.
- `app.sell_blockers`: `price_list` now means the job sells nothing (`app.job_offer` has no sold item).
- The bag (`shop_cart_lines`) gains `job_item_id` (composite key to the job's product, with its kind, cascade);
  `item_id` and `price_list_id` become nullable; exactly one of the two ids is set; adding the same product and pose
  again still merges (the unique index is rebuilt on whichever id is set). `order_lines.price_list_item_id` becomes
  nullable and gains `job_item_id` (no key: orders keep what they sold); exactly one is set.
- Recreated through the resolver: `shop_price_list` (sold items only, at this job's price), `shop_cart`,
  `shop_cart_add`, `shop_cart_set_quantity`, `app.shop_line_available`, `app.shop_line_physical` (both contents
  tables), `shop_checkout_begin` (the resolved unit price; the bag's fingerprint includes the job product's id; the
  line's contents from either table) and `complete_order` (the bag's clean-up matches either id).
- **Group photos are sold (D156 C5).** A pose may be any of the child's visible portraits or the group photos of the
  groups they are in (`app.parent_visible_photos(job, child, true)`); another group's photo is `photo_unavailable`.
  A child who leaves a group keeps the bag line, now marked unavailable (not deleted). Packages, prints and the single
  download take a group photo. All digitals is fixed at payment to the child's portraits, then their group photos,
  each in tagging order. Downloads, print files and refunds work by photo id, unchanged. A child with group photos but
  no portrait stays unavailable (N7).

**API** (`/api/v1`, D92; group "Products").

- `GET /jobs/{id}/shop` (everyone on the team): `{shop: {jobId, priceList {id, name, homeShipping}, rows, changes}}`,
  each row `{itemId, source: "list" | "job", kind, name, description, printSize, contents, listPrice | null, price,
  sold, changed}`.
- `PATCH /jobs/{id}/shop/prices/{itemId}` `{priceCents?, sold?}` and `DELETE` (undo) — owners and admins.
- `POST /jobs/{id}/shop/items`; `PATCH`/`DELETE /jobs/{id}/shop/items/{itemId}` — owners and admins, the price list
  item's input limited to packages and prints. Every write answers with the whole shop.
- `PATCH /jobs/{id} {priceListId}` is unchanged (it now drops the old list's changes).
- Every route: the person and role before the body, `studioScope`, every query filtered by `studio_id`, 404 for
  another studio's or another job's ids and for a bad UUID. 409s carry `fields.form` from `JOB_SHOP_CONFLICTS`
  (`jobShop.jobClosed`, `jobShop.notOnList`, `jobShop.itemLimit`; the limit equals the migration's). No region pin:
  prices and products are no personal data (ADR 0019's precedent). The parent shop's routes stay in `yul1`.

**Screens.**

- **Job › Shop** (`page.tsx` split into `shop-table`, `price-cell`, `change-list-dialog`, `add-product-dialog`,
  `shop-aside`): the list's name, Change, "Prices before tax", "N changes for this job", then one table (Product,
  Price list, This job, Sold). Owners and admins type a price (Enter or leaving the field saves, Escape restores) and
  switch Sold; Add a product opens the price list editor's item dialog (packages and prints), and a job-only product's
  name opens it again with Remove. The side: Delivery (school delivery as a switch, the list's home shipping fee) and
  More for this job (Early bird and coupons, Prepay, Yearbook pose, Reorders, each Soon).
- **`Switch`** in `packages/ui` (a button with `role="switch"` and `aria-checked`, its On/Off in words), in the
  `/dev/components` gallery.
- **Settings › Shop** (after Templates, everyone, read-only): Look, Shop address (Copy), Checkout, Policies, and Coupons
  and Gift cards (Soon).
- **Parent shop:** "Use this photo" on group photos; the pose picker shows Portraits, then Group photos, in one radio
  set; the pose page preselects `?photo=` from either.

## Calls for Seenu

Defaults the plan asked to be listed (rule 7):

- **N1** "N changes for this job" counts changed prices, items switched off and job-only products.
- **N2** Shop changes don't feed Overview's Details or Progress "Changed for this job" (that line stays the template
  rules').
- **N3** Start selling's "Price list chosen" becomes "the job sells at least one item".
- **N5** Job-only products sort after the list's items in their kind group (packages, prints).
- **N6** Portraits first, then group photos: in the pose picker and in All digitals.
- **N8** The price list editor's note doesn't mention per-job changes yet (a follow-up).
- **N9** School delivery is drawn as a Switch (same data and API as the checkbox).
- **N10** Photographers keep seeing prices on Job › Shop (ADR 0019 answer 8).

Calls made in this round: (added as the build settles; see the final list below)

## Not in this round (deferred)

Early bird and coupons, Prepay, Yearbook pose, Reorders (Soon); a logo upload (Soon); Coupons and Gift cards (Soon);
the price list editor's note about per-job changes (N8); showing the new events in the activity log.

## Tests

pgTAP `031_job_shop` and `032_group_photo_sales`; updated `018`, `021`, `022`, `029`; core `job-shop`, API contracts,
route tests with cross-studio and cross-job leak tests, screen tests (jsdom), e2e `phase1-job-shop` (desktop) and
`shop-group-photos` (phone). The e2e specs could not be run in this environment.
