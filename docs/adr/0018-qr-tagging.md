# 0018 — QR tagging and review

- Status: Proposed, Oct 12, 2026 (accepted when Seenu merges the step 5 PR). Amends 0015 (how a blank card is claimed;
  the card's child FK is now deferrable), 0016 (a batch can be a class-photo upload; the worker reads QR cards and
  decodes to 2048 px; the clean-up tags batches) and 0017 (a new task, new facts, a new Up next reason).
- Decisions: D32, F16, D142 #7, D143; touches D60, D91, D92, D96, D100, D112, D113, D138, D140, D141, D10. Seenu's
  answers to the step 5 brief (1–8) and to the architect's questions (1–10), Oct 12, 2026.

## Context

Phase 1 step 5: "Daybell reads QR cards in uploaded photos and gives each child every photo up to the next card; card
photos are hidden from parents; review screen to fix tags and drag leftovers onto children; review is required before
Selling" (D32, F16). A card's QR holds `DBC1:` + a random card code, never the access code (ADR 0015); photos are
ordered by upload batch, capture time, then filename (D142 #7; ADR 0016).

## Reading cards (in the image worker, in Canada)

- **Library:** `zxing-wasm` 3.1.4 (MIT; zxing-cpp compiled to WebAssembly; published Sep 10, 2026; 3.1.5 of Oct 6 is
  too new). Its dependencies resolve to `type-fest` 5.10.0 (Sep 17), `tagged-tag` 1.0.0 and `@types/emscripten`
  1.41.6 (Sep 1), all at least two weeks old (pnpm's `minimumReleaseAge` checks them too). WebAssembly, so the same
  code runs on the Lambda's arm64 Node 22. Only the `zxing-wasm/reader` subpath is used.
- **The .wasm is always read from disk.** By default zxing-wasm fetches it from jsDelivr; a Canadian Lambda must never
  depend on a CDN. `loadQrReader(wasmFile)` reads the file and passes it as `wasmBinary`; library code never resolves
  the path itself (Turbopack would try to bundle it), so every caller passes it: the Lambda its copy at
  `lib/zxing_reader.wasm`, the local driver the web app's `node_modules`, tests `node_modules`. `scripts/build.mjs`
  copies the file next to the bundle, checks its SHA-256 against a pinned value and the package's own
  `ZXING_WASM_SHA256`, then imports the bundle and runs `qrSelfCheck()` (the bundle reads an image with the wasm next
  to it). That check caught a real bug: the bundle's `createRequire` banner clashed with the reader's own import; the
  banner's import is now aliased. A test with `fetch` made to throw confirms nothing is fetched.
- **Where:** `processOriginal` decodes each original once, upright and sRGB, to 2048 px (was 1600). The card is read
  from that (RGBA into zxing's ImageData path: QR only, `tryHarder`, `tryRotate`, `returnErrors`, at most 4 symbols).
  Only when a symbol is located but not decoded is the original decoded again at 3072 px and read once more. The
  previews are then made from the 2048 px pixels, sized from the original so they are exactly as before.
- **What a photo's symbols mean** (`classifyQr`, core): other QR codes are ignored; one Daybell card read cleanly is a
  card (the same card twice in a frame too); a symbol located but not decoded, a `DBC1:` payload with a bad code, two
  different cards, or a clean card next to a symbol that couldn't be read are **unreadable** (Seenu, answer 1: never
  silently mis-tag). A decoder error on one photo counts as unreadable; a reader that can't load throws, so the message
  goes back to the queue instead of photos being processed without cards.
- **Reporting:** the signed result gains `qr: {kind, cardCode?}` (optional, so results from the worker already deployed
  count as plain photos). The card code travels only in that body: never in a URL, header, log line or queue message
  (worker test with a console spy). `record_photo_result` looks the code up **among the photo's own job's cards only**:
  anything else is `other_card` (another job, another studio, or a deleted card); no other job or studio is ever
  searched.
- **Time:** p50/p95 of `processOriginal` on a 24-megapixel JPEG, 20 runs, measured on this step's 2-vCPU x86_64
  machine: 558/758 ms reading cards, 350/450 ms with a no-op reader, so about 200 ms extra at p50 (target: under 400 ms).
  `DAYBELL_PERF=1 pnpm --filter @daybell/image-pipeline test` repeats it. **Not yet measured on the Lambda's arm64**:
  a follow-up on staging.

## Tagging rules (`packages/core/src/tagging.ts`, pure)

`tagBatch(photos, {classGroupId})`, for one upload batch in tagging order (each batch on its own, starting in
Leftovers):

- Before the first card, photos go to **Leftovers**.
- A readable card makes its own photo a **card photo** (hidden from parents, kept for the studio) and sends the photos
  after it to its child, or, for a blank card, to that card until the studio names the child. The same card again
  changes nothing, so a card shot twice in a row is ignored, and a card seen again later (a retake) sends photos back
  to its child (plan answer 8).
- A card that can't be read, or isn't this job's (plan answer 2), stays with the current target, **flagged** and
  hidden; the photos after it keep that target, flagged `afterUnreadable`, until the next readable card (answer 1).
- A photo that failed, or is still processing in a forced run, gets no tag and flags the photos after it
  `afterFailed` (plan answer 3).
- A class-photo upload puts every photo in that class's **Class photo** set; cards in it are hidden and otherwise
  ignored (answer 3, plan answer 8); an unreadable one is flagged.

`planTagWrites(current, computed)` writes only automatic tags that change and never touches a manual one, so tagging the
same batch twice writes nothing. `reviewTaggingDone`, `canMarkReviewed` and `notReviewableReason` are the review rules.

## Data (forward migration `20261012100000_tagging.sql`)

- `photos.qr_kind` (`none | card | unreadable | other_card`, null until processed by a worker that reads cards) and
  `photos.qr_card_id`, composite FK to the job's own cards (`on delete set null (qr_card_id)`). Members read both.
- **`photo_tags`**, one row per tagged photo: `place` (`child | class_set | leftovers | card | blank_card`), the id that
  goes with it, `flag`, `source` (`auto | manual`), `tagged_by`. Composite FKs keep the photo, child, class and card in
  the tag's own studio and job; checks tie each place to exactly its id. Row-level security: members read; nobody
  signed in writes. Every ready photo of a tagged batch has a row. A removed child's photos go to Leftovers (by hand)
  in a `before delete` trigger.
- **`upload_batches.group_id`** (a class-photo upload), **`tag_round`** (bumped by statement-level triggers when a
  photo is added, processed, binned, restored, or its card read or deleted) and **`tagged_round`**.
- **`job_tagging_reviews`**: who marked the job reviewed and when. Row-level security: members read. The row is
  deleted when photos are registered, when tagging writes Leftovers or flags, when photos are moved to Leftovers or a
  child is removed, which **reopens** the task (answer 4); moves between children don't (plan answer 5).
- Functions, service role only, each acting for the person and checking owner, admin or photographer (staff and other
  studios get 42501), errors without values: `move_photos` (≤500, never card photos: `card_photo`; never unprocessed
  or binned ones: `photo_not_ready`), `confirm_photos` (keep, or mark as card photos), `blank_card_code`,
  `claim_blank_card`, `mark_tagging_reviewed` (`tagging_not_ready` unless clean), and for tagging runs
  `tagging_inputs`, `apply_batch_tags` (`tagging_stale` when the round moved on), `batches_of_photos`,
  `batches_to_tag`. Reads for the screen are SECURITY INVOKER (row-level security applies): `job_tagging_overview`,
  `tagging_photos`, `tagging_children`, `tagging_no_photos`, `tagging_blank_cards`, `photo_parent_visible` (for the
  shop later: a ready photo, not binned, with a child or in a class set, not flagged, never a photo whose card was
  read). `job_checklist_facts` (still SECURITY DEFINER with one membership check, ADR 0017) gains `tagging_pending`,
  `leftovers`, `flagged`, `blank_cards_pending` and `tagging_reviewed`; `job_photo_counts` gains `leftovers` and
  `flagged`. `create_upload_batch` gains `p_group_id`.
- Batches uploaded before this step are marked due, so the daily sweep tags them (their photos were processed without
  cards, so they land in Leftovers).
- pgTAP `012_tagging.test.sql` (113 assertions): resolution within the job only, rounds, manual tags kept, the claim
  order, roles, another studio refused and seeing nothing, events with ids and counts only.

## When tagging runs

The API runs `tagBatch` (yul1) and writes the result for the round it read: after a worker result once the batch has
no photo still processing (the last result tags it), after an upload is finished, after the bin and a restore, and in
the daily clean-up for every batch still due (photos stuck processing for 15 minutes then count as unreadable). A run
that read a round that moved on is tried again up to three times, then left to the sweep (logged with the batch id
only). Tagging runs of a job and Mark reviewed take turns on an advisory lock.

## Naming a blank card's child (amends ADR 0015)

ADR 0015's order (release the card's code, make the child with it, give the card its child) can't run as that schema
stood: the card's check can't be deferred, and the child FK refuses a child not yet inserted. `qr_cards_child_fk` is now
`deferrable initially immediate`. `claim_blank_card` locks the card, defers the FK, gives the card its child and clears
its code in one statement (releasing the hash), inserts the child with the card's hash (claiming it again) and the
API's copy re-encrypted for the child's id, checks the FK, and sends the card's waiting photos to the child. Releasing
first matters: the release trigger deletes by hash, so releasing after the claim would delete the child's claim. The
API decrypts the card's copy (bound to the card) in memory and re-encrypts it for the new child (bound to the child),
in yul1, logging only the card id if it can't. New children only go into existing classes (plan answer 6); for a child
already on the roster, the card's photos are moved to them and the card's code stays unused.

## API (`/api/v1`, D92)

`GET /jobs/{id}/tagging` (summary, albums, blank cards; Mark reviewed's state from core), `GET /jobs/{id}/tagging/photos`
(`place=leftovers|flagged|child|classSet|blankCard`, keyset by photo id), `GET /jobs/{id}/tagging/children`,
`GET /jobs/{id}/tagging/no-photos`, `POST /jobs/{id}/photos/move`, `POST /jobs/{id}/photos/confirm`,
`POST /jobs/{id}/qr-cards/{cardId}/child` (201, the child), `POST /jobs/{id}/tagging/review` (409 `tagging.notReady`),
and `POST /jobs/{id}/upload-batches` with an optional `{groupId}`. Conflicts are named in `fields.form`:
`tagging.cardPhoto`, `tagging.photoNotReady`, `tagging.cardClaimed`, `tagging.notReady`. Every route checks the person,
their role for writes (owners, admins and photographers; staff read, plan answer 10) and the region before the body;
routes that sign previews or decrypt codes run in yul1 with `assertFunctionRegion` (and `assertStorageRegion` for
storage). URLs hold ids only.

## Screens

- Photos gains two views, **All photos** and **Review** (links with `aria-current`).
- The upload sheet asks first: "Individual photos (read QR cards)" or "Class photo for a class" with a class select.
- **Review:** the heading's subline counts photos, Leftovers and photos to check; **Mark reviewed** is disabled until
  clean and the reason is written out beside it. Then Flagged (each tile says why), Leftovers, New children from blank
  cards (the card's photo, its waiting photos, first and last name, class, Add child, Give photos to an existing
  child), one album per class then No class (a button with `aria-expanded`; the Class photo set, then each child's
  row with a strip of 12 and Show all), and No photos yet (collapsed; doesn't block selling, answer 6).
- Tiles show the 400 px preview with alt text "{where}, photo {n}" (never a filename); card photos say "Card" and have
  no checkbox. Movable photos have a 44px checkbox; ticking opens a bar: Move to…, Looks right, This is a card photo,
  Clear. **Move to…** is a dialog with a search box and native radios (Leftovers and class photo sets, then children by
  class): the non-drag way to move (WCAG 2.5.7). Drag uses native HTML5 drag and drop of ids onto a child's row, a
  class's header or Leftovers; no new dependency. Results go to a polite status region. While photos are processed or
  tagged, the summary is checked every 4 s.
- Staff see the review read-only. Words in the locale files; tokens only; visible focus everywhere.

## Checklist and Up next (amends ADR 0017)

- New task **Review tagging** (Photos in, links to Review, roster editors): done when there are photos, nothing pending,
  no Leftovers, flags or blank cards to name, and someone marked it reviewed. Its Overview row notes "N in Leftovers ·
  N to check".
- **Up next:** Leftovers or flagged photos rank as broken, in the same tier as failed photos (plan answer 9), with the
  new reason `taggingProblems`; failed photos still come first within the tier. Blank cards to name are just the next
  step.
- **Selling gate** (plan answer 7): `reviewTaggingDone` is the rule; jobs with no photos fail it. The Start selling
  dialog's "Tagging reviewed" is now real (from `GET /jobs/:id`'s checklist). The server refusal comes with Start
  selling.

## Events (D96)

Ids and counts only: `photos.tagged {batch_id, round, photos, cards, leftovers, flagged, blank_cards}` per run that
changed something (attributed to whoever started the upload), `photos.moved {photo_ids, count, target_kind,
target_id}`, `photos.confirmed {photo_ids, count, as_card}`, `qr_card.claimed {card_id, child_id}` (besides
`child.created`) and `tagging.reviewed`. Never card codes, names, filenames or access codes (pgTAP checks). Not shown in
the activity log yet (follow-up, as in ADR 0016).

## Region and privacy (D113, D141)

Cards are read by the Lambda in ca-central-1 (or the local driver); tagging and the claim run in yul1. Queue messages
still hold ids only. Card codes are not secret, but they are kept out of logs, URLs, events and queues anyway. Logs
name batch, photo and card ids and error names only.

## Calls made in this step (for review)

- `other_card` is its own `qr_kind` and flag ("Another job's card") rather than folded into unreadable: the behaviour is
  answer 2's, and the reviewer sees why.
- A clean card in the same frame as a symbol that couldn't be read counts as unreadable (it may be a second card).
- Failed photos get no tag and don't block Mark reviewed (answer 4 lists Leftovers, flags and blank cards only); the
  photos after them are flagged, which does.
- Mark reviewed also waits for photos still processing or batches still to tag.
- Confirming a flagged photo or moving it makes it the reviewer's (manual): tagging never changes it again.
- The blank card list is part of `GET /jobs/{id}/tagging`, not its own endpoint.
- Children marked Do not photograph are left out of No photos yet.

## Follow-ups

- Measure reading time on the Lambda's arm64 (staging) and record it here.
- Show the new events in the activity log and the job's Recent activity.
- Undo for moves; voiding unused blank cards (ADR 0015).
- The server's refusal to start selling until Review tagging is done (with Start selling).
- CI's image-worker job could also check the zip lists `lib/zxing_reader.wasm` (the build already refuses to finish
  without it); not changed here, as the workflow is outside this step.

## Rejected

- jsQR (pure JavaScript): it can't say "a symbol is here but I couldn't read it", which answer 1 needs.
- Reading cards at 1600 px (a waist-height card is about 3 px per module at 2048 px; less is too few).
- A second Lambda pass, or reading cards in the browser (D113; the worker already decodes every original).
- Tagging in SQL only (the rules belong in core, tested on their own and shared with screens).
- dnd-kit or another drag library (Move to… already covers touch and keyboard; native drag is enough).
- Fetching the .wasm from a CDN (D113).
