# 0015 — QR cards

- Status: Proposed, Oct 11, 2026 (accepted when Seenu merges the step 3 PR). Amends 0011 (access codes are now unique
  across children and blank cards, and blank cards are a fourth server-only code write).
- Decisions: D32, D138, D140; touches D91, D92, D96, D112, D113. Seenu's answers to the step 3 brief (1–4) and to the
  step 3 plan's questions (1–9), Oct 11, 2026.

> **Forward note (Oct 12, 2026):** the card's layout changed in step 5. Seenu's answer 11: the access code no longer
> prints on the photographed side. The front holds the name, class and QR only; the studio's name, the access code and
> the instructions are on a tab below a dashed "Fold back before picture day" line. See ADR 0018, "QR cards: the access
> code off the photographed side". The description below is the step 3 card.
>
> **Forward note (Oct 13, 2026):** the fold-back tab is replaced (Seenu, Oct 13, 2026). The PDF is printed
> double-sided on US Letter, flipped on the long edge: four cards per sheet, each sheet a front page then a back page.
> The front holds the studio's name, the child's name and class (a blank card: lines for the name and class) and the QR; the back
> holds the access code, large, "Go to {shop link}, enter your code" and the studio's name, its columns mirrored so each
> back lands behind its own front. One card is a two-page PDF. See ADR 0018, "Amendment (Oct 13, 2026): the access code
> on the back".

## What a card is

A card a child takes home (D138): the studio's name, the child's name and class, a QR, the parent access code and
"Go to {shop link}, enter your code". Four per US Letter page, sorted by class, cut along dashed lines. The QR holds a
random **card ID**, never the access code (D32), so a photo of a card never reveals the code. Children marked Do not
photograph get no card. Blank cards have lines for the name and class and their own pre-made access code (answer 1).
Layout choices (half page, 2 per page, editing) are deferred.

## Data

**`qr_cards`** (`studio_id`, row-level security, composite studio FKs as in ADR 0008):
- `child_id` is set for a child's card and null for a blank card. A child has **one card forever** (partial unique
  index; brief answer 2): reprints reuse it, so cards already handed out keep working.
- The FK `(studio_id, job_id, child_id) → children (studio_id, job_id, id)` (new key `children_studio_job_id_key`)
  keeps a card's child in the card's own job. It cascades: children are removed only while the job is a draft, and a
  child's card must never become a blank card.
- A blank card carries `access_code_hash` and `access_code_ciphertext`; a child's card never does (check constraint).
  When the tagging step (5) tags a blank card, in one transaction it must first clear the card's code columns (which
  releases the hash), then make the child with the same code (re-encrypted for the child's id, which claims the hash
  again), then set the card's `child_id`. Claiming before releasing would be refused as a collision.
- Members read `id, studio_id, job_id, child_id, card_code, created_at`. Nobody signed in can read the code columns,
  or insert, update or delete cards: card codes can't be chosen by a browser and never change.

**One access code everywhere (amends 0011).** Parents type only the code, so it must be unique across every child and
every blank card in the regional database (answer 1). Postgres can't put one unique constraint over two tables, so
`access_code_hashes` holds every hash (primary key), with `studio_id` and RLS (no policies, no grants). Triggers on
both tables claim a hash on insert and release it on delete. A taken hash raises `access_code_collision`, the name
`add_child` and `import_roster` already use, so the API's existing retries cover both tables. The primary key makes
concurrent claims wait for each other without extra locks. The triggers are split (claim on insert, release on
delete, both on a changed hash) with `WHEN` clauses, so a child's QR card, which has no code, never runs one. An index
on `studio_id` keeps a studio's deletion quick. The migration backfills it from `children`. A 5,000-row import takes
about 1.8 s on plain Postgres 16, against about 1.65 s without the registry (three runs each).

**Blank cards' codes** use the same rules as children's: CSPRNG, regional first symbol, HMAC lookup hash, AES-256-GCM
copy. The copy's associated data is `daybell:card:<card id>` (children use `daybell:child:<id>`), so a card's copy is
never readable as a child's, nor the other way round.

