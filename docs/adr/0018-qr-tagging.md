# 0018 — QR tagging and review

- Status: Proposed, Oct 12, 2026 (accepted when Seenu merges the step 5 PR). Amends 0015 (how a blank card is claimed;
  the card's child FK is now deferrable; the access code moves to a fold-back tab, answer 11; since Oct 13, 2026 to the back of a double-sided card), 0016 (a batch can be a class-photo upload; the worker reads QR cards and
  decodes to 2048 px; the clean-up tags batches) and 0017 (a new task, new facts, a new Up next reason).
- Decisions: D32, F16, D142 #7, D143; touches D60, D91, D92, D96, D100, D112, D113, D138, D140, D141, D10. Seenu's
  answers to the step 5 brief (1–8), to the architect's questions (1–10), after the security review (11) and after the
  fixes (12: undoing "This is a card photo"; 13: purge edge cases), Oct 12, 2026. Revised after the step's security and code reviews (cited below as "security review n" and "code review").

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
  to it). `loadQrReader` checks the same pinned SHA-256 (`ZXING_READER_SHA256` in `qr.ts`, kept equal to the build's by
  a test) every time it loads the file, not only at build (security review 7). A decoder error drops the module
  (`purgeZXingModule`) so the next photo loads a fresh one from disk and a warm Lambda recovers; a reader made before
  the drop refuses to run rather than let zxing-wasm fetch a module from its CDN (security review 8). That check caught a real bug: the bundle's `createRequire` banner clashed with the reader's own import; the
  banner's import is now aliased. A test with `fetch` made to throw confirms nothing is fetched.
- **Where:** `processOriginal` decodes each original once, upright and sRGB, to 2048 px (was 1600). The card is read
  from that (RGBA into zxing's ImageData path: QR only, `tryHarder`, `tryRotate`, `returnErrors`, at most 4 symbols).
  Only when a symbol is located but not decoded is the original decoded again at 3072 px and read once more. The
  larger read replaces the first only when it reads a Daybell card cleanly; otherwise both reads' symbols count, so a
  "looks like a card" from the first read is never lost (code review S2). The
  previews are then made from the 2048 px pixels, sized from the original so they are exactly as before.
- **What a photo's symbols mean** (`classifyQr`, core): other QR codes are ignored; one Daybell card read cleanly is a
  card (the same card twice in a frame too); a symbol located but not decoded, a `DBC1:` payload with a bad code, two
  different cards, or a clean card next to a symbol that couldn't be read are **unreadable** (Seenu, answer 1: never
  silently mis-tag). A decoder error on one photo counts as unreadable; a reader that can't load throws, so the message
  goes back to the queue instead of photos being processed without cards.
- **Reporting:** the signed result gains `qr: {kind, cardCode?}`, **required** for a ready photo (security review 2):
  a result from a worker that doesn't read cards is refused (400 from the API, 22023 from `record_photo_result`), so
  its message goes back to the queue for a worker that does. The card code travels only in that body: never in a URL, header, log line or queue message
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
- **Photos in the bin still mark where cards were** (security review 1). Tagging reads them (marked binned): they get
  no tag, but a binned card still sends the photos after it to its child, and a binned failed or unreadable photo
  still flags them. Without this, binning card photo 50 would silently give photos 51–60 to the previous child.
- **Photos purged from the bin leave what they did on the next photo** (security review 1). Before the daily clean-up
  deletes binned photos (30 days), `app.carry_purged_steps` folds each one's step (`tagStep`, `composeSteps`: a card
  sends the photos after it to its child; a failed photo, or one that may be a card, flags them until the next card)
  onto the next photo of its batch that stays (`photos.before_card`, `before_card_id`, `before_flag`; ids and flags
  only, never a filename). Tagging applies it before that photo, so tagging the batch again later gives every photo the
  same place.
