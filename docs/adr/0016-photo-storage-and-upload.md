# 0016 — Photo storage and upload

- Status: Proposed, Oct 11, 2026 (accepted when Seenu merges the step 4 PR). Amends 0015 (the region guard is shared,
  `assertPrintRegion` becomes `assertFunctionRegion`; tagging is step 5, not step 4) and, for photo progress, 0006
  (D142 answer 1, below).
- Decisions: D39, D53, D60, D85, D96, D100, D113, D141, D142, F9, F10; touches D91, D92, D112, D140. Seenu's answers
  to the step 4 brief (1–8), Oct 11, 2026; the answers to the plan's questions (D142 1–7).

## What ships

Studios drop whole folders of JPEGs into a job's Photos tab. The browser uploads them straight to storage, in
parallel, and an upload carries on after a dropped connection or a reload (D39). Each photo's previews are made once,
at upload, in the studio's region (D100): 400 px and 1600 px plain WebP for the studio, and the same sizes with the
studio's name tiled across for parents later (D60). Originals are kept until a bin purge; an archive tier waits for
the job's archive date (D85, D142 answer 3). Canada only for now; US studios are refused until R2 exists (answer 8).

## Storage

- **S3, `daybell-staging-ca-photos` in ca-central-1**, versioned, Block Public Access on, SSE-S3. Lifecycle:
  noncurrent versions expire after 30 days, expired delete markers go, incomplete multipart uploads abort after 7
  days. No storage-class transition yet.
- **Keys hold IDs only**: `{studio}/{job}/{photo}/original|thumb.webp|view.webp|proof-thumb.webp|proof.webp`
  (`photoKey`, lower-case UUIDs, checked). A photo's filename lives only in `photos.original_filename`: never in
  keys, URLs, events, logs or queue messages.
- **`@daybell/storage`**: one `PhotoStorage` interface (multipart create, part URLs with the part's exact length
  signed in, list parts, complete, abort, head, get, put, signed reads, delete every version under a prefix), with
  two drivers:
  - `s3`: `@aws-sdk/client-s3` and `s3-request-presigner`, `requestChecksumCalculation: "WHEN_REQUIRED"` so part URLs
    carry nothing a browser can't send. On Vercel, credentials come from Vercel's OIDC token through
    `@vercel/oidc-aws-credentials-provider` (role `AWS_ROLE_ARN`); no AWS keys exist anywhere. Works with R2 later.
  - `local`: a folder (`apps/web/.storage`), with HMAC-signed, expiring URLs served by `/api/dev-storage/[...key]`,
    which answers 404 unless `STORAGE_DRIVER=local`. For development, CI and end-to-end tests. Refused in production
    twice: `next.config.ts` fails the build, and `photoStorageSettings` throws at run time.
- **Settings** (`@daybell/config/server`, names only in errors): `STORAGE_DRIVER`, `PHOTO_BUCKET_CA`,
  `PHOTO_QUEUE_URL_CA`, `AWS_ROLE_ARN`, `AWS_REGION` (must be `ca-central-1` for Canadian photos),
  `PHOTO_WORKER_SECRETS`, `CRON_SECRET`, `LOCAL_STORAGE_DIR` (local only).

## Data

Migration `20261011100000_photos.sql` (forward only).

- **`upload_batches`**: one drop of photos and nothing more (no folder or class meaning). `seq` (identity) orders
  batches by when they started; UUIDs don't. Counts of duplicates and browser-skipped files.
- **`photos`**: status `uploading → processing → ready | failed`; `original_filename` (1–255, no control characters
  or slashes), `byte_size` (≤ 50 MiB), `sha256`, the storage `upload_id` (never readable by browsers), worker results
  (`width`, `height`, `captured_at` as EXIF DateTimeOriginal plus SubSecTimeOriginal, without a zone), the bin
  (`binned_at`, `binned_by`) and `sold_at` (Phase 3).