**Card codes.** 20 symbols of Crockford base32 (`0-9`, letters without I, L, O, U): 100 bits from pgcrypto's
`gen_random_bytes`. Each byte is masked to 5 bits; 256 is a multiple of 32, so there is no bias. Unique in the whole
database. Generated in SQL because they need no key (ADR 0011 rejected SQL only for access codes, whose keys must
stay out of the database). The QR payload is `DBC1:` + code: 25 characters in QR alphanumeric mode, version 2 at
error correction M. `DBC1` versions the format for the tagging app; there is no region prefix because the tagger works
inside a job it already loaded from one region. Card codes are not secret on their own, but they are kept out of
events and logs anyway. **A card code is never a parent credential:** it identifies a card for tagging only, and no
parent-facing lookup may ever accept it in place of an access code.

## Printing

**`prepare_qr_cards(p_actor, p_job_id, p_group_ids, p_no_group, p_child_id, p_blanks)`** runs only as the service role,
like `add_child` (blank cards carry codes). It acts for the signed-in person and checks owner, admin or photographer
(answer 3); staff, other studios and a missing actor get 42501. It checks the groups and the child belong to the job,
at most 100 blank cards (answer 3), and no blank cards or groups with a single child. Prints of one job run one at a
time (advisory lock). It makes the missing cards for eligible children in scope (cards are made on first print, answer
8; `add_child` and `import_roster` are unchanged), inserts the blank cards the API sent (ids, hashes, copies), and
returns every card code in scope plus the new blank cards. Named errors carry no values: `do_not_photograph`,
`nothing_to_print`, `access_code_collision`, `card_code_collision`. Nobody signed in can run the new `app` functions
(`claim_access_code`, the two trigger halves, `new_card_code`).

**`POST /api/v1/jobs/{id}/qr-cards`** (D92). A POST because each print makes blank cards and the body keeps the choice
out of URLs. Body: `groupIds` (job groups, `"none"` for no class), or `childId`, and `blankCards` 0–100. Order:
`studioScope()`, `assertCanEditRoster` and the region guard (below) before the body; the job, child (409 if Do not
photograph) and groups checked through RLS; the shop link and fonts checked, so a misconfiguration fails before any
blank card is made or a print is recorded; fresh blank-card codes generated and sent with up to 3 tries; only the
children the cards are for read through RLS (by id in chunks of 100, or the job in pages above 1,000 cards); codes
decrypted in memory; the PDF built and sent. A child marked Do not photograph between preparing and reading still gets
no card. If rendering fails after `prepare_qr_cards`, the blank cards it made stay unused (and the print is recorded);
they are harmless, since their codes were never shown, and voiding them is a follow-up. Response: `application/pdf`, `attachment; filename="qr-cards-<internal
number>.pdf"`, `Cache-Control: no-store`. Headers `Daybell-Cards`, `Daybell-Cards-Skipped` and
`Daybell-Cards-Replaced-Characters` give counts so the dialog can warn. A 409 says why in `error.fields.form`:
`qrCards.nothingToPrint`, `qrCards.doNotPhotograph` or `qrCards.codesUnreadable` (with the skipped count in its
header); the dialog and the child panel show each in its own words. The PDF is never stored; a reprint builds it
again (D138). OpenAPI describes the binary response and the headers (`RouteSpec.success.contentType` and `headers`).

**`GET /api/v1/jobs/{id}/qr-cards`** returns `{eligible, withCard, blankCards}` through `qr_card_status` (SECURITY
INVOKER). A separate endpoint rather than a field on the job, because the job page refreshes roster numbers after
every roster change and print.

**Unreadable codes (answer 9).** A child whose stored copy can't be decrypted is left out and counted; a card is never
printed without a working code. The log line is `access_code_unreadable` and the child's id, as in ADR 0011. If no card
can be printed, the API answers 409.

**The PDF.** Built in `apps/web/lib/qr-cards-pdf.ts` (server-only).
- Libraries, pinned and at least two weeks old: `pdfkit` 0.20.2 (MIT), `qrcode` 1.5.4 (MIT; only `QRCode.create()` for
  the module matrix, drawn as vector squares, no canvas or PNG) and `fontkit` 2.0.4 (pdfkit's own font engine, used
  directly to ask which characters the font has). `@types/pdfkit` 0.17.6 and `@types/qrcode` 1.5.6; fontkit's few
  functions are declared in `lib/fontkit.d.ts`.
- Fonts: Plus Jakarta Sans Regular and Bold, static TTF (OFL 1.1), committed in `apps/web/assets/fonts` with the
  licence and checksums, embedded as subsets. The document starts in the embedded font, so no standard PDF font is
  ever loaded. Latin and accents only (answer 5): other characters print as "?" and the card is counted.
