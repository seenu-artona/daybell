# 0032 — DRM screenshot protection: the test page (spike)

- Status: Proposed (branch `spike/drm-test-page`). A spike: nothing here reaches parents. Every call under "Calls for
  Seenu" is provisional until Seenu reviews it (CLAUDE.md rule 7).
- Decisions implemented: D158 (Seenu, Oct 14, 2026), first step only: a test page to try real devices, on the
  branch's **Preview** deployment (Seenu, Oct 14: never Vercel Production, which is staging today). Blackout mode for
  the fallback (Seenu's addition, Oct 14).
- Decisions touched: D113 (Montréal pinning; no studio data leaves its region), D92 (the page calls `/api/v1`), D96
  (words in the locale files), D91 (WCAG 2.2 AA), D112 (tokens, no hex), D60 (today's watermark and deterrents).

## What D158 asks, and what this step does

D158: in the parent gallery's large view, a photo becomes a one-frame DRM-encrypted video, so that hardware DRM
(Widevine L1, PlayReady SL3000, FairPlay) makes screenshots and screen recordings black. Axinom runs the license
service in the direct-key model (the license token carries the key, wrapped); we package in Canada. Devices without
hardware DRM get today's watermarked image, plus a short blackout on detected screenshot attempts.

This step only answers "does it work on real devices?":

- **A test clip, encrypted at build time.** No key passes through the repo, a developer's machine or chat:
  - The repo holds the **clear** clip, `apps/web/assets/drm-test/clear.mp4`: a synthetic SMPTE chart ("DRM TEST";
    never a real photo or a child), 2 all-intra frames of H.264 High 4.0 at 1600×1066, made by
    `scripts/drm/make-test-chart.mjs` with ffmpeg. It sits outside `public/` and is never served (checked: 404 at
    every path). Beside it, the committed fallback `public/drm-test/fallback.jpg`, the same chart watermarked.
  - `apps/web/scripts/encrypt-drm-test.mjs` runs before `next build`; its decisions are in
    `apps/web/lib/drm-test-build.mjs` (unit-tested). Every run first removes what an earlier run wrote. Then, only when
    `DRM_TEST_PAGE_ENABLED=true`, `VERCEL_ENV` isn't `production`, and both `DRM_TEST_KEY_ID` and
    `DRM_TEST_CONTENT_KEY` are set, it runs Shaka Packager 3.9.3 (the pinned `shaka-packager` dev dependency; its npm
    package carries the Linux binary Vercel's build image runs) to write CMAF cbcs with a DASH manifest and HLS
    playlists, raw key, `--clear_lead 0`, into `public/drm-test/` (git-ignored). Otherwise it writes nothing, and the
    page says the test isn't set up.
  - **The packager is checked and fenced** (security review M1, L4): its SHA-256 must equal the constant pinned for
    its platform in `drm-test-build.mjs` (linux-x64 `7a3cf35a…6f9ee6`) or the build stops; it runs with an
    environment holding `PATH` only, so no other build secret is visible to it; its error output is scrubbed of the
    key in hex (with or without GUID dashes), base64 and base64url before anything is printed. A malformed key fails
    the build, naming the variable. Key ID and content key are validated with exactly the token route's rules
    (`packages/config`), and a test checks both read the same values the same way.
  - `turbo.json` declares the three variables, so a change rebuilds, and keeps `public/drm-test/**` as build output.
    A cache hit therefore always comes from a run with the same flag and keys: with the flag off, what it restores
    holds no clip (code review 7). On a developer's machine, a clip from an earlier local build stays in `public/` until
    the next build, which removes it; it is git-ignored and useless without that build's key.
  - Checked locally with throwaway keys, since deleted: the build's output decodes with the key to exactly the clear
    frame and to flat grey without it, the key appears in no output file or build log, a production build serves the
    manifests and segments but not the clear clip, the step refuses in Production, and a modified binary is refused.
- **A token route.** `POST /api/v1/dev/drm-test/token` (Node, `preferredRegion = "yul1"`). Not found unless
  `DRM_TEST_PAGE_ENABLED=true` outside Vercel Production, read before anything else; then signed-in owners and admins
  only; then at most 30 tokens a minute per person (429 with Retry-After). It answers a JWT (HS256, signed with the
  communication key's bytes), the license server addresses and the FairPlay certificate address.
  `Cache-Control: no-store`. A missing or malformed setting answers 409 with `setup: drmTest.notConfigured`. Nothing
  is logged but the name of a missing setting and a fixed `drm_test_rate_limited`.
- **The entitlement message.** One inline key (`id` = the key ID; `encrypted_key` = AES-256-CBC, no padding, key = the
  communication key, IV = the key ID's 16 bytes in written order; `iv` = the clip's IV, below) under "Policy A":
  Widevine `HW_SECURE_ALL`, PlayReady `min_device_security_level: 3000`, FairPlay HDCP type 1 with no AirPlay and no AV
  adapter; `allow_persistence: false`.
- **The clip's IV** (fix after the first Safari test, Oct 14). Axinom (AxDRM 6.29.1) refused the FairPlay license with
  400 "Invalid license request. An initialization vector must be provided with every key in the entitlement message."
  FairPlay delivers the IV with the key, so the IV must be known, not left for the packager to pick at random. The
  build now passes `iv=` with the key (`--keys label=:key_id=…:key=…:iv=…`; Shaka Packager 3.9.3 accepts it), and the
  IV is **the key ID's own 16 bytes**: deterministic, no new setting, and not secret (it is in the clip's `tenc` box and
  the HLS playlist anyway). Checked: the playlist's `IV=` and the `tenc` constant IV both equal the key ID, and the
  clip still decrypts to the clear frame. The token sends the same bytes as `iv` (base64) on every inline key; tests
  check the token's IV, the packager's and their derivation agree. Widevine and PlayReady read the IV from the clip and
  ignore the token's, so DASH is unchanged. The field name `iv` is taken from the error's wording and Axinom's inline-key
  naming as recalled; it couldn't be checked against their docs from here.
- **A page.** `/dev/drm-test`, flag-gated (and never in Production), owners and admins (signed out: to sign-in and
  back; anyone else: not found). Its decisions are in `apps/web/lib/drm-test-player.ts` (unit-tested).
  1. What the device supports, in words: `requestMediaKeySystemAccess` for Widevine `HW_SECURE_ALL`,
     `HW_SECURE_DECODE`, `SW_SECURE_DECODE`; PlayReady (`com.microsoft.playready.recommendation`) at 3000 and 2000,
     and the `…recommendation.3000` key system; `com.apple.fps`. Each asks for the clip's H.264 with `cbcs`.
  2. In this order: the token route (409: not set up), the choice of DASH, HLS with FairPlay or the fallback, and only
     then whether the build made the clip (no manifest: not set up).
  3. The clip in Shaka Player 5.2.12 (npm, Sep 25, 2026), muted, `playsinline`, stopped on its picture, named from the
     locale files. Each license request, and no other request, gets a fresh token as `X-AxDRM-Message`.
  4. **When it counts as shown** (code review 1): only once the first frame is decoded (`loadeddata`, `readyState` at
     `HAVE_CURRENT_DATA` or more) **and** a key's status is `usable`. A failure, in words, on Shaka's `error`, the video
     element's `error`, a key that becomes `output-restricted` or `internal-error` (even after showing), or nothing
     within 15 seconds. `play()` is never awaited. Try again stays available while loading.
  5. Otherwise the fallback (below). The instruction line: "Take a screenshot and a screen recording; note whether
     the photo is black."
- **The proxy** (`apps/web/proxy.ts`) no longer runs its session check for `/drm-test/…` static files (code review 9).

## Token lifetime and replay

- Good from 5 seconds **before** it is made (`begin_date`, so a license server whose clock is a little behind still
  takes it; code review 8, a choice) to 60 seconds after (`expiration_date`).
- Within those 65 seconds a token can be replayed: it only ever unlocks the one synthetic test key, under the
  hardware-only policy, and only from a device the policy admits. Axinom's own replay protection
  (`prevent_drm_message_reuse` in the research notes) is **not** sent, and no `jti` either: neither could be checked
  against Axinom's schema, and an unknown field could make it refuse every token. Both are to be added once confirmed.
- Minting is limited to 30 tokens a minute per person. The count is kept in each function instance's memory, the
  same fixed one-minute window as the payout routes' database count (ADR 0020) but best effort: separate Vercel
  instances count separately. Enough for a flag-gated owners-and-admins page; the parent shop needs the database's
  count (call 7).

## Blackout mode (the fallback on computers)

`app/_components/blackout.tsx`, written for the parent shop to reuse: `useBlackout()` (a pure reducer plus window
listeners), `createClipboardClearer()`, `useDesktopPointer()` and `BlackoutPhoto`.

**Amended (Seenu, Oct 14, after trying the Preview on his Mac: Chrome had Widevine software only, so the fallback):**
the photo is **shown normally**. The first version showed it only while the pointer was over it or it had keyboard
focus, with a "move back to view" line; that requirement, the focusable region and the instruction are gone.

- It turns into an `ink` panel at once on a screenshot sign, and comes back when the sign ends:
  - the window losing focus: until it has focus again;
  - the page hidden (`visibilitychange`): until it is visible again;
  - Shift with Cmd/Win or Ctrl held, including Cmd+Ctrl+Shift (macOS Cmd+Shift+3/4/5 and Cmd+Ctrl+Shift+3/4, Windows
    Win+Shift+S): while held and for 1.5 seconds after they are let go, because the capture happens after release;
  - Print Screen, Cmd/Ctrl+P, `beforeprint`, the context menu (also blocked on the photo): for 1.5 seconds.
- macOS can swallow the key-up while its screenshot tool runs, so "held" never sticks: focus coming back, or a mouse
  move whose modifiers show the keys are up, counts as the release.
- The dark state says so in words ("Photo hidden while a screenshot may be taken. It comes back in a moment."), never
  by color alone: a screen-reader-only `role="status"` is always rendered and only the ink panel is toggled, so going
  dark is announced; the panel's own words are `aria-hidden` to avoid reading them twice. The image's `alt` is empty
  while hidden.
- Ctrl+Shift is also an ordinary shortcut (e.g. Ctrl+Shift+T), so on Windows and Linux the photo will sometimes go dark
  for a moment without a screenshot. Accepted: Seenu asked for Ctrl+Shift.
- Only on a pointer that hovers and points finely (`(hover: hover) and (pointer: fine)`). Phones and tablets get the
  shop's existing blur (`ProtectionProvider`).
- Nothing is logged or sent: tests check no `console` call and no `fetch`.

### Clearing the clipboard (Seenu's decision, Oct 14)

After a keyboard screenshot sign ends (a Shift combination above is released, or Print Screen), and while the page
has focus, Blackout overwrites the clipboard with an empty string (`navigator.clipboard.writeText("")`), so a
screenshot taken to the clipboard (Cmd+Ctrl+Shift+3/4, Win+Shift+S, Print Screen) is harder to paste anywhere. If the
page has no focus then, it tries when focus returns; if the browser refuses, it tries once more on the next focus, then
gives up. Every failure is ignored silently. It **never reads** the clipboard.

- Only keyboard signs clear it. The window losing focus, the page being hidden, printing and the context menu black the
  photo out but leave the clipboard alone: otherwise every switch to another app would erase what a parent had copied
  (Claude's reading of "when a sign is detected"; for Seenu to confirm).
- Limits:
  - **Browser support.** Chrome and Edge allow it while the page has focus. Safari and Firefox may refuse without a
    click or key press in the page at that moment (a key-up isn't one), so there it often does nothing.
  - **Files are untouched.** Screenshots saved as files (macOS Cmd+Shift+3/4/5 to the Desktop, Windows Win+Print
    Screen to Pictures, the Snipping Tool's own window) are not affected; nor are phone screenshots or cameras.
  - **It erases what the parent had copied**, whatever it was, on any of these key combinations, including a
    Cmd+Shift or Ctrl+Shift shortcut that wasn't a screenshot.
  - The OS may put the image on the clipboard after our write (the clipboard tools are asynchronous); the 1.5-second
    blackout helps the capture miss the photo, not the clear.

## Settings (all server-only; `packages/config/src/server.ts`)

| Variable | What | Secret |
|---|---|---|
| `DRM_TEST_PAGE_ENABLED` | `true` turns the page, route and build step on, never in Vercel Production; default off | no |
| `AXINOM_COM_KEY_ID` | the **test** tenant's communication key ID (GUID) | no |
| `AXINOM_COM_KEY` | the **test** tenant's communication key, base64 of 32 bytes | **yes** |
| `AXINOM_LICENSE_PREFIX` | tenant part of `https://<prefix>.drm-<system>-licensing.axprod.net/AcquireLicense` | no |
| `AXINOM_FAIRPLAY_CERT_URL` | optional https address of the FPS certificate; unset turns FairPlay off | no |
| `DRM_TEST_KEY_ID` | the clip's key ID: a random GUID (`uuidgen`) | no |
| `DRM_TEST_CONTENT_KEY` | the clip's content key: 32 random hex digits (`openssl rand -hex 16`) | **yes** |

- **Preview only** (security review L2; Seenu's decision on call 4): in Vercel, every one of these is scoped to the
  **Preview** environment (ideally to the `spike/drm-test-page` branch), never Production or Development, and
  `AXINOM_COM_KEY` and `DRM_TEST_CONTENT_KEY` are marked **Sensitive**.
- **A separate Axinom tenant or communication key for testing** (L2): the test's communication key must never be the
  one the real shop will sign with. A leaked test key then unlocks nothing but the synthetic chart, and can be revoked
  without touching the shop.
- Seenu makes the two test key values himself and sets them in Vercel only: they never go in the repo, a file, a log
  or a chat (`scripts/drm/README.md`). `DRM_TEST_PAGE_ENABLED` and both test key values are read at build time too (the
  encryption step) and must be set before the deployment is built; the Axinom settings are read only at run time.
- Errors name the variable, never the value. A missing or malformed setting makes the token route answer 409, and the
  page says the test isn't set up, as it does when the build made no clip.

## What reaches Axinom

From the parent's (here: the tester's) browser, directly: the license request (the CDM's challenge, which identifies
the device's DRM client), the browser's IP address (accepted in D158), and the token: the communication key ID, the
key ID, the wrapped content key, the policy and two timestamps. No name, email, access code, studio, photo or account
id. Our server talks to Axinom not at all; it signs tokens in Montréal.

## Rejected for this step

- Axinom's key service or a key server: the direct-key model keeps keys with us and needs nothing at packaging time.
- ffmpeg's own encryption: it writes `cenc` only, and FairPlay needs `cbcs`.
- Clear lead: one clip frame is the whole photo, so nothing may be unencrypted.
- A database counter for the token budget: a migration for a temporary, flag-gated spike route; the shop will need one
  (call 7).

## What wasn't verified (this was built without network access to Axinom's docs or GitHub)

- The entitlement message's field names, `begin_date`/`expiration_date`, and the `encrypted_key` IV byte order were
  taken from the D158 research notes, not checked against docs.axinom.com (blocked from the build machine). Neither
  `prevent_drm_message_reuse` nor a `jti` is sent (see "Token lifetime and replay").
- How Axinom's FairPlay server expects the SPC and the `skd://` URI (here `skd://<key ID GUID>`); Shaka's default
  raw SPC body is sent, and wrapped CKC responses are unwrapped. The first Safari test reached Axinom's FairPlay
  server and got past the token's signature to the IV check, so the token's envelope and signing are accepted.
- Axinom's log showed the request as `http://<tenant>.drm-fairplay-licensing.axprod.net/AcquireLicense`. Every license
  address this code builds is `https://` (a test checks all three), and the player uses them as given; the `http` in
  Axinom's log is presumably its own record behind TLS, to be confirmed with Axinom if it matters.
- Whether PlayReady SL3000 devices play `cbcs` (PlayReady 4+ does; older hardware may want `cenc`).
- Whether every browser reports key statuses (the page waits for `usable`): if one doesn't, its playback would end in
  the 15-second timeout, which the page reports in words.
- Any real playback: only the packaging was checked here (the build's clip decodes with the key and not without it).
- Vercel's build itself: the Linux x64 packager binary ran here, with the pinned hash; that the same runs in Vercel's
  build image is expected but untested until the first Preview deployment with the keys set.

## Calls for Seenu

1. **The test key.** Seenu generates `DRM_TEST_KEY_ID` (a random GUID) and `DRM_TEST_CONTENT_KEY` (32 random hex
   digits, `openssl rand -hex 16`), sets both in Vercel (Preview, Sensitive) only, then redeploys. An earlier draft of
   this branch committed a clip encrypted with a key made on the build machine; that key has been deleted and was never
   used anywhere else, so the clip left in the branch's history can't be decrypted.
2. **Token lifetime.** 5 seconds back, 60 seconds forward, fresh per license request, without
   `prevent_drm_message_reuse` or `jti` until Axinom's docs confirm them.
3. **Route and page under `/dev`.** The route is listed in the API docs under Internal ("Not for integrations"), like
   the other internal routes, because every route file must be documented.
4. **Production — decided (Seenu, Oct 14):** test on Preview only. `drmTestPageEnabled()` is false when
   `VERCEL_ENV=production` and the build step refuses the same way, whatever the flag says.
5. **Blackout's limits.** It can't see a phone's screenshot buttons, a second camera, or OS tools that don't move focus
   (e.g. a timed capture), and since the Oct 14 amendment the photo is visible whenever no sign is seen. It deters;
   DRM is what actually blacks out.
6. **When the shop adopts D158:** the shop's Content-Security-Policy (ADR 0022) will need `media-src blob:` and
   `connect-src` for Axinom's license hosts.
7. **The token budget for the shop.** Per-instance memory is fine here; parents' tokens will need a database count
   like `take_stripe_call`.
8. **Which signs clear the clipboard.** Keyboard signs only (above). Should the window losing focus clear it too? That
   would catch more screenshot tools but erase the parent's clipboard on every app switch.
