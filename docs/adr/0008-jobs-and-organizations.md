# 0008 — Jobs and organizations

- Status: Accepted, Oct 11, 2026
- Decisions: D75, D92, D96, D113, D131; Seenu's answers of Oct 11, 2026 (Quebec block, one optional picture day,
  organization required by job type)

**Two tables.** `organizations` (schools, daycares, clubs, leagues, dance studios) and `jobs` (one shoot or season).
Both carry `studio_id`, row-level security (everyone on the team reads; owners and admins create and edit), and write
an event through the outbox for every change: `organization.created {kind}`, `organization.updated {fields}`,
`job.created {type, status}`, `job.updated {fields}`. Events never hold names, addresses or notes; the activity log
looks names up when it is read. Nothing is deleted in this step (no delete policy, grant or endpoint). Organization
names need not be unique; pickers show the city to tell them apart.

**Composite studio foreign keys are the standard.** A child row references its parent together with the studio:
`jobs (studio_id, organization_id) → organizations (studio_id, id)`, backed by `unique (studio_id, id)` on the parent.
The database itself then makes it impossible for a job to point at another studio's organization, whatever the API
does. Every later studio-owned reference (rosters, photos, orders) follows this pattern.

**Column grants lock status until step 8.** Browsers' database role may insert and update only the editable columns.
`status` is not among them, so a job is always created as a draft and its status can't be changed directly; step 8
adds the function that moves a job between draft, selling and closed with its checks. `studio_id`, ids and timestamps
are never updatable either.

**Organization required by type.** School, preschool, sports and dance jobs need an organization; seniors and mini
sessions may have none. Enforced by a check constraint and by the zod schema (`packages/core/src/jobs.ts` holds the
rule; a test keeps it in step with the migration).

**Brands come later.** Jobs have no `brand_id` yet; a later migration adds it when brands exist.

**Two calls for inline create.** The new-job wizard creates a new organization with `POST /organizations`, then the job
with `POST /jobs`. Both endpoints stay simple and are exactly what integrations use (D92). If the job call fails, the
wizard keeps the organization it just made, so a retry doesn't add it twice.

**Quebec is blocked (D131; Seenu, Oct 11 2026).** A check constraint refuses an organization in Quebec (`QC`, with
country `CA` or no country, since QC is never a US state). The API returns a field error on `region` with a plain
message from the locale files.

**Lists use keyset pagination.** `?limit` (default 50, max 100) and `?cursor` (the last item's id). The cursor is an id,
not a name, so names never appear in URLs or request logs.

Rejected: a single "create job with organization" endpoint (two ways to create an organization), single-column FKs
plus RLS alone (a bug in a policy or the API could link studios' data), a free `status` column (statuses need
checks), storing names in events (personal data in an immutable log).
