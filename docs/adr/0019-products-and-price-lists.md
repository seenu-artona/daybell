# 0019 — Products and price lists

- Status: Proposed, Oct 12, 2026 (accepted when Seenu merges the step 6 PR). Amends 0008 (jobs gain a price list, by
  a `no action` composite FK; browsers lose the table-wide UPDATE on studios) and 0017 (a new onboarding task).
- Decisions: D36, D59, D104, D143, D96; touches D91, D92, D112, D113, D126, D128, D136, D137, D138, D140, D10.
  Seenu's answers 1–8 to the step 6 brief, and Claude's calls 1–10 on the architect's open questions (Oct 12, 2026;
  Seenu away: "make decisions, use what GotPhoto has"). D36, D59 and D104 are cited as the brief cites them; the
  decision log itself couldn't be opened from this environment, so their exact wording wasn't checked.

## Context

Phase 1 step 6: "Starter price list (packages, single prints, digital downloads) the studio edits; price list attached
to a job; flat home-shipping fee and free delivery to school." Out of scope: labs, discounts, prepay, group photo
sales, shipping by weight or zone, batch shipping. Orders and checkout are step 10.

Seenu's answers: a studio has many lists and each job uses one; new jobs get the default (1). The starter list is
GotPhoto-style: packages A, B and C, five print sizes, a single digital and all digitals, seeded for every studio (2).
A package is prints plus digitals of **one** pose (3). The flat home shipping fee is on the list; free delivery to
school is switched on per job (4). A selling job's list can still change, affecting new orders only; orders will copy
prices (5). A Price lists page in the menu plus the job's Shop tab (6). The single digital is full resolution with no
watermark; "all digitals" is every pose of that child in the job (7). Owners and admins edit; photographers and staff
read (8).

## Claude's calls (Claude's call, Seenu to review)

1. **Phones:** ADR 0013 stands: the studio app is desktop-only at 1280px, with no "Open this on a computer" notice.
2. **What studios change:** add, delete and rename items and packages; create a blank list or a copy of one of theirs;
   delete a list unless it is the default or a job uses it.
3. **Checklist:** no job task "Choose a price list" (every job gets the default, so it would always be done). The Start
   selling dialog's "Price list chosen" becomes real. The onboarding task "Review your price list" ticks the first time
   an owner or admin saves a price list change, creates a list or changes the default, from a write-once
   `studios.price_list_reviewed_at` set by the database, never by hand.
4. **Selling and closed jobs:** a draft or selling job may switch list and toggle school delivery (new orders only, as
   GotPhoto). A closed job's never change (the database refuses with `job_closed`, as `app.assert_job_open`).
5. **Menu:** the item stays "Products" (D126) and opens the "Price lists" page.
6. **Delivery:** with school delivery on, parents choose free school delivery or paid home shipping. Off by default for
   new jobs. Digital-only orders pay no shipping (step 10 applies it; the screens say so now).
7. **Currency** follows the data region (us → USD, ca → CAD), as ADR 0006's ledger already does.
8. **Bounds:** $0 items are allowed; at most $10,000 per item and $1,000 home shipping. Print sizes are fixed to the
   five listed for Phase 1.
9. The architect's placeholder starter prices are used as-is (table below); Seenu can change them. Price list events
   are not shown in the activity log yet (a follow-up, as in ADRs 0016 and 0018).
10. (Step 10) Shipping is outside the 3% fee (D59: product value only); whether shipping is taxable is for Stripe Tax
    and the tax adviser.

## Data (forward migration `20261012200000_price_lists.sql`)

- **Enums:** `price_item_kind` (`package`, `print`, `digital_single`, `digital_all`) and `print_size` (`4x6`, `5x7`,
  `8x10`, `11x14`, `wallets_8`). Core's `PRICE_ITEM_KINDS` and `PRINT_SIZES` mirror them; a test in `packages/api`
  keeps them in step, with the bounds.
- **Text parents see** (list and item names, descriptions): the database refuses control characters (C0, DEL, C1)
  and bidi overrides and isolates (U+202A–U+202E, U+2066–U+2069), spelled out rather than `[[:cntrl:]]` so the rule
  doesn't depend on the server's locale; zod refuses the same (`isPriceText`), so people get a field error first.
