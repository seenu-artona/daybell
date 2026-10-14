# 0028 — People: Clients, Contacts, Families and Subjects

- Status: Proposed with the People PR (branch `ui/round4-people`, stacked on `ui/round3-menu`). The calls in "Calls
  made" are provisional until Seenu reviews them, except call 1, which Seenu confirmed on Oct 14, 2026 (below).
- Decisions implemented: D150 (the People section), with Seenu's answers of Oct 14, 2026 (below) to the approved
  designs `P_PeopleClients`, `P_PeopleContacts`, `P_PeopleFamilies` and `P_PeopleSubjects`.
- Decisions touched: D147 (filter chips, saved per person), D148 (what "ordered" means), D96 (studio separation,
  events, words in files), D113 (no personal data in addresses, events or logs; Canadian data processed in Montréal),
  D91 (accessibility), D92 (one API for screens and integrations), D24.
- Amends: 0027 ("Contacts, Families and Subjects arrive with the People design": they have arrived), 0025 and 0026
  (Clients' columns and chips), 0026's `list_children` (its Ordered rule moved into a shared helper, unchanged).

## Seenu's answers (Oct 14, 2026)

These override the designs where they differ.

1. **Clients**: no Type column and no Schools/Preschools/Sports chips (clients have no type). Columns: Client, Main
   contact (name · role), Jobs (count), Latest job (latest by picture day, linked to the job). Chips: All only, plus
   the search. Rows open the existing client dialog. No money.
2. **Families** waits for parent accounts: the tab exists and shows the coming-soon panel; it is hidden for anyone who
   can't see order data.
3. **Contacts**: no School portal column; a "Main" badge next to the main contact's name. Columns Name, Role, Client,
   Email. Chips All, Main contacts, "+ Add filter" (Client…). New contact; rows open a contact dialog (edit for owners
   and admins, read-only otherwise). A new table `client_contacts` (studio_id, composite FK to clients, first and last
   name, role ≤ 60, email, phone, is_main; one main per client; row-level security like clients; events
   `contact.created`/`contact.updated` with field names only). Each client's inline contact is backfilled as its main
   contact. The public `Client.contact*` fields keep working, read from the main contact, and editing a client's
   contact and editing its main contact stay consistent (the approach is a call, below).
4. **Subjects (all jobs)**: one row per child per job. Columns Name, Class, Job (link), Ordered (D148, from one shared
   SQL helper so it can't drift from `list_children`). No Family column and no "No family yet" chip. Chips All,
   Ordered, Not ordered, "+ Add filter" (Job…, Client…). Footer "{n} subjects across {m} jobs". People who don't see
   orders: no Ordered column, no order chips, and the API returns null. Rows link to the child on their job's Subjects
   tab. A SECURITY INVOKER `list_studio_children` pages like `list_children`; the route runs in Montréal like `/orders`.
5. **Layout**: h1 "People", pill tabs Clients · Contacts · Families · Subjects (links with `aria-current`), a muted
   line per tab on the right, the green action only on Clients (New client) and Contacts (New contact). People is
   highlighted in the menu.
6. **Saved chips**: `people_clients`, `people_contacts`, `people_subjects` join the `list_page` enum in their own
   migration, and `save_list_filters` and `LIST_FILTER_KEYS` take their keys.

## Seenu's decisions on review (Oct 14, 2026)

A. **Staff see order status, as on Orders.** The code stays as it is: call 1 is confirmed.

B. **No "child" or "children" in People's words.** A subject can be anyone, an adult too. People's user-facing words
   (the sections' lines, empty states, chips, footers) say "everyone", "people" or "subjects"; Subjects' line is
   "Everyone across all your jobs". Internal names (tables such as `children`, functions such as
   `list_studio_children` and `app.ordered_children`, types) stay. Words outside People (the job's Subjects tab, QR
   cards, Photos, the shop) are unchanged for now.

## What changed

**Data** (`20261014100000_list_page_people.sql`, `20261014100100_people.sql`).

- `client_contacts`: `studio_id`, `client_id` (composite FK to `clients`, cascading with it), `first_name`,
  `last_name`, `role` (≤ 60), `email`, `phone`, `is_main`, timestamps. The name, email and phone limits are the client's
  own contact columns', so the two always fit each other. A contact must have a name, an email or a phone (a check).
  A unique partial index allows one main contact per client. Row-level security like clients: members read, owners
  and admins add and edit; no delete grant; a contact never changes studio or client (column grants).
- Backfill: every client with any contact field gets a main contact with those fields, without events.
- Events: `contact.created`, `contact.updated {fields}` and `contact.deleted`, the contact's id as subject, never
  names, emails, phones or roles. They are not activity types (the activity log doesn't show them yet).
- `app.client_contact_take_main` (the main contact's step-down) is SECURITY INVOKER: the step-down is the caller's own
  update, under row-level security, so someone who can't write a studio's contacts steps nobody down. The client-side
  sync still runs it as its owner. `app.mirror_main_contact` can't be called by signed-in people.
- `app.ordered_children(studio, child ids)`: the D148 rule, moved out of `list_children` unchanged (a paid order,
  neither canceled nor refunded in full, with a line of the child's own in the child's job that wasn't given back in
  full). SECURITY INVOKER: order rows are only readable by owners, admins and staff. `list_children` now calls it.
- `list_studio_children(studio, q, show, job, client, after, limit)`: SECURITY INVOKER; children across the studio's
  jobs by last and first name, keyset pages of up to 100, with the job's name, the class, `has_paid_order` (null
  unless the caller is an owner, admin or staff of the studio), and `total` and `jobs` over every match. `show` is
  `ordered` or `notOrdered` and is refused (42501) for anyone else.
- `list_client_contacts(studio, q, main only, client, after, limit)` and `client_list_details(studio, client ids)`
  (main contact, job count, latest job by picture day): SECURITY INVOKER. Their inputs are bounded like the API's: a
  search over 120 characters or more than 101 client ids is refused (22023).
- `save_list_filters`: Contacts takes a client chip, Subjects a job or a client chip, Clients none.

**API** (D92; the public group stays "Contacts", as in ADR 0027).

- `GET /clients` items are `ClientListItem`: a `Client` plus `mainContact`, `jobCount` and `latestJob`; the response
  gains `total` (still counted when the cursor's client has gone). One-client endpoints still return `Client`.
- `GET /contacts?show=main&clientId=`, `POST /contacts/search`, `POST /contacts`, `PATCH /contacts/{id}`.
- `GET /subjects?show=&jobId=&clientId=`, `POST /subjects/search`: `preferredRegion = "yul1"` and
  `assertFunctionRegion`, like `/orders`; `hasPaidOrder` is nulled for people who don't see orders, who get 403 for
  `show`.
- `GET` and `POST /contacts`, `PATCH /contacts/{id}`, `POST /contacts/search` and `GET` and `POST /clients` run in
  Montréal too (call 8).
- `LIST_PAGES` and `LIST_FILTER_KEYS` gain the three People lists.

**Screens.** `PeoplePage` (the title row, the tabs and the section's line) wraps the four sections; `/app/people`
itself (`PeopleIndexPage`) goes to Clients, and core's section type is `PeopleSection`. Clients: the columns of
answer 1, the main contact's name then its role muted ("Dana Ruiz · Office"), Jobs right-aligned, "n clients" in the
footer. Contacts: the columns of answer 3, the "Main" badge in words (D91) on primary-soft (the Badge's new `primary`
tone, a positive note that isn't a job status), chips All, Main contacts and saved clients, the contact dialog
(`ContactForm`: names up to 60 characters, email up to 254). The empty state tells owners and admins how to add a
contact and just says "No contacts yet." to everyone else. Families: the coming-soon panel. Subjects: the columns of
answer 4, Ordered and Not ordered as pills with their words (primary-soft and grey), chips All, Ordered, Not ordered
and saved jobs and clients, rows opening `/app/jobs/<job>/people?child=<id>` (the existing deep link). Chips are enum
words and ids in the address (D113).

**The main contact stays main until someone else is.** Unticking "Main contact for this client" on the current main
contact would leave the client with no contact person by accident, so the box is locked for the main contact, with
"To change the main contact, make someone else main.", and `PATCH /contacts/{id}` refuses `isMain: false` on it
(`invalid_input`, `isMain: validation.mainContactStays`). Making another contact main still steps the old one down.

**Tests.** pgTAP `027_people`: row-level security and grants, one main per client (and the index on its own), the
mirror both ways, cross-studio leaks for contacts, the clients details and subjects, photographers get null order
data and can't filter by it, staff see it, `list_children` and `list_studio_children` agree, events without personal
data, the People chips; the People functions are SECURITY INVOKER, the mirror isn't callable, the shared Ordered rule
answers photographers nothing, the lists' inputs are bounded, a photographer or another studio's owner can't add a
main contact (the main stays), and a contact added as main takes over and fills in the client. Route tests with
studio-scope leak tests for every new route, Montréal for the contacts and clients routes, the main contact's untick
refused; API contract tests; core (`peopleSections`, `contactName`, `isContactEmpty`); the screens, the contact form
and the chip logic; e2e `phase1-people` (also: saved Client… and Job… chips kept after a reload and removed, the
Clients row following the main contact, a contact made main from the Edit dialog, the dialog read-only for a
photographer).

## Calls made

1. **Who sees order data.** Confirmed by Seenu on Oct 14, 2026 (decision A): staff see order status, as on Orders.
   Answers 2 and 4 say "photographers (and staff — anyone who can't see order data)". In
   Daybell staff do see orders (ADR 0024, Q4: `canSeeOrders`, the orders' row-level security, and the job's own
   Subjects tab already shows staff the Ordered column). I followed the rule as stated, "anyone who can't see order
   data", which today is photographers only, so People › Subjects and the job's Subjects tab agree. If Seenu meant to
   hide it from staff too, it is one rule to change: `peopleSections` and the Subjects page in the app, `listSubjects`
   in the route, and the role list in `list_studio_children`.
2. **Keeping a client's contact and its main contact consistent.** The contacts table is the record; the client's
   four contact columns are a mirror of its main contact, and triggers keep them in step in the same statement,
   whichever side is written: a change to the main contact (or to which contact is main) is copied to the client; a
   change to the client's contact fields (the client dialog, the job form's new client, `POST`/`PATCH /clients`) is
   copied to its main contact, adding one if there was none. `pg_trigger_depth()` stops a copy being copied back.
   This keeps the public `Client.contact*` fields and every existing client screen unchanged, and the two can never
   disagree. Two consequences: clearing all four contact fields on a client removes its main contact (written as
   `contact.deleted`, an event the brief didn't list), and a contact change made on the client writes both
   `client.updated` (its contact fields, as before) and `contact.updated`. A mirrored copy writes no `client.updated`.
3. **Search goes in a POST body.** Contacts' and children's names may not go in a URL (D113; the menu search and the
   orders' reference search do the same), so `GET /contacts` and `GET /subjects` take filters only and
   `POST /contacts/search` and `POST /subjects/search` take the text. `list_studio_children` still takes `q`.
4. **A contact is a name, an email or a phone**, not necessarily a name, so every existing client contact (some have
   only an email) could be backfilled. A contact with no name is shown by its email, then its phone.
5. **A contact never moves to another client**, and there is no `DELETE /contacts` (contacts go only when their
   client's contact person is cleared, as above).
6. **Contacts' order**: by client name, the main contact first, then by last and first name.
7. **Footers**: "n clients" and "n contacts" as in the designs, so `GET /clients` gains `total` (one count query)
   and the contacts list returns its total.
8. **Everyone on the team reads contacts**, like clients. Contacts and clients are people's names, emails and phones,
   so after the security review their routes are pinned to Montréal like Subjects (`preferredRegion = "yul1"` and
   `assertFunctionRegion(studio.region)`): `GET`/`POST /contacts`, `PATCH /contacts/{id}`, `POST /contacts/search`
   and `GET`/`POST /clients`. `GET`/`PATCH /clients/{id}` are not pinned yet (they were not in the review's list).
9. **Subjects' search** matches the child's first and last name only (not student IDs or access codes).
10. **The Clients list's saved chips page** exists in the enum but takes no keys (answer 1: All only).
11. **The client's contact person stays in the client dialog** (editing it edits the main contact), so the job form's
    "new client" keeps working; its role is set from Contacts.
12. **Families' address** takes people who can't see order data to Clients rather than showing an empty page.
13. **Ordered and Not ordered compute the rule for every match** to filter and count; studios with very many orders
    may want an index or a stored flag later.

## Rejected

- Dropping the client's contact columns and reading them from `client_contacts` in every route: more routes and
  queries to change, and writes to a client and its contact would no longer be one statement.
- `GET /subjects?q=` and `GET /contacts?q=`: children's and contacts' names would land in request logs (D113).
- A Family column or "No family yet" chip (answer 4: no family data yet).

## Waiting

- Families (parent accounts).
- Contact events in a client's timeline (D150: timelines on records).
