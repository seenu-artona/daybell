# 0013 — Desktop studio app and the job page layout

- Status: Accepted, Oct 11, 2026. Supersedes 0012 (phone tiers). Amends D72.
- Decisions: D136 (replaces D134), D137, D138; touches D126, D128, D129, D133, D75, D23, D24, D91, D92, D96, D112,
  D113, D130. Seenu's answers to the step 2b plan (Q1–Q3, all the defaults) and the architect's calls listed below.

## D136: the studio app is desktop only

Everything under `/app` is built for desktop at a fixed layout and is not responsive. The shell has
`min-width: 1280px`, so it never reflows; a narrower window scrolls sideways. `app/app/layout.tsx` exports
`viewport = { width: 1280, initialScale: undefined }`: a phone lays the page out 1280px wide and scales it to fit, so it
shows the same screen. `initialScale` is cleared on purpose, because Next.js adds `initial-scale=1` by default and the
phone would open at 100% on the top-left corner. `maximumScale` and `userScalable` are never set, so people can zoom
(WCAG 1.4.4). The parent shop stays phone-first.

0012's `DesktopOnly` wrapper and its "Open this on a computer" notice are gone. 0012 itself is left as written (ADRs
are never edited).

**Tests.** Studio e2e specs run in the `desktop` Playwright project only. The `phone` project is kept for the parent
shop and runs only `shop-*.spec.ts` (none yet). Tests tagged `@load` (the 5,000-row roster) run on pushes to `main`,
not on pull requests (`--grep-invert @load`), as agreed with Seenu.

## D137: one job page layout

Five zones, the same in every job section:

1. **Menu** (`app-menu.tsx`, app-wide): the `ink` column, 220px open or a 64px icon rail. The fold choice is kept in
   `localStorage` (`daybell:menu-folded`, `"1"`/`"0"`); every read and write is wrapped, a failed read means open,
   and a choice that can't be saved still holds for the page. Folded items keep their names as sr-only text; there
   are no hover tooltips (WCAG 1.4.13). Top: logo, "Daybell", the fold button (`aria-expanded`, `aria-controls`).
   Then the Search box, the D126 sections ("Soon" per D128), and at the bottom the profile and the bell. There is no
   top bar, no phone header, no tab bar and no "More" sheet.
2. **Job header**: back to Jobs, the job name (h1), its status badge (not clickable), "type · client · picture day ·
   job number", "More actions ▾" (Edit job; there is no delete-job API, so no Delete) and the page's one green button,
   "Start selling", while the job is a draft. Start selling is never disabled; until step 8 it opens a dialog listing
   what is missing. Tabs below are real routes: `/app/jobs/[id]` (Overview), `/people`, `/photos`, `/shop`,
   `/messages`, `/orders`, `/settings`. They are links with `aria-current`, not an ARIA tablist. People shows the
   roster count. `/import` belongs to People.
3. **Section bar**, 40px: search, "+ Filter" and "Group" on the left; the section's white buttons on the right.
4. **Main**: one flat list on white (`Table variant="flat"`), thin row lines, `canvas` group heading rows, 40px rows.
   Cards are used only for Overview's numbers.
5. **Side panel**, 340px, white, border on the left: the selected item, closable with ×. Focus moves to its heading
   when a person opens it and returns to the opener when it closes.

**How it is built.** `jobs/[id]/layout.tsx` renders `JobShell`, which loads the job, the roster count, duplicates and
class count once (`useJob()`). Next.js keeps a layout mounted across its child routes, so moving between tabs, or to
Import and back, never reloads the job. Pages that are not on this layout yet (Home, Jobs, Contacts, Settings, the
coming-soon sections) put themselves in `PageFrame`, the old padded column.

**The selected child is in the URL**, as `?child=<uuid>` (replace, not push), so it survives a refresh and can be
linked. Only an id goes in the URL. An id that is not on the loaded roster is dropped quietly. Filters and the search
text stay in component state, because they may hold names.