- **`price_lists`:** `studio_id`, name (1–80, trimmed; names may repeat), `currency` (`USD`/`CAD`),
  `home_shipping_cents bigint` (0–100,000), timestamps; `unique (studio_id, id)`. `app.guard_price_list` sets the
  currency from the studio's region on insert, refuses any other, and never lets it (or the studio) change; it also
  holds the 50-list limit (serialised per studio with an advisory lock).
- **`price_list_items`:** composite FK `(studio_id, price_list_id)` → the list, `on delete cascade`; kind, name (1–80),
  description (≤ 500), `print_size` (set exactly when the kind is `print`), `price_cents bigint` (0–1,000,000),
  `position` (0–10,000, so `max + 1` never overflows; not in the update grant: the order changes only through
  `set_price_list_item_order`). Partial unique indexes allow one `digital_single` and one `digital_all` per list. A
  guard keeps kind, list and studio fixed and holds the 100-item limit.
- **`price_list_package_lines`:** composite FK `(studio_id, price_list_id, package_item_id)` → the item, `on delete
  cascade`; `line_kind` `print` (with a size, quantity 1–99) or `digital` (quantity 1, at most one per package: one
  pose). Only packages have lines; at most 20. Lines belong to the package rather than pointing at the list's print
  items, so a package stays whole if a size stops being sold on its own. Lines are replaced as a whole, never updated.
  Line positions are 0–10,000. **Every package holds at least one line**, however it is written: two deferrable,
  initially deferred constraint triggers (after a package is inserted, after a line is deleted) run
  `app.check_package_has_lines` at commit, so replacing a package's lines in one transaction works and a package
  deleted along the way needs nothing (`package_empty`).
- **The guards** (`guard_price_list`, `guard_price_list_item`, `guard_package_line`) are SECURITY DEFINER and run
  before row-level security's WITH CHECK, so each first refuses a signed-in person who isn't an owner or admin of the
  row's studio (42501) before any lookup, lock or count: a failure tells an outsider nothing about another studio's
  rows. The starter list, written by the studio's own insert trigger before its owner is a member, runs one trigger
  level deeper and is not checked.
- **`studios.default_price_list_id`:** composite FK `(id, default_price_list_id)` → `price_lists (studio_id, id)`,
  `no action`, so the default can't be deleted and the default is always the studio's own. One pointer: switching the
  default is one update. Once set it is never cleared (`default_price_list_required`, 23514, from the studio guard):
  new jobs need it, and it keeps a studio's last list from being deleted.
- **`studios.price_list_reviewed_at`:** write-once, the database's clock. Only the database writes it
  (`app.mark_price_list_reviewed`, SECURITY DEFINER, from the price list triggers for a signed-in person's own change;
  the studio guard when a person changes the default). To keep browsers from writing it, **the table-wide UPDATE
  Supabase grants on `studios` is replaced by column grants** (`name`, `slug`, `onboarded_at`,
  `default_price_list_id`); `id`, `created_at` and `data_region` (nothing in the browser writes it, and a trigger
  refuses changes; D113) are no longer updatable by browsers either (amends ADR 0008's
  "column grants" rule to cover studios).
- **`jobs.price_list_id`** (not null) with composite FK `(studio_id, price_list_id)`, **`no action` rather than
  `restrict`** (amends ADR 0008): deleting a studio cascades to both its jobs and its lists, and `restrict` is checked
  per row in the middle of that cascade. `jobs.deliver_to_school boolean not null default false`. A before-insert
  trigger fills a missing list from the studio's default; a before-update trigger refuses changes to either on a
  closed job. Both columns are in the authenticated insert and update grants and in `job.updated {fields}`.
- **Seeding:** `app.starter_price_list()` holds the starter list as JSON; `app.seed_price_list` writes it in the
  studio's currency and makes it the default. New studios get it from an after-insert trigger (inside studio creation,
  so `pg_trigger_depth() > 1` and no events: part of `studio.created`, the job_categories precedent). The backfill
  seeds every existing studio and points every existing job at its studio's default with the jobs' triggers off (no
  events, `updated_at` unchanged), before the event triggers exist.
