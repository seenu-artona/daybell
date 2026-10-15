// Builds the image worker's DRM tools layer (D158; ADR 0034): ffmpeg and Shaka Packager for Lambda (Linux, arm64),
// mounted at /opt/bin. Every file in it is pinned by SHA-256, and the zip is written with fixed times, modes and order.
// The zip's own hash isn't pinned (it depends on the zip tool's version); its contents are. Run in CI (the
// drm-packaging workflow) and by the deploy workflow; no AWS access here.
//
//   node layer/build-layer.mjs                       downloads, checks and zips the arm64 layer: image-worker-drm-layer.zip
//   node layer/build-layer.mjs --tools x64 <dir>     puts the x64 builds of the same versions in <dir>/bin (CI's check)
//
// Layout of the zip (Lambda unpacks it at /opt):
//   bin/ffmpeg                  FFmpeg 7.0.2, static, GPL, with libx264 (johnvansickle.com's build, as published in the
//                               b6.1.1 release of eugeneware/ffmpeg-static)
//   bin/packager                Shaka Packager 3.9.3 (the npm package shaka-packager@3.9.3, integrity-checked by pnpm)
//   licenses/…                  their licences and ffmpeg's build notes (GPL: the licence travels with the binary)
//
// Fails if any file's SHA-256 differs from its pin, or if the layer and the function's zip together would be over
// Lambda's 250 MB unzipped limit.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");

/** The ffmpeg release: a tag of a project that publishes static builds, and every file's SHA-256 (C13: legal check). */
export const FFMPEG_RELEASE =
  "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";
export const FFMPEG_FILES = {
  arm64: {
    gz: {
      name: "ffmpeg-linux-arm64.gz",
      sha256: "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0",
    },
    binary: "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce",
    license: {
      name: "linux-arm64.LICENSE",
      sha256: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
    },
    readme: {
      name: "linux-arm64.README",
      sha256: "d6777d2fd276b23f0ac6666fa619e88ffe4826521881c7ff83836e30cb4acec2",
    },
  },
  x64: {
    gz: {
      name: "ffmpeg-linux-x64.gz",
      sha256: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
    },
    binary: "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
  },
};
/** Shaka Packager 3.9.3's binaries, as in packages/image-pipeline (DRM_BINARY_SHA256) and the spike (ADR 0032). */
/** Shaka Packager's licence file in the same npm package, pinned too (review #16). */
export const PACKAGER_LICENSE_SHA256 =
  "0eea5a66a8505f758fdc8710637c5b4f5f1b18b29d0f248d6e95a3cdfc8fb599";
export const PACKAGER_FILES = {
  arm64: {
    name: "packager-linux-arm64",
    sha256: "d3a50cecc139b54435be1bbbfba5c0ea822d9e1e7edc3531f7821fba65ceebb0",
  },
  x64: {
    name: "packager-linux-x64",
    sha256: "7a3cf35ad146fd7810b4ededab363c8a3e6121d1b2c8391f53863126186f9ee6",
  },
};
/** Lambda's limit for a function and its layers, unzipped. */
export const LAMBDA_UNZIPPED_LIMIT = 250 * 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function check(label, bytes, expected) {
  const actual = sha256(bytes);
  if (actual !== expected)
    throw new Error(`${label} doesn't match its pinned SHA-256 (got ${actual}); refusing it`);
  return bytes;
}

