# @daybell/db

Database schema, row-level security and migrations for Daybell (D7, D96, D113).

- `supabase/migrations/` — every change to the database, in order. Never edit a migration after it is merged; add a new one.
- `supabase/tests/database/` — pgTAP tests. `001_rls_everywhere` fails if any table lacks row-level security or a `studio_id`. `002_studio_isolation` proves one studio can never see or change another's data.

## Regions

There is one Supabase project per region: `daybell-staging-us` and `daybell-staging-ca` (production later). The same
migrations run on both. Each database records its region once in `app.config` (see Deploying); after that, a studio from the
other region cannot be written to it and the region can never change.

## Running the tests

- CI: `supabase db start` + `supabase test db` against the real Supabase Postgres.
- Locally with Docker: same commands, `--workdir packages/db`.
- Locally without Docker: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @daybell/db test:local`
  runs the same tests on plain Postgres with pgTAP, using `test/supabase-stubs.sql` in place of Supabase's auth schema.

## Deploying

Each Supabase project uses Supabase's GitHub integration (working directory `packages/db`, production branch `main`,
"Deploy to production" on). Merging migrations to `main` applies them; no database password is stored in GitHub (D123).

**Once per new project** (e.g. when the US project is added, D122), record its region in the Supabase SQL editor after the
first deploy. Until then the database refuses every studio (fail closed):

```sql
insert into app.config (key, value) values ('data_region', 'ca');  -- 'us' for the US project
```

## Email templates (hosted projects)

Auth emails must link to our `/auth/confirm` with a `token_hash`, so links work on any device. For each project, in
**Authentication → Emails → Templates**, paste the HTML from `supabase/templates/` into **Confirm signup**
(`confirmation.html`), **Magic Link** (`magic_link.html`) and **Reset Password** (`recovery.html`), with the subjects in
`supabase/config.toml`.
