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

## 2. Lockout (answer 2, call 4)

- **5 wrong codes from one network and device (in 24 hours) lock that pair for 15 minutes; 30 wrong codes from one
  network in 15 minutes lock the network for 15 minutes.** Claude's call 4; the 24-hour window for a device is Claude's
  call, Seenu to review.
- The network is the client's address (the first `x-forwarded-for` entry, which Vercel sets and overwrites); IPv6 is
  bucketed by its /64. The device is a random httpOnly cookie, `daybell_device` (400 days, used for nothing else). Both
  are HMAC'd with a new key, `SHOP_THROTTLE_KEY`, before they leave the route: no address or device id is ever stored
  or logged. Clearing cookies only moves a guesser onto the network count.
- `public.shop_enter_code` locks both counters' rows first (network, then pair), checks the lock **before any lookup**
  (a locked caller gets `locked` even with a right code and learns nothing), then looks up the HMAC. A miss counts on
  both keys; the 5th miss answers `locked` straight away. **A right code never resets the count** (else one real code
  could clear it between guesses). Parallel guesses take turns on the row locks, so a burst can't slip past the limit.
- 429 `rate_limited` with `fields.form = shop.locked` and `Retry-After`.
- The counts live in `app.shop_code_attempts` (the `app` schema is not reachable through the Data API; no studio_id: a
  wrong guess belongs to no studio), HMACs only, removed after 24 hours.
