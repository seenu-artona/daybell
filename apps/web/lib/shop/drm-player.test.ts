import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrmProbeId, ProbeResult } from "../drm-capabilities";
import {
  createShopDrmPlayer,
  DRM_FAILURES_KEY,
  DRM_PLAN_KEY,
  drmOffForTab,
  failuresInARow,
  manifestUrl,
  planFromProbes,
  probeShopDrm,
  recordOutcome,
  type ShakaLike,
  type ShakaPlayerLike,
  safeDiagnostic,
  shakaConfig,
  storedPlan,
  storePlan,
} from "./drm-player";

// The shop's large view under DRM, apart from React (D158; ADR 0034, C2, C7): the plan from hardware probes only, the
// tab's memory (a plan and a count, nothing else), the manifest address, Shaka's hardware-only configuration, and one
// player that loads a photo at a time, shows it once a frame is ready, and falls back within 8 seconds.

const results = (over: Partial<Record<DrmProbeId, ProbeResult>> = {}) =>
  ({
    widevineHwAll: "notSupported",
    widevineHwDecode: "supported",
    widevineSwDecode: "supported",
    playready3000: "notSupported",
    playready2000: "supported",
    playready3000KeySystem: "notSupported",
    fairplay: "notSupported",
    ...over,
  }) as Record<DrmProbeId, ProbeResult>;

class MemoryStore {
  items = new Map<string, string>();
  getItem = (k: string) => this.items.get(k) ?? null;
  setItem = (k: string, v: string) => void this.items.set(k, v);
}

describe("the plan (C7)", () => {
  it("is DASH for hardware Widevine or PlayReady SL3000, HLS with FairPlay, else none (software DRM never counts)", () => {
    expect(planFromProbes(results(), true)).toBe("none");
    expect(planFromProbes(results({ widevineHwAll: "supported" }), true)).toBe("dash");
    expect(planFromProbes(results({ playready3000: "supported" }), false)).toBe("dash");
    expect(planFromProbes(results({ playready3000KeySystem: "supported" }), false)).toBe("dash");
    expect(planFromProbes(results({ fairplay: "supported" }), true)).toBe("fairplay");
    expect(planFromProbes(results({ fairplay: "supported" }), false)).toBe("none");
  });

  it("asks the browser only what can choose a plan, and says noEme without EME", async () => {
    const asked: string[] = [];
    const probed = await probeShopDrm(async (keySystem, configs) => {
      asked.push(`${keySystem} ${configs[0]?.videoCapabilities?.[0]?.robustness ?? ""}`.trim());
      if (keySystem === "com.apple.fps") return {};
      throw new Error("no");
    });
    expect(asked.sort()).toEqual(
      [
        "com.apple.fps",
        "com.microsoft.playready.recommendation 3000",
        "com.microsoft.playready.recommendation.3000",
        "com.widevine.alpha HW_SECURE_ALL",
      ].sort(),
    );
    expect(planFromProbes(probed, true)).toBe("fairplay");
    expect((await probeShopDrm(undefined)).widevineHwAll).toBe("noEme");
  });
});

describe("the tab's memory (C2, C7)", () => {
  it("keeps the plan, and nothing else but a count", () => {
    const store = new MemoryStore();
    expect(storedPlan(store)).toBeNull();
    storePlan("dash", store);
    expect(storedPlan(store)).toBe("dash");
    store.setItem(DRM_PLAN_KEY, "<script>");
    expect(storedPlan(store)).toBeNull();
    recordOutcome(false, store);
    expect([...store.items.keys()].sort()).toEqual([DRM_FAILURES_KEY, DRM_PLAN_KEY].sort());
    expect([...store.items.values()].join(" ")).not.toMatch(/[0-9a-f]{8}-/);
  });

  it("two failures in a row turn DRM off for the rest of the tab; a success in between resets the count", () => {
    const store = new MemoryStore();
    recordOutcome(false, store);
    recordOutcome(true, store);
    recordOutcome(false, store);
    expect(failuresInARow(store)).toBe(1);
    expect(drmOffForTab(store)).toBe(false);
    recordOutcome(false, store);
    expect(drmOffForTab(store)).toBe(true);
    recordOutcome(true, store);
    expect(drmOffForTab(store)).toBe(true);
  });
});

