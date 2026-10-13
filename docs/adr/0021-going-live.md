# 0021 — Going live: Selling, Closed and the bell

- Status: Proposed with the step 8 PR (Seenu was away; every choice below marked "Claude's call, Seenu to review" is
  provisional until he reviews it).
- Amends:
  - 0008: a job's status changes only through `start_selling`, `close_job`, `reopen_job` and the jobs cron;
    `job.updated` no longer names `status`.
  - 0014: the header's pill is the shop action (Start selling, Close shop, Reopen shop); the ⋯ menu gains "Set closing
    date".
  - 0017: the checklist gains Start selling (Selling milestone); Up next can pick it.
  - 0018: closes the follow-up "the server refuses Start selling".
  - 0019: "Price list chosen" needs at least one item.
  - 0020: the Start selling dialog's Payouts item is enforced by the server; payout status changes reach the bell.
- Decisions implemented: D75, D127, D143, D96, D92, D47 (hook only).
- Decisions touched: D113, D91, D112, D138, D140, D10.
- Inputs: the Phase 1 spec step 8 ("Go-live checklist (photos tagged and reviewed, price list, payouts connected);
  Selling and Closed; bell notifications"), the step 8 brief's Claude's calls 1–8, the architect's A1–A3, and the
  orchestrator's answers to Q1–Q3 (Oct 12, 2026).

## Context

Phase 1's goal ends with a studio that "connects payouts, keeps the starter price list, sets a shipping fee and turns
the job to Selling". Jobs have had the statuses Draft, Selling and Closed since step 1, with `status` ungranted to
browsers until "step 8 adds the function". The Start selling dialog ("Before you can sell") has listed what is missing
since step 2c, without the server enforcing it. D143 makes the bell information only, never tasks. D75 asks for a short
confetti burst when a job goes live. D127's Home has a "Jobs selling now" card.

## 1. Statuses (calls 1 and 2)

- Draft → Selling ("Start selling"), Selling → Closed ("Close shop"), Closed → Selling ("Reopen shop"). Never back to
  Draft: pausing a shop means closing it. **Claude's call, Seenu to review.**
- Owners and admins only; photographers and staff see the state, not the actions. **Claude's call, Seenu to review.**
- A backstop trigger (`app.guard_job_status`) refuses any other move, whoever writes, including the service role.
- Each change is one SECURITY DEFINER function, run by the API as the service role for the signed-in person
  (`app.act_for_manager`: `act_for` plus an owner-or-admin check, refusing with 42501 before anything is read):
  - `start_selling` and `reopen_job` share `app.go_live`: the job's tagging lock (`tagging:<job>`, the same lock Mark
    reviewed and tagging runs take, so a review can't reopen between the check and the write), then the job's row
    `FOR NO KEY UPDATE` (photo and roster writes only key-share the row, so they never wait on it and can't deadlock
    with the advisory lock), then the checks, then the write and one event.
  - `close_job` locks the row, closes and clears the closing date.
  - Named errors without values: `not_ready` (its DETAIL lists the blockers' keys), `already_selling`, `job_closed`,
    `job_not_selling`, `job_not_closed`; P0002 for an unknown job.
- API: `POST /api/v1/jobs/:id/start-selling`, `/close`, `/reopen` (owner-admin), each returning the job. 409s carry
  `fields.form` from `JOB_CONFLICTS`; `jobs.notReady` also has one field per missing item (`roster`, `photos`,
  `tagging`, `priceList`, `payouts` → `jobs.sell.<key>`). Only keys Daybell knows become fields.
- Database only, like editing a job (ADR 0017's precedent): no function-region pin.

## 2. What the server checks (call 1, A1, A2)

The server checks everything the dialog lists, in the dialog's order, in the same transaction as the change:

| Item | Rule |
|---|---|
| Roster added | the job has a child |
| Photos uploaded | a ready photo outside the bin (A1: "Coming soon" since ADR 0020, now real) |
| Tagging reviewed | core's `reviewTaggingDone`: a ready photo, nothing pending, no Leftovers, flags or blank cards, marked reviewed |
| Price list chosen | the job's list has at least one item (A2) |
| Payouts connected | the studio's payout account is Active |

- **A1 (Claude's call, Seenu to review):** the brief named three checks; the server checks all five, because a job can
  be "tagging reviewed" with no roster (a class-photo upload into an empty class).
- **A2 (Claude's call, Seenu to review):** `jobs.price_list_id` is NOT NULL (ADR 0019), so "has a price list" would
  check nothing. A list counts only if it has an item. The dialog reads the list when it opens ("Checking…" until then).
- Zero-photo jobs fail (photos and tagging).

## 3. Closing date (call 2, Q2)

- `jobs.closes_at timestamptz null`, set by owners and admins through `PATCH /jobs/:id` (`closesAt`, an ISO moment
  with offset, or null). In the future, at most 400 days away (`MAX_CLOSING_DAYS`), never on a closed job; checked by
  the API and by `app.guard_job_closes_at`. Removing it is always allowed. `job.updated` names `closes_at`.
- **Q2 (orchestrator, Seenu to review):** there is no studio time zone yet. The person picks the last day to order; the
  screens send the end of that day in their own browser's time zone (core's `endOfLocalDay`), and the hint names it
  ("Closes at midnight at the end of this day, Pacific Time."). Everyone sees the moment in their own local time. A
  Halifax studio's admin setting it from Vancouver closes four hours later than the owner might expect. Follow-up: a
  studio time zone setting.
- Closing (by hand or on schedule) clears the date, so a reopened shop isn't closed again at once.
- Where to set it: the ⋯ menu's "Set closing date" dialog, and the edit form's "More options" for draft and selling
  jobs. **Claude's call, Seenu to review.**

## 4. The jobs cron (Q1)

- `public.close_due_jobs(p_limit)` closes selling jobs whose `closes_at` has passed, in every studio of the database,
  oldest first, `FOR NO KEY UPDATE SKIP LOCKED`, each with `job.closed {scheduled: true}` and no actor (it blanks both
  `request.jwt.claim.sub` and `request.jwt.claims` and puts them back). Limit 1–1000.
- `GET /api/v1/internal/cron/jobs` (CRON_SECRET; `preferredRegion = "yul1"`; `assertFunctionRegion` for each region
  with a database): pages of 500 until fewer come back or 50 seconds pass, then `prune_notifications(1000)`. Counts
  only.
- **Q1 (orchestrator, Seenu to review):** Vercel's Hobby plan allows only daily crons and a more frequent schedule can
  fail the production deploy. So `.github/workflows/jobs-cron.yml` calls it hourly (staging always; production only
  once Seenu adds `PRODUCTION_CRON_SECRET` and `PRODUCTION_SITE_URL`), and `vercel.json` has one daily run at 08:07 UTC
  as a safety net. Seenu to confirm the Vercel plan; on Pro the hourly schedule can move into `vercel.json`. See
  docs/crons.md.

## 5. Bell notifications (call 4, Q3)

- Kinds (`notification_kind`, the same as core's `NOTIFICATION_KINDS`) and who hears them (`app.notification_audience`
  = core's `NOTIFICATION_AUDIENCE`):

| Kind | From | Who |
|---|---|---|
| `job_selling` | `job.selling` | owner, admin, photographer, staff, except whoever did it |
| `job_closed` | `job.closed` | the same; nobody is excluded on a scheduled close (no actor) |
| `payouts_active`, `payouts_restricted` | `payout_account.status_changed` to active / restricted | owner, admin |
| `tagging_ready` | `photos.tagged` with Leftovers or flags in the batch | owner, admin, photographer (the uploader too) |
| `photos_failed` | `photos.tagged` for a batch with failed photos not in the bin | owner, admin, photographer |

- `public.notifications`: `studio_id`, `user_id` (cascade with the person: erasure), `event_id`, `kind`, `job_id`
  (composite FK to the studio's job, cascade), `batch_id`, `data`, `created_at`, `read_at`. `data` holds counts and
  flags only, checked by a whitelist constraint (`scheduled`, `from`, `failed`, `leftovers`, `flagged`); never names or
  people. The words, with the job's current name, come from the locale files at read time.
- One row per person per event and kind; one tagging or failed-photos notification per batch and person, however many
  times the batch is tagged.
- Made by `app.notify_from_event`, an AFTER INSERT trigger on `events` with a WHEN clause (other events pay nothing),
  in the same transaction, inside the studio's own regional database: no queue, no other service, no email or push
  (D113; no emails until the domain).
- Row-level security: a person reads and updates only their own rows, in a studio they still belong to. Browsers may
  update `read_at` only; `app.guard_notification_read` sets it once to the database's clock and never clears or moves
  it, and freezes every other column for every writer. Nobody signed in inserts or deletes.
- Leaving a studio deletes the person's notifications there; a role change deletes the kinds the new role doesn't
  hear about. **Claude's call, Seenu to review.**
- `event_id` has no foreign key: events are only removed with their studio (which takes these too), and a key would
  change how the event log refuses TRUNCATE.
- **Q3 (orchestrator; needs Seenu's explicit acceptance):** notifications are a derived per-person read model. Making
  them and marking them read write no events, an exception to D96's "every change writes an event" like ADR 0016's
  upload progress. Writing events here would flood the log, and a mark-read event would fire the events trigger again.
  Easy to reverse.
- The person who did something isn't told about it. **Claude's call, Seenu to review.**
- Pruning: read notifications over 90 days old and any over 180 go, in the jobs cron. **Claude's call, Seenu to
  review.**
- API (signed-in; the person's own session, filtered by their studio and user id; nothing logged):
  `GET /notifications` (the 20 latest with the job's name, and the unread count), `GET /notifications/unread-count`,
  `POST /notifications/read` (`{ids}`, 1–100), `POST /notifications/read-all`.
- The bell (`app/app/notifications-bell.tsx`), in the menu once the person has a studio: the unread count every 60
  seconds while the page is visible and again on focus, not a live connection. **Claude's call, Seenu to review.** The
  button's name says the count ("Notifications, 3 unread") and the badge shows it as a number, never colour alone. A
  rise is announced once in a polite live region, never the first count after loading. Each row is one 44px link
  ("Unread, " is read out before unread ones; they also have a dot and bold text) that marks it read and goes to the
  job's Overview, its Photos (failed photos show there; there is no failed-only view to link to), Photos' Review, or
  Settings › Payouts. "Mark all as read" stays put so focus does.

## 6. Screens

- **Header (D140):** Draft: "Start selling" opens the dialog. Ready: Cancel and a primary Start selling; otherwise Close
  only. The dialog is `aria-busy` while it works and nothing is disabled; a 409 replaces the rows with the server's
  list and says so in the dialog's status. On success: the dialog closes, focus moves to the job's name (`tabIndex -1`,
  because the pill that opened it is gone; **Claude's call, Seenu to review**), the header's status says "{job} is
  live. Parents can order now.", and confetti bursts. Selling: a white "Close shop" pill with a confirm ("Close the
  shop? Parents can't order until you reopen it. Orders already placed aren't affected."). Closed: a green "Reopen
  shop" pill opening the same checklist titled "Reopen shop". **Claude's call, Seenu to review.** The details line adds
  "Closes {date and time}". `?sell=1` opens the dialog (the checklist's and Up next's link), then leaves the address.
- **Confetti (D75, call 6):** `ConfettiBurst` in packages/ui: 40 `aria-hidden` pieces with a CSS keyframe in the theme
  (`daybell-confetti`), token colours only (primary, lime, info, warning), 1.5 seconds, `pointer-events-none`, then
  it unmounts. With `prefers-reduced-motion: reduce` it draws nothing. No dependency. Only when a job first goes live,
  not on reopening. **Claude's call, Seenu to review.** In the /dev/components gallery.
- **Live note (call 3):** while selling, People, Photos, Review and Shop show "This shop is live: changes show to
  parents straight away; orders already placed keep what they bought." (one locale key, replacing Shop's own note).
  Edits stay allowed, as GotPhoto. **Claude's call, Seenu to review.**
- **Checklist (call 5):** Start selling (Selling milestone, target `sell`, owners and admins) ticks once the job sells
  and stays ticked once it closes. Fulfilment stays hidden. A ready draft's milestone is Selling with Start selling
  next; Up next picks it as the next step.
- **Home (call 7):** "Jobs selling now" lists up to 5 selling jobs (`GET /jobs?status=selling`), each a link with
  "Closes {date}" or "No closing date", and "View all jobs" when there are more. Home's panels are now named regions.
  Sales numbers stay 0 until checkout (step 10).
- **Activity:** `job.selling` ("{actor} opened the shop for {name}", green) and `job.closed` ("{actor} closed the shop
  for {name}", or "The shop for {name} closed" with no actor, grey).
- **Parent shop (call 8):** not built; Selling only flips the state. Access-code entry comes in step 9.

## 7. Events (ids only)

- New: `job.selling {from: "draft" | "closed"}`, `job.closed {scheduled: bool}`.
- `job.updated` names `closes_at` and no longer `status` (A3; status was never changeable before, so no stored event
  changes meaning). **Claude's call (A3), Seenu to review.**
- No events for notifications (Q3). No ledger entries: no money moves.

## 8. D47 hook

Core's `campaignsMaySend(status)` is true only for `selling`. Campaigns aren't built; this is where they will ask.

## 9. Region and separation (D113, D96)

Everything stays in the studio's regional database; notifications are made there by a trigger. The cron runs in
`yul1` with `assertFunctionRegion` for each region. Logs carry counts and fixed names only. `notifications` has
`studio_id`, row-level security and per-person rows; the functions check membership and role before reading anything;
every route filters by `studio_id`.

## 10. Tests

- pgTAP `018_going_live`: each blocker by key (A1, A2), zero photos, the bin, pending tagging and Leftovers; roles
  (photographer, staff, outsider, another studio's owner, a removed admin, nobody) refused with 42501; unknown job
  P0002; from-state errors; never back to Draft even for the database owner; browsers can't write the status;
  closing-date bounds, RLS and clearing on close; the cron closes due shops of any studio only, with no actor, puts the
  caller's identity back and refuses bad limits; events have ids only; grants.
- pgTAP `019_notifications`: recipients per kind and role with the actor excluded; once per batch; data whitelist;
  another studio's job refused by the composite key; leak tests (another member, another studio, an outsider, a removed
  member, anon); only `read_at` changes, once, with the database's clock; leaving and role changes; pruning; erasure;
  no events written.
- `010_photos` and `012_tagging` fixtures now go Draft → Selling → Closed (the new guard).
- Core: checklist, sell rules, `endOfLocalDay` under Toronto, Vancouver and Halifax including DST days, notifications.
  API: enum and audience kept equal to the migration, schemas, route registry. Web: route tests for the status routes,
  PATCH closing date, the bell's routes and the cron; screen rules (`going-live.ts`), links, the bell's words and
  markup, confetti under reduced motion. e2e: `phase1-going-live.spec.ts`; `phase1-job-page`, `-jobs`, `-photos` and
  `-qr-cards` updated for the seventh task, the Selling group, the dialog's photos row and the bell.

## Rejected

- A cron fan-out of notifications: a lag and another moving part, for no gain inside one database.
- Supabase Realtime for the bell: another channel to secure and scope; polling a count is enough for now.
- A confetti dependency (canvas-confetti): 40 CSS pieces do it.
- Selling → Draft.

## Follow-ups

- Other D75 celebrations (first order, batch shipped, season end, money milestones).
- The parent shop's access check against the status (step 9); checkout refusing closed jobs (step 10).
- D47 campaigns.
- A batch where every photo failed writes no tags, so no `photos.tagged` event and no notification; Up next's "N photos
  failed" still shows it.
- A studio time zone setting (Q2).
- A failed-photos view on Photos for the bell to link to.
- No index of ADRs exists in docs/adr/README.md to add this one to.
