#!/usr/bin/env node
// Build step for the DRM test page (spike; D158; ADR 0032). Runs before `next build`.
//
// Only when DRM_TEST_PAGE_ENABLED is "true", outside Vercel Production, and DRM_TEST_KEY_ID and DRM_TEST_CONTENT_KEY
// are both set, it encrypts the clear test clip (assets/drm-test/clear.mp4: a synthetic color chart, never served)
// with Shaka Packager 3.9.3 from the pinned npm package, after checking the binary's SHA-256: CMAF, cbcs, raw key,
// clear lead 0 (no frame unencrypted), a DASH manifest and HLS playlists, into public/drm-test/ (git-ignored), served
// at /drm-test/…. Otherwise it writes nothing, and the page says the test isn't set up. Every run first removes what an
// earlier run wrote. The decisions live in lib/drm-test-build.mjs (tested).
//
// The key lives only in the build's environment (Vercel, Preview). The packager gets it as an argument and an
// environment holding PATH alone; it is never printed, and the packager's errors are scrubbed of it.
import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlan,
  GENERATED,
  packagerArgs,
  packagerEnv,
  packagerFileName,
  removeGenerated,
  scrub,
  verifyPackager,
} from "../lib/drm-test-build.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLEAR = join(WEB, "assets", "drm-test", "clear.mp4");
const OUT = join(WEB, "public", "drm-test");

const say = (message) => process.stdout.write(`encrypt-drm-test: ${message}\n`);
function fail(message) {
  console.error(`encrypt-drm-test: ${message}`);
  process.exit(1);
}

removeGenerated(OUT);

let plan;
try {
  plan = buildPlan(process.env);
} catch (err) {
  fail(err instanceof Error ? err.message : "the DRM test settings are malformed");
}
if (plan.action === "skip") {
  say(
    {
      disabled: "DRM_TEST_PAGE_ENABLED isn't true: nothing to do.",
      production: "refused in Vercel Production: the DRM test runs on Preview deployments only.",
      missingKeys:
        "DRM_TEST_KEY_ID or DRM_TEST_CONTENT_KEY isn't set: no protected clip; the page will say it isn't set up.",
    }[plan.reason],
  );
  process.exit(0);
}
if (!existsSync(CLEAR)) fail("assets/drm-test/clear.mp4 is missing (scripts/drm/README.md)");

const name = packagerFileName(platform(), arch());
if (!name) fail(`no Shaka Packager binary for ${platform()} ${arch()}`);
const binary = join(
  dirname(createRequire(import.meta.url).resolve("shaka-packager/package.json")),
  "bin",
  name,
);
if (!existsSync(binary)) fail(`Shaka Packager binary missing: ${name}`);
try {
  verifyPackager(name, readFileSync(binary));
} catch (err) {
  fail(err instanceof Error ? err.message : "Shaka Packager failed its checksum");
}
try {
  accessSync(binary, constants.X_OK);
} catch {
  chmodSync(binary, 0o755);
}

mkdirSync(join(OUT, "video"), { recursive: true });
try {
  execFileSync(binary, packagerArgs({ clear: CLEAR, out: OUT, ...plan }), {
    env: packagerEnv(process.env),
    stdio: ["ignore", "ignore", "pipe"],
  });
} catch (err) {
  removeGenerated(OUT);
  const details = scrub(err?.stderr, [plan.contentKeyHex, process.env.DRM_TEST_CONTENT_KEY ?? ""]);
  fail(`Shaka Packager failed: ${details.trim() || "no details"}`);
}
say(`wrote ${GENERATED.join(", ")} to public/drm-test/ (DASH and HLS, cbcs, no clear lead).`);
