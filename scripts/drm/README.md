# DRM test clip (spike, D158; ADR 0032)

No key is ever committed, typed into chat or needed on a developer's machine. The repo holds only the **clear**
synthetic picture; the web app's build encrypts it with the key from Vercel's environment.

| File | Committed? | Served? |
|---|---|---|
| `apps/web/assets/drm-test/clear.mp4`: the clear clip (2 frames, all-intra H.264 High 4.0, 1600×1066, BT.709) | yes | **never** (outside `public/`) |
| `apps/web/public/drm-test/fallback.jpg`: the same chart, watermarked, for devices without hardware DRM | yes | yes |
| `apps/web/public/drm-test/manifest.mpd`, `master.m3u8`, `video.m3u8`, `video/`: the encrypted clip | no (git-ignored) | yes, made at build time |

The picture is a synthetic SMPTE colour chart with the words "DRM TEST": never a real photo, never a child.

## How the encrypted clip is made

`apps/web/scripts/encrypt-drm-test.mjs` runs before `next build` (`apps/web/package.json`). Only when
`DRM_TEST_PAGE_ENABLED=true` and both `DRM_TEST_KEY_ID` and `DRM_TEST_CONTENT_KEY` are set, it runs Shaka Packager
3.9.3 (the pinned `shaka-packager` dev dependency, whose npm package carries the Linux, macOS and Windows binaries) to
write CMAF cbcs with a DASH manifest and HLS playlists, raw key, `--clear_lead 0` (no frame unencrypted). Otherwise
it writes nothing and the page says the test isn't set up. A malformed key fails the build, naming the variable only;
the key itself is never printed (the packager's errors are scrubbed of it). The three variables are declared in
`turbo.json`, so changing one rebuilds.

## Setting the key (Seenu, in Vercel only)

1. Make the two values on your own machine:

   ```sh
   uuidgen | tr 'A-Z' 'a-z'   # DRM_TEST_KEY_ID: a random GUID
   openssl rand -hex 16       # DRM_TEST_CONTENT_KEY: 32 random hex digits
   ```

2. Paste them straight into Vercel (staging) as `DRM_TEST_KEY_ID` and `DRM_TEST_CONTENT_KEY`, mark the content key
   Sensitive, and don't keep them anywhere else. They never go in a file in the repo, a commit, a log or a chat.
3. Redeploy: the clip is encrypted during the build, so a deployment built before the keys were set has none.

Changing the key later works the same way: new values in Vercel, then redeploy.

## Remaking the clear picture (only if the chart itself should change)

Needs ffmpeg with libx264 and drawtext. From the repo root:

```sh
node scripts/drm/make-test-chart.mjs
```

It rewrites `apps/web/assets/drm-test/clear.mp4` and `apps/web/public/drm-test/fallback.jpg`; commit both.

## Checking the build's output locally (throwaway key)

```sh
cd apps/web
K=$(openssl rand -hex 16); C=$(openssl rand -hex 16)
DRM_TEST_PAGE_ENABLED=true DRM_TEST_KEY_ID=$K DRM_TEST_CONTENT_KEY=$C node scripts/encrypt-drm-test.mjs
cat public/drm-test/video/init.mp4 public/drm-test/video/1.m4s > /tmp/clip.mp4
ffmpeg -i /tmp/clip.mp4 -frames:v 1 /tmp/no-key.png                    # flat grey
ffmpeg -decryption_key "$C" -i /tmp/clip.mp4 -frames:v 1 /tmp/key.png   # the chart
unset K C; node scripts/encrypt-drm-test.mjs                             # flag unset: removes the output
```
