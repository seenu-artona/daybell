# 0029 — Record pages, a job's Progress, Subjects' record and job templates

- Status: Proposed with UI round 5 (branch `ui/round5-job-pages`). Every call under "Calls for Seenu" is provisional
  until Seenu reviews it (CLAUDE.md rule 7: nothing decided is changed silently).
- Decisions implemented: D151 (one blueprint for every record page), D152 (Job › Overview), D153 (Job › Subjects), D154
  (Templates and the Settings hub); Seenu, Oct 14, 2026, with the frozen designs `V_DetailsTimeline`, `S4_Subjects`,
  `S4_SubjectsPerson`, `T1_Settings`, `T2_Template`, `T3_NewJob` and `L_Template`.
- Decisions touched: D143 (the checklist stays the source of "done" and Home's Up next), D147 and D148 (chips; what
  "ordered" means), D96 (studio separation, events, words in files), D113 (Montréal; ids only in addresses), D91, D92,
  D75, D133.
- Amends: 0017 (the Overview's checklist card), 0021 (the shop's header button and the closing date's place), 0025 (the
  job header's details line; Subjects' columns and floating panel), 0026 (Subjects' chips), 0020 and 0023 (Settings'
  frame; their content is unchanged), 0010 (the job form's rows).

## What changed

**Data** (`20261015000000_job_templates.sql`).

- `job_templates`: `studio_id`, name (1–80), `qr_cards_days_before` (0–60, null: no day planned), `shop_opens`
  (`photos_checked` or `after_picture_day`) with `shop_opens_days` (0–180, exactly with `after_picture_day`),
  `shop_closes_days` (1–365, null: closed by hand), `price_list_id` (composite key to the studio's lists; a deleted list
  leaves the studio's default) and `deliver_to_school`. Row-level security: members read, owners and admins add, change
  and delete; a template never moves studio.
- `studios.default_job_template_id` (composite key, `no action`, as the default price list): one default per studio,
  never cleared (a trigger) and never deleted (the key). Every studio is seeded with one template, "Standard", from
  today's behaviour (call 2), by a trigger on new studios and a backfill for existing ones, both without events.
- `jobs` gain `template_id` (composite key, `on delete set null (template_id)`), the four rule columns, `template_rules`
  (what the template gave the job: a snapshot nobody can change, guarded by a trigger even for the database owner) and
  `opened_at` (the shop's first opening, the database's). A before-insert trigger copies the chosen template (else the
  default) into the rule columns and the snapshot, and its price list and school delivery unless the job names its own.
  Browsers may insert `template_id` and update the rule columns only. Template changes therefore reach new jobs only.
  Existing jobs link to no template and have no snapshot (call 1).
- When a draft's shop first opens, a trigger keeps `opened_at` and, if the job has a closing rule and no closing date,
  sets `closes_at` to the opening moment plus its days (call 4).
- Events (ids and field names only): `job_template.created`, `.updated {fields}`, `.deleted`, `.made_default`;
  `job.updated` names the rule fields. `job.created` is unchanged.
- `list_job_templates(studio)` (SECURITY INVOKER; how many jobs use each), `job_progress_facts(studio, job)` (SECURITY
  DEFINER with one membership check and `studio_id` on every read, like `job_checklist_facts`, because the event log is
  owners' and admins' only: dates for the team, who for owners and admins), `job_sales(studio, job)` (SECURITY INVOKER,
  refused with 42501 for anyone but owners and admins), `child_record_facts(studio, child)` (SECURITY INVOKER: the card's
  first print and the camera's day of the first photo), `studio_orders(..., p_child_id)`, and `save_list_filters`
  taking Subjects' `duplicates` and `noPhotos`.

**API** (D92): `/job-templates` (list, add, one, change, delete, `/default`, `/copy`); `Job` gains `template`, `rules`,
`changedRules` and `openedAt`; `POST /jobs` takes `templateId`; `PATCH /jobs/:id` takes the job's own rules (checked
whole); `POST /jobs/:id/rules/reset {rule}` (undo); `GET /jobs/:id/progress?today=`; `GET /jobs/:id/sales` (owners and
admins, `preferredRegion = "yul1"` and `assertFunctionRegion`, D113); `GET /children/:id/facts`; `GET /orders?childId=`
(region-pinned like `/orders`). Core: `templates.ts` (rules, limits, planned days, changed rules, undo) and
`progress.ts` (six stages from the job's checklist, so Progress and Home's Up next never disagree).

**Screens.**

- Job header (D151, D152): back, name, status pill (the only place status shows), no details line; ⋯ More (owners and
  admins: Preview as a parent and View as photographer marked Soon, Edit job, Close shop or Reopen shop, History) and
  one green action: Publish shop on a draft (the existing "Before you can sell" dialog), View shop while selling, none
  once closed.
- Overview: Sales and Subjects ordered cards (owners and admins, once the shop has opened; Sales by Home's rule, % of
  everyone on the roster), Progress, and Details (no box: Client, Picture day, Template with "N changes for this job",
  and a pencil opening the existing Edit job dialog). Progress: Prepare, Picture day, Photos, Selling, Fulfilment,
  Wrap-up; done steps dimmed with when and who, the step to do now with its one action, steps ahead with their planned
  day, automatic steps from the job's rules, Soon steps (Reminders, Send to lab, Delivery, Yearbook export, Archive);
  finished stages fold to one line; Change on a step's rule and "Changed for this job · Undo".
- Subjects (D153): white Print ▾ (QR cards) and Add subjects ▾ (Upload a list, Add one by one); chips All, Not
  photographed, Not ordered, + Add filter; columns Name with small tags, Class, Photos, Ordered pill; 56px rows. Opening
  a person folds the list to its Name column in the same card (same chips and search; grey row with a 3px ink bar and
  `aria-current`; ↑↓ move) and shows their record: Photos and Orders, Details (parent email masked) and QR card.
- Settings (D154): sections on the left with icon tiles and chevrons, the section's cards on the right; Templates
  grouped Jobs, Messages, Print; a template's page (name edited in place, Default, Used by N jobs, ⋯ Make default,
  Duplicate, Delete; sections Steps, Shop, Messages, Subjects and photos; each step a card opening a small dialog).
- New job dialog: Name, Client, Picture day, Template with one sentence on what it will do; the same dialog edits a job.

## Calls for Seenu

Data and rules

1. **Existing jobs link to no template** (the safe migration D154 offered): no snapshot, so nothing on them reads
   "Changed for this job", and Details says Template: None. Their rules are today's behaviour.
2. **The seeded template** is named "Standard" and keeps today's behaviour: no day planned for QR cards, the shop opens
   when photos are checked (someone presses Publish shop, as today), it closes when someone closes it, the studio's
   default price list, no school delivery. The design's "School Fall" values (5 days, 10 days) are not seeded.
3. **"Shop opens N days after picture day" plans a day only.** Nothing opens a shop by itself; Publish shop and its
   server checks stay manual. "When photos are checked" reads as a condition, not an automation.
4. **"Shop closes N days after opening"** sets the closing date when a draft first opens (the opening moment plus N
   days of 24 hours counted in UTC, as core counts them, so a daylight-saving change never moves it; not the end of a
   local day), unless a date is already set. Reopening a closed shop sets none.
5. **A selling job's closing date other than its template rule's counts as a change** to Shop closes (so a date set by
   hand on a job whose template closes by hand shows "Changed for this job"). Undo puts the rule's date back; when that
   date has already passed, Undo is refused and **nothing is reset** (neither the rule nor the date). A shop reopened
   after its rule's date has passed (closing clears the date) is **not** marked changed (code review M2).
5a. **The closing date is set, moved or removed on Progress's Shop closes step whenever the job is a draft or selling,
   whatever the step's state** (Change date, owners and admins), so a selling job whose photos need checking again can
   still change it, and a draft can hold a date again as ADR 0021 allowed. A draft holding a date shows that date, not
   its rule (the rule then sets nothing when the shop opens). Drafts also keep the rule's Change.
6. **At most 50 templates per studio**, checked by the API and again by the database (a trigger that locks the
   studio's row, so two adds at once can't pass 50); names up to 80 characters; rule days 0–60 (cards), 0–180 (opening), 1–365
   (closing).
7. **A template some jobs use can be deleted** (not the default): its jobs keep their copy and Details says None.
8. **Template events aren't in the activity log** (they are written to the outbox).
9. **Job sales**: the paid orders with a line in this job, as its Orders tab lists them; an order with lines in two jobs
   counts in both. The Orders count is paid orders; "since" is the first one's payment day; the percent is rounded.
   The currency is the orders' own; a job with no orders yet (all zeros) shows the region's currency.
9a. **School delivery on a new job**: the job's own choice wins, even an explicit false; left out, the template's
   (code review M3). The column lost its `false` default so "left out" can be told apart; the trigger fills it in.

Screens

10. **Templates is visible to photographers and staff, read-only** (members read templates in the database); Stripe and
    Taxes stay owners' and admins'.
11. **The New job dialog keeps job type, internal number and subjects expected under More options** (D154 lists Name,
    Client, Picture day, Template; ADR 0010 had Picture day | Job type on its second row). Type still defaults to School.
12. **Editing a job shows its template as text** (chosen when it is made). The closing date left the Edit job dialog
    and ⋯ "Set closing date" is gone: it is changed on Progress's Shop closes step (D152).
13. **Publish shop's dialog** keeps its title ("Before you can sell") and intro words; its confirm button now says
    Publish shop.
14. **View shop opens `/shop` in a new tab** (the one parent shop address, ADR 0022: there is no per-job public page;
    parents enter a code). It shows to everyone on the team while selling.
15. **⋯ More is for owners and admins only** (its items are theirs; History needs the event log). Preview as a parent
    and View as photographer are listed, marked Soon, and can't be chosen; History adds a line "Team comments are
    coming soon".
16. **Progress**: the step to do now has a warm (warning-soft) row with the word "Now" for screen readers; a finished
    stage is a button that opens it; "Change" appears on steps ahead that have a rule (owners and admins), not on the
    step to do now (one action); after the shop closes the header says "Now: Fulfilment". Makeup day isn't a Progress
    step (it is Soon in templates only). Who did a step is a team member's email (owners and admins only).
17. **The number cards** use the Overview's white cards with Sales highlighted in lime as on Home, without Home's
    count-up animation.
18. **Subjects' chips**: Not photographed and Not ordered are built in; No photos (built in since D147) moves to
    + Add filter with Possible duplicates, both savable; Add filter's order is the classes, No class, Possible
    duplicates, No photos, Grade…, Do not photograph, Do not publish.
19. **Subjects' columns** drop the avatar, Student ID, Grade and Access code (D153's columns); the access code is on the
    record's QR card. The record also shows **Grade** when the person has one, and Do not publish and Possible
    duplicate as tags (D153's Details list doesn't name them; kept so nothing is lost).
