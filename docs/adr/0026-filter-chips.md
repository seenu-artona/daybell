# 0026 — Filter chips: one row of chips per list, saved per person

- Status: Proposed with the D147 UI PR (branch `ui/round2`). The calls in "Calls made" are provisional until Seenu
  reviews them.
- Decisions implemented: D147 (amends D144 and D145), with Seenu's answers of Oct 14, 2026 (below).
- Decisions touched: D96 (studio separation, events, words in files), D113 (no personal data in addresses, events or
  logs; Canadian data processed in Montréal), D91 (accessibility), D112 (tokens), D92 (one API), D143 and D146 (the
  checklist stays on a job's Overview and Home's Up next), D136 (desktop), D128 (coming soon).
- Amends: 0025 (see its "Amendments: D147" section). 0025 is otherwise unchanged.
- Inputs: the D147 mockups (`F_Jobs`, `F_Orders`, `F_JobSubjects`, `F_JobSubjectsFilter`, `F_JobPhotos`,
  `F_JobOrders`, `F_Clients`, `F_Products`), the architect's plan and Seenu's answers to it.

## Seenu's answers (Oct 14, 2026)

These override the architect's plan where they differ.

1. No sales, orders or "% ordered" per job in any list: no per-job sales query, no new index. Jobs' columns are Job,
   Client, Picture day, Status, Shop closes. Home's Selling now (D146) shows no sales either (its closing line:
   answer 7).
2. Jobs' "+ Add filter" offers Shop closes this week, Picture day this month and Client… (no "No orders yet"). They
   are plain query filters on `GET /jobs`, with a search.
3. Subjects has no Group by: one flat list, the class is a chip.
4. Photos' chips are All and Review (Review is the existing page); no "+ Add filter" on Photos; Unsorted later.
5. The planner's defaults are accepted: Orders' Done is shipped, delivered or complete; chips saved on a job's tab
   belong to that job; at most 8 saved chips per list; photographers get no order data and no Not ordered chip;
   Clients and Price lists show only the All chip (Clients keeps its search, Price lists has none); a closed job's
   Shop closes says "Closed"; no View shop button; a grade chip lives in the browser only (never saved, never in the
   address); saving chips writes `list_filters.saved` with the page and the count only; Jobs' Calendar is a "coming
   soon" panel.
6. Class rename (after review): a "Classes N ›" row under the Subjects list, in the job-details row style, opens the
   job's classes in the floating panel, each with Rename (the existing class form in rename mode); roster editors only.
7. Home's Selling now (after review): amber "Closes in N days" when the last day to order is two days or fewer away,
   else "Closes Oct 24" (the closing day, not the midnight moment), or "No closing date", with the Jobs list's
   `closingDay` and `closesSoon`.

## What changed

**Chips.** A list's first row inside its white card is a row of 44px pill chips, exactly one selected (an ink border,
a check and bold text, and `aria-current="true"`: never colour alone). Built-in chips come first; chips the person
added follow, each with its own 44px remove button named "Remove filter: {name}". After them, the dashed
"+ Add filter" pill opens a small panel headed "Show only" with one row per choice the list doesn't have yet; a choice
ending in "…" (Client…, Job…, Grade…) opens a second step in the same panel with Back and a searchable field (the
existing combobox, without "Add new"). Picking adds the chip, opens it, closes the panel and returns focus to the pill
(or to the selected chip if the pill has gone). The search stays a 44px icon at the toolbar's right end. Chips show no
counts.

| List | Built in | "+ Add filter" (saved) |
|---|---|---|
| Jobs | All, Draft, Selling, Closed | Shop closes this week, Picture day this month, Client… |
| Orders | All, To print, To ship, To take to school, Done | Delivery: Home, Delivery: School, Job… |
| A job's Orders | the same | Delivery: Home, Delivery: School |
| A job's Subjects | All, Not ordered (people who see orders), No photos, Possible duplicates | each class, No class, Grade… (browser only), Do not photograph, Do not publish |
| A job's Photos | All, Review | none |
| Clients, Price lists | All | none |

