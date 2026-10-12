# 0017 — One checklist

- Status: Accepted, Oct 12, 2026. Amends 0014 (the Overview's timeline and to-dos) and replaces Home's "Needs you"
  (D127).
- Decisions: D143 (amends D140); touches D92, D96, D113, D91, D112, D127, D137, D138, D10. Seenu's answers of Oct
  12, 2026 (1–12), his approval of the SECURITY DEFINER facts function, the code and security reviews, and the calls
  listed below.

## What changed

**One checklist replaces the timeline and the to-dos.** The Overview keeps its hero line ("Picture day in N days") and
Recent activity. Between them, one "Checklist" card: the current milestone as a neutral pill (never the Selling green,
so it can't be mistaken for the shop state), "N of M done" with a bar, and the tasks grouped by milestone. The step 2c timeline (`job-timeline.tsx`), the "{milestone}: to-dos" card
(`milestone-todos.tsx`), the green "Step 1 of 5 · …" subline and core's `milestone`, `timeline`, `milestoneTodos`
and `todoProgress` are gone. The header pill still shows the shop state only (Draft, Selling, Closed); the milestone
shows only with the checklist (Overview, Jobs list, Home).

**Tasks per job type** (`packages/core/src/checklist.ts`). `JOB_CHECKLISTS` holds one list per job type; today every
type has the same list, so the lists can diverge later without changing callers. Built tasks, by milestone (answer 1):

| Milestone | Task | Ticks itself when | Row links to |
|---|---|---|---|
| Set up | Create the job | always (the job exists) | — (the Overview itself) |
| Set up | Add the roster | the roster has a child | People |
| Set up | Print QR cards | every child who may be photographed has a card (`qrCardsDone`, ADR 0015) | People's print dialog |
| Picture day | Picture day | the picture day has passed in the person's own day | — (the Overview itself) |
| Photos in | Upload photos | the job has a ready photo not in the bin | Photos |

Tasks never tick by hand; no screen can mark one done. Unbuilt tasks (Review tagging, price list, payouts, Start
selling, fulfilment) are not in the list at all, so they never count toward "M", and a milestone with no built task
has no group. US and Canadian studios get the same list (answer 3); Upload photos can't be done by US studios until US
photo storage exists.

**Milestone rule** (answer 2). The milestone is the group of the next unfinished task; dates never move it (only the
Picture day task ticking moves it on). A selling job is at Selling; a closed job reads "All done" and has no next
task. A draft with every built task done shows the next stage, whose tasks aren't built yet (today: Selling).

**Rows are plain links** (D143). Each row is one link, at least 44px tall, to the page where the work happens; no
buttons in rows and no opened "current" box. A row is plain text when there is no other page (Create the job, Picture
day on the Overview) or the person's role can't do the work (answer 10), e.g. staff and Add the roster: the
roster, card and photo tasks follow the existing roster-editor rule (owners, admins and photographers). Done rows have a filled green check and are muted and struck through; the next row has a green ring and the
word "Next"; to-do rows a grey ring. "Done" and "To do" are read out to screen readers; nothing is colour alone (D91).

**Collapse rule** (my call, kept simple). The Overview's list is collapsed to its progress and "Next: {task}" (a link
when the person can do it) while the job is on track: past Set up, with no date close and nothing broken (the same
reasons Up next uses). It is open during Set up, when picture day has passed without photos, or when photos failed. A
closed job is collapsed and reads "All done". A "Show all tasks" / "Hide tasks" button (`aria-expanded`,
`aria-controls`) toggles it; the list stays in the page, `hidden` while collapsed.

**Jobs list and Overview: one data path** (D92: computed on the server). `GET /api/v1/jobs` adds `checklist:
{ milestone, done, total, next }` to each job, and `GET /api/v1/jobs/:id` adds the whole checklist (`tasks` with their
milestone and done, and `onTrack`), both from `job_checklist_facts` and core's `jobChecklist`. The Overview draws the
`GET /jobs/:id` checklist, so it and the list never disagree; the job's summary counts only feed the rows' notes. A new "Progress" column shows the milestone pill, "N of M done" and "Next: …" as
a link to where it's done (plain text for roles that can't; the link's name adds the job's name).

**Home** (answer 6). The stats, "Jobs selling now" and Recent activity stay; "Needs you" is replaced.

- **Set up your studio** (owners and admins only, answer 5). Built tasks: Create your account (always done) and
  Create your first job (linking to the new-job form). "Studio name and logo" waits for branding (answer 4); payouts
  and the price list come later. Inviting the team is not an onboarding task: it stays in Settings (answer 12).
- **Onboarding stays done** (answer 5). When every built task is first done, `GET /studio/checklist` records it in
  `studios.onboarded_at`, through the person's own session (row-level security: only owners and admins may update
  their studio). A trigger makes the column write-once (the database's clock; never cleared or moved) and writes one
  `studio.onboarded` event with the studio's id only. It isn't shown in the activity log.
  - **The one GET with a write** (an exception to reads being side-effect free): it is idempotent, since the
    database keeps the first time and repeating the request changes nothing. The OpenAPI description says so.
  - **Owners and admins can also set it directly** through the Data API (the studio update policy allows it). That is
    accepted: it only hides their own studio's setup card, it can only be their own studio, the database stamps its own
    time, and it writes the same event.
- **Up next** (after onboarding, and always for photographers and staff). At most one task per draft or selling job
  (answer 8), the three most urgent shown, then "N more jobs in Jobs" linking to the Jobs list. Each row links to the
  task's page (plain text for roles that can't do it) and says why it was picked.

