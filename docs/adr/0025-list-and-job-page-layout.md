# 0025 — List and job page layout: one view bar, list cards, sticky job tabs

- Status: Proposed with the D144 UI PR. Provisional until Seenu reviews it (the defaults in "Calls made" are listed in
  the PR too).
- Decisions: D144 (amends D139 and D140); touches D143, D137, D138, D126, D128, D91, D96, D112, D92, D113, D136.
- Amends 0014 (job page style): the active tab pill, the section heading row, the round Filter and Group buttons, the
  visible search box and filter chips, and the sheet card's corners. 0014 is not edited.
- UI only: no schema, migration, API contract, RLS, event or region changes. Screens use the existing endpoints
  `GET /jobs?status=`, `GET /orders?status=&delivery=&jobId=&q=`, `GET /clients?q=` and `GET /price-lists`.

## What changed

**Tokens.** `line-canvas` (#DAD7CF, the hairline under a view bar and the stuck job header), `radius-list` (20px),
`shadow-card` (two soft layers) and the `job-title` type style (28/36, 700). `theme.css` is regenerated from
`tokens.json`; `cn` knows the named radius and shadow tokens so `rounded-list` replaces an earlier `rounded-xl`. Hover
is canvas grey, hairlines are `line`, the faint row chevron is `line-strong` (decorative), inactive tabs are `muted`
(5.3:1 on canvas), the current main tab is `ink` with `on-primary` text. The Design System artifact must be updated in
step (`tokens.json`'s `_source`).

**Design-system pieces** (`packages/ui`). `PageHeader` (a list's h1 alone, or a record's back button, 28px h1, status,
details line and actions); `MainTabs`/`MainTab` (44px pills, the current one ink, white and bold, links with
`aria-current`); `ViewBar` (views left, tools right, one hairline under it); `ViewTabs`/`ViewTab` (56px links, the
current one bold with a 4px ink dash that is `aria-hidden`; the row scrolls sideways when full at 1280px);
`SearchToggle` (a 44px icon button that opens a search box with the same name); `ListCard` (white, 20px corners, soft
shadow, optional footer); `Table variant="list"`; `ClickableRow` and `RowChevron`; a `quiet` Button variant and
IconButton tone. `Card variant="sheet"` now has 20px corners and the soft shadow, so Home's sheet cards change too.

**List pages.** Jobs, Orders, Clients and Price lists share `ListPage`: full width on the canvas, the h1 alone (no
intro), then one view bar over the list card. Views are links that change the address (`?status=`); the tools at the
right end go in this order: quiet menus, quiet actions, search, then the one green action.
- Jobs: views All · Draft · Selling · Closed (`GET /jobs?status=`); New job; rows are clickable, the job's name stays
  the link and the job number sits under it; the D143 progress cell and its Next link are unchanged; Show more in the
  card's footer.
- Orders (and a job's Orders tab, the same component): views All plus every fulfilment status; quiet menus
  "Delivery: Any" and (Orders page only) "Job: Any", whose long job names are cut with an ellipsis on screen only; the
  reference search submits on Enter; Clear filters while a filter is set, which closes the search and puts focus on
  the current view; the bulk bar stays. The view and the delivery are both in the address (`?status=`, `?delivery=`)
  and switching one keeps the other; the job and the search stay in the browser and survive a view switch. Home's
  links still work.
- Clients: the menu item and page are "Clients" (key `contacts` and route `/app/contacts/clients` unchanged); the
  disabled Parents and Children tabs are gone; search by name through `GET /clients?q=` (300ms after typing stops,
  from the first page again); New client; a row or its name opens the existing dialog (edit for owners and admins,
  view otherwise), so the Edit buttons are gone.
- Price lists: New price list; Make default and Delete stay visible on the row as quiet buttons; "Prices before tax"
  is the card's footer. The intro line is gone, like the other list pages'.

Rows open their item on a click anywhere except on their own links, buttons and form controls, or at the end of a
text selection; Ctrl- or Cmd-click opens the row's main link in a new tab. Paged lists drop answers that a newer view,
filter or search overtook, and run one "Show more" at a time (`lib/load-guard.ts`).

**Job page.** The header and the tabs share one sticky block. Its negative top lets the title row scroll away while
the 72px tab row stays; once stuck (an IntersectionObserver sentinel) it turns canvas with a hairline and shows a back
button and the job's name in small type (`aria-hidden`; the h1 stays in the page). No animation with reduced motion.
While stuck, the header's own back link leaves the tab order and the accessibility tree (one back link at a time), and
focus moving into the header scrolls the page back to it (instantly with reduced motion), so its controls stay
reachable. One CSS variable, `--sticky-header-height` (72px), sizes the tab row; `html:has([data-sticky-header])` keeps
focused controls that plus 16px clear of it (WCAG 2.4.11), and the floating panel sticks at the same place. The shop button (Start selling, Close shop, Reopen shop) is a white pill before the round ⋯; dialogs are
unchanged. The tab row shows only the built sections (Overview, Subjects, Photos, Shop, Orders); Messages and Settings
keep their routes and open by address. People is labelled Subjects. A section's heading is a visually hidden h2; its
green subline is gone.
- Subjects: views All · Possible duplicates · Do not photograph · Do not publish in `?show=`; the open child keeps the
  view (`?show=…&child=<id>`). Quiet menus "Class: All" (each class and No class), "Grade: All" (only when the roster
  has grades) and "Group: None"; quiet Print QR cards; the search; the green "Add subjects" menu (Add child, Import
  roster) for roster editors. The view, class, grade and search combine with AND through core's `applyFilters`. The
  duplicates notice's "Show them" switches to the duplicates view. A class or grade that leaves the roster stops
  filtering. The roster's size moved from the tab to the list card's footer ("6 children · 3 classes · no
  duplicates"; the duplicates part waits for the job's summary).
- Photos: views All and Review; a quiet Bin (n) or Back to photos and the green Upload photos; the counts are a muted
  line above the grid (its photo count is hidden from screen readers, which hear it in the section's h2). Review's Mark reviewed is the green action (still disabled with its reason as description).
- Overview, Shop, Import, Messages and Settings keep their content in the new frame; Shop's "Prices before tax" sits in
  the price list card.

**Address state (D113).** Only enum words and ids go in page addresses: `?status=` (job or order status), `?show=`
(a Subjects view), `?delivery=` and `?child=<uuid>`. Search text never does; the class, grade, job and grouping
choices stay in the browser.

## Calls made in this step

1. The job header keeps its details line. 2. No "View shop" button (there is no studio-side shop page). 3. The shop
state button stays, as a white pill. 4. Messages and Settings leave the tab row. 5. The Subjects count moves to the
footer. 6. No List/Calendar tabs on Jobs (Calendar isn't built). 7. The search icon is only on Subjects, Orders and
Clients. 8. The removed filters became quiet menus or views; view tabs scroll sideways at 1280px. 9. Price lists keep
"Price lists" / "New price list" and their row actions. 10. Routes are unchanged (`/app/contacts/clients`, `/people`).
11. Menu order is unchanged (D126). 12. Home, Settings, an order and a price list keep PageFrame (only the sheet card
style changes). 13. `/dev/components` is not updated. 14. "Show more" stays a footer button.

Also: a search box closes when it is left empty (Escape on it puts focus back on the button; tabbing away does not move
focus), and its button has no `aria-controls` because the box doesn't exist until it opens; the Orders delivery menu
uses short values ("Delivery: Home"); a filtered Jobs view with no jobs says so rather than showing the first-job card.

**Leak test.** `app/api/v1/clients/route.test.ts` checks that `GET /clients?q=` is scoped by `studio_id` from the
caller's studio and that `q` is an ilike on the name only.

## Waiting on API data (defaults used)

- B1: Subjects' Ordered / Not ordered / No photos views need per-child order and photo data; the flag views ship instead.
- B2: Jobs has no season filter and only draft, selling and closed: views All · Draft · Selling · Closed, no Season menu.
- B3: Orders has no Printing/Refunded statuses or season: the existing statuses are the views, no Season menu.

## Rejected

- An ARIA tablist for views and sections: each is its own address, so links with `aria-current`.
- Hover-only row actions: nothing appears on hover; a row's main link or button stays the keyboard target.
- Search text in the address: it may hold a child's or client's name (D113).

## Amendments (Oct 14, 2026): D145 (amends D144)

Seenu tried the D144 UI on staging and asked for these changes (D145, amends D144). UI only: no schema, migration,
API contract, RLS, event or region changes. Where they differ from the sections above, these win.

1. **Tab levels.** The first row of tabs on any page is pills (`MainTabs`, the current one near-black); dash
   `ViewTabs` are only a second level under pill tabs. Jobs (All · Draft · Selling · Closed) and the Orders page's
   status views are pills, still links with `aria-current`. Their tools sit on the same row at the right end, and that
   row has no line under it: `ViewBar` has `variant="main"` (the default, no line) and `"sub"` (the hairline, for the
   dashes). The job page keeps pill job tabs over dash sub tabs (Subjects, Photos, the job's Orders: `JobSection` uses
   `"sub"`, and `OrdersList` takes `level="sub"` there). `MainTabs` scroll sideways when full at 1280px. Clients and
   Price lists have no views; their tool row loses its line too.
2. **Jobs rows.** The Progress cell is one line, "5 of 7 · Next: Picture day" (the next task stays a link, D143; a
   closed job ends with "All done"). The milestone pill is gone from the row: the Status pill already says the shop's
   state. The line never wraps; a long task is cut with an ellipsis on screen only, and its text and the link's name
   stay whole for screen readers.
3. **One filter icon.** The quiet menus are gone (QuietMenu and its test removed). Subjects (Class, Grade when the
   roster has grades, Group by) and Orders (Delivery, and Job on the Orders page) have one 44px filter icon: named
   "Filter", or "Filter (n on)" with a small dot while filters are set (words, not colour alone, D91), with
   `aria-expanded`. It opens the existing Popover with one named radio group per filter (the same options) and, while
   any is set, Clear filters, which resets them, closes the panel and puts focus back on the icon. The right end's
   order is now: filter icon, search, quiet actions, then the one green action (Subjects: filter, search, Print QR
   cards, Add subjects). Orders' delivery stays in the address (`?delivery=`); the bar's own Clear filters is gone.
4. **Home.** Home leaves PageFrame for `ListPage`: the h1 alone on the canvas, the date range at the right end of the
   row under it. Every section is a white list card named by its h2; rows that open somewhere are one link each in the
   ClickableRow style (16px, canvas grey on hover, name underlined, faint chevron that darkens). Links are ink; Home
   has no green action. Data and D143 behaviour (setup checklist, Up next with reasons) are unchanged. Call 12 now
   reads: Settings, an order and a price list keep PageFrame.

Calls made in the amendment:

- A. Group by sits in the filter panel with Class and Grade (Seenu listed it); it counts as "on" when it is not None,
  and Clear filters sets it back to None.
- B. Orders' Clear filters (in the panel) clears the delivery and the job, not the reference search, which keeps its
  own box (emptying it closes it and drops the search). The earlier "focus on the current view" is replaced by focus
  back on the filter icon.
- C. The filter icon is lucide's Funnel; the panel scrolls when a studio has many jobs.
- D. Jobs rows that wait with no next task (a milestone but no next) show only "5 of 7".
- E. Home never had a page intro, so nothing was removed there. Up next keeps its own muted line ("Picked from all
  your jobs, most urgent first") under its card title, as D143 has it. Recently on Home is now a region named by its
  heading.
- F. The setup checklist's rows on Home use the new row look (`ChecklistGroups look="rows"`); the job Overview's
  checklist keeps its plain look.

## Amendments (Oct 14, 2026): D146 (amends D143, D127 and D145)

Seenu approved a new Home (D146). UI only: no schema, migration, API contract, RLS, event or region changes; Home reads
the same `GET /studio/sales`, `GET /studio/checklist` and `GET /jobs?status=selling` as before. Where it differs from
the D145 Home above, this wins.

1. **Title.** The h1 is "Good morning", "Good afternoon" or "Good evening" by the browser's hour (5-11, 12-17, else;
   `greeting.ts`), with no subline. Home leaves `ListPage`: the date range pill sits at the right end of the title row.
   There is no New job button.
2. **Numbers.** Four separate white cards (20px corners, soft shadow): Sales (still lime-highlighted), Orders, Average
   order, Daybell fee.
3. **Up next.** One white card, "Up next" with "Picked from all your jobs, most urgent first", replaces the To do card
   and the three-row Up next: up to five rows mixing the jobs' D143 tasks with the orders waiting (to print, to ship,
   to take to school), as plain links (task · job, a 14px muted reason line, the faint chevron). `upNextRows` merges
   them by D143's tiers, the order to-dos counting as "money is waiting" (core's `upNextRank`: after something broken,
   before the next step). The sort is stable: ties keep the server's order (nearest picture day first), and the order
   to-dos go print, ship, school. "N more jobs in Jobs" counts the jobs not shown.
4. **Selling now.** Quiet text on the canvas, not a card: an h2 with "All jobs" (always shown) at its right, each
   selling job one link with its name and closing date, thin lines between rows.
5. **Recently** is gone from Home (the job Overview keeps its activity).

Role checks are as before: the numbers and the range for owners and admins (`canSeeSales`); the orders waiting for
everyone who sees orders (`canSeeOrders`); job tasks for everyone, linked only where the role can do them. The setup
checklist is unchanged.

Calls made in the amendment:

- G. **No first name.** Daybell stores no names for team members, only emails (Q1 of step 2b), and `GET /me` returns
  none, so the greeting has no name until it does. Not derived from the email.
- H. **Next payout** has no amount in any API (`GET /studio/payouts` gives only the next payout day, Canada only), so
  the fourth card stays Daybell's fee.
- I. **Selling now's sales, families bar and order count** are not in `GET /jobs`, so each row shows the name and
  closing date only, as before.
- J. While the setup checklist shows (or the checklist can't be loaded), the orders waiting get their own Up next card
  under it, left out when nothing is waiting, so they never disappear for a studio still in setup.
- K. The server still sends only the three most urgent jobs (`UP_NEXT_SHOWN`), so with three urgent jobs and three
  order to-dos the fifth row is chosen from those six.

## Amendments (Oct 14, 2026): D147 (amends D144 and D145)

Seenu approved filter chips for the lists (D147); ADR 0026 records them in full. Where they differ from the sections
above, these win.

1. **No longer UI only.** D147 adds a migration (`20261014000000_list_filters.sql`: saved chips with row-level
   security, the roster's photo and order columns, Orders by several statuses), API fields and parameters
   (`GET /jobs?show=&clientId=&q=`, `GET /orders?stage=done`, `GET`/`PUT /me/list-filters`, `RosterChild`) and an event
   (`list_filters.saved`, page and count only). The roster list now carries order data, so it runs in Montréal for
   Canadian studios like `/orders`.
2. **Views become chips.** The pill views on Jobs and Orders, the dash views on Subjects, Photos and a job's Orders, the
   filter icon and its panel (FilterMenu), Group by and the view bar (ViewBar, retired) are replaced by one row of chips in each list
   card's toolbar, with "+ Add filter" and the search at its right end. The address keeps one chip as enum words and
   ids only (D113).
3. **Title row and tab row.** A list page's green action sits in its title row; a job section's actions sit at the right
   end of the job's tab row, also when it sticks. Jobs gets pill sections List and Calendar (Calendar is coming soon),
   so call 6 above no longer holds.
4. **B1 resolved.** Subjects' Not ordered and No photos chips and its Photos and Ordered columns use the roster's new
   `photoCount` and `hasPaidOrder`; photographers get neither the column nor the chip.
5. **Jobs rows.** The D143 progress cell is removed from the Jobs list (Seenu: no per-job progress or sales in lists);
   columns are Job, Client, Picture day, Status and Shop closes. The checklist stays on the job's Overview and in Home's
   Up next (D143, D146).
6. **Clients and Price lists** show the All chip only; Clients keeps its search.
7. **Class rename** moves from Group by's headings to a "Classes N ›" row under the Subjects list and its panel.
8. **Home's Selling now** says "Closes in N days" in amber with words when the shop closes in two days or fewer.
