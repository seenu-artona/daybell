# 0004 — Studio separation and data regions

- Status: Accepted, Oct 11, 2026
- Decisions: D96, D113

**One database, row-level security per studio.** Every studio-owned table carries `studio_id`; Postgres row-level
security decides what each signed-in person can see, using `app.is_member()` and `app.has_role()`. A database test fails
the build if any table is created without RLS or without `studio_id`, and leak tests prove one studio cannot read or write
another's data. Rejected: a database per studio (costly and slow to run) and filtering in application code only (one
forgotten `where` leaks children's data).

**Roles:** owner, admin, photographer, staff. Only owners manage members; a studio always keeps at least one owner.
Studios are created by the server during sign-up, never directly from a browser. Logged-out visitors cannot read these
tables at all.

**One database per region.** US and Canadian studios live in separate Supabase projects (US East and Canada Central). The
same migrations run on both. Each database records its region once in `app.config`; a trigger refuses any studio whose
region doesn't match, refuses every studio until the region is recorded (fail closed), and the region can never change.
