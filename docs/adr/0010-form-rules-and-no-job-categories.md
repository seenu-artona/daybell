# 0010 — Form rules, and job categories removed

- Status: Accepted, Oct 11, 2026. Supersedes the job-category and job-form parts of 0009.
- Decisions: D91, D133 (Seenu, Oct 11 2026)

**Job categories are removed (D133).** Seenu merged the category into the job type. The forward migration
`20261011060000_drop_job_categories` does the following:
- Replaces the job event trigger so it no longer reads `category_id`.
- Drops `jobs.category_id`, along with its composite FK, index and grants.
- Drops the seeding trigger on `studios` and its function.
- Drops `job_categories`, along with its policies, grants and triggers, and the `job_category.*` event function.

Each job's category is lost, as are any categories studios renamed or added. This is a known, accepted loss. Earlier
`job_category.*` events stay in the event log as written, because events are immutable; the activity log never showed
them. The `/job-categories` endpoint, its types and the job's `category` field are gone from the API.

**Form rules (D133), for every form:**
- **Hints go inside fields as placeholders.** The only text under a field is its error, linked to the field (D91).
- **Optional fields say so in the label,** e.g. "Subjects expected (optional)". The text comes from one locale message.
- **Rarely used fields fold under "More options",** which is closed by default and opens by itself when one of its fields
  has an error.
- **Layout:** two columns on desktop and one on phones. Long text is full width; short pairs sit side by side. Rows are
  `gap-5` apart, section titles use the `text-title-sm` token, and there are no extra borders or boxes.
- **A picker is one field:** an ARIA 1.2 combobox (`role=combobox` with a listbox, `aria-activedescendant`, arrow keys,
  Enter to pick, Escape to close the list only). The list opens on click, typing or ArrowDown (not on focus
  alone, so it stays shut when focus returns from a dialog). No option is active until chosen with the arrow keys or
  pointer, so Enter alone submits the form. "Add new client" is always the last
  option, and with no clients it is the only one. It opens the client form on top, prefilled with what was typed, and
  selects the new client.
- **Buttons name the action:** "Create job" and "Add client" when creating, "Save changes" when editing, with Cancel
  beside them. Dialog titles are short: "Create job", "Edit job", "Add client", "Edit client".

**The job form** (create and edit share one component) has these rows:
1. Job name.
2. Picture day | Job type.
3. Client (optional).
4. "More options": internal job number (pre-filled with the next JOBnnnnn) | Subjects expected (optional).

**The client form** has these sections, none of them folded:
- Name.
- Address: street; apartment or suite; city | province or state; postal or ZIP code | country.
- Contact person: first | last name; phone | email.
- Notes, with the placeholder "Only your studio sees this".
