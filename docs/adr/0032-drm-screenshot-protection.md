# 0032 — DRM screenshot protection: the test page (spike)

- Status: Proposed (branch `spike/drm-test-page`). A spike: nothing here reaches parents. Every call under "Calls for
  Seenu" is provisional until Seenu reviews it (CLAUDE.md rule 7).
- Decisions implemented: D158 (Seenu, Oct 14, 2026), first step only: a test page on staging to try real devices.
  Blackout mode for the fallback (Seenu's addition, Oct 14).
- Decisions touched: D113 (Montréal pinning; no studio data leaves its region), D92 (the page calls `/api/v1`), D96
  (words in the locale files), D91 (WCAG 2.2 AA), D112 (tokens, no hex), D60 (today's watermark and deterrents).

## What D158 asks, and what this step does

D158: in the parent gallery's large view, a photo becomes a one-frame DRM-encrypted video, so that hardware DRM
(Widevine L1, PlayReady SL3000, FairPlay) makes screenshots and screen recordings black. Axinom runs the license
service in the direct-key model (the license token carries the key, wrapped); we package in Canada. Devices without
hardware DRM get today's watermarked image, plus a short blackout on detected screenshot attempts.

This step only answers "does it work on real devices?":

- **A test clip.** `scripts/drm/package-test-asset.mjs` draws a synthetic SMPTE chart ("DRM TEST"; never a real photo
  or a child), encodes 2 all-intra frames of H.264 High 4.0 at 1600×1066, and encrypts them with Shaka Packager 3.9.3
  as CMAF cbcs with a DASH manifest and HLS playlists, raw key from the environment, `--clear_lead 0`. The output in
  `apps/web/public/drm-test/` is committed: it is useless without the key. A watermarked JPEG of the same chart is the
  fallback. Regenerating: `scripts/drm/README.md`.
- **A token route.** `POST /api/v1/dev/drm-test/token` (Node, `preferredRegion = "yul1"`). Not found unless
  `DRM_TEST_PAGE_ENABLED=true`, read before anything else; then signed-in owners and admins only. It answers a JWT
  (HS256, signed with the communication key's bytes) valid 60 seconds (`begin_date`/`expiration_date`), the license
  server addresses and the FairPlay certificate address. `Cache-Control: no-store`. Nothing is logged but the name of a
  missing setting.
- **The entitlement message.** One inline key (`id` = the key ID; `encrypted_key` = AES-256-CBC, no padding, key = the
  communication key, IV = the key ID's 16 bytes in written order) under "Policy A": Widevine `HW_SECURE_ALL`,
  PlayReady `min_device_security_level: 3000`, FairPlay HDCP type 1 with no AirPlay and no AV adapter;
  `allow_persistence: false`.
- **A page.** `/dev/drm-test`, flag-gated, owners and admins (signed out: to sign-in and back; anyone else: not found).
  1. What the device supports, in words: `requestMediaKeySystemAccess` for Widevine `HW_SECURE_ALL`,
     `HW_SECURE_DECODE`, `SW_SECURE_DECODE`; PlayReady (`com.microsoft.playready.recommendation`) at 3000 and 2000,
     and the `…recommendation.3000` key system; `com.apple.fps`. Each asks for the clip's H.264 with `cbcs`.
  2. The clip in Shaka Player 5.2.12 (npm, Sep 25, 2026), muted, `playsinline`, paused on its picture, named from the
     locale files: DASH when hardware Widevine or PlayReady is there, HLS with FairPlay when FairPlay is supported and
     set up. Each license request fetches a fresh token and sends it as `X-AxDRM-Message`. The page says which key
     system played it, or why it couldn't, in words.
  3. Otherwise the fallback (below). The instruction line: "Take a screenshot and a screen recording; note whether
     the photo is black."

## Blackout mode (the fallback on computers)

`app/_components/blackout.tsx`, written for the parent shop to reuse: `useBlackout()` (a pure reducer plus window
listeners), `useDesktopPointer()` and `BlackoutPhoto`.

- The photo shows only while the page has focus and the pointer is over it; keyboard users view it by focusing it
  (a focusable `role="group"` named from the locale files, with a visible focus ring).
- It turns into an `ink` panel at once on: window blur, `visibilitychange` to hidden, the pointer leaving, Cmd/Win+
  Shift held, Print Screen (down or up), Cmd/Ctrl+P, `beforeprint`, the context menu (blocked on the photo).
- After a shortcut, print or the context menu it stays dark until the pointer comes back onto the photo (or the photo
  is focused again), because the capture happens after the keys are let go. Window focus brings it back by itself.
- The dark state says so in words in a status region ("Photo hidden — move back to view."; before the first view:
  how to view it), so it is never colour only. The image's `alt` is empty while hidden.
- Only on a pointer that hovers and points finely (`(hover: hover) and (pointer: fine)`). Phones and tablets get the
  shop's existing blur (`ProtectionProvider`), with no split reveal.
- Nothing is logged or sent: a test checks no `console` call and no `fetch`.

## Settings (all server-only; `packages/config/src/server.ts`)

| Variable | What | Secret |
|---|---|---|
| `DRM_TEST_PAGE_ENABLED` | `true` turns the page and route on; default off | no |
| `AXINOM_COM_KEY_ID` | the communication key's ID (GUID) | no |
| `AXINOM_COM_KEY` | the communication key, base64 of 32 bytes | **yes** |
| `AXINOM_LICENSE_PREFIX` | tenant part of `https://<prefix>.drm-<system>-licensing.axprod.net/AcquireLicense` | no |
| `AXINOM_FAIRPLAY_CERT_URL` | optional https address of the FPS certificate; unset turns FairPlay off | no |
| `DRM_TEST_KEY_ID` | the clip's key ID (GUID) | no |
| `DRM_TEST_CONTENT_KEY` | the clip's content key, 32 hex digits | **yes** |

Errors name the variable, never the value. None is needed at build time.

## What reaches Axinom

From the parent's (here: the tester's) browser, directly: the license request (the CDM's challenge, which identifies
the device's DRM client), the browser's IP address (accepted in D158), and the token: the communication key ID, the
key ID, the wrapped content key, the policy and two timestamps. No name, email, access code, studio, photo or account
id. Our server talks to Axinom not at all; it signs tokens in Montréal.

## Rejected for this step

- Axinom's key service or a key server: the direct-key model keeps keys with us and needs nothing at packaging time.
- ffmpeg's own encryption: it writes `cenc` only, and FairPlay needs `cbcs`.
- Clear lead: one clip frame is the whole photo, so nothing may be unencrypted.

## What wasn't verified (this was built without network access to Axinom's docs or GitHub)

- The entitlement message's field names, `begin_date`/`expiration_date`, and the `encrypted_key` IV byte order were
  taken from the D158 research notes, not checked against docs.axinom.com (blocked from the build machine). The
  research's `prevent_drm_message_reuse` is **not** sent: its name and place couldn't be confirmed, and an unknown field
  could make Axinom refuse every token.
- How Axinom's FairPlay server expects the SPC and the `skd://` URI (here `skd://<key ID GUID>`); Shaka's default
  raw SPC body is sent, and wrapped CKC responses are unwrapped.
- Whether PlayReady SL3000 devices play `cbcs` (PlayReady 4+ does; older hardware may want `cenc`).
- Any real playback: only the packaging was checked here (the clip decodes with the key and not without it).

## Calls for Seenu

1. **The test key.** A key pair was generated for the committed clip and kept outside the repo on the build machine;
   it is not in any commit or message. Either use that file, or make your own key and regenerate the clip
   (`scripts/drm/README.md`), then add both values to Vercel staging.
2. **Token lifetime.** 60 seconds, fresh per license request, without `prevent_drm_message_reuse` until its name is
   confirmed in Axinom's docs.
3. **Route and page under `/dev`.** The route is listed in the API docs under Internal ("Not for integrations"), like
   the other internal routes, because every route file must be documented.
4. **Production.** Nothing stops `DRM_TEST_PAGE_ENABLED=true` in production other than not setting it. Should it be
   refused when `VERCEL_ENV=production`?
5. **Blackout's limits.** It can't see a phone's screenshot buttons, a second camera, or OS tools that don't move focus
   (e.g. a timed capture). It deters; DRM is what actually blacks out.
6. **When the shop adopts D158:** the shop's Content-Security-Policy (ADR 0022) will need `media-src blob:` and
   `connect-src` for Axinom's license hosts.
