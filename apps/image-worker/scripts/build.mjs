// Builds the image worker's Lambda (ADR 0016).
//
//   pnpm --filter @daybell/image-worker build      bundles src/handler.ts into dist/lib/index.mjs (offline, quick)
//   pnpm --filter @daybell/image-worker package    also installs sharp for Lambda (Linux, arm64) and zips dist into
//                                                  image-worker.zip, the file the deploy workflow uploads
//
// Layout of the zip (handler "lib/index.handler"):
//   lib/index.mjs                    the bundle (our code, @daybell/*, the AWS SDK, exif-reader, zxing-wasm's JS)
//   lib/zxing_reader.wasm            zxing-wasm's QR reader (ADR 0018), read from disk next to the bundle, never fetched
//   assets/PlusJakartaSans-Bold.ttf  the watermark font, found at ../assets from lib/ as in the source tree
//   node_modules/sharp, @img/*       sharp and libvips for linux-arm64, from lambda/package-lock.json
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const dist = join(app, "dist");
const pipeline = join(app, "..", "..", "packages", "image-pipeline");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "lib"), { recursive: true });

await build({
  entryPoints: [join(app, "src", "handler.ts")],
  outfile: join(dist, "lib", "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // sharp loads a native library: it ships next to the bundle, never inside it.
  external: ["sharp"],
  // Some bundled CommonJS packages call require(); ESM has none unless it is made.
  banner: {
    // Aliased, so it never clashes with a bundled module's own import of createRequire (the QR reader has one).
    js: "import { createRequire as __daybellRequire } from 'node:module'; const require = __daybellRequire(import.meta.url);",
  },
  legalComments: "external",
  logLevel: "warning",
});
cpSync(join(pipeline, "assets"), join(dist, "assets"), { recursive: true });

// zxing-wasm's reader (ADR 0018), pinned in the pipeline at 3.1.4. Its checksum is pinned here too, so a changed file
// is noticed before it ships; the package states the same checksum for itself. packages/image-pipeline/src/qr.ts pins
// the same value and checks it again every time the Lambda loads the file (qr.test.ts keeps the two equal).
const ZXING_READER_SHA256 = "e8af31edb56d0522f4de74495839385ef019ba8bc90d38e5ecb2f18795d86fb2";
const fromPipeline = createRequire(join(pipeline, "package.json"));
const wasm = fromPipeline.resolve("zxing-wasm/reader/zxing_reader.wasm");
const wasmSha = createHash("sha256").update(readFileSync(wasm)).digest("hex");
const { ZXING_WASM_SHA256 } = await import(
  pathToFileURL(fromPipeline.resolve("zxing-wasm/reader")).href
);
if (wasmSha !== ZXING_READER_SHA256 || wasmSha !== ZXING_WASM_SHA256)
  throw new Error("zxing_reader.wasm doesn't match its pinned SHA-256");
cpSync(wasm, join(dist, "lib", "zxing_reader.wasm"));

// The bundle reads QR cards with the wasm file next to it, offline: nothing is fetched.
execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `const m = await import(${JSON.stringify(pathToFileURL(join(dist, "lib", "index.mjs")).href)});
     if ((await m.qrSelfCheck()) !== 0) throw new Error("QR self-check");`,
  ],
  { stdio: "inherit" },
);

if (process.argv.includes("--package")) {
  // sharp for Lambda (Linux, arm64), from the committed lockfile: exact versions, integrity checked by npm ci, and no
  // install scripts run (sharp's prebuilt @img packages need none).
  for (const file of ["package.json", "package-lock.json"])
    cpSync(join(app, "lambda", file), join(dist, file));
  const pinned = JSON.parse(readFileSync(join(pipeline, "package.json"), "utf8")).dependencies
    .sharp;
  const locked = JSON.parse(readFileSync(join(dist, "package-lock.json"), "utf8")).packages[
    "node_modules/sharp"
  ];
  if (locked?.version !== pinned)
    throw new Error("lambda/package-lock.json must pin the same sharp as the pipeline");
  execFileSync(
    "npm",
    [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--os=linux",
      "--cpu=arm64",
      "--libc=glibc",
    ],
    { cwd: dist, stdio: "inherit" },
  );
  // The native parts must be there, since no install script fetched or built them.
  const img = join(dist, "node_modules", "@img");
  const files = (dir) =>
    existsSync(join(img, dir, "lib")) ? readdirSync(join(img, dir, "lib")) : [];
  const native = files("sharp-linux-arm64").filter((f) => f.endsWith(".node"));
  const vips = files("sharp-libvips-linux-arm64").filter((f) => f.startsWith("libvips-cpp.so"));
  if (native.length === 0 || vips.length === 0)
    throw new Error("sharp's Linux arm64 binaries are missing");
  rmSync(join(app, "image-worker.zip"), { force: true });
  execFileSync("zip", ["-qr", join(app, "image-worker.zip"), "."], { cwd: dist, stdio: "inherit" });
  process.stdout.write("image-worker.zip ready\n");
}