- **Row-level security:** members read; owners and admins insert, update and delete (lines: insert and delete).
  Column grants keep studio, list, kind, currency, ids and timestamps out of client writes. Anon gets nothing.
- **Functions:** `save_price_list_item` (SECURITY INVOKER) adds or updates one item in place and replaces a package's
  lines in one transaction (`package_empty`, `not_package`, `item_limit`; `not_found` for another studio's list or
  item). `copy_price_list` (SECURITY INVOKER) copies a list's settings, items and lines. `set_price_list_item_order` is
  **SECURITY DEFINER** so it can write one `price_list.reordered` event; it checks membership and the owner/admin role
  itself and touches only that list's rows (the plan had it INVOKER; RLS-bound functions can't write events). An
  order that changes no position (the same order again, or an empty list) writes no event and doesn't count as a
  review.
  `price_list_summaries` (SECURITY INVOKER) gives counts by group, jobs and selling jobs per list. All have an empty
  `search_path` and no PUBLIC or anon execute.

pgTAP `013_price_lists` (146 tests) covers seeding, money bounds, text and position bounds, kinds and contents (at least
one line per package at commit), roles, every cross-studio leak (lists, items, lines, defaults, job lists, the four
functions, the guards' 42501 before any lookup), the column grants as `authenticated`, the default never cleared,
deletes, defaults for new jobs, closed jobs, events (none for a no-change reorder) and the review stamp; `014_price_lists_canada` checks a Canadian studio's list is CAD and USD is refused.

## Money

Whole cents in `bigint` plus the list's currency, never floats (D96). Zod takes `z.number().int()` only: 12.5, "1250"
and negatives are refused, never rounded. Clients never send a currency. Responses use one `Money {cents, currency}`
schema. Screens read prices with core's `parseMoneyInput` (text to cents, never through a float; ".5", "12.50" and
"$1,234.00" are fine; three decimals, exponents and letters are not) and show them with `formatMoney` in the
currency's own locale ("$25.00" for USD and CAD alike). Every price screen says "Prices before tax"; Stripe Tax adds
tax at checkout (step 10).

## The contract for step 10 (orders snapshot prices; answer 5)

Checkout prices on the server from the job's current list, never from the browser. Each order line copies
`price_list_item_id` (nullable, `on delete set null`), kind, name, print size, unit price in cents, currency,
quantity, a package's contents as sold and the chosen pose; the order copies the shipping method (`home`/`school`),
the shipping fee (0 for school and for digital-only orders) and the list's id. Totals, receipts, refunds and the
ledger read only the copy. This step keeps item ids stable on edit (updated in place) so orders can point at them.

## API (`/api/v1`, D92; new group "Products")

