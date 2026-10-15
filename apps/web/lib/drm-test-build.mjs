// The DRM test clip's build step, its decisions only (spike; D158; ADR 0032). Plain JavaScript so the build runs it
// with Node alone; tested in drm-test-build.test.ts; used by scripts/encrypt-drm-test.mjs. Types: drm-test-build.d.mts.
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";

/** What the step writes into public/drm-test/; the committed fallback.jpg beside them is never touched. */
export const GENERATED = ["manifest.mpd", "master.m3u8", "video.m3u8", "video"];

/** The clip's length in seconds: one segment. */
export const SEGMENT_SECONDS = 2;

/**
 * SHA-256 of each Shaka Packager 3.9.3 binary in the npm package `shaka-packager@3.9.3`, whose tarball matched npm's
 * published integrity (sha512-+kNjs9r5…UcQ==). The build refuses any other file. To move to a new version: pin it in
 * package.json, check the tarball against npm's integrity, then `sha256sum node_modules/shaka-packager/bin/*` and
 * replace these (scripts/drm/README.md).
 */
export const PACKAGER_SHA256 = {
  "packager-linux-x64": "7a3cf35ad146fd7810b4ededab363c8a3e6121d1b2c8391f53863126186f9ee6",
  "packager-linux-arm64": "d3a50cecc139b54435be1bbbfba5c0ea822d9e1e7edc3531f7821fba65ceebb0",
  "packager-osx-x64": "64f0fece6a5f80603d9f19b3adc70e626303feb63b459fd599132632b8e76420",
  "packager-osx-arm64": "b3049e743451aab5c2cd7b1316a4ce055682c41effe06a49e2e6c95a9243d351",
  "packager-win-x64.exe": "ef9cdc9f09cd86321f995c4a6b8dcaf96bcc853707caaf304cb9a0e76f6d68f6",
};

/** The same GUID rule as packages/config's drmTestSettings: dashes optional, any case. */
const GUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A GUID as lowercase with dashes; an error naming the variable (never the value) otherwise. */
export function guidSetting(name, value) {
  const text = (value ?? "").trim();
  if (!text) throw new Error(`${name} is not set`);
  if (!GUID.test(text)) throw new Error(`${name} must be a GUID`);
  const hex = text.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * What the build should do. Skips (writes nothing) when the flag isn't "true", in Vercel Production (the test runs
 * on Preview deployments only, like drmTestPageEnabled), or when either key is unset. A key that is set but malformed
 * throws, naming the variable only, so the build fails rather than publishing a page that can't work.
 */
export function buildPlan(env) {
  if (env.DRM_TEST_PAGE_ENABLED?.trim() !== "true") return { action: "skip", reason: "disabled" };
  if (env.VERCEL_ENV === "production") return { action: "skip", reason: "production" };
  const rawKeyId = env.DRM_TEST_KEY_ID?.trim() ?? "";
  const rawContentKey = env.DRM_TEST_CONTENT_KEY?.trim() ?? "";
  if (!rawKeyId || !rawContentKey) return { action: "skip", reason: "missingKeys" };
  const keyId = guidSetting("DRM_TEST_KEY_ID", rawKeyId);
  const contentKeyHex = rawContentKey.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(contentKeyHex))
    throw new Error("DRM_TEST_CONTENT_KEY must be 16 bytes as 32 hex digits");
  const keyIdHex = keyId.replaceAll("-", "");
  if (contentKeyHex === keyIdHex)
    throw new Error("DRM_TEST_CONTENT_KEY must be different from DRM_TEST_KEY_ID");
  return { action: "encrypt", keyId, keyIdHex, contentKeyHex };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Text with every form of each secret taken out: hex (any case, with or without GUID dashes), base64 and base64url
 * (with or without padding) of its bytes, and the text as given. For the packager's error output, before printing.
 */
export function scrub(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (!secret) continue;
    const forms = new Set([secret]);
    const hex = secret.replaceAll("-", "").toLowerCase();
    if (/^[0-9a-f]+$/.test(hex) && hex.length % 2 === 0) {
      const bytes = Buffer.from(hex, "hex");
      forms.add(bytes.toString("base64"));
      forms.add(bytes.toString("base64").replace(/=+$/, ""));
      forms.add(bytes.toString("base64url"));
      out = out.replace(new RegExp(hex.split("").join("-?"), "gi"), "<redacted>");
    }
    for (const form of [...forms].sort((a, b) => b.length - a.length))
      if (form) out = out.replace(new RegExp(escapeRegExp(form), "g"), "<redacted>");
  }
  return out;
}

/** Removes what an earlier build wrote (never the fallback), so no clip from another key or setting is left. */
export function removeGenerated(
  outDir,
  remove = (path) => rmSync(path, { recursive: true, force: true }),
) {
  for (const name of GENERATED) remove(join(outDir, name));
}

/** The binary's file name for a platform and CPU, or null when the package has none. */
export function packagerFileName(platform, arch) {
  const os = { linux: "linux", darwin: "osx", win32: "win" }[platform];
  const cpu = { x64: "x64", arm64: "arm64" }[arch];
  if (!os || !cpu) return null;
  const name = `packager-${os}-${cpu}${os === "win" ? ".exe" : ""}`;
  return name in PACKAGER_SHA256 ? name : null;
}

/** Throws unless the binary's bytes are exactly the pinned release. */
export function verifyPackager(name, bytes) {
  const expected = PACKAGER_SHA256[name];
  if (!expected) throw new Error(`no pinned SHA-256 for ${name}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected)
    throw new Error(
      `${name} doesn't match the pinned Shaka Packager 3.9.3 (SHA-256 ${actual}); refusing to run it`,
    );
}

/** The packager's environment: PATH only, so no other build secret is ever visible to it. */
export function packagerEnv(env) {
  return { PATH: env.PATH ?? "" };
}

/**
 * The clip's constant cbcs IV, as hex: the key ID's own 16 bytes. FairPlay's license must carry the IV with the key
 * (Axinom refuses an inline key without one: "An initialization vector must be provided with every key"), so it has to
 * be known rather than random. An IV isn't secret (it is in the clip's tenc box and the HLS playlist), and deriving it
 * from the key ID means no extra setting. lib/drm-test.ts sends the same bytes in the token (a test checks both agree).
 */
export function drmTestIvHex(keyIdHex) {
  return keyIdHex.toLowerCase();
}

/** Shaka Packager's arguments: CMAF cbcs, raw key with its IV, no clear lead, a static DASH manifest and VOD HLS. */
export function packagerArgs({ clear, out, keyId, keyIdHex, contentKeyHex }) {
  return [
    `in=${clear},stream=video,init_segment=${join(out, "video", "init.mp4")},segment_template=${join(out, "video", "$Number$.m4s")},playlist_name=video.m3u8`,
    "--protection_scheme",
    "cbcs",
    "--enable_raw_key_encryption",
    "--keys",
    `label=:key_id=${keyIdHex}:key=${contentKeyHex}:iv=${drmTestIvHex(keyIdHex)}`,
    "--protection_systems",
    "Widevine,PlayReady,FairPlay",
    "--hls_key_uri",
    `skd://${keyId}`,
    "--clear_lead",
    "0",
    "--segment_duration",
    String(SEGMENT_SECONDS),
    // A segment template otherwise makes a live ("dynamic") MPD; this clip is on demand.
    "--generate_static_live_mpd",
    "--mpd_output",
    join(out, "manifest.mpd"),
    "--hls_master_playlist_output",
    join(out, "master.m3u8"),
    "--hls_playlist_type",
    "VOD",
    "--v=0",
    "--minloglevel=1",
  ];
}