- Every shop route also counts requests per network: **120 a minute** (architect's call, accepted), in
  `app.shop_rate` through `take_shop_request`, the `stripe_call_budget` pattern. 429 with `Retry-After: 60`.

## 3. Sessions (answer 3; calls 1, 11)

- A right code opens a session: `public.shop_sessions`, one studio, **a fixed 30 days from the first code; adding a
  sibling doesn't extend it** (call 11). Opening a code on a device that already has a session forgets the old one
  (one session per device; Claude's call, Seenu to review).
- The cookie `daybell_shop=<region>.<token>`: 32 random bytes, httpOnly, SameSite=Lax, Path=/, Max-Age 30 days,
  Secure in production (as `daybell_region`, so local and CI runs over http work). The database keeps only the
  token's SHA-256, so a leaked table can't be replayed. The region names the database for later requests (D113). A
  missing, forged, expired or unknown cookie is the same 401 (`shop_session_required`, a new API error code); a dead
  cookie is cleared.
- Siblings (call 1): **same studio only, from any of its jobs, up to 5 children**. Another studio's code answers 409
  `shop.otherStudio` ("This code is from a different photographer. Open it separately."); checkout stays per studio.
  The 5 is enforced in the function and by a trigger under a lock on the session row, whoever writes. In the sibling
  flow a code of another region can't be this studio's and is looked up as nothing (a wrong code; Claude's call).
- "Forget this device" (⋯ menu, with a confirmation) deletes the session, its children and its bag, and clears the
  cookie (call 11).
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
- A valid code for a closed or draft job does reveal that the code exists and the studio's name: Seenu chose that
  message (answer 4).
- Photos: `app.parent_visible_photos(job, child, group)` is the set-based twin of `photo_parent_visible` (same
  predicate: ready, not binned, never a card or another job's card photo, a maybe-card only once a person placed or
  confirmed it, placed with a child or a class set, not flagged, its batch's tags up to date). pgTAP proves the two agree
  on every fixture photo. A child sees their own portraits and **their own class's set** (class sets are still shown
  to other children of a Do not publish child, call 6), in tagging order.
- The cover (D119) is **the first visible portrait in tagging order** until studios can star a pose (call 3), full
  screen, with the studio's name, the child's name, the school (the job's client, else the job's name), picture day
  and a **"See photos" button**. The words slide up on load; with reduced motion they don't. It never moves on by itself.
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
  travel in a Referer) and `X-Frame-Options: DENY`; pages also carry robots noindex and no-referrer metadata. Shop API
  answers are `Cache-Control: no-store`. No third-party scripts or analytics; the font is self-hosted.

## 6. The bag (calls 8, 9)

- `public.shop_cart_lines`: ids, the pose and a quantity only. **No price is stored**: every read prices the bag from
  each job's current list, so a price change shows at once and step 10 can snapshot it exactly as ADR 0019 describes.
- Rules (core `cartLineProblem`, enforced by `shop_cart_add`): a package, print or single download needs a pose, one
  of **that child's** visible portraits; "all digitals" has none; downloads are bought once; quantities 1–99; the same
  item and pose again adds to its line; at most 100 lines. Refusals: 409 `shop.closed`, `shop.itemUnavailable`,
  `shop.photoUnavailable`, `shop.bagFull`.
- A line reads back `available: false`, marked "No longer available" and left out of the totals, when its item left
  the job's list (a list switch), its pose can't be shown any more, or the shop closed. Deleting an item or purging a
  photo removes its lines (composite foreign keys with cascade).
- Delivery (call 9): **one home fee per bag, the highest among its jobs with something to deliver; school delivery
  only if every such job allows it; a bag of downloads needs none.** When both are offered the parent chooses; the
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
| `/shop` | Code entry (neutral, the studio isn't known yet); with a session, straight to the first child's gallery |
| `/shop/add` | A brother's or sister's code |
| `/shop/c/[childId]` | The cover, then the grid; Portraits / Class photo; the children as links; "Order by" and school delivery; the viewer |
| `/shop/c/[childId]/buy` | Packages as a radio list, the price docked beside Continue; "Single prints and downloads" |
| `/shop/c/[childId]/buy/singles` | Prints, the single download and all digitals |
| `/shop/c/[childId]/buy/[itemId]` | The pose (radios shown as thumbnails), how many, "Add to bag" |
| `/shop/bag` | Lines by child, delivery, totals "+ tax" |

Accessibility (WCAG 2.2 AA): every input labelled (the code field, the pose and delivery radios, the quantity groups);
44 px targets; visible focus in the studio colour; the viewer has Previous and Next buttons and arrow keys besides
swiping (2.5.7); the docked button leaves room and adds scroll padding so a focused control is never hidden under it
(2.4.11); the selected child is `aria-current` and filled, a selected tab `aria-pressed` and underlined (no colour-only
meaning); refusals are announced (`role="alert"`). Words are in `messages/en-US.json` and `en-CA.json` (`shop.*`);
colours are tokens only.

Board deviations (decisions win): the board's cover has no button and moves on after 2 seconds; D119 asks for a "See
photos" button and a timed move would fail WCAG 2.2.1. The board's accent is #2B2B2B; D116 says #1C1C1E. Left out as
out of scope: favourites, backgrounds, extra poses, discount tiers, Apple Pay (step 10) and the board's "Class photo"
package (call 8).

## 8. API (D92)

New group "Shop" and access kind `parent` (the session cookie) in `packages/api` routes and OpenAPI:
`POST /shop/access`, `GET`/`DELETE /shop/session`, `POST /shop/children`, `GET /shop/children/{childId}/gallery`,
`GET /shop/children/{childId}/price-list`, `GET /shop/cart`, `POST /shop/cart/lines`,
`PATCH`/`DELETE /shop/cart/lines/{id}`, `PUT /shop/cart/shipping`. 409 keys in `SHOP_CONFLICTS`; `shop.codeNotFound`
and `shop.locked`; the new error code `shop_session_required` (401). Writes go through `handle()`'s same-origin and
JSON-only checks.

## 9. Database (forward migration `20261012700000_parent_shop.sql`)

- Tables: `public.shop_sessions`, `public.shop_session_children`, `public.shop_cart_lines` (each with `studio_id`,
  composite studio foreign keys, row-level security on, no policies, nothing granted to `anon` or `authenticated`);
  `app.shop_code_attempts` and `app.shop_rate` (HMACs only). A new unique key on `price_list_items (studio_id,
  price_list_id, id, kind)` lets a line carry its item's kind.
- Functions, all SECURITY DEFINER with an empty `search_path`, executable by `service_role` only, named errors with no
  values: `shop_enter_code`, `shop_session`, `shop_gallery`, `shop_price_list`, `shop_cart`, `shop_cart_add`,
  `shop_cart_set_quantity`, `shop_cart_remove`, `shop_set_shipping`, `shop_forget`, `take_shop_request`,
  `prune_shop`; helpers in `app` that nobody can call directly.
- `prune_shop` runs in the jobs cron (hourly on staging, daily in production) after `prune_notifications`: expired
  sessions with their bags, and wrong-code and request counts untouched for 24 hours.
- Events: **none for parents' actions** (call 10): sessions, attempts and the bag are the parent's own state, like the
  notifications exception of ADR 0021. Studios don't see gallery opens in Phase 1.
- Region (D113): every shop route and page is pinned to `yul1` and refuses to run elsewhere for Canadian data
  (`assertFunctionRegion`; photos also `assertStorageRegion`). A US function region will need its own shop routing,
  as ADRs 0015 and 0021 already note.

## 10. Configuration

- `SHOP_THROTTLE_KEY` (new, declared in `packages/config` `shopThrottleKey()`): 32 random bytes, base64, different
  from both access code keys; server-only, read on first use; errors name the variable only. Without it every shop
  route answers 500 and logs `shop_throttle_key_missing` (fails closed). CI makes a fresh one per run. Changing it only
  restarts the counts.
- **Seenu must add `SHOP_THROTTLE_KEY` in Vercel (Production, and Preview for staging) before the shop is used there:
  generate it with `openssl rand -base64 32` and paste it straight into Vercel's environment variables. Never in chat,
  a commit, an issue or a log.**
- `SHOP_URL` unset now falls back to `${siteUrl}/shop`.
- `turbo.json` is unchanged: like the access code keys, the key is a runtime secret the build never reads.

## 11. Tests

- Core (`shop.test.ts`): lockout edges, line rules, merging, delivery and totals (school and downloads free,
  unavailable lines left out, no total until delivery is chosen), cover pick, display name, the cookie format.
- UI (`contrast.test.ts`): `shopAccent` fallbacks (none, pale yellow, mid grey) and contrast for any colour.
- Config: `SHOP_THROTTLE_KEY` and the `/shop` fallback.
- API (`shop.test.ts`): the schemas; `SHOP_CONFLICTS` and limits kept equal to the migration's; nothing granted to
  browsers; the routes' access and errors.
- pgTAP `021_parent_shop` (113 assertions): grants (tables and functions closed to `anon` and `authenticated`), lookup
  by HMAC among children only (blank-card and card codes refused), the lockout (5th miss locks, locked caller with a
  right code, expiry and restart, a right code doesn't reset, the network ceiling), sessions (30 days, siblings,
  other studio, the limit of 5 even for direct inserts, a session never holding another studio's child, expiry,
  replacing a device's session), the gallery (every hidden kind excluded, another class's set and another child's
  photos excluded, equivalence with `photo_parent_visible`, closed, draft, passed closing date, unavailable), prices,
  the bag (kind rules, another child's or a class photo refused, another studio's item refused, merging, a list switch
  and a hidden pose make lines unavailable, cascades), cross-studio leaks (studio B's session can't read or change A's
  child, prices or lines, even with their ids), no events, no names or codes stored. Two sessions racing for the 5th
  sibling can't be run in one pgTAP connection; the trigger's row lock is what serialises them.
- Route tests (`shop-routes.test.ts`): cookie flags; the token's hash only reaching the database; identical answers
  for a wrong code, another region's code and a non-code; 429 with Retry-After when locked or over 120 a minute; the
  same pair and network keys for the same device; no code or address reaching the database; the Montréal guard;
  failing closed without the key; 401 for a missing, forged or other-region cookie; signed keys ending in `proof*.webp`
  for 600 seconds at most; nothing signed for closed shops; the bag priced and totalled; refusals as keys; `no-store`;
  cross-site and non-JSON writes refused; the `next.config` headers; a console spy proving nothing is logged.
- e2e `shop-gallery.spec.ts` (the `phone` project, Pixel 7): code, cover (no slide with reduced motion), grid, blur on
  visibility change, viewer Previous/Next, "Use this photo", a package and its pose, a sibling and switching, a print
  and a single download, delivery and totals, forgetting the device, a draft job's closed message, and five wrong codes
  locking a phone out.

## Claude's calls, Seenu to review

1. Siblings: same studio only (any of its jobs); another studio's code is refused with "This code is from a
   different photographer. Open it separately."
2. Parents see first name and last initial only ("Ava P.").
3. The cover is the child's first visible portrait in tagging order until studios can star one.
4. Lockout: 5 wrong codes per network+device, plus 30 per network in 15 minutes; 15-minute locks.
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
16. Opening a code on a device replaces that device's earlier session.
17. In the sibling flow, a code of a region other than the session's counts as a wrong code.
18. When both deliveries are offered, the parent must choose before a total shows; there is no default.
19. The cover shows once per child per browser tab session.
20. The bag's count includes lines no longer available until they are removed.
21. At most 100 lines in a bag; quantities 1 to 99.
22. IPv6 networks are counted by their /64.
23. Cookies are Secure in production only (local and CI run over http), Path=/; the device cookie lasts 400 days.
24. A new API error code, `shop_session_required` (401), rather than reusing `not_signed_in` (from the plan).

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

## Follow-ups

- Step 10: checkout snapshots the bag (ADR 0019), the "payments processed by Daybell for <studio>" line (D104), Apple
  and Google Pay.
- Studios starring a best pose; studio colours and presets (D117, D118).
- A US function region and its shop routing.
- Class photo sales, if Seenu wants them (call 8).