describe("addresses and configuration", () => {
  const target = {
    childId: "c0000000-0000-4000-8000-000000000001",
    photoId: "f0000000-0000-4000-8000-000000000001",
    galleryId: "a".repeat(32),
  };
  it("names the manifest route for the plan and the gallery", () => {
    expect(manifestUrl(target, "dash")).toBe(
      `/api/v1/shop/children/${target.childId}/photos/${target.photoId}/drm-manifest?format=dash&gallery=${"a".repeat(32)}`,
    );
    expect(manifestUrl(target, "fairplay")).toContain("format=hls&");
  });

  it("asks Shaka for hardware only, with our FairPlay certificate and native HLS on Safari", () => {
    const setup = {
      licenseUrls: { widevine: "https://w", playready: "https://p", fairplay: "https://f" },
      fairplayCertificateUrl: "/api/v1/shop/drm/fairplay-certificate",
    };
    expect(shakaConfig("dash", setup, {})).toMatchObject({
      streaming: { useNativeHlsForFairPlay: true },
      drm: {
        servers: {
          "com.widevine.alpha": "https://w",
          "com.microsoft.playready.recommendation": "https://p",
        },
        advanced: {
          "com.widevine.alpha": { videoRobustness: ["HW_SECURE_ALL"] },
          "com.microsoft.playready.recommendation": { videoRobustness: ["3000"] },
        },
        keySystemsMapping: { "com.microsoft.playready": "com.microsoft.playready.recommendation" },
      },
    });
    expect(shakaConfig("fairplay", setup, { "com.microsoft.playready": "x" })).toMatchObject({
      drm: {
        servers: { "com.apple.fps": "https://f" },
        advanced: {
          "com.apple.fps": { serverCertificateUri: "/api/v1/shop/drm/fairplay-certificate" },
        },
      },
    });
  });

  it("never lets a token or key into anything shown (safeDiagnostic, kept from the spike)", () => {
    expect(safeDiagnostic("token eyJhbGciOi.eyJ2ZXJzaW9u.c2lnbmF0dXJl")).toBe("token <token>");
  });
});

// ── A fake Shaka (Shaka itself needs a real browser) ─────────────────────────────────────────────────────────────────

type Behaviour = "frame" | "error" | "never";
class FakeVideo extends EventTarget {
  readyState = 0;
  videoWidth = 0;
  currentTime = 0;
  muted = false;
  error = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
}
function fakeShaka(video: FakeVideo, behave: (url: string) => Behaviour) {
  const made: FakePlayer[] = [];
  class FakePlayer extends EventTarget implements ShakaPlayerLike {
    loads: string[] = [];
    filters: ((type: number, request: { headers: Record<string, string> }) => Promise<void>)[] = [];
    config: object | null = null;
    destroyed = false;
    constructor() {
      super();
      made.push(this);
    }
    async attach() {}
    configure(config: object) {
      this.config = config;
      return true;
    }
    getConfiguration() {
      return { drm: { keySystemsMapping: {} } };
    }
    getNetworkingEngine() {
      return {
        registerRequestFilter: (f: unknown) =>
          void this.filters.push(f as FakePlayer["filters"][number]),
        registerResponseFilter: () => {},
      };
    }
    async load(url: string) {
      this.loads.push(url);
      video.readyState = 0;
      video.videoWidth = 0;
      const b = behave(url);
      if (b === "error") throw Object.assign(new Error("shaka"), { code: 6007 });
      if (b === "frame") {
        video.readyState = 4;
        video.videoWidth = 1600;
      }
    }
    async destroy() {
      this.destroyed = true;
    }
    getKeyStatuses() {
      return {};
    }
  }
  const shaka = {
    polyfill: { installAll: () => {} },
    Player: Object.assign(FakePlayer, { isBrowserSupported: () => true }),
    net: { NetworkingEngine: { RequestType: { LICENSE: 2 } } },
    drm: { FairPlay: { commonFairPlayResponse: () => {} } },
  } as unknown as ShakaLike;
  return { shaka, made };
}

