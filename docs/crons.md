# Scheduled jobs

What runs on a schedule, where, and what Seenu sets up (ADR 0016, 0021). Every cron route needs `CRON_SECRET` as a
bearer token, answers counts only and never logs anything about studios or people. Secrets live in Vercel and GitHub
only, never in the repository or chat.

| Route | What it does | Production | Staging |
|---|---|---|---|
| `/api/v1/internal/cron/photos` | Photo clean-up: purges the bin after 30 days, drops unfinished uploads, finishes idle batches, tags batches (ADR 0016, 0018) | Vercel Cron, daily 07:17 UTC | `staging-photo-cleanup.yml`, daily 07:17 UTC |
| `/api/v1/internal/cron/jobs` | Closes shops whose closing date has passed; prunes read notifications after 90 days and any after 180 (ADR 0021) | `jobs-cron.yml`, hourly at :07, once its secret is set; Vercel Cron daily 08:07 UTC as a safety net | `jobs-cron.yml`, hourly at :07 |

Vercel Cron only runs for production deployments, so staging is called from GitHub Actions.

## The jobs cron

A closing date is the end of the chosen day in the time zone of whoever set it, so the shop should close within the
hour after that moment. Vercel's Hobby plan allows only daily cron jobs, and a more frequent schedule in `vercel.json`
can fail a production deploy, so the hourly run comes from GitHub Actions (`.github/workflows/jobs-cron.yml`) and
`vercel.json` keeps one daily run as a safety net. On a Pro plan the hourly schedule could move into `vercel.json`
(`"7 * * * *"`) and the production job in the workflow could go. **Seenu to confirm the plan.**

What Seenu sets up once, in GitHub › Settings › Secrets and variables › Actions:
- staging: nothing new (`STAGING_CRON_SECRET` and `STAGING_VERCEL_PROTECTION_BYPASS` already exist);
- production, when it is deployed: the secret `PRODUCTION_CRON_SECRET` (the same value as production's `CRON_SECRET`
  in Vercel) and the variable `PRODUCTION_SITE_URL` (e.g. `https://app.example.com`, no trailing slash). Until both are
  set, the workflow's production job does nothing and says so.

To run it by hand: GitHub › Actions › "Jobs cron (hourly)" › Run workflow.
