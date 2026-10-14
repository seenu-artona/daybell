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
  "Delivery: Any" and (Orders page only) "Job: Any"; the reference search submits on Enter; Clear filters while a
  filter is set; the bulk bar stays. Home's `?status=` and `?delivery=` links still work.
- Clients: the menu item and page are "Clients" (key `contacts` and route `/app/contacts/clients` unchanged); the
  disabled Parents and Children tabs are gone; search by name through `GET /clients?q=` (300ms after typing stops,
  from the first page again); New client; a row or its name opens the existing dialog (edit for owners and admins,
  view otherwise), so the Edit buttons are gone.
- Price lists: New price list; Make default and Delete stay visible on the row as quiet buttons; "Prices before tax"
  is the card's footer.

**Job page.** The header and the tabs share one sticky block. Its negative top lets the title row scroll away while
the 72px tab row stays; once stuck (an IntersectionObserver sentinel) it turns canvas with a hairline and shows a back
button and the job's name in small type (`aria-hidden`; the h1 stays in the page). No animation with reduced motion.
`html:has([data-sticky-header])` keeps focused controls 88px clear of it (WCAG 2.4.11), and the floating panel sticks
at 88px. The shop button (Start selling, Close shop, Reopen shop) is a white pill before the round ⋯; dialogs are
unchanged. The tab row shows only the built sections (Overview, Subjects, Photos, Shop, Orders); Messages and Settings
keep their routes and open by address. People is labelled Subjects. A section's heading is a visually hidden h2; its
green subline is gone.
- Subjects: views All · Possible duplicates · Do not photograph · Do not publish in `?show=`; the open child keeps the
  view (`?show=…&child=<id>`). Quiet menus "Class: All" (each class and No class), "Grade: All" (only when the roster
  has grades) and "Group: None"; quiet Print QR cards; the search; the green "Add subjects" menu (Add child, Import
  roster) for roster editors. The view, class, grade and search combine with AND through core's `applyFilters`. The
  duplicates notice's "Show them" switches to the duplicates view. The roster's size moved from the tab to the list
  card's footer ("6 children · 3 classes · no duplicates").
- Photos: views All and Review; a quiet Bin (n) or Back to photos and the green Upload photos; the counts are a muted
  line above the grid. Review's Mark reviewed is the green action (still disabled with its reason as description).
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
focus); the Orders delivery menu uses short values ("Delivery: Home"); a filtered Jobs view with no jobs says so rather
than showing the first-job card; Price lists keep their intro line.

## Waiting on API data (defaults used)

- B1: Subjects' Ordered / Not ordered / No photos views need per-child order and photo data; the flag views ship instead.
- B2: Jobs has no season filter and only draft, selling and closed: views All · Draft · Selling · Closed, no Season menu.
- B3: Orders has no Printing/Refunded statuses or season: the existing statuses are the views, no Season menu.

## Rejected

- An ARIA tablist for views and sections: each is its own address, so links with `aria-current`.
- Hover-only row actions: nothing appears on hover; a row's main link or button stays the keyboard target.
- Search text in the address: it may hold a child's or client's name (D113).
