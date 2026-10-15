import { describe, expect, it, vi } from "vitest";
import {
  DRM_PROBES,
  playbackPlan,
  probeConfig,
  probeDrm,
  TEST_CLIP_CODEC,
} from "./drm-capabilities";

// The DRM test page's capability panel (D158; ADR 0032).
describe("probeDrm", () => {
  it("asks for each key system and robustness with the clip's format", async () => {
    const request = vi.fn(async (keySystem: string, configs: MediaKeySystemConfiguration[]) => {
      const robustness = configs[0]?.videoCapabilities?.[0]?.robustness;
      if (keySystem === "com.widevine.alpha" && robustness === "SW_SECURE_DECODE") return {};
      throw new DOMException("no", "NotSupportedError");
    });
    const results = await probeDrm(request);
    expect(request).toHaveBeenCalledTimes(DRM_PROBES.length);
    expect(results).toEqual({
      widevineHwAll: "notSupported",
      widevineHwDecode: "notSupported",
      widevineSwDecode: "supported",
      playready3000: "notSupported",
      playready2000: "notSupported",
      playready3000KeySystem: "notSupported",
      fairplay: "notSupported",
    });
  });

  it("says when the browser has no EME at all", async () => {
    const results = await probeDrm(undefined);
    expect(new Set(Object.values(results))).toEqual(new Set(["noEme"]));
  });

  it("asks for cbcs H.264, and FairPlay with its own init data", () => {
    const wv = probeConfig(DRM_PROBES[0]);
    expect(wv.initDataTypes).toEqual(["cenc"]);
    expect(wv.videoCapabilities?.[0]).toMatchObject({
      contentType: TEST_CLIP_CODEC,
      robustness: "HW_SECURE_ALL",
      encryptionScheme: "cbcs",
    });
    const fps = probeConfig(
      DRM_PROBES.find((p) => p.id === "fairplay") as (typeof DRM_PROBES)[number],
    );
    expect(fps.initDataTypes).toEqual(["sinf", "skd"]);
    expect(fps.videoCapabilities?.[0]).not.toHaveProperty("robustness");
  });
});

describe("playbackPlan", () => {
  const none = {
    widevineHwAll: "notSupported",
    widevineHwDecode: "notSupported",
    widevineSwDecode: "supported",
    playready3000: "notSupported",
    playready2000: "supported",
    playready3000KeySystem: "notSupported",
    fairplay: "notSupported",
  } as const;

  it("plays DASH with hardware Widevine or PlayReady SL3000", () => {
    expect(playbackPlan({ ...none, widevineHwAll: "supported" }, false).kind).toBe("dash");
    expect(playbackPlan({ ...none, playready3000: "supported" }, false).kind).toBe("dash");
    expect(playbackPlan({ ...none, playready3000KeySystem: "supported" }, false).kind).toBe("dash");
  });

  it("plays HLS with FairPlay only once FairPlay is set up", () => {
    expect(playbackPlan({ ...none, fairplay: "supported" }, true)).toEqual({
      kind: "fairplay",
      manifest: "/drm-test/master.m3u8",
    });
    expect(playbackPlan({ ...none, fairplay: "supported" }, false).kind).toBe("none");
  });

  it("falls back when only software DRM is there", () => {
    expect(playbackPlan(none, true).kind).toBe("none");
  });
});