**Up next ranking** (`upNextForJob`, `rankUpNext`). Kinds, most urgent first (D143), with only data that exists:

1. A date is close: a past picture day with the job's Upload photos not done ranks highest ("Picture day was 3 days
   ago, no photos yet"); then a Set up task within 14 days before picture day, the day itself included ("Picture day
   in 3 days"; answer 7).
2. Something is broken: failed photos not in the bin ("4 photos failed", task "Check failed photos" → Photos).
   Possible duplicates are not "broken" for now (answer 9).
3. Money is waiting: no data yet (payouts arrive later), so never produced.
4. The next step in the job: the first unfinished task that has a page of its own. Tasks on the job's Overview itself
   (Create the job, Picture day) are never picked, since there is nothing to go and do (code review N1); a job whose
   only open task is Picture day isn't in Up next.

Ties go to the nearest picture day (past or future, by distance), then the job id, so the order never flickers.

**Today.** Picture day is a calendar date and there is no studio time zone yet (ADR 0014), so `/jobs`, `/jobs/:id` and
`/studio/checklist` take an optional `today=YYYY-MM-DD` from the browser. The server accepts it only within a day of
its own UTC date (every time zone is) and otherwise uses the UTC date. It isn't personal data.

## Database (forward migration `20261012000000_one_checklist.sql`)

- `studios.onboarded_at timestamptz` (nullable, no backfill), the write-once trigger and the `studio.onboarded` event.
  No policy changes.
- `public.job_checklist_facts(p_studio_id, p_job_ids)`: per job, children, children who may be photographed, of those
  with a card, whether a ready photo exists, and failed photos not in the bin. One query per Jobs page, Overview or Home
  load, never one per job. At most 1,000 job ids per call (more raises 22023, with no values in the message); a null
  studio or list returns no rows.
- **SECURITY DEFINER with one membership check** (approved by Seenu after review). The plan said SECURITY INVOKER. Row-level security
  gives the same answer but calls `app.is_member` once per child, card and photo row: on a seeded studio (300 jobs,
  90,000 children, about 62,000 cards, 300,000 photos) 50 jobs took ~200 ms that way and ~39 ms with one explicit
  `app.is_member(p_studio_id)` check and `studio_id` filters on every table (300 jobs: ~1.1 s vs ~0.2 s). The check is
  written `(select app.is_member(p_studio_id))` so it runs once (an InitPlan). The function is read-only, has an empty
  `search_path`, and isn't executable by `anon` or PUBLIC.
- **Partial index** `photos_failed_idx on photos (job_id) where status = 'failed' and binned_at is null`, added
  because EXPLAIN showed a bitmap scan of ~1,000 photos per job (30 ms each) to count a handful of failed ones.
- pgTAP `011_one_checklist.test.sql`: the counts; another studio's job ids, another studio's id, my job under another
  studio's id, an outsider, a removed member, a null studio and a null list all return nothing; more than 1,000 ids
  are refused; the function is SECURITY DEFINER with no PUBLIC execute; only owners and admins of the studio can set
  `onboarded_at`, never for another studio; it can't be backdated, and from a known past value it can't be cleared or
  moved; one event with ids only.

## Studio separation and region

Every query is scoped to the caller's studio (`studioScope`, explicit `studio_id` filters, the function's membership
check); route tests check the scope and that the facts are one query. `/studio/checklist` reads the database only (no
storage), so it runs where `/jobs` runs (D113). Responses carry ids, counts and job names, as `/jobs` already does.
The only log line is a count when Up next's 1,000-job limit cuts jobs off (`up_next_truncated`, no ids or names).

## Calls made in this step

- The checklist card's title is "Checklist" (the mock's "Get this job selling" reads wrong once a job sells).
- Problem items stay inline where they are (D143): the Upload photos row notes failed photos; Add the roster notes the
  number of children; Print QR cards notes children still without a card. The old roster note's "possible duplicates"
  link is gone from the Overview; People still marks duplicates.
- Up next's broken task is its own row, "Check failed photos", rather than reopening Upload photos.
- Home loads one endpoint instead of the team, invites and jobs lists. While it loads, the card has a neutral title
  ("Your next steps"), since it may turn out to be either list.
- Photographers and staff never see onboarding; they get Up next straight away.
- Up next looks at no more than 1,000 draft or selling jobs per studio (far more than any studio runs at once), and
  logs a count-only warning when it has to cut.
- The `checklist-steps.ts` (D127's "Get ready to sell") and its tests are removed; the Start selling dialog's own
  "Before you can sell" list is unchanged.

## Follow-ups

- US photo storage (R2) and the US function region: until then US studios can't tick Upload photos (answer 3).
- Review tagging (step 5), price list, payouts, Start selling and fulfilment tasks join the list as they ship; "money
  is waiting" joins Up next with payouts; "Studio name and logo" joins onboarding with branding.

## Rejected

- Date-driven milestones (step 2c's rule): D143 works the milestone out from the checklist.
- Buttons in rows, or an opened "current" box with buttons: Seenu simplified the design to plain links.
- Computing the Jobs list's progress in the browser: the public API and MCP server must see the same numbers (D92).
- Ticking tasks by hand.
