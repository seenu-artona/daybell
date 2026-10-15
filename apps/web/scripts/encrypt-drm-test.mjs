#!/usr/bin/env node
// Build step for the DRM test page (spike; D158; ADR 0032). Runs before `next build`.
//
// Only when DRM_TEST_PAGE_ENABLED is "true" and DRM_TEST_KEY_ID and DRM_TEST_CONTENT_KEY are both set, it encrypts the
// clear test clip (assets/drm-test/clear.mp4: a synthetic colour chart, never served) with Shaka Packager 3.9.3 from
// the pinned npm package: CMAF, cbcs, raw key, clear lead 0 (no frame unencrypted), a DASH manifest and HLS
// playlists. The output goes to public/drm-test/ (git-ignored), served at /drm-test/…. Otherwise it writes nothing,
// and the page says the test isn't set up.
//
// The key lives only in the build's environment (Vercel). It is passed to the packager and never printed; the
// packager's own output is silenced below its warnings. A malformed key fails the build, naming the variable only.
import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLEAR = join(WEB, "assets", "drm-test", "clear.mp4");
const OUT = join(WEB, "public", "drm-test");
/** What this step writes; fallback.jpg beside them is committed and left alone. */
const GENERATED = ["manifest.mpd", "master.m3u8", "video.m3u8", "video"];
/** The clip's length in seconds: one segment. */
const SEGMENT_SECONDS = 2;

const say = (message) => process.stdout.write(`encrypt-drm-test: ${message}\n`);
function fail(message) {
  console.error(`encrypt-drm-test: ${message}`);
  process.exit(1);
}

/** 32 lowercase hex digits from a GUID or hex value, or a build failure naming the variable (never the value). */
function hex16(name, value) {
  const hex = value.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex))
    fail(`${name} must be 16 bytes as 32 hex digits (a GUID for the key ID)`);
  return hex;
}

const guid = (hex) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** The packager binary for this machine, from the shaka-packager package's bin folder. */
function packagerBinary() {
  const pkg = dirname(createRequire(import.meta.url).resolve("shaka-packager/package.json"));
  const os = { linux: "linux", darwin: "osx", win32: "win" }[platform()];
  const cpu = { x64: "x64", arm64: "arm64" }[arch()];
  if (!os || !cpu) fail(`no Shaka Packager binary for ${platform()} ${arch()}`);
  const bin = join(pkg, "bin", `packager-${os}-${cpu}${os === "win" ? ".exe" : ""}`);
  if (!existsSync(bin)) fail(`Shaka Packager binary missing: ${bin}`);
  try {
    accessSync(bin, constants.X_OK);
  } catch {
    chmodSync(bin, 0o755);
  }
  return bin;
}

// Never leave a clip from an earlier build (or an earlier key) behind.
for (const name of GENERATED) rmSync(join(OUT, name), { recursive: true, force: true });

const enabled = process.env.DRM_TEST_PAGE_ENABLED?.trim() === "true";
const rawKeyId = process.env.DRM_TEST_KEY_ID?.trim() ?? "";
const rawContentKey = process.env.DRM_TEST_CONTENT_KEY?.trim() ?? "";
if (!enabled) {
  say("DRM_TEST_PAGE_ENABLED isn't true: nothing to do.");
  process.exit(0);
}
if (!rawKeyId || !rawContentKey) {
  say(
    "DRM_TEST_KEY_ID or DRM_TEST_CONTENT_KEY isn't set: no protected clip; the page will say it isn't set up.",
  );
  process.exit(0);
}
const keyId = hex16("DRM_TEST_KEY_ID", rawKeyId);
const contentKey = hex16("DRM_TEST_CONTENT_KEY", rawContentKey);
if (keyId === contentKey) fail("DRM_TEST_CONTENT_KEY must be different from DRM_TEST_KEY_ID");
if (!existsSync(CLEAR)) fail("assets/drm-test/clear.mp4 is missing (scripts/drm/README.md)");

/** The packager's own words, with both key values taken out, so a failure never prints the key. */
function scrub(text) {
  let out = String(text ?? "");
  for (const secret of [contentKey, guid(contentKey), rawContentKey])
    out = out.replace(new RegExp(secret.replaceAll("-", "-?"), "gi"), "<redacted>");
  return out;
}

mkdirSync(join(OUT, "video"), { recursive: true });
const args = [
  `in=${CLEAR},stream=video,init_segment=${join(OUT, "video", "init.mp4")},segment_template=${join(OUT, "video", "$Number$.m4s")},playlist_name=video.m3u8`,
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
  String(SEGMENT_SECONDS),
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
];
try {
  execFileSync(packagerBinary(), args, { stdio: ["ignore", "ignore", "pipe"] });
} catch (err) {
  for (const name of GENERATED) rmSync(join(OUT, name), { recursive: true, force: true });
  fail(`Shaka Packager failed: ${scrub(err?.stderr).trim() || "no details"}`);
}
say("wrote the encrypted test clip to public/drm-test/ (DASH and HLS, cbcs, no clear lead).");