async function download(name, expected) {
  const res = await fetch(`${FFMPEG_RELEASE}/${name}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return check(name, Buffer.from(await res.arrayBuffer()), expected);
}

function packagerBinary(arch) {
  const pkg = createRequire(join(app, "package.json")).resolve("shaka-packager/package.json");
  const file = join(dirname(pkg), "bin", PACKAGER_FILES[arch].name);
  return {
    bytes: check(PACKAGER_FILES[arch].name, readFileSync(file), PACKAGER_FILES[arch].sha256),
    license: check(
      "shaka-packager LICENSE",
      readFileSync(join(dirname(pkg), "LICENSE")),
      PACKAGER_LICENSE_SHA256,
    ),
  };
}

/** Puts ffmpeg and the packager for `arch` in `<out>/bin`, checked; returns their paths. */
export async function tools(arch, out) {
  const ff = FFMPEG_FILES[arch];
  const ffmpeg = check(
    `ffmpeg (${arch})`,
    gunzipSync(await download(ff.gz.name, ff.gz.sha256)),
    ff.binary,
  );
  const packager = packagerBinary(arch);
  mkdirSync(join(out, "bin"), { recursive: true });
  writeFileSync(join(out, "bin", "ffmpeg"), ffmpeg, { mode: 0o755 });
  writeFileSync(join(out, "bin", "packager"), packager.bytes, { mode: 0o755 });
  return {
    ffmpeg: join(out, "bin", "ffmpeg"),
    packager: join(out, "bin", "packager"),
    packagerLicense: packager.license,
  };
}

function sizeOf(dir) {
  return readdirSync(dir, { recursive: true })
    .map((f) => join(dir, String(f)))
    .filter((f) => statSync(f).isFile())
    .reduce((sum, f) => sum + statSync(f).size, 0);
}

async function layer() {
  const out = join(app, "dist-layer");
  rmSync(out, { recursive: true, force: true });
  const { packagerLicense } = await tools("arm64", out);
  const licenses = join(out, "licenses");
  mkdirSync(licenses, { recursive: true });
  const ff = FFMPEG_FILES.arm64;
  writeFileSync(
    join(licenses, "FFMPEG-LICENSE-GPL-3.0.txt"),
    await download(ff.license.name, ff.license.sha256),
  );
  writeFileSync(
    join(licenses, "FFMPEG-BUILD-README.txt"),
    await download(ff.readme.name, ff.readme.sha256),
  );
  writeFileSync(join(licenses, "SHAKA-PACKAGER-LICENSE.txt"), packagerLicense);
  cpSync(join(here, "NOTICE.md"), join(licenses, "NOTICE.md"));

  // Reproducible: fixed modes and times (1 Jan 2000), files in sorted order, no extra attributes.
  const files = readdirSync(out, { recursive: true })
    .map((f) => String(f))
    .filter((f) => statSync(join(out, f)).isFile())
    .sort();
  const fixed = new Date("2000-01-01T00:00:00Z");
  for (const f of files) {
    chmodSync(join(out, f), f.startsWith("bin/") ? 0o755 : 0o644);
    utimesSync(join(out, f), fixed, fixed);
  }
  const unzipped = sizeOf(out);
  const functionDir = join(app, "dist");
  const functionSize = existsSync(join(functionDir, "node_modules")) ? sizeOf(functionDir) : 0;
  if (unzipped + functionSize > LAMBDA_UNZIPPED_LIMIT)
    throw new Error(
      `the layer (${unzipped} bytes) and the function (${functionSize} bytes) are over Lambda's 250 MB unzipped`,
    );
  const zip = join(app, "image-worker-drm-layer.zip");
  rmSync(zip, { force: true });
  execFileSync("zip", ["-X", "-q", "-D", zip, ...files], {
    cwd: out,
    stdio: "inherit",
    env: { PATH: process.env.PATH ?? "", TZ: "UTC" },
  });
  process.stdout.write(
    `${relative(process.cwd(), zip)} ready: ${unzipped} bytes unzipped${functionSize ? ` (+ ${functionSize} for the function)` : ""}, SHA-256 ${sha256(readFileSync(zip))}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [flag, arch, out] = process.argv.slice(2);
  if (flag === "--tools") {
    if (!(arch in FFMPEG_FILES) || !out)
      throw new Error("usage: build-layer.mjs --tools <arm64|x64> <dir>");
    const made = await tools(arch, out);
    process.stdout.write(`${made.ffmpeg}\n${made.packager}\n`);
  } else {
    await layer();
  }
}
