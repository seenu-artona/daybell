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
  - 0021: Start selling's "Price list chosen" means "the job sells at least one item" and reads "Something to sell".
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
  0–1,000,000, `sold` default true, timestamps), primary key (job, item): a row is written only while something
  differs from the list (a price, or the item switched off: `price_cents is not null or not sold`). A row can remain
  when the list's price is later changed to equal the job's; it then counts as no change (`changed` and "N changes"
  are worked out from the resolved prices, not from the row being there). Composite keys to the studio's job
  and to the item **on the job's list** (both cascade, so deleting an item or a job takes its changes with it).
- `job_shop_items` (`studio_id`, `job_id`, kind `package` or `print` only, name 1–80 and description ≤ 500 with the
  price list's text rules, `print_size` exactly for prints, `price_cents` 0–1,000,000, `sold` default true, `position`
  0–10,000, timestamps) and `job_shop_package_lines` (as `price_list_package_lines`: at most 20 lines, at most one
  digital, at least one line checked at commit). At most 100 job-only products per job, under an advisory lock.
- Row-level security: members read; owners and admins write. The guards are SECURITY DEFINER and refuse a signed-in
  person who isn't an owner or admin of the row's studio with 42501 **before anything is read** on inserts and updates.
  On deletes they first check that the row's parent (job, list item or product) still exists, so a cascade passes;
  row-level security has already filtered a delete to the person's own studio's rows, so that check tells an outsider
  nothing. Then they lock the job's
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
- **N3** Start selling's "Price list chosen" becomes "the job sells at least one item" (and reads "Something to sell",
  call 17).
- **N5** Job-only products sort after the list's items in their kind group (packages, prints).
- **N6** Portraits first, then group photos: in the pose picker and in All digitals.
- **N8** The price list editor's note doesn't mention per-job changes yet (a follow-up).
- **N9** School delivery is drawn as a Switch (same data and API as the checkbox).
- **N10** Photographers keep seeing prices on Job › Shop (ADR 0019 answer 8).

Calls made in this round (each **New: needs Seenu**):

Data and API

1. **Who writes, and how.** Like price lists (ADR 0019): row-level security with owners and admins writing through
   SECURITY INVOKER functions, and SECURITY DEFINER guards that refuse with 42501 before anything is read. The parent
   shop's functions stay service-role only. `job_shop` is SECURITY DEFINER (it reads through the resolver) with one
   membership check.
2. **Events' subjects.** `job_price.*` events are about the job (subject: the job; data names the list item);
   `job_item.*` events are about the product (subject: the product; data names the job). `job_item.deleted` carries
   `{job_id, kind}` (the plan named the event only).
3. **Typing the list's price back** (while the item is sold) deletes the row and writes `job_price.reset`, as Undo
   does. A list swap and a deleted list item remove the job's changes with no `job_price.reset` (the first is already
   `job.updated {fields: ["price_list_id"]}`).
4. **An order line for a job's own product** keeps `price_list_id` (not null) as the job's list at checkout.
5. **404 or 409.** A list item that isn't the studio's is 404 (another studio's id says nothing); one of the studio's
   items that isn't on the job's list is 409 `jobShop.notOnList`.
6. **Sold for a job's own product** is `PATCH /jobs/{id}/shop/items/{itemId} {sold}`; the prices route is for list
   items only. `DELETE /jobs/{id}/shop/prices/{itemId}` (Undo) is in the API; the screen undoes by typing the list's
   price back (D157), so it has no Undo button.
7. **Every Job › Shop write answers with the whole shop** (200, and 201 for a new product), so the screen and API users
   always see the job's resolved prices and its count of changes.
8. **A job's own products keep the order they were added in** (each after the last); there is no Move up or Move down
   for them this round.
9. **Bag fingerprints now name the job's product too**, so a checkout begun before this migration isn't reused by the
   next Pay (it expires as usual).

Screens

10. **One table, no group headings.** Packages, prints and downloads keep their order (N5) without sub-headings in the
    table (D157: one table).
11. **A row switched off is dimmed with muted text, not transparency**, so its words keep AA contrast; its switch says
    Off.
12. **The price cell** shows the $ sign and the price in dollars and cents ("85.00"); a price that isn't one says the
    price list's own message under the field ("Enter a price from $0 to $10,000, like 25 or 25.00."); a refused save
    shows under the field, and leaving the field doesn't send the same refused price again.
13. **Change** is a button (named "Change price list") opening a dialog: the list select, the warning in a live region
    when another list is chosen ("2 changes for this job will be removed." and "Products only this job sells stay."),
    Cancel and "Change price list". The old "Edit this price list" / "View this price list" link stays beside it.
14. **"N changes for this job"** sits on the "Prices before tax" line; none reads "No changes for this job". Saves are
    announced as "Saved. 2 changes for this job".
15. **Add a product** asks Package or Print first, then shows the price list editor's item dialog with one more line,
    "Only this job sells it. The price list doesn't change." A job's own product's name (a button, "Edit Panorama")
    opens the dialog again; Remove there asks to confirm ("Only this job sells it. Orders already placed keep it.").
16. **Words changed:** a closed job says "This job is closed, so its shop can't change."; photographers and staff read
    "Only owners and admins can change this job's shop."
17. **Start selling's row reads "Something to sell"** (it was "Price list chosen"), with the same check: the job sells at
    least one item (N3). **Decided by Claude overnight — please review.**
18. **More for this job** rows are plain text with a Soon tag (not buttons), like Progress's Soon steps.
19. **Settings › Shop** reads the shop's address on the server (SHOP_URL, else this deployment's /shop, as QR cards
    print it). Its cards' words are this ADR's summaries of how things work today (ADR 0022, 0023, 0024); the Taxes
    and Stripe links show only to owners and admins (only they can open those sections); Price lists shows to
    everyone. Look says the shop shows only the studio, never Silverback's name or logo (D62). Its icon is a shop
    front (`Store`).