**Address state (D113).** One chip at a time, as enum words and ids only: Jobs `?status=`, `?show=closingThisWeek` or
`?show=pictureDayThisMonth`, `?client=<id>`; Orders To print `?status=paid`, To ship `?status=printed&delivery=home`,
To take to school `?status=printed&delivery=school` (Home's Up next links keep working), Done `?status=done`,
`?delivery=home|school`, `?job=<id>`; Subjects `?show=notOrdered|noPhotos|duplicates|doNotPhotograph|doNotPublish|noClass`
or `?class=<id>`, with `&child=<id>`. Any other combination is All, and the address is replaced. Search text and
grades never go in an address. A chip in the address that isn't saved (a shared link) still shows, selected, without a
remove button.

**Layout.** List pages: the title row is the h1 and the one green action; Jobs has pill sections List and Calendar
under it (`/app/jobs/calendar` is coming soon). A job's page: the section's actions sit at the right end of the tab
row (Subjects: Print QR cards in white, Add subjects in green; Photos: Bin and Upload photos; Review: Mark reviewed),
rendered there by a portal (`JobTabActions`) so they stay in the sticky row, after the tabs in reading and tab order.
`JobSection` has no view bar. The dash `ViewTabs` and `ViewBar` are retired (nothing uses them); `ListCard` gains
`toolbar` and `toolbarEnd`; `SearchToggle` gains `onCard` (a canvas-grey box on white).

**Saved chips in the browser.** `useListFilters` reads the person's chips once. If that fails, the chips stay
unknown: the built-in chips work, but nothing can be added, removed or dropped, the "+ Add filter" choices that would
be saved are hidden, and a notice offers Try again, so a list built from a failed load is never saved over the real
one. Changes show at once; saves go one at a time and the newest list wins (changes made while one is in flight go
next as one list; answers for an earlier page, job or load are dropped); if the newest list can't be saved, the chips
go back to the last list the server accepted. A chip whose name is still loading shows "…", and its remove button names
its kind ("Remove filter: Client").

**Jobs.** Columns Job (name and number), Client, Picture day, Status, Shop closes: a draft "Not selling yet", a closed
job "Closed", a selling one its last day to order or "No closing date"; two days or fewer away it is amber and says
"Oct 15, 2026 · in 2 days" in words (core's `closesSoon`). The D143 progress cell is gone from the list; the job's
Overview and Home's Up next keep the checklist, and `GET /jobs` still returns it.

**Subjects.** A flat list with Photos (ready photos tagged to the child, outside the bin) and Ordered ("Ordered" or
"Not yet", hidden for people who don't see orders) columns. Core's `applyFilters` gains Not ordered and No photos; an
unknown order state (null) never matches Not ordered. A class or grade that leaves the roster stops filtering.
Roster editors rename classes from the "Classes N ›" row under the list (answer 6).

## Data (migration `20261014000000_list_filters.sql`, new)

- `list_page` enum: `jobs`, `orders`, `job_subjects`, `job_orders`, `job_photos`.
- `list_filter_chips`: `studio_id`, `user_id`, `page`, `job_id` (set exactly for the `job_*` pages), `position` 1–8,
  `filter_key` (`^[a-z][a-zA-Z]{1,39}$`), `filter_value` (a uuid or null), `created_at`. Foreign keys
  (studio, user) → `studio_members` and (studio, job) → `jobs`, both on delete cascade. Unique per person, page and
  job on the position and on the (key, value). Row-level security: a person reads their own rows in a studio they
  belong to; no write grant.
- `save_list_filters(studio, page, job, chips jsonb)`: SECURITY DEFINER, `search_path=''`. Checks membership, the job
  in the studio for a job's tab (and none for a studio list), at most 8, each chip an object with a well-formed key and
  a uuid or null as value (checked before any cast, so no value reaches an error message or the database log), no
  duplicates, each key one the page takes (with an id exactly where the key names a record), and every id the
  studio's own client or job, or a class of this job (the API checks the same first; this is the backstop for direct
  calls). Replaces the caller's rows for that page and job and writes one `list_filters.saved` event: the job as
  subject for a job's tab, data `{page, count}` only. Refusals are fixed words (`list_filters_*`). Authenticated only.
  The activity log doesn't show the event (not an activity type).
- `list_children` recreated with `photo_count` and `has_paid_order` per child: a paid order, neither canceled nor
  refunded in full, with a line for the child in this job; null unless the caller is an owner, admin or staff of the
  job's studio. It reads only the orders with a line for a child on the current page. An order refunded only in part
  still counts as ordered, even when the part given back was this child's line. Still SECURITY INVOKER.
- `studio_orders` recreated taking `p_statuses order_fulfilment[]` in place of `p_status`; fully refunded orders are
  still left out of Paid and Printed.

## API

- `GET /jobs` gains `show` (`closingThisWeek`: selling and closing from now to the end of today + 6;
  `pictureDayThisMonth`: today's calendar month, both from `today`), `clientId` and `q` (name or internal number
  contains it, at most 120 characters, like `/clients?q=`). All are filters on the studio-scoped query; paging is
  unchanged.
- `GET /orders` gains `stage=done` (shipped, delivered or complete; never with `status`).
- `GET /jobs/:id/children` returns `RosterChild` (a `Child` with `photoCount` and `hasPaidOrder`); the route also nulls
  `hasPaidOrder` for roles that don't see orders and, carrying order data now, runs in Montréal for Canadian studios
  like `/orders` (`preferredRegion`, `assertFunctionRegion`). `preferredRegion` is per route file, so the same file's
  `POST` (add a child) runs in Montréal too; that is where Canadian roster writes belong anyway (access codes, D113),
  and only `GET` asserts the region.
- `GET /me/list-filters?page=&jobId=` (the caller's chips, filtered by studio and person) and `PUT /me/list-filters`
  (`{page, jobId?, chips}`; each key one of the list's, an id exactly where the key names a record; every client, job
  or class id checked to be the studio's own, a class the job's; 204). Refusals are `validation.filterChips` and never
  repeat what was sent.

## Calls made

1. **This week's end.** The server knows the viewer's `today`, not their time zone. A shop closes at the end of its
   last day in the setter's zone (ADR 0021), which for the US and Canada is local midnight at UTC−2:30 to UTC−10. So
   "this week" ends at (today + 7) 10:00 UTC: a closing at the end of today + 6 anywhere there falls before it, one at
   the end of today + 7 after it.
2. **Shop closes this week lists selling jobs only.** A draft's preset closing date isn't a shop closing; its row
   says "Not selling yet".
3. **The roster's new columns are on the list only.** `photoCount` and `hasPaidOrder` are on `RosterChild` (the
   list's item), not on `Child`: one child's own endpoints (add, edit, claim a blank card) would otherwise need the
   same queries or send made-up values.
4. **Flagged photos count** in a child's photo count (they are the child's, waiting for a check); binned, processing
   and failed ones don't.
5. **A chip added from "+ Add filter" is opened at once.**
6. **Names by id.** A client's or job's chip asks `GET /clients/:id` or `GET /jobs/:id` once per page view; one that
   answers "not found" is dropped from the saved list (and saved). Classes come from the loaded roster. Until a name
   is known the chip shows "…".
7. **Two small changes to shared pieces**: the combobox's "Add new" option is optional (a filter has none), and the
   popover checks focus on the next tick before closing on blur, so a panel can swap its content (the menu's second
   step) without closing.
8. **Commit order.** The locale additions precede the pages (the messages are typed), and the words the retired views
   used leave with the pages.

## Rejected

- Saving the search text or a grade with the chips (D113: they can be personal).
- A tablist for chips: each chip is an address (or a browser-only choice), so links with `aria-current`.
- Per-job sales in lists (Seenu, answer 1).

## Open questions

None: class rename and Home's Selling now were answered on Oct 14 (answers 6 and 7).