`GET/POST /price-lists`, `GET/PATCH/DELETE /price-lists/{id}`, `POST /price-lists/{id}/default`,
`POST /price-lists/{id}/items`, `PUT /price-lists/{id}/items/order`, `PATCH/DELETE /price-list-items/{id}`. Every
route takes the studio scope, filters every query by `studio_id`, answers 404 for a bad UUID or another studio's id,
and checks the role before reading the body (photographers and staff get 403). Conflicts are named in `fields.form`:
`priceLists.isDefault`, `inUse`, `limit`, `itemLimit`, `digitalTaken`, `jobClosed`. `Job` gains `priceListId` and
`deliverToSchool`; `POST /jobs` and `PATCH /jobs/{id}` take both (another studio's list is the field error
`validation.priceList`; a closed job's change is 409 `priceLists.jobClosed`). Database only, so the routes run where
`/jobs` runs (D113).

## Screens (D136, D140; words in the locale files, tokens only)

- **Menu:** Products is built (no "Soon"); it opens Price lists (call 5).
- **Price lists** (`/app/products`): a table of lists, the default badged first, with item counts and "Used by N
  jobs". Owners and admins get "New price list" (name, and "Start from": an empty list or a copy of one), and per row
  "Make default" and "Delete" buttons (with a confirm dialog that names why a list can't go). The plan's ⋯ menu became
  two plain buttons: simpler, and every action is a 44px labelled target. Their accessible names start with the
  visible words ("Make default: Spring", "Delete Spring"; WCAG 2.5.3). A list jobs use shows "In use, so it can't be
  deleted" instead of Delete (the API's 409 still covers the race). The "Default" badge uses the `info` tone, not a
  job status tone.
- **Editor** (`/app/products/price-lists/{id}`): name and default badge, "Prices before tax", the live note when
  selling jobs use the list, a Settings card (name and home shipping fee), then Packages, Prints and Digital downloads
  cards with each item's contents or description and price. Owners and admins add, edit (a dialog with name,
  description, price, a print's size, and a package's lines with Add prints / Remove line buttons and "Includes the
  digital download of the chosen pose"), remove and reorder with **Move up / Move down buttons** (no drag, WCAG 2.5.7;
  focus stays on the moved item's button). Photographers and staff see it read-only.
- **Job Shop tab** (no longer "coming soon"): the job's list (a select and a "Save price list" button for owners and
  admins while the job isn't closed, so arrowing through the select saves nothing on the way), a link to edit it, what
  parents can buy with prices, and Delivery: the list's home shipping fee and the "Free delivery to school" checkbox.
  Saves go through `PATCH /jobs/{id}` and are announced in a status region. Nothing is disabled while a save runs
  (that would drop keyboard focus, WCAG 2.4.3); input meanwhile is ignored and the tab is `aria-busy`.
- **Start selling** dialog: "Price list chosen" is real (done when the job has a list).
- Status messages live in `role="status"` regions that stay in the accessibility tree while empty.

## Checklist (amends ADR 0017)

Onboarding is now Create your account, **Review your price list**, Create your first job (D143's order). The task
links to Products for owners and admins and ticks from `price_list_reviewed_at`. Studios already onboarded never see
it (`onboarded_at` is write-once). No job task was added (call 3), so ADR 0017's draft milestone rule is unchanged.

## Events (D96: ids, kinds and field names only)

`price_list.created`, `price_list.updated {fields}`, `price_list.deleted`, `price_list.made_default` (subject: the new
default; not for the first default), `price_list.reordered`, `price_list_item.created {price_list_id, kind}`,
`price_list_item.updated {price_list_id, fields}` (one `["contents"]` event per package per transaction, none for a
package created in the same transaction), `price_list_item.deleted {price_list_id, kind}`, and `job.updated` with
`price_list_id` / `deliver_to_school`. None for the starter list, the backfill, or rows deleted with their parent (a
deleted list's items, a deleted studio's lists). A copy writes `price_list.created` and one `price_list_item.created`
per copied item (the plan's `copied_from` was dropped: a row trigger can't know it). The activity log doesn't show the
new types yet (call 9).

## Region and privacy (D113)

Everything lives in the studio's regional database; no storage, queue or third-party call. Price data isn't personal;
logs and events still carry ids and error names only.

## Starter list (placeholder prices, call 9)

| Item | Contents | USD | CAD |
|---|---|---|---|
| Package A | 1 × 8×10, 2 × 5×7, 1 wallet sheet, digital download | $64.00 | $85.00 |
| Package B | 2 × 5×7, 1 wallet sheet, digital download | $44.00 | $59.00 |
| Package C | 1 × 5×7, 1 wallet sheet | $29.00 | $39.00 |
| 4×6, 5×7, 8×10, 11×14 print | | $10 / $14 / $20 / $32 | $13 / $19 / $27 / $43 |
| Wallets (sheet of 8) | | $15.00 | $20.00 |
| Digital download | one photo, full resolution, no watermark | $25.00 | $33.00 |
| All digitals | every photo of the child in the job | $59.00 | $79.00 |
| Home shipping (list setting) | | $8.95 | $11.95 |

Ten items in all. The names are seeded in English and become the studio's own data (as job categories were).

## Follow-ups

- Show price list events in the activity log (call 9).
- Step 10: the order snapshot above, shipping rules (school vs home, digital-only free) and tax on shipping (call 10).
- Seenu to confirm or replace the starter prices and contents, and calls 1–10.

## Rejected

- An `is_default` flag with a partial unique index: it can't swap the default in one statement.
- Packages referencing the list's print items: removing a print size would break packages.
- A whole-list PUT: it needs optimistic locking; item-level saves don't.
- Seeding from the API instead of the database: studios created any other way would have no list.
- A currency per item: the list (and the studio's region) decides it.
- A "Choose a price list" job task that is always done (call 3).