20. **The pose picker** titles its two sets ("Portraits", "Group photos") only when the child has group photos; a group
    photo is "Group photo 2 of 4", the big preview follows the same words. "Use this photo" on a group photo opens
    Choose a package first, as for a portrait (D24). The viewer's "can't be ordered yet" line is gone.
21. **e2e:** `shop-checkout` buys portraits only and needed no change; `shop-gallery` also buys a group photo with the
    job's own print (review fixes); `phase1-going-live` expects the row "Something to sell".
22. **A group photo any family buys is sold for everyone in it:** it is marked sold and can no longer be binned by the
    studio (see Review fixes). **Decided by Claude overnight — please review.**

## Review fixes (Oct 15, 2026; tester, code and security reviews)

Seenu was asleep and asked the coordinator to decide; each item marked **Decided by Claude overnight — please review**
is provisional until he does.

- **Lost update (code H1):** `set_job_price` and `reset_job_price` take a per-item advisory lock (after the job's share
  lock) before reading the row, so a price and a Sold switch sent at the same moment both stick. `save_job_item`
  already merges each field from the row's current values in its UPDATE.
- **The price cell (code M1, M2; tester 2, 3):** text typed while a save runs is saved right after it and never
  replaced by the older answer; Enter retries a refused price, leaving the field doesn't send it again; a refusal is a
  `role="alert"` under the field. **Decided by Claude overnight — please review.**
- **Overlapping saves (tester 4):** when saves overlap, the page reads the shop again once they have all answered, so
  "N changes" and Change's warning end on the server's count. **Decided by Claude overnight — please review.**
- **One offer per job per call (security L1, code L3):** the bag, quantities, delivery and checkout resolve each job's
  offer once (`app.shop_line_available_with`), not once per line; the three-way totals test is unchanged.
- **Leak tests (security M1)** for job products and their contents, and for another job's own product in the bag.
- **Bidi characters (code L1)** are written as escapes in the migration and the API test.
- **A sold group photo can't be binned (code L2), a consequence of D156 C5:** a group photo any family buys is marked
  sold (`photos.sold_at`, ADR 0023), so the studio can no longer bin it. That holds for every child in the photo: one
  family's purchase keeps the photo in every member's gallery. Removing a child from the group still hides it from that
  child (ADR 0030); moving it to another group still works. **Decided by Claude overnight — please review** (listed as
  a Call: Seenu may want a studio-only "hide" for sold group photos later).
- **The Start selling row** reads "Something to sell" (call 17). **Decided by Claude overnight — please review.**
- **e2e (tester 1, 5):** `phase1-templates` expects Shop in Settings' sections; the group photo checks moved into
  `shop-gallery` so CI builds one selling studio.

## Not in this round (deferred)

Early bird and coupons, Prepay, Yearbook pose, Reorders (Soon); a logo upload (Soon); Coupons and Gift cards (Soon);
the price list editor's note about per-job changes (N8); showing the new events in the activity log.

## Tests

- pgTAP `031_job_shop` (122): shape, row-level security and grants (nothing for anon; the resolver and guards for
  nobody signed in), the resolver, this job's prices (the list's price typed back, off at the list's price, both at
  once, Undo, the same price again writing nothing), roles (photographers and staff refused with 42501, a direct write
  refused before anything is read; another studio's owner not_found and 42501), a closed job refused, job-only
  products (contents, in place, Sold, kinds, text rules, 20 lines, 100 per job, a package without lines at commit),
  `not_on_list` for the list a job had before a swap, the swap dropping the old list's changes and keeping the job's
  products, a deleted list item and a closed job's cascade, events without amounts or names; review fixes: a price then
  Sold alone keeps the price and Sold then a price keeps it off (per-item lock), and another studio reads, changes and
  deletes none of a job's products or their contents and can't point a line at them.
- pgTAP `032_group_photo_sales` (50; another job's own product in the same studio refused): what the shop offers at the job's prices; group photos as poses for a member,
  refused for a non-member, another group's photo and another studio; merging; the three-way totals check (the
  shop's prices, the bag, checkout) for every bag; leaving a group and a product switched off making lines unavailable,
  not deleted; order lines naming a job's product with its own contents; All digitals portraits then group photos; a
  sold group photo not binned, its download and print files; Groups' Ordered; N7. Canadian studios (CAD).
- Updated: `018` (N3, 78), `021` (another group's photo refused), `022` (All digitals with the group photo, 194).
- Core `job-shop` and the pose rules in `shop`; API contracts (whole cents only, kinds and limit equal to the
  migration's, conflicts, routes); route tests with cross-studio and cross-job leak tests, role-before-body, 409s and a
  console spy; jsdom: the price cell, the table, Change's warning, the Switch, the pose picker, the viewer, Settings ›
  Shop and its sections.
- e2e: new `phase1-job-shop` (desktop); `shop-gallery` (phone) also buys a group photo with the job's own print at the
  job's prices, in its one selling studio (review: CI minutes); updated `phase1-price-lists`, `phase1-job-page`,
  `phase1-templates` (Settings › Shop in the sections) and `phase1-going-live` ("Something to sell"). The e2e specs
  could not be run in this environment.