19a. **"Photographed"** is the camera's own clock at the first photo (it has no time zone), shown as its day as it
    stands, never shifted through UTC. The record reads the card's Printed date again after a print there or of the
    whole job.
20. **The record**: Escape goes back to the full list, as the floating panel did; the card's link reads "Print QR card"
    before the first print and "Print again" after; up to 12 photos and 20 orders show, each order linking to its page.
    US studios' photos can't be shown yet (no US storage), so the record says so.
21. **Words**: new words say "subjects"; the Subjects tab's existing words that say "children" (its heading, footer,
    search label, "Add child" dialog) are unchanged, as ADR 0028's decision B left them.
22. **The parent email is masked on screen only**; the roster API returns it to the team as before (roster editors
    see it whole in the edit form).
23. **`GET /children/:id/facts` isn't pinned to Montréal**: it returns two dates and nothing personal.
24. **A template's section is in its address** as `?section=` (an enum word); the name is edited in place by a pencil
    that turns the heading into a field (Save, Cancel, Escape).
25. **The roster API still gives the whole team full parent emails and access codes**; the masking is on screen only.
    Question for Seenu: strip them server-side for roles that can't edit the roster (staff)?
26. **`GET /jobs/:id/progress` returns team members' emails to owners and admins and isn't pinned to Montréal**, like
    `/studio/team` and `/studio/activity`. Question for Seenu: are team (adult staff) emails in D113's pinning scope?
