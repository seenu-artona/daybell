import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { DrmProbeId, ProbeResult } from "./drm-probes";

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

type Behaviour = "frame" | "decodedOnly" | "error" | "never" | "playRefused" | "errorDuringLoad";
class FakeVideo extends EventTarget {
  readyState = 0;
  videoWidth = 0;
  currentTime = 0;
  muted = false;
  error = null;
  frameCallbacks: (() => void)[] = [];
  behaviour: Behaviour = "frame";
  play = vi.fn(() => {
    if (this.behaviour === "playRefused")
      return Promise.reject(new DOMException("autoplay", "NotAllowedError"));
    if (this.behaviour === "frame")
      // A frame is presented a moment after play().
      setTimeout(() => {
        for (const cb of this.frameCallbacks.splice(0)) cb();
      }, 10);
    return Promise.resolve();
  });
  pause = vi.fn();
  requestVideoFrameCallback: ((cb: () => void) => number) | undefined = (cb) =>
    this.frameCallbacks.push(cb);
  cancelVideoFrameCallback = () => {};
}
function fakeShaka(video: FakeVideo, behave: (url: string) => Behaviour) {
  const made: FakePlayer[] = [];
  class FakePlayer extends EventTarget implements ShakaPlayerLike {
    loads: string[] = [];
    filters: ((type: number, request: { headers: Record<string, string> }) => Promise<void>)[] = [];
    destroyed = false;
    constructor() {
      super();
      made.push(this);
    }
    async attach() {}
    configure() {
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
      video.behaviour = behave(url);
      if (video.behaviour === "error") throw Object.assign(new Error("shaka"), { code: 6007 });
      if (video.behaviour === "errorDuringLoad") {
        // Shaka reports an error while load() is still running (listeners were attached before load).
        this.dispatchEvent(new CustomEvent("error", { detail: { code: 6012 } }));
        await new Promise(() => {});
      }
      if (video.behaviour === "never") await new Promise(() => {});
      if (video.behaviour === "frame" || video.behaviour === "decodedOnly") {
        video.readyState = 4;
        video.videoWidth = 1600;
        setTimeout(() => video.dispatchEvent(new Event("loadeddata")), 1);
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

describe("createShopDrmPlayer: one player per open viewer (review #3, #4, #5)", () => {
  const setup = {
    licenseUrls: { widevine: "https://w", playready: "https://p", fairplay: null },
    fairplayCertificateUrl: null,
  };
  const target = (n: number) => ({ childId: "c1", photoId: `p${n}`, galleryId: "g" });
  const budget = () => {
    const controller = new AbortController();
    return { controller, options: { signal: controller.signal, deadline: Date.now() + 8000 } };
  };
  const make = (
    video: FakeVideo,
    shaka: ShakaLike,
    token: (t: { photoId: string }) => Promise<string> = async () => "t",
  ) =>
    createShopDrmPlayer({
      shaka,
      video: video as unknown as HTMLVideoElement,
      plan: "dash",
      setup,
      token,
    });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads each photo in the same player and shows it once a frame was presented; plays muted, then pauses", async () => {
    const video = new FakeVideo();
    const { shaka, made } = fakeShaka(video, () => "frame");
    const player = await make(video, shaka);
    const first = player?.show(target(1), budget().options);
    await vi.advanceTimersByTimeAsync(20);
    expect(await first).toBe("shown");
    expect(video.pause).toHaveBeenCalledTimes(1);
    const second = player?.show(target(2), budget().options);
    await vi.advanceTimersByTimeAsync(20);
    expect(await second).toBe("shown");
    expect(made).toHaveLength(1);
    expect(made[0]?.loads).toEqual([
      manifestUrl(target(1), "dash"),
      manifestUrl(target(2), "dash"),
    ]);
    expect(video.muted).toBe(true);
    await player?.destroy();
    expect(made[0]?.destroyed).toBe(true);
  });

  it("where the browser can say a frame was presented, a decoded frame alone isn't shown (#3)", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, () => "decodedOnly");
    const player = await make(video, shaka);
    const pending = player?.show(target(1), budget().options);
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

  it("without the callback, a decoded frame with a size is shown", async () => {
    const video = new FakeVideo();
    video.requestVideoFrameCallback = undefined;
    const { shaka } = fakeShaka(video, () => "decodedOnly");
    const player = await make(video, shaka);
    const pending = player?.show(target(1), budget().options);
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toBe("shown");
  });

  it("a refused play() with nothing presented is a failure (#3)", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, () => "playRefused");
    const player = await make(video, shaka);
    const pending = player?.show(target(1), budget().options);
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toBe("failed");
  });

  it("hears an error during load(): it listens before loading (#3)", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, () => "errorDuringLoad");
    const player = await make(video, shaka);
    const pending = player?.show(target(1), budget().options);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("failed");
  });

  it("fails when loading fails, at the photo's deadline, or as soon as it is given up (#4)", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, (url) => (url.includes("/p1/") ? "error" : "never"));
    const player = await make(video, shaka);
    expect(await player?.show(target(1), budget().options)).toBe("failed");
    const late = player?.show(target(2), {
      signal: new AbortController().signal,
      deadline: Date.now() + 3000,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await late).toBe("failed");
    const { controller, options } = budget();
    const aborted = player?.show(target(3), options);
    controller.abort();
    expect(await aborted).toBe("failed");
  });

  it("gives each license request a fresh token for the photo shown, and none once it was given up (#5)", async () => {
    const video = new FakeVideo();
    const { shaka, made } = fakeShaka(video, () => "never");
    const token = vi.fn(async (t: { photoId: string }) => `token-for-${t.photoId}`);
    const player = await make(video, shaka, token);
    const { controller, options } = budget();
    void player?.show(target(7), options);
    const filter = made[0]?.filters[0];
    const license = { headers: {} as Record<string, string> };
    const segment = { headers: {} as Record<string, string> };
    await filter?.(2, license);
    await filter?.(1, segment);
    expect(license.headers).toEqual({ "X-AxDRM-Message": "token-for-p7" });
    expect(segment.headers).toEqual({});
    expect(token).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(filter?.(2, { headers: {} })).rejects.toThrow("drm_given_up");
    expect(token).toHaveBeenCalledTimes(1);
  });

  it("a photo superseded by the next one settles as not shown", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, (url) => (url.includes("/p1/") ? "never" : "frame"));
    const player = await make(video, shaka);
    const first = player?.show(target(1), budget().options);
    await vi.advanceTimersByTimeAsync(10);
    const second = player?.show(target(2), budget().options);
    expect(await first).toBe("failed");
    await vi.advanceTimersByTimeAsync(20);
    expect(await second).toBe("shown");
  });

  it("is null where Shaka says the browser can't play", async () => {
    const video = new FakeVideo();
    const { shaka } = fakeShaka(video, () => "frame");
    (shaka.Player as unknown as { isBrowserSupported: () => boolean }).isBrowserSupported = () =>
      false;
    expect(await make(video, shaka)).toBeNull();
  });
});