- Composite studio FKs as in ADR 0008: `(studio_id, job_id) → jobs` **on delete restrict** (a job with photos can't
  vanish and leave objects behind); `(studio_id, job_id, batch_id, batch_seq) → upload_batches` (a photo's batch is
  in its own studio and job, with the batch's order).
- Row-level security on both: members read; nobody signed in writes. Every write goes through service-role functions
  that act for the person (`p_actor`) and check their role again (owners, admins and photographers; answer 6), the
  ADR 0011 pattern. Named errors carry no values.
- **Indexes**: unique `(job_id, sha256) where status <> 'failed'` (duplicates by content, the bin included; a failed
  upload frees its hash); the **tagging order** `(job_id, batch_seq, coalesce(captured_at, 'infinity'),
  original_filename collate "C", id) where binned_at is null`, leading with the batch (D142 answer 7); the bin; the
  unfinished; `studio_id` on both.
- **Tagging order** (answer 2; D142 answers 5 and 7): batch, then capture time, then filename byte by byte, then id;
  photos without a capture time come after the timed photos of their batch. `compareTaggingOrder` in core sorts the
  same way. Pages are keyset by photo id (`job_photos_page`), so no filename is ever in a URL.
- **Limits**: 50 MB a photo; 50,000 photos per job, the bin included (`photo_limit`); 500 files per registration.

## Uploading

1. `POST /jobs/{id}/upload-batches` starts a drop (closed jobs refuse: `photos.jobClosed`; D142 answer 2).
2. The browser filters the drop (JPEG only; hidden and `._*` files skipped quietly; empty and over-50 MB counted),
   hashes each file (SHA-256 in a pool of three Web Workers made from an inline script, so nothing depends on how the
   bundler treats worker files), drops duplicates within the drop, and registers files in chunks of 500
   (`POST /upload-batches/{id}/files`). Each answers `new`, `resume`, `duplicate` or `duplicate_in_bin`.
3. Parts of 8 MiB go straight to storage, six in flight (S3 is HTTP/1.1): `POST /upload-batches/{id}/part-urls`
   starts each photo's multipart upload on first use (two racing requests keep the first upload id; the other is
   aborted) and signs URLs valid for 15 minutes, each for exactly its part's length.
4. `POST /photos/{id}/upload-complete` has no body: the server lists the parts itself, checks every part is there at
   its exact length (`photos.incomplete` otherwise), completes, and checks the stored size. A wrong size deletes the
   object and fails the photo. Otherwise the photo is `processing`.
5. `POST /upload-batches/{id}/finish` records one event. Batches nobody finishes are finished by the cron after a day.

**Resume is driven by the server.** After a reload, or on another computer, dropping the same files again hashes
them; registration answers `resume` with the existing photo, and `GET /photos/{id}/upload-parts` says which parts
storage already has, so only the rest are sent. Nothing about an upload is kept in the browser (the plan replaced
the brief's "progress in the browser": a browser can't re-read files after a reload anyway). Network errors and
server errors are retried with growing pauses (1 s doubling to 30 s, eight tries); while the browser is offline the
upload waits and says so; an expired URL is signed again once. Leaving the page mid-upload warns. Failed files can be
retried (only those), which is safe because registration resumes.

## Previews (the image worker)

`@daybell/image-pipeline` `processOriginal` checks the file is at most 50 MB, matches the browser's SHA-256 and is a
JPEG; reads the capture time with sub-seconds (`exif-reader`); turns the photo upright (EXIF orientation); converts
to sRGB; and writes four WebP previews with every bit of metadata stripped (no GPS). The watermark is the studio's
name (escaped for Pango) in Plus Jakarta Sans Bold (bundled with checksums), white with a soft dark shadow, about 30%
opacity, rotated −30° and tiled (answer 4). Failures are `not_jpeg`, `too_large`, `hash_mismatch` or `unreadable`
(and `incomplete` for a wrong-sized upload). No watermark regeneration on studio rename at launch (D142 answer 6).

