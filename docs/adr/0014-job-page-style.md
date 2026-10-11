# 0014 — Job page style: canvas, cards, timeline and floating panel

- Status: Accepted, Oct 11, 2026. Amends 0013 (D137 zones 2–5 and D138's Overview).
- Decisions: D140 (amends D137 and D139); touches D91, D96, D112, D128, D130, D136. Seenu's answers to the step 2c
  plan (1–10) and the calls listed below. No schema, API, event, RLS or region changes.

## What changed

**Canvas and cards.** The job page has no white header block: everything sits on the grey canvas, and content lives
in white "sheet" cards with 24px corners, no border and hairline rows. `canvas` is now #F3F2EE, a warm grey (answer
1); muted text on it is 5.3:1 and the green subline 4.8:1 (checked in `tokens.test.ts`). New tokens: `radius-xl`
(24px, sheet cards and floating panels) and the `hero` type style (40px, 800, line height 1.05, letter spacing
-0.02em, answer 5); the theme generator now writes a type style's letter spacing. Colours in the mock-ups map to
existing tokens; no hex is copied into components.

**Design-system pieces** (`packages/ui`): `Button` gets `shape="pill"` and a borderless `white` variant;
`IconButton` is round and 44px with a required `label` (its accessible name), `surface` or `canvas` tone, and
`asChild` for links; `IconChip` is a decorative pastel tile (or a round initials avatar), always `aria-hidden`;
`Card variant="sheet"` and `CardRow` draw the white cards and hairline rows. `buttonVariants` now merges its classes
so a pill's rounding wins over the size's.

**Title row and tabs.** A round back button, the job's name (h1), its status pill and the details line under the
name; on the right a round ⋯ ("More actions", Edit job) and the green "Start selling" pill (owners and admins, while
a draft; unchanged behaviour). Section tabs are a row of pills: the active one white and bold with `aria-current`.
The People count stays in the tab's name.

**Overview.** One hero line ("Picture day in N days", "is today", "is tomorrow", "was N days ago", or "This job is
closed") and a green subline ("Step 1 of 5 · Set up · 1 of 3 done"). One job timeline of five milestones replaces both
the journey bar and "Before you can sell": Set up, Picture day, Photos in, Selling, Fulfilment. `packages/core`
works it out (`milestone`, `timeline`, `milestoneTodos`, `todoProgress`): a draft without a roster is Set up
whatever the date, with a roster it is Set up before picture day and Picture day from that day; selling follows the
status; a closed job has every milestone done and none current (answer 2). Photos in and Fulfilment are never
current yet. Every state is written out ("Done", "Now · 2 of 3 done" with `aria-current="step"`, the date, or
"Soon · …"), never shown by colour alone. Below it, the current milestone's to-dos beside Recent activity (owners and
admins; otherwise the to-dos take the full width; no "View all", answer 10). Set up: Job created (done), Roster
added (with "N children · N classes", plus "· N possible duplicates" linking to People's duplicates filter, answer
4), Print QR cards (Soon). Later milestones list their next real tasks as Soon (answer 3). The number cards, the
next-step card and the Overview side panel are gone. "Before you can sell" stays only in the Start selling dialog.

**People.** A plain heading ("6 children") and a green subline ("3 classes · no duplicates", with a check icon that
is decorative). On the right a visible search box (answer 6), round Filter and Group icon buttons (named "Filter" and
"Group: None" / "Group: Class") and white pills Import roster and Add child; no Export (no API). The list is one
table in a white card, flat with a Class column by default (answer 7); Group: Class brings the collapsible class
headings back. Rows are 60px with a decorative initials avatar whose soft colour comes from the child's id.

**Floating panel.** Picking a row opens a 400px white panel that floats over the right side of the table, as tall as
its content (at most the window, scrolling inside) and sticky while the table scrolls. It is still a non-modal
`aside` named by its heading, still driven by `?child=<uuid>` (an id only); focus moves to its heading when a person
opens it and back to the row's name when it closes, by × or by Escape with focus inside it. The child's panel shows
the access code on a dark ink card (label white at 80%, answer 8), then hairline detail rows; no parent email row and
no "Allow photos" action.

**44px targets.** Rows are now tall enough for real 44px controls, so the `HIT_44` invisible hit area from 0013 is
removed; every control on the job page is at least 44px.

## Calls made in this step

- "Start selling" as a Selling to-do is Soon until selling ships in step 8 (the dialog only lists what is missing);
  it is done once a job's status is selling or closed.
- A closed job shows no to-do card; Recent activity takes the full width.
- "Roster added" without a roster says how to add one and, for roster editors, has an "Add roster" pill to People.
- The design-system gallery (`/dev/components`) shows the new pieces.

## Rejected

- A modal child panel: the table should stay usable beside it, and the URL already holds the selection.
- Copying the mock-ups' inline hex values: every colour maps to an existing token.
- Keeping the journey bar and the "Before you can sell" panel next to the timeline: two progress views of one job.
