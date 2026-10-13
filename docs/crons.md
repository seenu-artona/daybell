# Scheduled jobs

What runs on a schedule, where, and what Seenu sets up (ADR 0016, 0021, 0024). Every cron route needs a bearer token:
Vercel Cron sends `CRON_SECRET`, compared in constant time. Every cron route answers counts only and never logs
anything about studios or people. Secrets live in Vercel only, never in the repository or chat.

| Route | What it does | Schedule |
|---|---|---|
| `/api/v1/internal/cron/photos` | Photo clean-up: purges the bin after 30 days, drops unfinished uploads, finishes idle batches, tags batches (ADR 0016, 0018) | Vercel Cron, daily 07:17 UTC (staging also: `staging-photo-cleanup.yml`, daily 07:17 UTC) |
| `/api/v1/internal/cron/jobs` | See below (ADR 0021, 0022, 0023, 0024) | Vercel Cron, **hourly at :07** (`"7 * * * *"`) |

Vercel Cron only calls the **production** deployment (`https://daybell.vercel.app`); preview deployments get no cron
calls. Vercel is on the Pro plan, which allows hourly cron jobs (Seenu, Oct 13, 2026).

## The jobs cron

Hourly, so a shop closes within the hour after its closing date (the end of the chosen day in the time zone of whoever
set it). Each run, a page at a time and within each region's share of the time:

- closes shops whose closing date has passed (ADR 0021);
- prunes read notifications after 90 days and any after 180 (ADR 0021), expired parent shop sessions, day-old
  wrong-code counts and hour-old request counts (ADR 0022);
- finishes checkouts whose Stripe event never arrived (paid ones completed, abandoned ones expired), closes at Stripe
  any replaced checkout Stripe hasn't closed yet, and settles paid orders' card fees still owed (ADR 0023);
- since step 11 (ADR 0024):
  - **deletes home delivery addresses** 90 days after the order shipped; 90 days after payment when the order was
    canceled or fully refunded without shipping; and at the latest 180 days after payment, whatever happened. The order
    keeps the date (`ship_to_purged_at`) and the studio sees "Address removed";
  - **retries refunds** Stripe hasn't accepted after a minute, finishes accepted ones whose transfer reversal isn't
    done, and asks Stripe about pending ones;
  - **recovers refund shortfalls** (what a refund took beyond what the sale's transfer still held) from the studio's
    latest settled sale, and **absorbs** any still owed after 180 days (ledger `refund_shortfall`).

A failed try is noted and backs off (1, 2, 4 … minutes, at most 6 hours); a problem no retry can fix is kept for support
and never retried. Support looks at `select id, reference, problem, problem_at from public.orders where problem is not
null` and, for refunds, `select id, order_id, status, problem, problem_at from public.order_refunds where problem is not
null`.

It answers counts, e.g. `{"closedJobs":…,"prunedNotifications":…,"prunedShop":…,"settledOrders":…,"expiredOrders":…,
"retriedRefunds":…,"purgedAddresses":…,"absorbedShortfalls":…}`.

## The GitHub workflow is retired (step 11)

Until step 11, staging's hourly run came from GitHub Actions (`.github/workflows/jobs-cron.yml`) because the Hobby plan
allowed only daily Vercel crons. With the Pro plan the hourly schedule lives in `apps/web/vercel.json`, and the workflow
was removed. What Seenu can tidy up (nothing breaks if left):

1. GitHub › the repository › Settings › Environments › `staging`: delete the secret `STAGING_ACTIONS_CRON_SECRET`.
2. Vercel › the Daybell project › Settings › Environment Variables: delete `GITHUB_CRON_SECRET`. The cron routes still
   accept it while it is set (ADR 0021, security review M1); removing that code is a follow-up.

To run the jobs cron by hand: Vercel › the Daybell project › Settings › Cron Jobs › **Run** next to
`/api/v1/internal/cron/jobs`.

Follow-up (not done here): `staging-photo-cleanup.yml` still sends the repository-wide `STAGING_CRON_SECRET` (staging's
`CRON_SECRET`); it can move to the `staging` environment the same way, or be retired once staging is the production
deployment's cron.