**AWS Lambda `daybell-staging-ca-image-worker` in ca-central-1** (`apps/image-worker`; brief answer 3): S3's
object-created events for `…/original` go to the SQS queue `daybell-staging-ca-photo-events` (dead-letter queue
after five receives); the Lambda takes one message at a time and reports failures per message. For each photo it
calls the API over a signed request (`GET /internal/photo-worker/photos/{id}`: ids, status, hash, size and the
studio's name), stops if the photo isn't `processing` (a repeated message), reads the original (refusing over 50 MB
before reading), makes and stores the previews (`Cache-Control: private, max-age=3600`), and posts the result
(`POST …/result`, idempotent). It never touches the database (D92) and logs only photo ids and reasons. The studio's
name is fetched per photo with the status rather than cached: the call is needed for the status anyway.

**Signed calls.** `Daybell-Signature: t=<unix>,v1=<hex HMAC-SHA256>` over `t.region.METHOD.path.sha256(body)`, with
`Daybell-Region` naming the data region (so a request can't be replayed against another region), five minutes of
clock skew, and two secrets accepted during a rotation (`PHOTO_WORKER_SECRETS`). Checked with WebCrypto's `verify`
(constant time). The callback goes to the staging alias with Vercel's Protection Bypass for Automation header (D142
answer 4): PR previews' uploads are processed by staging's code; end-to-end tests use the local driver.

**Build and deploy.** esbuild bundles the handler (`lib/index.mjs`); `sharp` 0.35.4 for Linux arm64 is installed
next to it with npm `--before` 14 days ago; the font sits at `assets/`. CI builds the zip on every pull request. The
`Deploy image worker (staging)` workflow (`workflow_dispatch`, environment `staging`, Seenu approves) uses GitHub's
OIDC token for a role that may only update this one function's code. No secrets in the repository. Production is
Seenu's alone. AWS setup: `docs/aws-staging-photos.md`.

**Local driver.** No queue: `upload-complete` and `retry` process the photo in the web server after responding
(`after()`), with the same `runPhotoJob` steps against the local folder and the database.

## Screens

The Photos tab (D140, replacing the D128 coming-soon panel): "N photos" with a green subline (uploads, processing,
duplicates skipped); white pills Bin (n) and Upload photos (owners, admins and photographers; not on closed jobs).
The upload sheet has a drop zone and the buttons Choose folder and Choose photos (D91); each drop shows its progress
in words and a bar, read out politely at most every five seconds; uploads keep showing when someone visits another
tab and comes back. Thumbnails are 44px+ buttons in a sheet card, alt text "Photo {n}" (never the filename),
processing and failed photos say so in words; 200 at a time with Show more; a checkbox on each for bulk bin and
restore; the bin is its own view. The floating panel (`?photo=<id>`) shows the 1600 px preview, the file's name,
when it was taken (the camera's clock), size, pixels, status, Move to bin or Restore, and Try again for unreadable
photos. Overview: Upload photos is done once a photo is ready, with a link to Photos while it's open. All words in the
locale files; tokens only.

Previews are served by signed URLs signed at the top of the hour and valid for two, so a browser can cache the same
URL for an hour. Unwatermarked previews are for the studio's members only.

## The bin and the daily clean-up

Bin and restore take up to 500 of a job's photos; a photo that has sold can't be binned (`photos.photoSold`, nothing
moves; answer 7). `GET /internal/cron/photos` runs daily from Vercel Cron in yul1 (`apps/web/vercel.json`,
`CRON_SECRET` as a bearer token, compared in constant time): it finishes batches idle for a day, drops uploads never
finished after 7 days (aborting their parts), and purges photos binned more than 30 days ago — every stored version
first, then the rows (the function re-checks the rule), so a failure never leaves objects without a row. A
four-minute budget stops it starting new work; tomorrow carries on.

## Region (D113, D141)

`apps/web/lib/region-guard.ts`: `assertFunctionRegion` (Canadian work in yul1 when `VERCEL_REGION` is set; the QR
route uses it now) and `assertStorageRegion` (refuses US studios with `region_unavailable`). Every photo route that
touches storage checks the person, their role (for writes), then both guards, before reading the body or touching
storage; bin, restore and counts touch only the database. Every photo route sets `preferredRegion = "yul1"`. The Lambda refuses to start outside ca-central-1. Queue messages carry the S3 key (ids)
or `{photoId}` only. Logs name regions, ids and reasons only.

## Events (D96; D142 answer 1)

`photos.uploaded {batch_id, added, failed, unfinished, duplicates, skipped}` when a batch finishes; `photos.binned`,
`photos.restored` and `photos.purged {photo_ids, count}` through statement-level triggers with transition tables (one
event per bulk action, per job), attributed to the person (the cron's batch closing to whoever started the upload).
**Upload progress and the worker's results write no events**: an exception to "every change writes an event" (ADR
0006) for Seenu to review, since a 50,000-photo job would otherwise write 150,000. The bin trigger's join over its
transition tables is kept to a hash join (`enable_nestloop = off` on the function), because a cached nested-loop plan
was quadratic on a statement touching 50,000 rows. These events are not shown in the activity log yet (follow-up).

## Follow-ups

- **Cloudflare (flagged):** D100 says previews are served from Cloudflare's cache; that would copy Canadian studios'
  photos to a non-Canadian service, against D113. Not added; needs Seenu's decision.
- The archive tier for originals once the job's archive date exists (D85, D142 answer 3).
- Showing photo events in the activity log and the job's Recent activity.
- The milestone moving to "Photos in" once photos arrive, and the Start selling dialog's "Photos uploaded" (both still
  Soon); not in this step's plan.
- A Content-Security-Policy: none exists yet, so the plan's "add the bucket to img-src and connect-src" had nothing to
  amend. When one is added it needs the bucket host (and `blob:` for the hashing workers).
- US photo storage (R2) and the US function region.
- Re-queueing previews when a studio is renamed (D142 answer 6).

## Dependencies

Pinned exactly, each at least two weeks old on Oct 11, 2026 (checked on npm): `@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner` and `@aws-sdk/client-sqs` 3.1141.0 (Sep 25), `@vercel/oidc-aws-credentials-provider`
3.3.9 (Sep 22), `sharp` 0.35.4 (Aug 26; 0.35.5 of Sep 27 was too new), `exif-reader` 2.0.3, `esbuild` 0.28.2,
`@types/aws-lambda` 8.10.163, `aws-actions/configure-aws-credentials` v6.3.0 by commit (Sep 15).

## Rejected

- tus or another resumable-upload server (S3 multipart already resumes, without a server in the data path).
- ETags sent by the browser (the server lists parts itself).
- Upload progress in IndexedDB (a browser can't re-read files after a reload; nothing personal in the browser).
- Trigger.dev for previews (its region isn't confirmed Canadian), a Vercel function (time and memory limits for 50 MB
  originals), and the Lambda writing to the database (a database secret in AWS, and it would bypass the API, D92).
- The studio's name in S3 object metadata for the watermark (goes stale; encoding problems).
- Cloudflare in front of previews (above).
