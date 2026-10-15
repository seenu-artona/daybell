#!/usr/bin/env node
// Makes the DRM test page's clear picture (D158; ADR 0032). See scripts/drm/README.md. No key is involved here.
//
// 1. Draws a synthetic test chart (SMPTE colour bars, the words "DRM TEST"): never a real photo, never a child.
// 2. Encodes it as a 2-frame, all-intra (every frame a keyframe) 1600 px H.264 clip:
//    apps/web/assets/drm-test/clear.mp4. Outside public/, so it is never served; the web app's build encrypts it
//    (apps/web/scripts/encrypt-drm-test.mjs) and publishes only the encrypted copy.
// 3. Makes the fallback, the same chart as a watermarked JPEG: apps/web/public/drm-test/fallback.jpg.
//
// Usage (from the repo root; needs ffmpeg with libx264 and drawtext): node scripts/drm/make-test-chart.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLEAR = join(ROOT, "apps", "web", "assets", "drm-test", "clear.mp4");
const FALLBACK = join(ROOT, "apps", "web", "public", "drm-test", "fallback.jpg");
const FONT = join(ROOT, "apps", "web", "assets", "fonts", "PlusJakartaSans-Bold.ttf");
/** 3:2, 1600 px on the long side, like a parent's large view (D158). Even sizes for H.264 4:2:0. */
const WIDTH = 1600;
const HEIGHT = 1066;
/** Two frames at 1 frame a second: one 2-second segment. */
const FRAMES = 2;

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

mkdirSync(dirname(CLEAR), { recursive: true });
mkdirSync(dirname(FALLBACK), { recursive: true });
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
    CLEAR,
  ],
  { stdio: "inherit" },
);

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
    FALLBACK,
  ],
  { stdio: "inherit" },
);

process.stdout.write(
  "Wrote apps/web/assets/drm-test/clear.mp4 and apps/web/public/drm-test/fallback.jpg\n",
);
