# @daybell/db

Database schema, row-level security and migrations for Daybell (D7, D96, D113).

- `supabase/migrations/` — every change to the database, in order. Never edit a migration after it is merged; add a new one.
- `supabase/tests/database/` — pgTAP tests. `001_rls_everywhere` fails if any table lacks row-level security or a `studio_id`. `002_studio_isolation` proves one studio can never see or change another's data.

## Regions

There is one Supabase project per region: `daybell-staging-us` and `daybell-staging-ca` (production later). The same
migrations run on both. On first deploy each database records its region in `app.config`; after that, a studio from the
other region cannot be written to it and the region can never change.

## Running the tests

- CI: `supabase db start` + `supabase test db` against the real Supabase Postgres.
- Locally with Docker: same commands, `--workdir packages/db`.
- Locally without Docker: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @daybell/db test:local`
  runs the same tests on plain Postgres with pgTAP, using `test/supabase-stubs.sql` in place of Supabase's auth schema.

## Deploying

`.github/workflows/db-deploy.yml` applies migrations to both staging projects when migrations change on `main`. It needs
the `STAGING_DB_URL_US` and `STAGING_DB_URL_CA` secrets in the GitHub Environment `staging`, restricted to `main`.
Until the region is recorded, a database refuses every studio (fail closed).