27. **⋯ More on a job has five rows** (Preview as a parent and View as photographer marked Soon, Edit, Close or Reopen,
    History), more than D151's "at most 3 secondary".
28. **Picture day changes only through the Edit job pencil**, not on its own Progress step (D152's "a date is changed
    on its own step" is followed for the closing date and the rules).

## Not in this round (deferred)

Opening a shop by itself; Reminders, Send to lab, Delivery, Yearbook export, Archive and Makeup day (Soon); message and
print templates; Preview as a parent, View as photographer and team comments; Subjects' tick boxes and bulk bar,
Family, Yearbook, Notes, flyers, sign-up link and makeup day (D153).

## Tests

pgTAP `028_job_templates` (row-level security and grants, seeding, the default never cleared or deleted, the copy and
its snapshot, template changes reaching new jobs only, the opening rule, events without names, Progress facts with who
for owners only, job sales for owners and admins only, a person's dates and orders, cross-studio leaks for each). Core
(`templates`, `progress`, Not photographed, `maskEmail`), API contracts, route tests with studio-scope leak tests for
every new route (including Montréal for sales), screen logic (`rules`, `progress-view`, Settings sections, chips, ↑↓).
e2e: new `phase1-templates`; updated going-live, job-page, jobs, payouts, photos, qr-cards, roster, tagging and people.
The e2e specs could not be run in this environment.
