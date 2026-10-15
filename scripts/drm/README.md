# DRM test clip (spike, D158; ADR 0032)

`package-test-asset.mjs` makes everything in `apps/web/public/drm-test/`:

| File | What |
|---|---|
| `manifest.mpd` | DASH manifest (Widevine and PlayReady signalling, cbcs) |
| `master.m3u8`, `video.m3u8` | HLS playlists (FairPlay `skd://<key ID>`, plus Widevine and PlayReady key tags) |
| `video/init.mp4`, `video/1.m4s` | The encrypted CMAF clip: 2 frames, all-intra H.264 High 4.0, 1600×1066, BT.709 |
| `fallback.jpg` | The same chart, watermarked, for devices without hardware DRM |

The picture is a synthetic SMPTE colour chart with the words "DRM TEST". It is never a real photo and never a child.
Everything is encrypted with `--clear_lead 0`, so no frame ships in the clear; the files are useless without the
content key, which is why they are committed.

## Regenerate

You need ffmpeg (with libx264 and drawtext) and Shaka Packager **3.9.3** (July 27, 2026).

1. Get Shaka Packager from npm (the official package carries the release binaries; it runs no install scripts):

   ```sh
   mkdir -p /tmp/shaka-packager && cd /tmp/shaka-packager
   npm pack shaka-packager@3.9.3
   # Check it is the published file:
   # sha512-+kNjs9r5ojIKimCS6JdvtX1O3WQAo/tqCaTwSDLCz9q8Kj0VnZ27FeA/SP7ZOYrWaTQqEqdGnBtf2qtcPZ3UcQ==
   echo "sha512-$(openssl dgst -sha512 -binary shaka-packager-3.9.3.tgz | base64 | tr -d '\n')"
   tar -xzf shaka-packager-3.9.3.tgz
   ls package/bin   # packager-linux-x64, packager-osx-arm64, packager-win-x64.exe, …
   ```

2. Choose the test key, if you are making a new one (each is 16 random bytes):

   ```sh
   openssl rand -hex 16   # DRM_TEST_KEY_ID (written as a GUID: 8-4-4-4-12 hex digits)
   openssl rand -hex 16   # DRM_TEST_CONTENT_KEY (32 hex digits)
   ```

   Keep them in a password manager or an env file outside the repo, never in a commit, a log or a chat. The same two
   values go into Vercel (staging), because the token route wraps the content key for Axinom.

3. From the repo root, with the key in the environment (not typed on the command line, so it stays out of shell
   history):

   ```sh
   set -a; . /path/outside/the/repo/drm-test.env; set +a
   SHAKA_PACKAGER=/tmp/shaka-packager/package/bin/packager-osx-arm64 node scripts/drm/package-test-asset.mjs
   ```

   It prints the key ID (not secret: it is in the manifests) and the files it wrote. `FFMPEG=/path/to/ffmpeg` picks
   another ffmpeg.

4. Commit `apps/web/public/drm-test/`. If the key changed, update `DRM_TEST_KEY_ID` and `DRM_TEST_CONTENT_KEY` in
   Vercel at the same time: a clip and a key that don't match fail with a license or decode error on the page.

## Checking a clip without a browser

```sh
cat apps/web/public/drm-test/video/init.mp4 apps/web/public/drm-test/video/1.m4s > /tmp/clip.mp4
ffmpeg -i /tmp/clip.mp4 -frames:v 1 /tmp/no-key.png                                    # grey or garbage
ffmpeg -decryption_key "$DRM_TEST_CONTENT_KEY" -i /tmp/clip.mp4 -frames:v 1 /tmp/key.png  # the chart
```
