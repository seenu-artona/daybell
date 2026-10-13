# Scheduled jobs

What runs on a schedule, where, and what Seenu sets up (ADR 0016, 0021). Every cron route needs a bearer token:
Vercel Cron sends `CRON_SECRET`; GitHub Actions may send its own `GITHUB_CRON_SECRET` instead (ADR 0021, security
review M1), so each caller can be rotated or revoked alone. Both are compared in constant time. Every cron route answers
counts only and never logs anything about studios or people. Secrets live in Vercel and GitHub only, never in the
repository or chat.

| Route | What it does | Production | Staging |
|---|---|---|---|
| `/api/v1/internal/cron/photos` | Photo clean-up: purges the bin after 30 days, drops unfinished uploads, finishes idle batches, tags batches (ADR 0016, 0018) | Vercel Cron, daily 07:17 UTC | `staging-photo-cleanup.yml`, daily 07:17 UTC |
| `/api/v1/internal/cron/jobs` | Closes shops whose closing date has passed; prunes read notifications after 90 days and any after 180 (ADR 0021), expired parent shop sessions, day-old wrong-code counts and hour-old request counts, a page at a time until done (ADR 0022) | Vercel Cron, daily 08:07 UTC | `jobs-cron.yml`, hourly at :07 |

Vercel Cron only runs for production deployments, so staging is called from GitHub Actions.

## The jobs cron

A closing date is the end of the chosen day in the time zone of whoever set it, so the shop should close within the
hour after that moment. Vercel's Hobby plan allows only daily cron jobs, and a more frequent schedule in `vercel.json`
can fail a production deploy, so:

- **Staging** is called hourly by GitHub Actions (`.github/workflows/jobs-cron.yml`).
- **Production** has only its daily Vercel cron for now (08:07 UTC): a shop can stay open up to a day past its closing
  date. The workflow has no production job (security review M1: a repository-wide production secret could be read by
  any branch's workflow). On a Pro plan the hourly schedule can move into `vercel.json` (`"7 * * * *"`). **Seenu to
  confirm the plan.**

### What Seenu sets up once (staging)

1. Make a new token: `openssl rand -base64 32`. Use it only here; it must differ from staging's `CRON_SECRET`.
2. Vercel › the Daybell project › Settings › Environment Variables: add `GITHUB_CRON_SECRET` with that value for the
   environment staging runs in (the `main` branch's Preview deployment), then redeploy staging.
3. GitHub › the repository › Settings › Environments › New environment, named `staging`:
   - Deployment branches and tags: "Selected branches and tags", add the rule `main` (only `main` may use it; any other
     branch's run of the workflow is refused the secret).
   - Environment secrets › Add secret: `STAGING_ACTIONS_CRON_SECRET`, the same value as in step 2. (GitHub refuses
     secret names starting with `GITHUB_`.)
   - Optional, for less to leak: move `STAGING_VERCEL_PROTECTION_BYPASS` here too. The workflow reads it either way;
     it only gets past Vercel's preview protection and opens no route by itself.
4. GitHub › Actions › "Jobs cron (hourly)" › Run workflow, on `main`. It answers `{"closedJobs":…,"prunedNotifications":…,"prunedShop":…}`.
   If the secret is missing it fails with "STAGING_ACTIONS_CRON_SECRET is missing from the staging environment".

Until step 3 is done the hourly run fails loudly on `main` (the workflow is new; nothing relied on it before).

Follow-up (not done here): `staging-photo-cleanup.yml` still sends the repository-wide `STAGING_CRON_SECRET` (staging's
`CRON_SECRET`); it can move to the `staging` environment and `STAGING_ACTIONS_CRON_SECRET` the same way, after which
`STAGING_CRON_SECRET` can be deleted.

To run it by hand: GitHub › Actions › "Jobs cron (hourly)" › Run workflow.
