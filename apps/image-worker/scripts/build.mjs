// Builds the image worker's Lambda (ADR 0016).
//
//   pnpm --filter @daybell/image-worker build      bundles src/handler.ts into dist/lib/index.mjs (offline, quick)
//   pnpm --filter @daybell/image-worker package    also installs sharp for Lambda (Linux, arm64) and zips dist into
//                                                  image-worker.zip, the file the deploy workflow uploads
//
// Layout of the zip (handler "lib/index.handler"):
//   lib/index.mjs                    the bundle (our code, @daybell/*, the AWS SDK, exif-reader)
//   assets/PlusJakartaSans-Bold.ttf  the watermark font, found at ../assets from lib/ as in the source tree
//   node_modules/sharp, @img/*       sharp and libvips for linux-arm64, exactly the version the repo pins
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  legalComments: "external",
  logLevel: "warning",
});
cpSync(join(pipeline, "assets"), join(dist, "assets"), { recursive: true });

if (process.argv.includes("--package")) {
  const sharpVersion = JSON.parse(readFileSync(join(pipeline, "package.json"), "utf8")).dependencies
    .sharp;
  writeFileSync(
    join(dist, "package.json"),
    `${JSON.stringify({ name: "daybell-image-worker", private: true, type: "module", dependencies: { sharp: sharpVersion } }, null, 2)}\n`,
  );
  // Dependencies must be at least two weeks old (CLAUDE.md): sharp is pinned, and npm resolves its few ranged
  // dependencies as they were 14 days ago.
  const before = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  execFileSync(
    "npm",
    [
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--os=linux",
      "--cpu=arm64",
      "--libc=glibc",
      `--before=${before}`,
    ],
    { cwd: dist, stdio: "inherit" },
  );
  rmSync(join(app, "image-worker.zip"), { force: true });
  execFileSync("zip", ["-qr", join(app, "image-worker.zip"), "."], { cwd: dist, stdio: "inherit" });
  process.stdout.write("image-worker.zip ready\n");
}
