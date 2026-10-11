# 0009 — Clients, job categories and the one-form job dialog

- Status: Accepted, Oct 11, 2026. Supersedes parts of 0008 (organizations, organization kinds, the type rule, the wizard).
- Decisions: D96, D113, D131; Seenu's decisions of Oct 11, 2026 (GotPhoto "Add new client" and "Create Photo Job")

**A forward migration, not an edit.** `20261011040000_jobs_and_organizations` was merged and deployed, and staging may
hold real test rows. `20261011050000_jobs_and_clients` changes the existing tables in place: it renames rather than
dropping and recreating, so ids and rows survive. Its backfills turn the tables' own triggers off: they are nobody's
change, so they write no events and leave `updated_at` alone. Each later schema change follows the same rule: never edit
a merged migration, add a new one.

**Organizations become clients.** `organizations` is renamed to `clients` with its constraints, index, policies, grants and
trigger, and `jobs.organization_id` becomes `client_id` (still a composite studio FK, ADR 0008). The `kind` column and
its enum are dropped; the job type says what kind of shoot it is. **This loses data:** every existing client's kind
(school, daycare, club, league, dance studio, other) is deleted by the migration and can't be recovered from the
database. This is a known, accepted loss (Seenu, Oct 11 2026). Clients gain an optional contact person (first
name, last name, phone up to 30 characters, email) next to the address and notes. The address
and contact person are personal data: events carry field names only, and nothing about them goes in logs or URLs
(the list cursor is an id; `?q=` searches client names only). Everyone on the studio's team sees each client's contact person, address and
notes (Seenu, Oct 11 2026), so reads stay open to all members, as for jobs. Parents and schools never see them. The Quebec rules stay. The school-portal option comes with
the portal in Phase 7.

**Old events stay as written.** Events are immutable, so `organization.created/updated` rows remain. The activity log
shows them as `client.created/updated`, and their names come from `clients` (the ids did not change). New changes write
`client.created {}` and `client.updated {fields}`.

**Jobs.** A client is optional for every job type, so the type rule is removed (job types now only choose labels:
classes, teams or groups). Picture day is required. Existing jobs without a picture day get the date they were created
before the column becomes `not null`. New columns:
- `internal_number`: 1–30 characters, unique per studio ignoring case, seen only by the studio. Existing jobs are numbered
  JOB00001… per studio in creation order. `GET /jobs/next-number` and `public.next_job_number()` suggest the highest
  `JOBnnnnn` + 1. The server fills it in when it's left out, retrying if two jobs are created at the same moment. A
  clash with a number someone typed is a field error.
- `subjects_expected`: optional, 1–100,000.
- `category_id`: a composite studio FK to `job_categories`, required.

**Job categories** are a studio-owned table with the same RLS as the others, unique names per studio (ignoring case),
and a display order. Every new studio is seeded with Fall, Spring, Graduation, Sports, Dance, Yearbook and Other by a
trigger on `studios`. Seeding adds no events of its own, because it is part of `studio.created`. Existing studios get the
same list, and their existing jobs get "Other". Owners and admins may already add and rename categories in the database.
The Settings screen to manage them comes in a later step.

**One form instead of a wizard.** Clients are created ahead of time in Contacts › Clients. A job is created in one dialog
("New job" on Jobs; Home links to `/app/jobs?new=1`): name, picture day, client (searchable, optional, with "Add new
client" opening the client form in a dialog on top and selecting the new client), internal number, type, category and
subjects expected. `/app/jobs/new` shows the same form as a page for direct links. Editing a job uses the same form.
Dialogs stack natively: Escape closes only the top one, and focus returns to the button that opened it.

Rejected:
- Editing the deployed migration in place: its version is already recorded, so the change would silently never apply.
- Drop and recreate: this would lose staging data.
- A free-text category: the reports need a fixed list per studio.
- A database sequence for job numbers: studios edit their numbers, so the next one comes from the highest existing number.
