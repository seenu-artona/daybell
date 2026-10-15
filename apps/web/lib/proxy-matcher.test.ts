import { describe, expect, it, vi } from "vitest";

// Which paths run the proxy's session check. The matcher's pattern is read as a regular expression over the path, the
// way Next.js applies it.
vi.mock("@daybell/config", async (original) => ({
  ...(await original<typeof import("@daybell/config")>()),
  regionDatabase: () => null,
}));
const { config } = await import("../proxy");

const runs = (path: string) =>
  config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));

describe("proxy matcher", () => {
  it("skips the DRM test page's static clip and fallback (ADR 0032)", () => {
    for (const path of [
      "/drm-test/manifest.mpd",
      "/drm-test/master.m3u8",
      "/drm-test/video.m3u8",
      "/drm-test/video/init.mp4",
      "/drm-test/video/1.m4s",
      "/drm-test/fallback.jpg",
    ])
      expect(runs(path), path).toBe(false);
  });

  it("still runs for pages, the DRM test page itself included", () => {
    for (const path of ["/app", "/app/jobs", "/dev/drm-test", "/sign-in", "/shop"])
      expect(runs(path), path).toBe(true);
  });

  it("still skips what it skipped before", () => {
    for (const path of ["/_next/static/x.js", "/api/v1/me", "/favicon.ico", "/brand/logo.svg"])
      expect(runs(path), path).toBe(false);
  });
});