- **Purge edge cases are flagged, never guessed** (Seenu, answer 13). Each case flags the affected photos `afterPurge`
  ("Check: near deleted photos"), which hides them from parents and reopens Review tagging (the run writes flags):
  - *The purged photos were last in their batch:* there is no photo to carry their step, so the batch remembers it
    (`upload_batches.purge_tail`; `purge_steps` marks any batch where a purge left a step).
  - *A photo comes into the batch's order, or moves in it, after such a purge:* `app.on_photo_after_purge` marks it
    `photos.after_purge` when it leaves `uploading` or its capture time changes. `tagBatch` works out where the purged
    photos may have been (the gap between the photo carrying their step and the last photo that was already in place
    before it, or after the last such photo for a tail) and flags the marked photos in that gap: they may belong before
    or after the purged photos. If a marked photo in the gap did something itself (a card, a flag), the two steps
    can't be put in order, so the photos from the one carrying the purged step on are flagged too, until the next
    card. If the photo carrying a step has itself moved, every photo of the batch is flagged.
  - *A purged card is removed later (its child deleted):* the photos it gave the child go to Leftovers by hand, as any
    removed child's do, but flagged `after_purge`; the photo carrying the removed card's step flags the photos after
    it until the next card. The removal moves the batch's round on (`before_card_id` is now one of the columns the
    round watches), so the batch is tagged again at once.
  A photo marked `after_purge` stays marked (a later purge can't tell it apart), so a few photos may be flagged that
  didn't need to be; never the other way round.
- **A ready photo without a QR result** (a worker that didn't read cards) is treated as unreadable (flagged, and the
  photos after it flagged) unless no ready photo of its batch has a QR result: then the batch predates card reading
  and its photos are plain photos, in Leftovers (security review 2).

`planTagWrites(current, computed)` writes only automatic tags that change and never touches a manual one, so tagging the
same batch twice writes nothing. `reviewTaggingDone`, `canMarkReviewed` and `notReviewableReason` are the review rules.
`reviewActions(photo)` says what review allows for a photo, and the database enforces the same (security review 3-4,
code review M1):
- card photos, read or marked by a person, are never moved or confirmed again (`card_photo`); a photo a **person**
  marked a card photo can be unmarked by an owner or admin (`undoCard`, Seenu answer 12), a photo whose card was read
  never (`not_marked_card`);
- a photo of another job's card (or of a removed card) shows that card's child: it can only be marked a card photo,
  never confirmed as a normal photo or moved (`other_card`), and is never parent-visible;
- a photo that may be a card (flag `unreadable_card` or `other_card`) is confirmed, either way, before it can be moved
  (`confirm_first`, Seenu's plan answer 1: hidden until confirmed). A removed child's photos keep that flag.

## Data (forward migration `20261012100000_tagging.sql`)

- `photos.qr_kind` (`none | card | unreadable | other_card`, null until processed by a worker that reads cards) and
  `photos.qr_card_id`, composite FK to the job's own cards (`on delete set null (qr_card_id)`). Members read both.
- **`photo_tags`**, one row per tagged photo: `place` (`child | class_set | leftovers | card | blank_card`), the id that
  goes with it, `flag`, `source` (`auto | manual`), `tagged_by`. Composite FKs keep the photo, child, class and card in
  the tag's own studio and job; checks tie each place to exactly its id. Row-level security: members read; nobody
  signed in writes. Every ready photo of a tagged batch has a row. A removed child's photos go to Leftovers (by hand)
  in a `before delete` trigger.
- **`upload_batches.group_id`** (a class-photo upload), **`tag_round`** (bumped by statement-level triggers when a
  photo is added, processed, binned, restored, or its card read or deleted, and by `claim_blank_card` for the card's
  batches) and **`tagged_round`**.
- **`job_tagging_reviews`**: who marked the job reviewed and when. Row-level security: members read. The row is
  deleted when photos are registered, when tagging writes Leftovers or flags, when photos are moved to Leftovers or a
  child is removed, which **reopens** the task (answer 4); moves between children don't (plan answer 5).
- **`photos.after_purge`**, **`upload_batches.purge_steps`** and **`purge_tail`** (answer 13, above). `photo_tags`
  allows a manual tag a flag only for an undone card photo mark (`unreadable_card`) or a removed child's photos after
  a purged card (`after_purge`): checked again at review, never changed by tagging.
- Functions, service role only, each acting for the person and checking owner, admin or photographer (staff and other
  studios get 42501), errors without values: `move_photos` (≤500, never card photos: `card_photo`; never unprocessed
  or binned ones: `photo_not_ready`), `confirm_photos` (keep, or mark as card photos), `undo_card_photos` (owners and
  admins only, photographers and staff get 42501; ≤500 photos a person marked card photos, else `not_marked_card`;
  not binned; not in a closed job; takes the job's tagging lock; answer 12, below), `blank_card_code`,
  `claim_blank_card`, `mark_tagging_reviewed` (`tagging_not_ready` unless clean); moves, confirmations, undos, claims
  and Mark reviewed refuse a closed job (`job_closed`, security review 9); and for tagging runs
  `tagging_inputs`, `apply_batch_tags` (`tagging_stale` when the round moved on), `batches_of_photos`,
  `batches_to_tag`. Reads for the screen are SECURITY INVOKER (row-level security applies): `job_tagging_overview`,
  `tagging_photos` (also `unlinked_cards`: card photos linked to none of the job's cards), `tagging_children`,
  `tagging_no_photos`, `tagging_blank_cards`, `photo_parent_visible` (for the shop later: a ready photo, not binned,
  with a child or in a class set, not flagged, never a card photo or a photo of another job's card; a photo that may
  be a card only once a person put it there or confirmed it; and never while its batch is due to be tagged again,
  security review 6). `job_checklist_facts` (still SECURITY DEFINER with one membership check, ADR 0017) gains `tagging_pending`,
  `leftovers`, `flagged`, `blank_cards_pending` and `tagging_reviewed`; `job_photo_counts` gains `leftovers` and
  `flagged`. `create_upload_batch` gains `p_group_id`.
- Batches uploaded before this step are marked due, so the daily sweep tags them (their photos were processed without
  cards, so they land in Leftovers).
- pgTAP `012_tagging.test.sql` (188 assertions): resolution within the job only, rounds, manual tags kept, the claim
  order, roles (staff can't claim), another studio refused and seeing nothing, events with ids and counts only, and
  the review fixes: binned photos kept as boundaries, purged photos' steps carried, `qr` required, card photos and
  other-job cards locked, `confirm_first`, the blank-card claim race, parent visibility while a retag is due, closed
  jobs, a skipped write not reopening the review; undoing a card photo mark (roles, another studio, read cards, closed
  jobs, visibility, the reopen, the event, tagging leaving it alone); and the purge edge cases (the tail, a late and a
  moved photo marked, the flag written and the review reopened, a removed purged card's photos flagged).

## When tagging runs

The API runs `tagBatch` (yul1) and writes the result for the round it read: after a worker result once the batch has
no photo still processing (the last result tags it), after an upload is finished, after the bin and a restore, and in
the daily clean-up for every batch still due (photos stuck processing for 15 minutes then count as unreadable). A run
that read a round that moved on is tried again up to three times, then left to the sweep (logged with the batch id
only). Tagging runs of a job and Mark reviewed take turns on an advisory lock (`tagging:<job>`); moves and every
reopen of the review take it too, so a review is never saved just after a reopen it missed (code review nice 1). Locks
are always taken batch first, then the job's lock. Only rows a run actually wrote can reopen the review, so a write
skipped for a manual tag doesn't (code review nice 2).

## Naming a blank card's child (amends ADR 0015)

ADR 0015's order (release the card's code, make the child with it, give the card its child) can't run as that schema
stood: the card's check can't be deferred, and the child FK refuses a child not yet inserted. `qr_cards_child_fk` is now
`deferrable initially immediate`. `claim_blank_card` locks the card, defers the FK, gives the card its child and clears
its code in one statement (releasing the hash), inserts the child with the card's hash (claiming it again) and the
API's copy re-encrypted for the child's id, checks the FK, and sends the card's waiting photos to the child. Releasing
first matters: the release trigger deletes by hash, so releasing after the claim would delete the child's claim. The
API decrypts the card's copy (bound to the card) in memory and re-encrypts it for the new child (bound to the child),
in yul1, logging only the card id if it can't. New children only go into existing classes (plan answer 6); for a child
already on the roster, the card's photos are moved to them (every page of them, code review S4) and the card's code
stays unused. A claim moves the round of every batch with the card's photos on, and `apply_batch_tags` refuses
(`tagging_stale`) any write holding a photo for a card that has its child, so a run that read the batch before the
claim can't leave photos stuck under a named card (code review M2). The API then tags the job's due batches before it
answers, so the review isn't left "pending" (Mark reviewed disabled) until the daily sweep.

## API (`/api/v1`, D92)

`GET /jobs/{id}/tagging` (summary, albums, blank cards; Mark reviewed's state from core), `GET /jobs/{id}/tagging/photos`
(`place=leftovers|flagged|child|classSet|blankCard|unlinkedCards`, keyset by photo id; each photo says its `qrKind` and
the `actions` review allows), `GET /jobs/{id}/tagging/children`,
`GET /jobs/{id}/tagging/no-photos`, `POST /jobs/{id}/photos/move`, `POST /jobs/{id}/photos/confirm`,
`POST /jobs/{id}/tagging/undo-card` (owners and admins: photographers and staff get 403 before the body; `{undone}`),
`POST /jobs/{id}/qr-cards/{cardId}/child` (201, the child), `POST /jobs/{id}/tagging/review` (409 `tagging.notReady`),
and `POST /jobs/{id}/upload-batches` with an optional `{groupId}` (an empty body, however it is sent, is `{}`; the
route never decides from `content-length`, which chunked and HTTP/2 bodies lack, code review S1). Conflicts are named
in `fields.form`: `tagging.cardPhoto`, `tagging.photoNotReady`, `tagging.cardClaimed`, `tagging.notReady`,
`tagging.confirmFirst`, `tagging.otherCard`, `tagging.notMarkedCard`. Every route checks the person,
their role for writes (owners, admins and photographers; staff read, plan answer 10) and the region before the body;
every tagging route runs in yul1 with `assertFunctionRegion` (and `assertStorageRegion` when it signs previews), the
database-only `tagging/review` and `tagging/no-photos` included (security review 12). URLs hold ids only.

## Screens

- Photos gains two views, **All photos** and **Review** (links with `aria-current`).
- The upload sheet asks first: "Individual photos (read QR cards)" or "Class photo for a class" with a class select.
- **Review:** the heading's subline counts photos, Leftovers and photos to check; **Mark reviewed** is disabled until
  clean and the reason is written out beside it. Then Flagged (each tile says why), Leftovers, New children from blank
  cards (the card's photo, its waiting photos, first and last name, class, Add child, Give photos to an existing
  child), one album per class then No class (a button with `aria-expanded`; the Class photo set, then each child's
  row with a strip of 12 and Show all), and No photos yet (collapsed; doesn't block selling, answer 6).
- Tiles show the 400 px preview with alt text "{where}, photo {n}" (never a filename); card photos say "Card" and have
  no checkbox; a removed card says "Removed card", not "Another job's card" (code review nice 3). Photos with any
  action have a 44px checkbox; ticking opens a bar offering what every ticked photo allows: Move to…, Looks right (or
  "It's a normal photo" when one may be a card), This is a card photo, Move to bin (junk Leftovers, plan answer 4;
  code review S3), Not a card photo after all (owners and admins, for photos a person marked card photos; answer 12),
  Clear, with a note when some must be confirmed before they move. Owners and admins get a checkbox on such card
  photos too. Dragging carries only photos that
  can move. Card photos linked to no card of the job are listed under **Other card photos**. A child's Show all pages
  500 at a time with Show more, and appears only when the child has more photos than the strip shows (code review
  nice 4-5). **Move to…** is a dialog with a search box and native radios (Leftovers and class photo sets, then children by
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
  dialog's "Tagging reviewed" is now real: the job page's own data (the job as first loaded, then the Overview's
  checklist and the Review summary), never a fetch of its own (code review nice 6). The server refusal comes with
  Start selling.

## Events (D96)

Ids and counts only: `photos.tagged {batch_id, round, photos, cards, leftovers, flagged, blank_cards}` per run that
changed something (attributed to whoever started the upload), `photos.moved {photo_ids, count, target_kind,
target_id}`, `photos.confirmed {photo_ids, count, as_card}`, `photos.card_unmarked {photo_ids, count}`, `qr_card.claimed {card_id, child_id}` (besides
`child.created`) and `tagging.reviewed`. Never card codes, names, filenames or access codes (pgTAP checks). Not shown in
the activity log yet (follow-up, as in ADR 0016).

## Region and privacy (D113, D141)

Cards are read by the Lambda in ca-central-1 (or the local driver); tagging and the claim run in yul1. Queue messages
still hold ids only. Card codes are not secret, but they are kept out of logs, URLs, events and queues anyway. Logs
name batch, photo and card ids and error names only.

## QR cards: the access code off the photographed side (Seenu, answer 11; amends ADR 0015)

A card shot where no QR is found at all looks like a plain photo, and would show the access code printed on its face.
The card now has two panels. The **front**, which is photographed, holds only the child's name, class (or the lines
to write them on) and the QR. The studio's name, the access code and the instructions are on a **tab** below a dashed
fold line labelled "Fold back before picture day" (`pdf.qrCards.foldBack`), printed upright; folded back, the tab
stays attached for parents but is out of shot. The fold line's dashes are shorter than the cut lines'. `CARD_LAYOUT`
(core) places everything (`at.fold`); core and PDF tests check that only the name and class print above the fold and
that the QR and its quiet zone end above it.

### Amendment (Oct 13, 2026): the access code on the back

Seenu's decision of Oct 13, 2026 replaces the fold-back tab. The PDF is printed **double-sided on US Letter**, four
cards per sheet (2×2); each sheet is a front page followed by a back page.

- **Front** (photographed): the studio's name, the child's name and class (or "Class ____" for a child without one) and
  the QR (the random card ID). A blank card's front: the studio's name, a line for the name and the QR. The access code
  is never on a front page.
- **Back**: the studio's name, "Access code" and the code itself, large (`CARD_LAYOUT.code`, 28 pt, the widest code
  still inside the margins), and "Go to {shop link}, enter your code".
- **Long-edge duplex:** the back page's columns are mirrored (`backCardOrigin` in core: same row, opposite column), so
  each back lands behind its own front; a lone card's back is on the right of its page. The cut lines are on both
  sides.
- The dashed "Fold back before picture day" line, its label and `pdf.qrCards.foldBack` are removed; `CARD_LAYOUT.at`
  becomes `CARD_LAYOUT.front` and `CARD_LAYOUT.back`.
- The Print QR cards dialog says "Print double-sided, flip on long edge" (`app.qrCards.duplex`) next to Download PDF,
  as the button's description, and counts sheets: "5 cards on 2 sheets of US Letter". The child panel's single card
  is a two-page PDF.
- Tests: core checks the mirrored back positions and that each side's text stacks inside the card; the PDF tests decode
  each page's text (through the fonts' ToUnicode maps) and check the code is only ever on a back page, each back sits
  in the mirrored column, and a blank card's sides. The e2e counts two pages per sheet.

Unchanged: cards are made on demand and never stored, built in the studio's region, and printed by the same roles.

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
- Purged photos' steps are carried on the next photo by id and flag, not kept as tombstones holding the photo's order
  key: that key includes the filename, which is sometimes personal data and must go with the photo.
- A photo marked a card photo stays one for photographers (security review 3). Confirmed card photos stay listed: with
  the child they were with (that child's card), with their blank card, or under Other card photos.

## Undoing "This is a card photo" (Seenu, answer 12)

Owners and admins only; photographers and staff are refused (403 from the API before the body, 42501 from
`undo_card_photos`). Only photos a person marked can be undone. The photo goes back to **Flagged** with
`unreadable_card`, hidden from parents until someone confirms it again (either way), and the flag reopens Review
tagging. It returns to where it was listed: the child whose card it was linked to, its blank card (or that card's
child, if named since), or else Leftovers; a mark made in Leftovers or a class photo set keeps nothing to go back to,
so those go to Leftovers. The tag stays the reviewer's (manual), so tagging never clears the flag. A photo of another
job's card is still only ever a card photo or flagged: unmarked, it can be marked again, never confirmed as normal or
moved. One `photos.card_unmarked` event (ids and a count).
- A card photo next to its child keeps the child's card id when marked by hand, so it shows in the child's strip.

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
