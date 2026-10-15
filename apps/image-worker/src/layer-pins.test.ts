import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DRM_BINARY_SHA256 } from "@daybell/image-pipeline";
import { describe, expect, it } from "vitest";
import {
  FFMPEG_FILES,
  FFMPEG_RELEASE,
  LAMBDA_UNZIPPED_LIMIT,
  PACKAGER_FILES,
} from "../layer/build-layer.mjs";

// The DRM tools layer (ADR 0034): what the layer build downloads and copies is exactly what the worker checks before
// running it, for both architectures, and the build reads only pinned files.
describe("the DRM tools layer's pins", () => {
  it("are the pipeline's, for Lambda's arm64 and CI's x64", () => {
    expect(FFMPEG_FILES.arm64.binary).toBe(DRM_BINARY_SHA256.ffmpeg["linux-arm64"]);
    expect(FFMPEG_FILES.x64.binary).toBe(DRM_BINARY_SHA256.ffmpeg["linux-x64"]);
    expect(PACKAGER_FILES.arm64.sha256).toBe(DRM_BINARY_SHA256.packager["linux-arm64"]);
    expect(PACKAGER_FILES.x64.sha256).toBe(DRM_BINARY_SHA256.packager["linux-x64"]);
  });

  it("are the spike's for Shaka Packager 3.9.3 (ADR 0032)", () => {
    const spike = readFileSync(join(__dirname, "../../web/lib/drm-test-build.mjs"), "utf8");
    expect(spike).toContain(`"packager-linux-arm64": "${PACKAGER_FILES.arm64.sha256}"`);
    expect(spike).toContain(`"packager-linux-x64": "${PACKAGER_FILES.x64.sha256}"`);
  });

  it("downloads from one tagged release over HTTPS, every file with a SHA-256", () => {
    expect(FFMPEG_RELEASE).toBe(
      "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1",
    );
    const pinned = [
      FFMPEG_FILES.arm64.gz,
      FFMPEG_FILES.arm64.license,
      FFMPEG_FILES.arm64.readme,
      FFMPEG_FILES.x64.gz,
    ];
    for (const file of pinned) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(LAMBDA_UNZIPPED_LIMIT).toBe(250 * 1024 * 1024);
  });

  it("matches the shaka-packager version the worker installs", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
    expect(pkg.devDependencies["shaka-packager"]).toBe("3.9.3");
    expect(pkg.dependencies["@aws-sdk/client-kms"]).toBe(pkg.dependencies["@aws-sdk/client-s3"]);
  });
});
