# 0022 — Parent gallery: access codes, the gallery and the bag

- Status: Proposed with the step 9 PR (Seenu was asleep and asked for every decision to be made following GotPhoto;
  every choice below marked "Claude's call, Seenu to review" is provisional until he reviews it).
- Amends:
  - 0015: with no `SHOP_URL`, QR cards print this deployment's address **with `/shop`** (Seenu's answer 1), not the
    bare address. Cards already printed on staging show the bare address; reprints fix that.
  - 0021: the parent shop checks a job's status itself, and treats a passed closing date as closed at once, before the
    jobs cron runs (call 12). The jobs cron also prunes the shop's expired sessions and old counts (§9).
- Decisions implemented: D24, D60, D116, D119, F17, D113, D96, D92, D91, D112.
- Decisions touched: F13 and D32 (access codes; a card code is never a parent credential), D36, D59 and D104 (price
  lists; the bag is shaped for step 10's order snapshot, ADR 0019; the "payments processed by" line stays in step 10),
  D118 (presets later), D10.
- Inputs: the Phase 1 spec step 9 ("Code entry with lockout; full-screen cover and photo grid in the default look with
  the studio's name and colour; up to 5 sibling codes in one cart; package, then pose"), Seenu's answers 1–4 of Oct 12,
  2026, Claude's calls 1–13 on the architect's questions, the architect's plan, and the ShopFlow v5 board.
- Review fixes (Oct 12–13): the security review (H1, M1, M2, M3, L1–L7), the code review (M1, M2, S1–S6, N1–N12) and the
  security re-review (R1–R9), with the orchestrator's calls on all three, are in this ADR as amended below; §12 lists
  each finding and where it went.

## Context

Phase 1's goal: "On a phone, opens a card's access code, sees the gallery cover and grid, adds a sibling's code, buys a
package, a print and a download, and pays with a test card." Checkout (Stripe) is step 10; this step ends at a bag
ready for it. Children have had access codes since step 2 (ADR 0011: an HMAC for lookup, an encrypted copy for the
studio); previews have been made at upload since step 4, including watermarked `proof*.webp` versions for parents
(ADR 0016); step 5 decided which photos parents may ever see (`photo_parent_visible`, ADR 0018).

## 1. One shop address, codes in the body (Seenu's answer 1)

- `/shop` is the shop for every studio; the code says which studio and child (D24: no sign-up).
- `POST /api/v1/shop/access {code}`. Codes are never in a URL, never logged, never stored but as the existing HMAC.
- The code's first symbol names its regional database (ADR 0011). A code whose region has no database here, anything
  that isn't a code, a blank card's code and a wrong code all get the same 404 (`shop.codeNotFound`), take the same
  path (the HMAC is always computed) and count as a wrong code (call 5: blank cards not yet named reveal nothing).
- Lookup is by `children.access_code_hash` only: never `qr_cards` (blank cards) and never `card_code`.
- Every shop request is counted against its network's budget **before its body is read** (security review L7), so
  malformed bodies count too.

## 2. Lockout (answer 2, call 4; security review H1, M2, M3, L4, L6; re-review R1–R4, R6, R9)

The first version counted "5 per network and device" by a device id the caller chose, so a script without cookies was
only ever limited per network: about 2,880 guesses a day per IPv4 address or IPv6 /64, and about 1.9×10⁸ a day from one
IPv6 /48 (H1). It now counts:

- **Devices the server issued.** A request without one may be given one: a random id in a cookie signed with HMAC
  under `SHOP_THROTTLE_KEY` (`<id>.<issued at>.<signature>`, checked in constant time, valid 30 days, L6). Anything
  else (no cookie, a forged or expired one) is "no device". A device is counted **wherever it is**: moving networks
  doesn't reset it.
- **One shared no-device bucket per network.** Every request on a network without a valid device shares it, so dropping
  the cookie never earns fresh tries.
- **A device is issued only to a request that isn't locked (R1).** A request without a device is judged as its
  network's no-device bucket and its networks; only if none of them is locked is a new device issued (and counted),
  and its wrong code counts on it. A locked answer never carries a device cookie.
- **New devices are capped per network per day**: 500 per IPv4 address and 5,000 per IPv4 /24 (R1: raised, as a
  carrier's shared address can see hundreds of new parents a day in card hand-out week), 50 per IPv6 /64, 200 per IPv6
  /56, 500 per IPv6 /48. Beyond the cap a request stays in the no-device bucket. An unknown device never gets past the
  networks' ceilings, so the cap only bounds how many devices can become known, which R3 also bounds per child
  (below). Devices are issued while the breaker is tripped too (R2): issuing adds no guesses beyond the ceilings.
- **Networks at three widths**, every 15 minutes: 30 wrong codes from an IPv4 address or IPv6 /64, 100 from an IPv4 /24
  or IPv6 /56, 300 from an IPv6 /48 lock it for 15 minutes.
- **A region-wide circuit breaker**: 600 wrong codes in a minute across the region trip it for 15 minutes. The count
  is kept in 16 rows (each wrong code in its network's row) and summed, so wrong codes don't queue on one row (R9).
  While it is tripped, **only a network that keeps coming back is tightened** (R2): one whose last wrong code before
  its current 15-minute count was within the hour gets 10, 30 and 100 instead of 30, 100 and 300; a network with no
  earlier wrong code (a parent's first typo) keeps its ceilings. Known devices keep their allowance and devices are
  still issued. The wrong code that trips it makes the API log one code-free line, `shop_lockout_breaker_tripped
  <region>`, once per trip.
- **The breaker's alert is not wired to anyone yet (R2.5; Seenu to set up).** The line is a `console.warn` in Vercel's
  function logs only; nobody is paged until a Vercel log drain or alert rule matches it (`docs/shop-lockout-alert.md`).
- **Known devices keep their own allowance on a locked network (M3).** A device that has opened a gallery with a right
  code is "known" (kept 30 days). On a network that is locked (a school's Wi-Fi after someone's typos, a carrier's shared
  address), a known device still gets its own 5 tries, unless it was itself locked in the last 24 hours; breaker or not
  (R2). Its wrong codes still count on the network. Opening, adding or re-entering a child makes a device known (never a
  refused code: the 5-child or 3-gallery limit), and **one child's code makes at most 3 new devices known in 24 hours**
  (R3), so a card can't vouch for a crowd of harvested devices. This doesn't reopen H1: known devices need a right code,
  at most 3 a day per code, and each one loses the allowance after its first lock (about 5 network-free guesses a day
  each). "Forget this device" (every gallery) makes it unknown again (R7).
- The device's 5 wrong codes (in 24 hours) and the network's ceilings still lock for 15 minutes (answer 2). **A right
  code never resets a count.** A running lock is never extended or cleared by more wrong codes.

**Effective limits** (H1.6), per 15 minutes unless said: a device (or a network's no-device bucket) 5 then locked 15
minutes (so about 5 per 15 minutes, 480 a day at most); a network 30; an IPv4 /24 or IPv6 /56 100; an IPv6 /48 300 (about
28,800 a day, against 1.9×10⁸ before, plus at most about 5 a day from each known device, of which each code makes at
most 3 a day); a network that keeps coming back while the breaker is tripped, a third of that. With 10⁵ live Canadian
codes in a space of 15×31⁷ ≈ 4.1×10¹¹, 28,800 guesses a day from a /48 find a code about once in 140 days.

**What the breaker does not do (R2; corrected).** It never refuses; it only lowers the ceilings of networks that keep
coming back. A wide, distributed attack is still capped only per network: 10,000 IPv4 /24s at 100 per /24 per 15
minutes is about 9.6×10⁷ guesses a day (about 2.9×10⁷ if each /24 keeps coming back while tripped), which finds about
7 to 23 children a day with 10⁵ live codes, and about 70 to 230 with 10⁶. A second stage that does refuse is Seenu's
decision (below, "Flagged for Seenu"); it is not built.

How:

- The address (L4, R6): on Vercel only `x-vercel-forwarded-for`, which Vercel sets itself (`@vercel/functions` isn't
  a dependency, so its `ipAddress()` isn't used); a request on Vercel without it, and any address that can't be read,
  share **one strict bucket** (`untrusted`). Off Vercel, the local server's `x-forwarded-for` **only with
  `SHOP_TRUST_XFF=1`** and no `VERCEL_ENV` (development, CI and end-to-end runs set it); without it every request is in
  the strict bucket, so a non-Vercel deployment a client can send that header to can't be spoofed into fresh counts.
  **A CDN or proxy put in front of Vercel would make `x-vercel-forwarded-for` the CDN's address**, putting every parent
  in one network: such a change needs its own reading of the client address first. Device ids and networks are HMACs
  before they leave the route: no address or device id is ever stored or logged.
- `public.shop_enter_code` takes every key's **advisory lock** in one sorted order (parallel guesses take turns and two
  tabs can't deadlock, code review N1), including the networks' new-device counts when a device may be issued (R1:
  the caps can't be passed by parallel requests); checks the locks **before any lookup or write** (a locked caller gets
  `locked` even with a right code and learns nothing); then issues a device if the request had none; then looks up the
  HMAC. A miss counts on the device's bucket, every network width and the breaker. A right code then takes the
  child's lock before any session row (trimming forgets other sessions of the child, so two devices entering one
  child's code take turns rather than deadlock).
- Rows are written only on a wrong code, a device issued (per network, not per request) or a right code that shows a
  child; **a locked or refused request writes nothing** (M2, R1: a request without a device on a locked network gets
  no device and counts none). The counts live in `app.shop_code_attempts` (not reachable through the Data API; no
  studio_id: a wrong guess belongs to no studio; the per-child counts of R3 are keyed by a SHA-256 of a label and the
  child's id, never a name or code); `prune_shop` removes them after 24 hours untouched (a known device's after 30
  days).
- 429 `rate_limited` with `fields.form = shop.locked` and `Retry-After`.
- Every shop route also counts requests per network: **120 a minute** (architect's call, accepted), and **1,200 a
  minute per IPv4 /24 or IPv6 /48** (R4), in `app.shop_rate` through `take_shop_request`, the `stripe_call_budget`
  pattern. The wider network is counted first; once it is used up nothing is written for its networks, so rotating
  /64s inside a /48 neither escapes the budget nor fills the table. 429 with `Retry-After: 60`.

## 3. Sessions (answer 3; calls 1, 11; code review S5, S6; security review L1, M2)

- A right code opens a session: `public.shop_sessions`, one studio, **a fixed 30 days from the first code; adding a
  sibling doesn't extend it** (call 11).
- **One session per studio on a device, up to 3 studios** (code review S6, orchestrator's call). A code of a studio the
  device already has a session of **adds the child to that session** (call 16 narrowed; this also fixes S5: a code typed
  again never empties a bag); another studio's code opens a session of its own, leaving the first's gallery and bag
  alone. A 4th studio is refused: 409 `shop.galleryLimit` ("This device already has galleries from 3 photographers.
  Forget one, then try again."). Checkout stays per studio.
- The cookie holds the device's sessions: `<region>.<token>~<region>.<token>`, at most 3, oldest first; each token 32
  random bytes, the database keeping only its SHA-256, so a leaked table can't be replayed. The region names the
  database for later requests (D113). Sessions that no longer last are dropped from the cookie on the next code or
  session read.
- Cookies (L1): **`__Host-daybell_shop` and `__Host-daybell_device`, Secure, Path=/, no Domain**, httpOnly, SameSite=Lax,
  30 days, on every HTTPS host, so a sibling subdomain can't plant one. Only on `http://localhost` (and 127.0.0.1) are
  they plain and not Secure, because browsers refuse Secure cookies over plain HTTP there; over HTTPS a plain-named
  cookie is never read.
- A gallery's id (`galleryId`, 32 hex) is a one-way hash of its token: the screens name a gallery with it
  (`?gallery=`) without holding the token. A missing, forged, expired or unknown cookie, or a gallery not on the device,
  is the same 401 (`shop_session_required`).
- Siblings (call 1): **same studio only, from any of its jobs, up to 5 children** per session, enforced in the function
  and by a trigger under a lock on the session row, whoever writes.
- **At most 10 sessions show one child** (M2, R3): opening or adding a child in an 11th forgets the oldest other
  sessions that show them **with an empty bag**; a session with anything in its bag is never forgotten for this, so
  someone else holding the card can't empty a parent's bag. **At most 10 new sessions show one child in 24 hours**
  (R3): beyond that a right code is answered `locked` until the day is over (Retry-After up to 24 hours), writing
  nothing; forgetting a session doesn't give the allowance back, and a device already showing the child still gets in.
  Together they bound the database and the trimming.
- "Forget this device" (⋯ menu, with a confirmation): with one gallery, it forgets it; with more, the parent chooses
  this gallery or all of them. Each forgotten session goes with its children and bag; the cookie keeps the rest or is
  cleared. **Forgetting every gallery also forgets the device** (R7): it is no longer known (its counts and any lock
  stay, so forgetting earns no tries) and its cookie is cleared. A `?gallery=` not on the device is 404 and forgets
  nothing. A failed forget (a busy shared address's 429, a lost connection) says so in the dialog
  (`shop.menu.forgetFailed`), so a parent on a shared phone never believes it is gone.
- Parents have no account and no JWT: every read and write runs as the service role from the `/api/v1/shop` routes,
  through SECURITY DEFINER functions that take the session token's hash and work only within that session's own studio
  and children. The tables have row-level security on and no policies (the `stripe_events` pattern); browsers,
  signed in or not, can read or run none of it.

## 4. What parents see (answer 4; calls 2, 3, 6, 7, 8, 12)

- Names: **first name and last initial only ("Ava P.")** everywhere in the shop (call 2); the database returns only
  the initial. Photo descriptions use the first name ("Ava, photo 2 of 6"), never a filename.
- Per child, a state:
  - `closed`: the job isn't Selling (**drafts too, never revealed**; answer 4), or its closing date has passed, even
    before the cron runs (call 12). "This shop is closed. Contact {studio}." No photos, nothing can be added.
  - `unavailable`: the child is marked Do not publish or Do not photograph, or has no portrait parents may see. "Photos
    aren't available yet. Contact {studio}." No photos at all, class photos included (call 6).
  - `open`: the gallery.
- A closed, draft or unavailable child is **only an id and a state** in the session (security review M1): no name,
  school, picture day or dates leave the database, and the screens say "Your child". A stale, lost or discarded card,
  or a Do not publish child's (often a custody or protection case), reveals only that the code exists and the studio's
  name, as Seenu's message asks (answer 4).
- Photos: `app.parent_visible_photos(job, child, group)` is the set-based twin of `photo_parent_visible` (same
  predicate: ready, not binned, never a card or another job's card photo, a maybe-card only once a person placed or
  confirmed it, placed with a child or a class set, not flagged, its batch's tags up to date). pgTAP proves the two agree
  on every fixture photo. A child sees their own portraits and **their own class's set** (class sets are still shown
  to other children of a Do not publish child, call 6), in tagging order.
- The cover (D119) is **the first visible portrait in tagging order** until studios can star a pose (call 3), full
  screen, with the studio's name, the child's name, the school (the job's client, else the job's name), picture day
  and a **"See photos" button** (open children only). The words slide up on load; with reduced motion they don't. It never moves on by itself.
  It shows once per child per browser tab session (Claude's call).
- Class photos are **view only** in Phase 1 (call 8): the viewer says so, and the database refuses them as a pose.
- Colour: **charcoal #1C1C1E for every studio in Phase 1** (call 7; D116), from the theme's existing studio slot
  (`--color-studio`, `--color-on-studio`, `--color-studio-ring`). `shopAccent()` in `packages/ui` is kept for when
  studios pick a colour: white or ink text, whichever reaches 4.5:1, charcoal if neither does; rings and selected marks
  fall back to ink below 3:1 against white (WCAG 1.4.11).
- "Lost your code?" says "Ask your photographer or school for a new card." (call 13). No lookup.

## 5. Previews and deterrents (D60)

- Only the watermarked, low-resolution previews ever reach parents: `proof-thumb.webp` (400 px) and `proof.webp`
  (1600 px), **signed for 600 seconds** (architect's call, accepted). Never originals, never the studio's plain
  `thumb`/`view` previews. Signed in Montréal from S3 ca-central-1 (D113). An image that fails to load (an expired URL)
  reloads the gallery, at most twice a minute.
- Plain `<img>`, never `next/image`: Vercel's optimiser would fetch and cache Canadian photos outside Canada.
- Deterrents only (no browser can stop a screenshot): photos blur while the page is hidden or not focused, on Print
  Screen and on Cmd/Win+Shift; they are hidden when printing; right-click, long-press and dragging are blocked
  (`contextmenu`, `dragstart`, `-webkit-touch-callout: none`, `user-select: none`, a transparent layer over each image);
  one quiet line says "Photos are protected and shown at low resolution with a watermark", and an attempt shows it again.
  With reduced motion the blur has no transition.
- `/shop` and `/api/v1/shop` send `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` (signed URLs never
  travel in a Referer), `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=63072000` (custom domains too) and
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()`; pages also carry
  robots noindex and no-referrer metadata. Shop API answers are `Cache-Control: no-store` and
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. The font is self-hosted.
- **Content-Security-Policy on every shop page** (security review L2), with a fresh nonce per request from the proxy,
  which Next puts on its own scripts (the shop's layout renders per request for it): `default-src 'self'`;
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (plus `'unsafe-eval'` in development only); `style-src 'self'
  'unsafe-inline'`; `img-src 'self' blob: data: https://<PHOTO_BUCKET_CA>.s3.ca-central-1.amazonaws.com`;
  `font-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri 'none'`;
  `form-action 'self'`. So the browser itself enforces "no third-party scripts" and Canada-only images (D113).

## 6. The bag (calls 8, 9)

- `public.shop_cart_lines`: ids, the pose and a quantity only. **No price is stored**: every read prices the bag from
  each job's current list, so a price change shows at once and step 10 can snapshot it exactly as ADR 0019 describes.
- Rules (core `cartLineProblem`, enforced by `shop_cart_add`): a package, print or single download needs a pose, one
  of **that child's** visible portraits; "all digitals" has none; downloads are bought once; quantities 1–99; the same
  item and pose again adds to its line; at most 100 lines. Refusals: 409 `shop.closed`, `shop.itemUnavailable`,
  `shop.photoUnavailable`, `shop.bagFull`.
- A line reads back `available: false`, marked "No longer available" and left out of the totals, when its item left
  the job's list (a list switch), its pose can't be shown any more, or the shop closed. **One rule in one place**
  (code review M2): `app.shop_line_available` decides it for the bag's totals, for delivery and for quantities. Deleting
  an item or purging a photo removes its lines (composite foreign keys with cascade).
- A quantity can change only on a line that can still be bought (N2): 409 `shop.closed`, `shop.itemUnavailable` or
  `shop.photoUnavailable` otherwise. Removing always works.
- Delivery (call 9): **one home fee per bag, the highest among its jobs with something to deliver; school delivery
  only if every such job allows it; a bag of downloads needs none**, all counting only lines that can still be bought,
  in core (`availableShipping`) and the database (`shop_set_shipping`) alike (M2): school delivery is never offered and
  then refused, and is refused when nothing needs delivery. A job missing from the delivery facts throws rather than
  making delivery free (N3). The bag's money is in the studio's currency from the database, never a guess (N4). When both are offered the parent chooses; the
  total waits for that choice ("Choose delivery"; Claude's call, Seenu to review). School delivery is free. Totals are
  whole cents, before tax.
- The header's bag count is every thing in the bag (quantities added), unavailable lines included, until removed.
- No pay button until step 10 (architect's call, accepted).

## 7. Screens (D24, D91, D112, D116)

`apps/web/app/shop/`, phone first (a 480 px column centred on wider screens), client-rendered shells pinned to
`yul1`: children's names and photos reach the browser only through the Montréal-pinned API (D113). The studio app's
proxy passes `/shop` straight through, so parents' requests never touch studio sign-in.

| Page | What |
|---|---|
| `/shop` | Code entry (neutral, the studio isn't known yet); with one gallery, straight to its first child; with more, "Your galleries" (each studio's name and its open children's names) and the form for another code; if the galleries can't be read, "Try again", never the form (S5) |
| `/shop/add?gallery=` | A brother's or sister's code (another studio's opens its own gallery) |
| `/shop/c/[childId]` | The cover, then the grid; Portraits / Class photo; the children as links; "Order by" (the last day to order, as ADR 0021 shows studios, N6) and school delivery; the viewer |
| `/shop/c/[childId]/buy` | Packages as a radio list, the price docked beside Continue; "Single prints and downloads" |
| `/shop/c/[childId]/buy/singles` | Prints, the single download and all digitals |
| `/shop/c/[childId]/buy/[itemId]` | The pose (radios shown as thumbnails), how many, "Add to bag" |
| `/shop/bag?gallery=` | A gallery's bag: lines by child, delivery, totals "+ tax" |

Accessibility (WCAG 2.2 AA): every input labelled (the code field, the pose and delivery radios, the quantity groups);
44 px targets; visible focus in the studio colour; the viewer has Previous and Next buttons and arrow keys besides
swiping (2.5.7); the docked button leaves room and adds scroll padding so a focused control is never hidden under it
(2.4.11), and the sticky header adds scroll padding at the top too (S1); the selected child is `aria-current` and
filled, a selected tab `aria-pressed` and underlined (no colour-only meaning); refusals are announced (`role="alert"`);
the bag's totals are a polite, atomic live region (S2); every page names itself in the document's title (2.4.2, S3),
**never with a child's name** (R8: titles reach browser history and tab sync and outlive "Forget this device"; the
gallery is "Your child's photos");
the photo grid and the docked bar are named ("Photos of Ava P.", "Next step"); option radios are named by their title
alone with the price as their description, and delivery radios by their words alone (S4); at either end of the viewer
focus moves to the other arrow, or to Close (N5). Words are in `messages/en-US.json` and `en-CA.json` (`shop.*`); colours
are tokens only.

The bag is read once when it opens and again only after the parent's own change, whose answer is the bag (code review
M1: the first version refetched in a loop, 1154 reads a second in a reproduction, using up the network's request
budget). The provider's `setBagCount` is one function for its life and leaves the state alone when the count is the
same.

Board deviations (decisions win): the board's cover has no button and moves on after 2 seconds; D119 asks for a "See
photos" button and a timed move would fail WCAG 2.2.1. The board's accent is #2B2B2B; D116 says #1C1C1E. Left out as
out of scope: favourites, backgrounds, extra poses, discount tiers, Apple Pay (step 10) and the board's "Class photo"
package (call 8).

## 8. API (D92)

New group "Shop" and access kind `parent` (the session cookie) in `packages/api` routes and OpenAPI:
`POST /shop/access` (opens or adds; `{childId, galleryId}`), `GET /shop/session` (`{galleries: [...]}`),
`DELETE /shop/session[?gallery=]` (404 for a gallery not on the device; without it, the device too, R7), `GET /shop/children/{childId}/gallery`, `GET /shop/children/{childId}/price-list`,
`GET /shop/cart`, `POST /shop/cart/lines`, `PATCH`/`DELETE /shop/cart/lines/{id}`, `PUT /shop/cart/shipping`; all but
the first two take `?gallery=` (`shopGalleryQuery`; without it, the device's first). `POST /shop/children` is gone:
`/shop/access` places a code in the right gallery (S6). `ShopChild` is a union on `state`: an open child's name, school
and dates, or only `{id, state}`. 409 keys in `SHOP_CONFLICTS` (`shop.galleryLimit` replaces `shop.otherStudio`);
`shop.codeNotFound` and `shop.locked`; the error code `shop_session_required` (401); every shop route lists
`region_unavailable` (N11). Writes go through `handle()`'s same-origin and JSON-only checks.

## 9. Database (forward migration `20261012700000_parent_shop.sql`)

- Tables: `public.shop_sessions`, `public.shop_session_children`, `public.shop_cart_lines` (each with `studio_id`,
  composite studio foreign keys, row-level security on, no policies, nothing granted to `anon` or `authenticated`);
  `app.shop_code_attempts` and `app.shop_rate` (HMACs only). A new unique key on `price_list_items (studio_id,
  price_list_id, id, kind)` lets a line carry its item's kind.
- Functions, all SECURITY DEFINER with an empty `search_path`, executable by `service_role` only, named errors with no
  values: `shop_enter_code`, `shop_session`, `shop_gallery`, `shop_price_list`, `shop_cart`, `shop_cart_add`,
  `shop_cart_set_quantity`, `shop_cart_remove`, `shop_set_shipping`, `shop_forget`, `shop_forget_device`,
  `take_shop_request`, `prune_shop`; helpers in `app` that nobody can call directly (`shop_code_failed`,
  `shop_breaker_failed`, `shop_issue_device`, `shop_mark_known`, `shop_trim_child_sessions`, `shop_line_available`,
  `shop_line_physical`, …). Every query names
  its studio, bag lines and package lines included (security review L5).
- `prune_shop` runs in the jobs cron (hourly on staging, daily in production) after `prune_notifications`, **a page of
  1,000 at a time until a page comes back short or the region's share of the time is up** (M2): expired sessions with
  their bags, counts untouched for 24 hours (a known device's for 30 days), request counts over an hour old.
- Events: **none for parents' actions** (call 10): sessions, attempts and the bag are the parent's own state, like the
  notifications exception of ADR 0021. Studios don't see gallery opens in Phase 1.
- Region (D113): every shop route and page is pinned to `yul1` and refuses to run elsewhere for Canadian data
  (`assertFunctionRegion`, **inside `callShopFunction`, so every database call is checked against its own region**,
  whichever session or code named it, R5; photos also `assertStorageRegion`). A US function region will need its own shop routing,
  as ADRs 0015 and 0021 already note.

## 10. Configuration

- `SHOP_THROTTLE_KEY` (new, declared in `packages/config` `shopThrottleKey()`): 32 random bytes, base64, different
  from both access code keys; server-only, read on first use; errors name the variable only. It also signs device
  cookies: changing it restarts the counts and makes every device new. Without it every shop
  route answers 500 and logs `shop_throttle_key_missing` (fails closed). CI makes a fresh one per run.
- The shop's image policy reads `STORAGE_DRIVER` and `PHOTO_BUCKET_CA` (already set for photos).
- **Seenu must add `SHOP_THROTTLE_KEY` in Vercel (Production, and Preview for staging) before the shop is used there:
  generate it with `openssl rand -base64 32` and paste it straight into Vercel's environment variables. Never in chat,
  a commit, an issue or a log.**
- `SHOP_TRUST_XFF` (new, declared in `packages/config` `shopTrustForwardedFor()`, R6): `1` lets the shop read
  `x-forwarded-for` off Vercel (development, CI, end-to-end; set in `ci.yml` and `.env.example`); ignored whenever
  `VERCEL` or `VERCEL_ENV` is set. **Never set it in Vercel.**
- `SHOP_URL` unset now falls back to `${siteUrl}/shop`.
- `turbo.json` is unchanged: like the access code keys, the key is a runtime secret the build never reads.

## 11. Tests

- Core (`shop.test.ts`): lockout edges for every kind (device, no-device, network widths, tripped limits, a running
  lock never cleared), the known-device rule, line rules, merging, delivery and totals (school and downloads free,
  unavailable lines left out, no total until delivery is chosen, a missing job throws), cover pick, display name, the
  cookie format with up to 3 sessions.
- UI: `shopAccent` fallbacks; an option card named by its title alone and described by the rest.
- Config: `SHOP_THROTTLE_KEY` and the `/shop` fallback.
- API (`shop.test.ts`): the schemas and `shopGalleryQuery`; `SHOP_CONFLICTS` and every limit kept equal to the
  migration's; nothing granted to browsers; the routes' access, gallery parameter and errors (`region_unavailable`).
- pgTAP `021_parent_shop` (198 assertions; re-review additions: a request without a device on a locked network
  writing nothing and issued no device, no device with a lock, IPv4 caps of 500 and 5,000 and IPv6's 50, the breaker
  summed over its rows, only a returning network tightened while tripped, devices issued and known devices let in
  while tripped, 3 new known devices per child a day, trimming sparing a bag, 10 new sessions per child a day not
  given back by forgetting, `shop_forget_device`, the wider request budget writing no row past it): grants; lookup by HMAC among children only; the lockout (5th miss locks a
  device wherever it goes, a locked caller with a right code, expiry and restart, a right code doesn't reset, the
  network's 30, the shared no-device bucket, devices issued and capped at 50, the /56's 100 and the /48's 300, a known
  device's own allowance on a locked network and its loss after a lock, the breaker's alert, tightened limits, no
  devices and no allowance while tripped, a locked request writing no row); sessions (30 days, siblings added to the
  studio's session, another studio's opening its own with the first untouched, a 4th studio refused, dead sessions
  left out, the limit of 5 even for direct inserts, a session never holding another studio's child, expiry, 10
  sessions per child at most); a closed or draft child's name, school and day never in the session; the gallery (every
  hidden kind excluded, another class's set and another child's photos excluded, equivalence with
  `photo_parent_visible`, closed, draft, passed closing date, unavailable with nothing but the state); prices; the bag
  (kind rules, refusals, merging, a list switch and a hidden pose make lines unavailable and their quantities fixed,
  cascades, the studio's currency); school delivery judged by lines that can still be bought (the code review's
  example) and refused with nothing to deliver; cross-studio leaks (studio B, and the same device's studio B gallery,
  can't read or change A's child, prices or lines); forgetting one gallery leaves the others; the tidy-up a page at a
  time, keeping known devices 30 days; no events, no names or codes stored.
- Route tests (`shop-routes.test.ts`; re-review: no device cookie with a lock, the /24 and /48 request budget,
  `x-forwarded-for` only with `SHOP_TRUST_XFF=1` off Vercel, forget-all clearing the device cookie and calling
  `shop_forget_device`, 404 for a gallery not on the device, `callShopFunction`'s region check on every call): cookie flags, `__Host-` and Secure over HTTPS, a planted plain cookie ignored;
  the token's hash only reaching the database; opening, adding to the same studio's gallery, a second studio's gallery,
  the 4th refused, dead sessions dropped; a device counted only by its signed cookie and the same on any network, a
  forged one no device, a device cookie set only when issued; identical answers for a wrong code, another region's code
  and a non-code; 429 with Retry-After; the breaker's one code-free log line; the budget counted before the body is read;
  Vercel's address header only; the Montréal guard; failing closed without the key; the galleries list with closed
  children as id and state only; forgetting one or all; a gallery not on the device refused; proofs only, 600 seconds
  at most; the bag priced in the studio's currency; school delivery by available lines; refusals as keys; `no-store`;
  cross-site and non-JSON writes refused; the `next.config` headers; a console spy proving nothing else is logged.
- CSP (`csp.test.ts`): the policy, the bucket from the environment, a fresh nonce per page on the request and the
  response, studio pages untouched.
- Cron (`going-live-routes.test.ts`): the shop pruned a page at a time until short, and stopped when time is up.
- Screens (`shop-pages.test.tsx`, jsdom; re-review: the gallery's title without the child's name, a failed forget
  announced with the dialog kept open): **the bag read once when it opens, whatever the header's count does** (the
  scratch reproduction of code review M1 made a regression test; it fails, timing out, if the loop comes back); no
  re-read after a change; the totals' live region; delivery radios' exact names; one `setBagCount` and no re-render for
  the same count; "Your galleries" with only open children's names; one gallery goes straight through; "Try again"
  instead of the form; the viewer's focus at the ends; the page title kept when the head is rewritten.
- e2e `shop-gallery.spec.ts` (the `phone` project only, Pixel 7; the `desktop` project ignores `shop-*.spec.ts`), locators scoped to a landmark and exact (S4): code, cover
  (no slide with reduced motion), grid by its name, blur on visibility change, viewer Previous/Next, "Use this photo", a
  package radio and its pose, a sibling and switching, a print and a single download, delivery radios by exact name and
  totals, the page title, forgetting the device, a draft job's closed message without the child's name, and five wrong
  codes locking a phone out.

## 12. Review findings and where they went (Oct 12–13)

| Finding | Fix |
|---|---|
| Security H1 | §2: signed devices, shared no-device bucket, devices capped per network, /24, /56 and /48 ceilings, region breaker with an alert, effective limits stated |
| Security M1 | §4: closed, draft and unavailable children are an id and a state only; "Your child" |
| Security M2 | §2, §3, §9: no row before the lock check or on a refused request; counts only on failure; prune loops; 10 sessions per child |
| Security M3 | §2: known devices keep their own allowance on a locked network |
| Security M4 | Follow-up (needs Seenu's AWS work) |
| Security L1 | §3: `__Host-` cookies, Secure except on `http://localhost` |
| Security L2 | §5: CSP with a nonce; Canada-only `img-src`; Permissions-Policy; HSTS |
| Security L3 | Ids from the address checked as UUIDs and encoded in every client path |
| Security L4 | §2: `x-vercel-forwarded-for` on Vercel only; one strict bucket otherwise |
| Security L5 | §9: every query names its studio |
| Security L6 | §2: device cookie 30 days; privacy notice follow-up |
| Security L7 | §1: counted before the body is read |
| Security L8 | Follow-up |
| Code M1 | §7: the bag reads once; stable `setBagCount`; regression test |
| Code M2 | §6: one availability rule for totals, delivery and quantities |
| Code S1–S4 | §7: top scroll padding; totals live region; page titles; scoped, exact e2e locators |
| Code S5 | §3, §7: same-studio codes add; "Try again" instead of the form |
| Code S6 | §3: a session per studio, up to 3; "Your galleries"; forget one or all |
| Code N1 | §2: advisory locks first, in one order, then session rows |
| Code N2–N4 | §6 |
| Code N5 | §7 |
| Code N6 | §7: the last day to order, as ADR 0021 shows it (there is no job or studio time zone yet) |
| Code N7 | One locale pattern for "Order by … · Free delivery to school" |
| Code N8 | Unused keys removed; the pose summary shows the quantity |
| Code N9 | The pose page's Back keeps the pose |
| Code N10 | "Try again" on the add page (and every shop page) when the session can't be read |
| Code N11 | §8 |
| Code N12 | `callShopFunction`; `networkKey`, `wideKey`, `widerKey`, `deviceKey`; `PoseData`; `lib/shop/shop.ts` split into `http.ts`, `codes.ts`, `gallery.ts` (with `session.ts`, `throttle.ts`, `csp.ts`) |
| Re-review R1 | §2: locks first, a device only for a request that isn't locked, never with `locked`; issue counts under the advisory locks; IPv4 caps 500 and 5,000 |
| Re-review R2 | §2: devices still issued and known devices let in while tripped; only returning networks tightened; the breaker's limits stated; alert wiring for Seenu (follow-up); a second stage for Seenu to decide (flagged) |
| Re-review R3 | §2, §3: 3 new known devices per child a day; only shown children make a device known; trimming spares bags; 10 new sessions per child a day |
| Re-review R4 | §2: 1,200 requests a minute per IPv4 /24 or IPv6 /48, counted first |
| Re-review R5 | §9: `assertFunctionRegion` inside `callShopFunction` |
| Re-review R6 | §2, §10: `SHOP_TRUST_XFF`; the CDN note |
| Re-review R7 | §3, §8: forget-all forgets the device and clears its cookie; 404 for an unknown gallery; failures shown |
| Re-review R8 | §7: "Your child's photos"; no names in titles |
| Re-review R9 | §2: the breaker's count in 16 rows, summed |

## Claude's calls, Seenu to review

1. Siblings: same studio only (any of its jobs). (Amended by 25: another studio's code opens its own gallery.)
2. Parents see first name and last initial only ("Ava P.").
3. The cover is the child's first visible portrait in tagging order until studios can star one.
4. Lockout: 5 wrong codes per device (amended by 26–29: a signed device, wherever it is), plus 30 per network in 15
   minutes; 15-minute locks.
5. An unnamed blank card's code counts as a wrong code.
6. Do not publish, Do not photograph, or no visible portraits: "Photos aren't available yet. Contact {studio}.", no
   photos; class sets still shown to other children.
7. Charcoal #1C1C1E for every studio in Phase 1; `shopAccent()` kept for later.
8. Class photos are view only in Phase 1.
9. One home fee per bag (the highest); school delivery only if every job allows it; downloads need no delivery.
10. No events for parents' actions; studios don't see gallery opens in Phase 1.
11. Sessions last a fixed 30 days from the first code; siblings don't extend them; "Forget this device" deletes the
    session and the bag.
12. A passed closing date is closed at once in the shop.
13. "Lost your code?" says "Ask your photographer or school for a new card."
14. (Architect, accepted by the orchestrator) previews signed for 600 seconds; 120 shop requests a minute per network;
    no pay button until step 10; client-rendered shell pinned to `yul1`; no `next/image`.
15. A device's wrong codes count over 24 hours (the network's over 15 minutes); a lock that has run out starts the
    count again.
16. (Narrowed by the orchestrator, code review S5/S6) a code of a studio the device has a session of adds to it; it
    never replaces a session.
17. A code of a region with no database here counts as a wrong code (there is no separate sibling flow any more).
18. When both deliveries are offered, the parent must choose before a total shows; there is no default.
19. The cover shows once per child per browser tab session.
20. The bag's count includes lines no longer available until they are removed.
21. At most 100 lines in a bag; quantities 1 to 99.
22. IPv6 networks are counted by their /64, and also by their /56 and /48 (H1).
23. (Amended, L1 and L6) cookies are `__Host-` and Secure everywhere but `http://localhost`; the device cookie lasts
    30 days.
24. A new API error code, `shop_session_required` (401), rather than reusing `not_signed_in` (from the plan).
25. (Orchestrator, code review S6) a device holds a session for each of up to 3 studios; a 4th is refused
    (`shop.galleryLimit`) rather than replacing one; "Your galleries" lists them; "Forget this device" offers this
    gallery or all.
26. (Orchestrator, H1; amended by R1 and R2) the numbers: 30/100/300 wrong codes per network, /24 or /56, and /48 in
    15 minutes; new devices a day 500 per IPv4 address and 5,000 per /24, 50/200/500 per IPv6 /64, /56 and /48; a
    breaker at 600 wrong codes a minute per region, for 15 minutes, cutting a returning network's limits to 10/30/100.
27. (Orchestrator, M3; amended by R2 and R3) a known device is one that has opened, added or re-entered a child; it
    keeps its own 5 tries on a locked network unless it was locked in the last 24 hours, breaker or not; one child's
    code makes at most 3 new devices known a day; it stays known 30 days, or until "Forget this device" (all).
28. The first wrong code of a request without a device counts on the device it is issued (when the request isn't
    locked, R1); only when none can be issued does it count in the network's shared bucket (so a parent's first,
    mistyped try on school Wi-Fi isn't spent in a bucket strangers share).
29. The breaker's alert is one log line, `shop_lockout_breaker_tripped <region>`, once per trip, with no code, address
    or name; a log drain or alert rule that pages someone is for Seenu to set up (`docs/shop-lockout-alert.md`).
30. (Amended by R3) at most 10 sessions show one child; the oldest others with an empty bag go when an 11th is used;
    at most 10 new sessions per child a day, the rest answered `locked` until the day is over.
31. A gallery's id is a one-way hash of its token, named in `?gallery=`; the token never leaves the httpOnly cookie.
32. The shop's CSP allows inline styles (React's style attributes and Next's own), never inline scripts; it carries no
    `upgrade-insecure-requests` (local http runs). `payment=()` in Permissions-Policy until step 10 decides what Apple
    and Google Pay need.
33. "Order by" shows the last day to order in the parent's own time zone, the way ADR 0021 shows it to studios; there
    is no studio time zone yet.
34. (R2) "A network that keeps coming back" is one whose last wrong code before its current 15-minute count was within
    the hour; a wrong code inside the current count doesn't tighten it (else every network would be tightened by its
    own count, as the limit only matters at the 10th).
35. (R4) The wider request budget is 1,200 a minute (ten networks' worth).
36. (R7) A failed forget shows "We couldn't forget this yet. Check your connection and try again." and keeps the
    dialog open.

## Rejected

- Supabase anonymous sign-in, or JWTs minted for parents with row-level security for `anon`: more ways to get it
  wrong than one set of service-role functions keyed by the session hash.
- A bag kept in a cookie: it couldn't be priced and checked on the server.
- Upstash or KV for the lockout: another service, and data outside the region.
- `next/image`: its optimiser would cache Canadian photos outside Canada.
- Resetting the lockout on a right code: one real code could clear the count between guesses.
- Codes in URLs (query or path): they would reach logs, history and Referer headers.
- New `shop-accent` tokens (the plan's): the theme already has the studio slot with charcoal as its default; a second
  pair would duplicate it.
- Device ids chosen by the browser (the first version): free fresh tries for anyone who drops the cookie (H1).
- A 4th studio's code replacing the device's oldest gallery: it would empty a bag without asking (S6).
- A proof-of-work step instead of a network lock (M3): known devices soften shared networks without making every
  parent's phone do work.

## Follow-ups

- Step 10: checkout snapshots the bag (ADR 0019), the "payments processed by Daybell for <studio>" line (D104), Apple
  and Google Pay.
- Studios starring a best pose; studio colours and presets (D117, D118).
- A US function region and its shop routing.
- Class photo sales, if Seenu wants them (call 8).
- **Security M4, for Seenu (AWS):** the shop signs previews with the same AWS role as the studio app; only the
  `ParentPreview` type keeps it to `proof*.webp`. Give the shop's routes their own role whose policy allows only
  `s3:GetObject` on `arn:aws:s3:::<bucket>/*/*/*/proof*.webp`, so a future bug can't sign an original for a parent.
  Needs a new role and `AWS_SHOP_ROLE_ARN` in Vercel; then the shop's storage client uses it.
- **Security L8:** sessions can't be revoked per child yet. When a code can be regenerated (a lost card, a custody
  dispute), that must delete the child's `shop_session_children` rows. Today a studio's only immediate switch is Do not
  publish, which every read checks.
- **Security L6:** the parent privacy notice (not written yet) must say the shop keeps a device cookie for 30 days, for
  the lockout only.
- **Security re-review R2.5, for Seenu:** set up a Vercel log drain or alert rule that pages someone on
  `shop_lockout_breaker_tripped` (`docs/shop-lockout-alert.md`). Today it is a `console.warn` only, so nobody may ever
  see it.

## Flagged for Seenu

- **Class sets with a Do not publish classmate (call 6).** Class photo sets stay visible to every parent in the class
  even when a classmate is marked Do not publish (the orchestrator kept it: such children are normally not in the class
  photo). Do not publish often marks a custody or protection case; one option is that a Do not publish child in a class
  hides that class's set until the studio confirms it. Seenu to decide.
- **D60 "low resolution":** `proof.webp` is 1600 px on its longest side (from step 4), about 5.3 inches at 300 dpi,
  watermarked. Kept as is; Seenu to confirm it is low enough.
- **A second stage for a sustained trip (re-review R2.4; not built, Seenu to decide).** The breaker only lowers
  ceilings (§2, "What the breaker does not do"). One option: after, say, 3 trips in an hour, requests without a known
  device must pass an in-house proof-of-work (no third-party CAPTCHA, D113), or get a hard refusal. The trade-off:
  proof-of-work costs every new parent's phone time and battery during an attack; a hard refusal stops new parents
  everywhere in the region until it ends. Neither is decided.
- The lockout numbers (call 26) on mobile carriers: thousands of phones can share one IPv4 address; known devices
  (call 27) soften it, but a busy carrier address can still lock new devices for 15 minutes. Worth a look before
  launch.