**Q3, 40px against 44px targets.** Rows and the section bar are 40px, as drawn. Section-bar buttons, chips, the
group heading controls and other controls look 32px and get a 44px hit area from an invisible pseudo-element
(`HIT_44`). Tabs, menu items and other controls are 44px. D136 makes the studio app desktop and pointer only.

## D138: what step 2b covers

- **Overview.** `packages/core/job-page.ts` works out the journey stage from data that exists now: closed and selling
  follow the status; a draft with no roster is Set up whatever the date; with a roster it is Set up before picture day
  and Picture day from that day on. Review photos and Fulfilment are never returned yet. The next step is "Add your
  roster", then "Get ready for picture day" with the date, then "Upload photos" (coming soon); none once selling. The
  numbers are children (of N expected), classes, possible duplicates (with "Show them") and the picture day countdown,
  in the browser's calendar day. The side panel holds "Before you can sell": only "Roster added" is real; photos,
  tagging, price list and payouts say "Coming soon". Then the job's recent activity, for owners and admins (as Home).
- **People.** The step-2 roster moved here. It loads every page of the existing list API (500 at a time) up to 5,000
  children, the import cap, and draws after the first page. Search, filters, duplicates and per-class counts all need
  the whole roster, and grouping on the server would have needed a new filtered, grouped API. Above 5,000 an info
  banner says only the first 5,000 are shown. No row virtualisation yet; the load test draws 5,000 rows. Search ignores
  case and accents and matches names in either order, the student ID, and (from 4 symbols) the access code without
  its dash. Filters (class, grade, do not photograph, do not publish, duplicates, no class) combine with AND and show
  as removable chips. Group: Class or None. Add and Edit keep the child form dialog (D133); Remove is in the panel's
  ⋯ menu and in the form while the job is a draft. Import stays a full page and lands back on People.
- **Photos, Shop, Messages, Orders, Settings** show the D128 coming-soon panel inside the job frame. Any other tab is
  a 404.
- **Menu search** replaces the ⌘K palette (D129). `POST /api/v1/search` with `{ q }`, 2 to 100 characters, any member.
  It calls `public.search_studio`, a SECURITY INVOKER SQL function with an explicit studio filter: jobs by name or
  internal number, clients by name only (never the contact person), never children. LIKE wildcards are escaped,
  text under 2 characters returns nothing, and it never raises, so typed text can't reach the Postgres log. At most 10
  jobs and 10 clients, starts-with matches first. **POST, not `GET ?q=`**: people will type names into a global box,
  and ADR 0011 keeps text that may be a name out of URLs and request logs. The combobox follows ARIA 1.2 (listbox with
  "Jobs" and "Clients" groups), waits 250ms, keeps only the newest answer, and never logs the text. ⌘K / Ctrl+K
  focuses it (`aria-keyshortcuts`), never shown as a label. A client result opens
  `/app/contacts/clients?client=<id>` in the client dialog (new `GET /api/v1/clients/{id}`), read-only for people who
  aren't owners or admins (Q2).
- **Job activity.** `GET /api/v1/studio/activity?jobId=` answers 404 for a job outside the caller's studio, then shows
  only that job's `job.*` and `roster.*` events. A forward migration adds `events (studio_id, subject_id, id desc)`:
  every 5,000-row import writes about 5,020 hidden events, and without it the per-job query walks the studio's log.
- **Notifications**: the bell opens "No notifications yet." The real bell is step 8.
- **Profile** (Q1): Daybell stores no names, so the button shows initials from the email, the email and the studio.
  Its menu has Settings, View my shop, Help and Sign out.

## The architect's calls (approved)

- The `canvas` token stays #FAFBFA (D130); the brief's #F6F5F1 is not used, and `tokens.json` is unchanged.
- Search is a POST through a SECURITY INVOKER RPC (above).
- "Start selling", "More actions" and the job's activity are for owners and admins only.
- Help and "View my shop" moved into the profile menu, so the menu holds only D126's sections.

## Rejected

- Responsive studio screens or phone tiers (0012): replaced by D136.
- Server-side grouping with lazy groups for People: it breaks filtering across classes.
- Filters in the URL: the grade filter carries roster text, which is personal data.
- Hover tooltips on the folded rail (WCAG 1.4.13).