- Layout constants and text fitting are in `packages/core/src/qr-cards.ts`. The QR symbol itself (quiet zone
  excluded) is 128 pt, 1.78 inches, at least the 1.75 inches tagging needs; the four-module quiet zone around it is
  kept clear of text. A test measures the drawn symbol in the PDF. Long names shrink, then go on two lines, then are
  cut with "…". Colours come from the design tokens (D112).
- Card wording follows the job's group word (Class, Team or Group; answer 7). The shop link is printed without
  `https://`. Words come from the locale files through `createTranslator` (D96).
- Metadata: the Title comes from the locale files ("QR cards"); Creator and Producer "Daybell"; never names or codes.
  The regular weight is opened once (the document's starting font, reused by name).
- `serverExternalPackages: ["pdfkit", "fontkit"]` and `outputFileTracingIncludes` for the fonts. The route uses the
  Node runtime and `maxDuration = 60`. 5,000 cards (1,250 pages; 2,500 since the double-sided card of Oct 13, 2026) take about 12 s and 270 MB locally; the `@load` e2e
  checks it against the real stack.

**Shop link.** `SHOP_URL` (`@daybell/config`'s `shopUrl()`; brief answer 1). Unset, it falls back to the deployment's
own address, so staging prints its Vercel address until the shop's domain exists. A value that isn't http(s) is
refused by name. Declared in `turbo.json` and `.env.example`.

## Region (D113)

The PDF is built in the request, from the session's regional database; codes are decrypted only in memory. Request
URLs carry only the job id. Seenu set the Vercel project's function region to `yul1` (Montréal) and redeployed (plan
answer 4). The route also sets `preferredRegion = "yul1"`, and a guard (`assertPrintRegion`) refuses a Canadian
studio's print with `region_unavailable` when `VERCEL_REGION` is set to anything else, before the body is read or a
code decrypted (logging only the region names). Locally and in CI `VERCEL_REGION` is unset, so there is nothing to
check. **Follow-up:** when a US database exists, US studios need their own function region and the mirror guard
(`PRINT_REGION.us`); `preferredRegion` is fixed per route and can't follow a studio.

## Events and screens

- `qr_cards.printed {cards, new_cards, blank_cards, groups, single}` on the job, attributed to the person printing.
  Counts and ids only. It shows in the job's Recent activity and the studio log as "{actor} printed QR cards for
  {job}" (answer 6).
- Overview: "Print QR cards" is done when every child who may be photographed has a card (answer 2, read literally:
  a roster where everyone is marked Do not photograph is done too; an empty roster is not); a child added later
  reopens it ("1 child without a card"). If the card counts fail to load, the rest of the Overview still shows. While it is open, roster editors get "Print cards", which opens People's
  print dialog (`?print=qr`, read once and removed).
- People: "Print QR cards" in the toolbar opens a dialog (native radios, checkboxes and a number field with labels,
  44px targets, a live count of cards and pages, a busy button, results and warnings in a status region). The child
  panel's "Print QR card" downloads that child's card; a child marked Do not photograph shows "No QR card" instead.
- The browser POSTs, then saves the file through a short-lived object URL.

## Follow-ups

- Voiding unused blank cards (never handed out, or left over from a print whose PDF failed), so their codes are
  released.
- A rate limit on prints, and one print per job at a time across requests (today prints of a job queue on an advisory
  lock in the database, but nothing limits how often a person prints).
- US function region and region guard (above).
- Tagging (step 5) uses `parseCardQrPayload` and `decryptCardAccessCode`, defined and tested now.

## Dependencies

`vite` comes in through `vitest` and `@vitejs/plugin-react`; the lockfile had 8.3.4, released 3 days before this step.
It is pinned with a pnpm override to 8.3.1 (Sep 24, 2026), the newest release at least two weeks old (CLAUDE.md).

## Rejected

- The access code in the QR (D32: a photo of a card would reveal it).
- A card code derived from the access code.
- Blank cards without a code (parents of untagged children couldn't reach the shop).
- Checking code uniqueness across tables with per-hash advisory locks (5,000 locks per import exhaust the lock table)
  or one global lock (serialises every import in the region).
- Creating cards when children are created (answer 8 allowed either; first print keeps `add_child` and the import
  untouched).
- Storing PDFs, or caching them.
- A GET that makes blank cards.
- pdf-lib (no release since 2021), `@react-pdf/renderer` (a heavy renderer for this), Helvetica (can't print
  "Ñúñez"), Noto fallback fonts for other scripts (answer 5: not at launch).
