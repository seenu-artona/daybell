#!/usr/bin/env node
// Packages the DRM test clip for /dev/drm-test (D158; ADR 0032). See scripts/drm/README.md.
//
// 1. Draws a synthetic test chart (SMPTE colour bars, the words "DRM TEST"): never a real photo, never a child.
// 2. Encodes it as a 2-frame, all-intra (every frame a keyframe) 1600 px H.264 clip with ffmpeg.
// 3. Encrypts it with Shaka Packager: CMAF, cbcs, the test key from DRM_TEST_KEY_ID and DRM_TEST_CONTENT_KEY, clear
//    lead 0 (nothing ships unencrypted), with a DASH manifest (Widevine, PlayReady) and HLS playlists (FairPlay).
// 4. Makes the fallback: the same chart as a watermarked JPEG, for devices without hardware DRM.
//
// Writes apps/web/public/drm-test/ (replacing it). Only encrypted segments, manifests and the watermarked fallback
// land there; the clear clip stays in a temporary folder that is deleted. The key is read from the environment and
// never printed.
//
// Usage (from the repo root):
//   SHAKA_PACKAGER=/path/to/packager-linux-x64 DRM_TEST_KEY_ID=… DRM_TEST_CONTENT_KEY=… \
//     node scripts/drm/package-test-asset.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "apps", "web", "public", "drm-test");
const FONT = join(ROOT, "apps", "web", "assets", "fonts", "PlusJakartaSans-Bold.ttf");
/** 3:2, 1600 px on the long side, like a parent's large view (D158). Even sizes for H.264 4:2:0. */
const WIDTH = 1600;
const HEIGHT = 1066;
/** Two frames at 1 frame a second: one 2-second segment. */
const FRAMES = 2;

function fail(message) {
  console.error(`package-test-asset: ${message}`);
  process.exit(1);
}

/** "0123…" or "01234567-89ab-…" → 32 lowercase hex digits. Names the variable on error, never the value. */
function hex16(name) {
  const raw = (process.env[name] ?? "").trim().replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(raw))
    fail(`${name} must be 16 bytes as 32 hex digits (a GUID for the key ID)`);
  return raw;
}

function guid(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const keyId = hex16("DRM_TEST_KEY_ID");
const contentKey = hex16("DRM_TEST_CONTENT_KEY");
if (keyId === contentKey) fail("DRM_TEST_KEY_ID and DRM_TEST_CONTENT_KEY must be different");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: a local tool path for this script, not an input of any turbo task.
const packager = (process.env.SHAKA_PACKAGER ?? "").trim();
if (!packager)
  fail("SHAKA_PACKAGER must be the path to the Shaka Packager 3.9.3 binary (see README.md)");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: a local tool path for this script, not an input of any turbo task.
const ffmpeg = (process.env.FFMPEG ?? "ffmpeg").trim();

// Text for ffmpeg's drawtext: the font file path needs ':' and '\' escaped inside the filter graph.
const font = FONT.replaceAll("\\", "/").replaceAll(":", "\\:");
const chart = [
  `smptehdbars=s=${WIDTH}x${HEIGHT}:r=1:d=${FRAMES}`,
  `drawtext=fontfile='${font}':text='DRM TEST':fontsize=220:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=48:x=(w-tw)/2:y=(h-th)/2-60`,
  `drawtext=fontfile='${font}':text='Synthetic test chart':fontsize=56:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=20:x=(w-tw)/2:y=(h/2)+150`,
].join(",");
// The fallback's watermark: about 30% white text with a soft shadow, repeated, like the shop's proofs (D60).
const watermark = Array.from({ length: 5 }, (_, row) => {
  const y = Math.round((HEIGHT / 5) * row + HEIGHT / 10);
  return `drawtext=fontfile='${font}':text='PROOF   PROOF   PROOF   PROOF':fontsize=72:fontcolor=white@0.3:shadowcolor=black@0.3:shadowx=2:shadowy=2:x=(w-tw)/2+${row % 2 ? 120 : -120}:y=${y}`;
}).join(",");

const work = mkdtempSync(join(tmpdir(), "drm-test-"));
try {
  const clear = join(work, "clear.mp4");
  // All-intra H.264 High, level 4.0, no audio, no B-frames, no scene-cut logic: each frame decodes on its own.
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      chart,
      "-frames:v",
      String(FRAMES),
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-level:v",
      "4.0",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "1",
      "-bf",
      "0",
      "-x264-params",
      "keyint=1:min-keyint=1:scenecut=0",
      "-crf",
      "16",
      // Tagged BT.709, so every player shows the chart's colours the same way.
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-an",
      "-map_metadata",
      "-1",
      clear,
    ],
    { stdio: "inherit" },
  );

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "video"), { recursive: true });

  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `${chart},${watermark}`,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      "-map_metadata",
      "-1",
      join(OUT, "fallback.jpg"),
    ],
    { stdio: "inherit" },
  );

  // Raw-key encryption: Axinom's direct-key model (D158) needs no key server at packaging time. The key arguments go
  // to the packager only; its own output is silenced below its warnings so nothing echoes them.
  execFileSync(
    packager,
    [
      `in=${clear},stream=video,init_segment=${join(OUT, "video", "init.mp4")},segment_template=${join(OUT, "video", "$Number$.m4s")},playlist_name=video.m3u8`,
      "--protection_scheme",
      "cbcs",
      "--enable_raw_key_encryption",
      "--keys",
      `label=:key_id=${keyId}:key=${contentKey}`,
      "--protection_systems",
      "Widevine,PlayReady,FairPlay",
      "--hls_key_uri",
      `skd://${guid(keyId)}`,
      "--clear_lead",
      "0",
      "--segment_duration",
      String(FRAMES),
      // A segment template otherwise makes a live ("dynamic") MPD; this clip is on demand.
      "--generate_static_live_mpd",
      "--mpd_output",
      join(OUT, "manifest.mpd"),
      "--hls_master_playlist_output",
      join(OUT, "master.m3u8"),
      "--hls_playlist_type",
      "VOD",
      "--v=0",
      "--minloglevel=1",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );

  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(`${relative(ROOT, full)} (${statSync(full).size} bytes)`);
    }
  };
  walk(OUT);
  process.stdout.write(`Wrote, for key ID ${guid(keyId)}:\n  ${files.sort().join("\n  ")}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