describe("createShopDrmPlayer: one player per open viewer", () => {
  const setup = {
    licenseUrls: { widevine: "https://w", playready: "https://p", fairplay: null },
    fairplayCertificateUrl: null,
  };
  const target = (n: number) => ({ childId: "c1", photoId: `p${n}`, galleryId: "g" });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads each photo in the same player, shows it once a frame is ready, plays muted and pauses after", async () => {
    const video = new FakeVideo();
    const { shaka, made } = fakeShaka(video, () => "frame");
    const player = await createShopDrmPlayer({
      shaka,
      video: video as unknown as HTMLVideoElement,
      plan: "dash",
      setup,
      token: async () => "t",
    });
    expect(await player?.show(target(1))).toBe("shown");
    expect(await player?.show(target(2))).toBe("shown");
    expect(made).toHaveLength(1);
    expect(made[0]?.loads).toEqual([
      manifestUrl(target(1), "dash"),
      manifestUrl(target(2), "dash"),
    ]);
    expect(video.muted).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(2);
    video.currentTime = 0.2;
    video.dispatchEvent(new Event("timeupdate"));
    expect(video.pause).toHaveBeenCalled();
    await player?.destroy();
    expect(made[0]?.destroyed).toBe(true);
  });

  it("gives each license request, and nothing else, a fresh token for the photo being shown", async () => {
    const video = new FakeVideo();
    const { shaka, made } = fakeShaka(video, () => "frame");
    const token = vi.fn(async (t: { photoId: string }) => `token-for-${t.photoId}`);
    const player = await createShopDrmPlayer({
      shaka,
      video: video as unknown as HTMLVideoElement,
      plan: "dash",
      setup,
      token,
    });
    await player?.show(target(7));
    const filter = made[0]?.filters[0];
    const license = { headers: {} as Record<string, string> };
    const segment = { headers: {} as Record<string, string> };
    await filter?.(2, license);
    await filter?.(1, segment);
    expect(license.headers).toEqual({ "X-AxDRM-Message": "token-for-p7" });
    expect(segment.headers).toEqual({});
    expect(token).toHaveBeenCalledTimes(1);
  });

  it("fails when loading fails, or when no frame comes within 8 seconds (C2)", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, (url) => (url.includes("/p1/") ? "error" : "never"));
    const player = await createShopDrmPlayer({
      shaka,
      video: video as unknown as HTMLVideoElement,
      plan: "dash",
      setup,
      token: async () => "t",
    });
    expect(await player?.show(target(1))).toBe("failed");
    const pending = player?.show(target(2));
    await vi.advanceTimersByTimeAsync(7_999);
    let settled = false;
    void pending?.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("failed");
  });

  it("a photo superseded by the next one settles as not shown", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, (url) => (url.includes("/p1/") ? "never" : "frame"));
    const player = await createShopDrmPlayer({
      shaka,
      video: video as unknown as HTMLVideoElement,
      plan: "dash",
      setup,
      token: async () => "t",
    });
    const first = player?.show(target(1));
    await vi.advanceTimersByTimeAsync(10);
    expect(await player?.show(target(2))).toBe("shown");
    expect(await first).toBe("failed");
  });

  it("is null where Shaka says the browser can't play", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, () => "frame");
    (shaka.Player as unknown as { isBrowserSupported: () => boolean }).isBrowserSupported = () =>
      false;
    expect(
      await createShopDrmPlayer({
        shaka,
        video: video as unknown as HTMLVideoElement,
        plan: "dash",
        setup,
        token: async () => "t",
      }),
    ).toBeNull();
  });
});
