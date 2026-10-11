# 0011 — The roster and parent access codes

- Status: Accepted, Oct 11, 2026.
- Decisions: D23, D24, D83 (deferred), D91, D92, D96, D113, D126, D133; Seenu's answers of Oct 11, 2026 (#1–#14 and
  the plan's open questions Q1–Q4, all answered with the defaults); the review fixes of Oct 11, 2026, where Seenu chose
  "server-only writes" for access codes.

**Two tables.** `job_groups` holds a job's classes, teams or groups. It is not called `groups` because `GROUPS` is an
SQL keyword and the longer name says whose groups they are. `children` holds one child on a job's roster. Both have
`studio_id`, row-level security and composite studio FKs (ADR 0008). The migration adds the key they need,
`jobs (studio_id, id)`. A child's class uses the FK `(studio_id, job_id, group_id) → job_groups (studio_id, job_id, id)`,
so a class is always in the child's own job. A class is optional (Q1): the roster shows "No class", and cards in step 3
print a blank class. Class names are unique per job, ignoring case. Student IDs are stored and indexed but not unique.
Duplicates are imported and flagged, never merged (Seenu #3). Linking a child across years (D83) comes later.

**Who can do what.** Owners, admins and photographers add, import, edit and rename. Staff read everything, codes
included (Seenu #2, #10). The API checks who is asking and their role before it reads a request body, to give a clear
error, and RLS enforces the same rule. Column grants:
- Browsers can never read `access_code_hash`, and can't insert children at all (see "Server-only code writes").
- Nobody can change the hash, the encrypted code, the job, the studio or `school_provided` directly.
- `school_provided` is always true. Roster data comes from the school (FERPA) and is never used for marketing. That
  covers hand-added children too (Seenu #6, #7). Parent emails are stored on the child under the same rule.

**Removing a child** is a hard delete, allowed only while the job is a draft (Seenu #12). The API answers 409 first, and
a `BEFORE DELETE` trigger is the backstop. The trigger lets a whole studio's deletion cascade, like `guard_event_delete`.
Classes can't be deleted in this step.

**Access codes (D24, F13).**
- **Format.** 8 symbols from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31 symbols, no 0/O, 1/I/L). Stored without the dash and
  shown as `K7QM-4XPA`. Generated on the server with a CSPRNG and rejection sampling: 240 for the first symbol, 248 for
  the rest, so there is no modulo bias.
- **Unique everywhere.** The first symbol is `23456789ABCDEFGH` for US studios and `JKMNPQRSTUVWXYZ` for Canadian ones.
  A code is never ambiguous between the two regional databases, and step 9 knows which database to ask (D113). Within a
  database, the hash is unique across all studios. Parents type only the code, so uniqueness per job or per studio would
  be ambiguous. There are about 4×10¹¹ codes per region, which is enough given F17's lockout (step 9).
- **Lookup.** `HMAC-SHA256(ACCESS_CODE_HMAC_KEY, "daybell:access-code:v1:" + code)`, stored as lowercase hex. A plain
  hash would fall to an offline brute force of 31⁸ codes.
- **The studio's copy.** AES-256-GCM with `ACCESS_CODE_ENCRYPTION_KEY`, a random 12-byte IV, and the child's id as
  associated data, so a copy moved to another row won't decrypt. Stored as `v1.` + base64url(IV ‖ ciphertext ‖ tag);
  `v1` leaves room to rotate keys. The API sets the child's id itself so the copy can be bound to it. Studios always see
  the code, and step 3's cards print it.
- **Where it runs.** The functions live in `packages/core` and use WebCrypto only. Keys are passed in and read only on
  the server (`apps/web/lib/access-codes.ts`, `server-only`), lazily, so builds don't need them. Codes are never put in
  SQL, events, logs, URLs or Sentry.
- **Keys.** Each key is base64 of 32 random bytes (`openssl rand -base64 32`), and the two must differ. Errors name the
  variable, never the value. CI generates a fresh pair for each run's throwaway database. Vercel Preview and staging share
  the staging database, so they must share one pair of keys. Production gets its own pair. Losing the encryption key
  means codes can't be shown or printed; losing the HMAC key breaks parent lookup. Keep both in the password manager.
- **Unreadable copies.** If a stored copy can't be decrypted (a wrong or rotated key, a damaged row), the API shows the
  child with `accessCode: null` and the screens say "Code unavailable". It logs only `access_code_unreadable` and the
  child's id. One bad row never breaks the list.

**Server-only code writes (review fix S1, Seenu's choice).** Browsers can't write access codes. A member with a write
role could otherwise have inserted a child through PostgREST with a hash and copy of their own choosing.
- `authenticated` has no insert grant or policy on `children`, and can't run `add_child` or `import_roster`. Both
  functions can be run only by `service_role`.
- The web app calls them with a service-role client (`apps/web/lib/supabase/service.ts`, `server-only`). It does this
  only in the two route handlers that write codes (add a child, import), after `studioScope()` and
  `assertCanEditRoster`. The client has no session, and it is used for nothing else, because it bypasses RLS.
- Each function takes `p_actor`, the signed-in person's verified id. `app.act_for` sets `request.jwt.claim.sub` to that
  person for the rest of the call, so `auth.uid()` returns them. It then checks `app.has_role(studio, owner/admin/
  photographer)` for the job's studio. Staff, members of another studio and a missing actor get 42501, whatever the
  API did. Events from the triggers and `roster.imported` are attributed to that person through `app.emit`, not to the
  service role. `app.end_act_for` restores the setting before the function returns.
- `add_child` raises `access_code_collision` when a code is taken, as `import_roster` does, and the API tries again
  with a new code (3 attempts). The retry loops are `addChildWithRetries` and `saveImport` in `apps/web/lib/roster.ts`.
- **The key.** `SUPABASE_SECRET_KEY_US` and `SUPABASE_SECRET_KEY_CA` hold each regional project's secret key
  (`sb_secret_…`, or the legacy `service_role` key). They are declared in `@daybell/config/server` (`server-only`),
  are never `NEXT_PUBLIC_`, and are read on first use, so builds don't need them. A missing key logs
  `supabase_secret_key_missing` and the region, never a value. CI uses the local stack's own key from
  `supabase status`, masked and never committed. Vercel needs `SUPABASE_SECRET_KEY_CA` for Preview and Production
  (from that environment's Canadian project), and `SUPABASE_SECRET_KEY_US` once the US region is switched on.
- **Statement timeout.** A 5,000-row import is one statement, now run as `service_role`. Supabase gives
  `service_role` no role-level `statement_timeout`; previously it ran as `authenticated` (8 s). On plain Postgres 16 it
  takes about 1.9 s, which leaves room under the 8 s limit; the e2e test runs a full-size import against the local
  stack.

**Import (D23).**
- **In the browser.** CSV and Excel (.xlsx) are parsed in the browser; the raw file is never uploaded, stored or
  logged (D113). Only the confirmed rows reach the API.
- **Libraries.** `papaparse` 5.7.0 reads CSV: UTF-16 when there is a BOM (FF FE or FE FF) or a NUL in most byte
  pairs, else UTF-8 with a Windows-1252 fallback, the BOM stripped, and the delimiter detected. NULs are stripped from
  cells. `read-excel-file` 9.3.10 (browser entry) reads Excel. Both load only on the import page. SheetJS on npm is
  frozen at 0.18.5 with known advisories (CVE-2023-30533, CVE-2024-22363), and fixed builds come only from its own CDN.
  ExcelJS is large and pulls in many dependencies.
- **Limits.** 5 MB and 5,000 rows per file (Q3). Larger rosters are split into several imports; a job's roster has no
  limit.
- **Zip bombs.** Before unzipping an .xlsx file, the browser reads the sizes declared in its central directory. It
  refuses the file if any entry or the total would unpack to more than 50 MB, or if an entry of 1 MB or more is
  compressed more than 100 to 1. It also refuses ZIP64 and malformed archives. The unzipper (fflate) allocates
  exactly those declared sizes, so a file can't unpack to more than it declared.
- **Clean text.** Names, classes, student IDs and grades with control characters (C0 or DEL) or lone UTF-16
  surrogates are refused by the zod schemas. In names and classes, tabs and line breaks become spaces first.
- **Row numbers.** Blank rows are skipped but counted, so the "Row" column on the check screen matches the file.
- **Steps.** Daybell guesses each column from a synonym list, and the studio confirms the mapping. Rows are checked
  with the same zod schema the API uses: bad rows are shown with a reason and left out. A **dry run** on the server
  plans adds, updates and duplicates from the current roster, and the studio imports after seeing it.
- **Re-import (Seenu #5, Q2).** A row whose student ID matches exactly one child updates that child, who keeps their
  code. The rule is "fills and changes, never erases": names are replaced; class, grade and parent email change only when
  the cell has a value; opt-outs can be turned on by a file but never off. Children missing from the file are left
  alone. Other rows are added.
- **One transaction.** `import_roster` saves the whole file or nothing. Imports into one job run one at a time (advisory
  lock). If a code collides, the API generates new codes and retries (up to 3 attempts). If a matched child was removed
  meanwhile, it plans again once, then answers 409. The RPC's error messages carry no values.
- **Duplicates (Seenu #4).** Two children are duplicates if they share a student ID (case and whitespace ignored), or
  if neither has an ID and they share a first and last name (case and whitespace ignored) in the same class. "No class"
  counts as a class. Core and `list_children` implement the same rule.

**Why the roster list is an RPC.** `list_children` is SECURITY INVOKER, so RLS and column grants apply. Keyset filters
on names would put children's names in PostgREST URLs, which Supabase logs; an RPC carries its parameters in the body.
Duplicate flags also need the whole job. Every other query puts only IDs in its URL. Classes come from
`list_job_groups` with their child counts.

**Events and the activity log (Q4).** `job_group.created {job_id}`, `job_group.updated {fields}`,
`child.created {job_id, group_id}`, `child.updated {fields}`, `child.deleted {job_id}` and
`roster.imported {added, updated, groups_added}` carry only IDs, field names and counts. The activity log shows one line
per import, "{actor} imported a roster into {job}". Child and class events stay in the outbox and aren't shown. The
activity query filters to the types it shows before its limit of 50, so a big import can't push everything else out.

**zod is at least as strict as the database.** A failing check constraint makes Postgres log the failing row, names
and emails included. Every length limit is checked in zod first, and a test reads the migration's limits.

**The screens** follow ADR 0010.
- The roster is a section of the job page (Seenu #11). Contacts › Children stays "Soon".
- The class picker is the shared combobox, now `app/app/combobox.tsx`, which the client picker also uses.
- Import is its own page, so tables of up to 5,000 rows fit on phones too.

**Rejected:**
- Browser writes of codes, with the hash and copy checked only by format (the risk the review fix removes).
- Codes unique per job (ambiguous for parents).
- A plain SHA-256 hash.
- Storing the plain code.
- Generating codes in SQL (the keys would live in the database).
- Uploading the file to the server.
- One API call per row.
- A unique student ID.
- Merging duplicates.
