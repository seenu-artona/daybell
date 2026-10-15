import type { DrmTestTokenResponse } from "@daybell/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "./client-api";
import type { DrmProbeId, ProbeResult } from "./drm-capabilities";
import {
  licenseRequestFilter,
  PLAYBACK_TIMEOUT_MS,
  prepare,
  watchPlayback,
} from "./drm-test-player";

// The DRM test page's decisions (spike; D158; ADR 0032).

const results = (over: Partial<Record<DrmProbeId, ProbeResult>> = {}) =>
  ({
    widevineHwAll: "notSupported",
    widevineHwDecode: "notSupported",
    widevineSwDecode: "supported",
    playready3000: "notSupported",
    playready2000: "notSupported",
    playready3000KeySystem: "notSupported",
    fairplay: "notSupported",
    ...over,
  }) as Record<DrmProbeId, ProbeResult>;

const config = (fairplay = false): DrmTestTokenResponse => ({
  token: "t",
  expiresAt: "2026-10-14T12:01:00.000Z",
  licenseUrls: {
    widevine: "https://w.example.test",
    playready: "https://p.example.test",
    fairplay: fairplay ? "https://f.example.test" : null,
  },
  fairplayCertificateUrl: fairplay ? "https://c.example.test" : null,
});

const ok = (data: DrmTestTokenResponse): ApiResult<DrmTestTokenResponse> => ({ ok: true, data });
const refused = (code: string, status = 409): ApiResult<DrmTestTokenResponse> => ({
  ok: false,
  status,
  code,
  message: "",
  fields: {},
});

function steps(over: Partial<Parameters<typeof prepare>[0]> = {}) {
  const order: string[] = [];
  const s = {
    probe: vi.fn(async () => {
      order.push("probe");
      return results({ widevineHwAll: "supported" });
    }),
    onProbed: vi.fn(() => order.push("shown")),
    token: vi.fn(async () => {
      order.push("token");
      return ok(config());
    }),
    clipBuilt: vi.fn(async () => {
      order.push("clip");
      return true;
    }),
    cancelled: () => false,
    ...over,
  };
  return { s, order };
}

describe("prepare", () => {
  it("probes and shows the results, then asks for a token, then checks the clip, then plays", async () => {
    const { s, order } = steps();
    expect(await prepare(s)).toEqual({
      kind: "play",
      plan: { kind: "dash", manifest: "/drm-test/manifest.mpd" },
      config: config(),
    });
    expect(order).toEqual(["probe", "shown", "token", "clip"]);
    expect(s.clipBuilt).toHaveBeenCalledWith("/drm-test/manifest.mpd");
  });

  it("says not set up when the token route answers 409", async () => {
    const { s } = steps({ token: async () => refused("conflict") });
    expect(await prepare(s)).toEqual({ kind: "fallback", reason: "notConfigured" });
    expect(s.clipBuilt).not.toHaveBeenCalled();
  });

  it("says not set up when the build made no clip", async () => {
    const { s } = steps({ clipBuilt: async () => false });
    expect(await prepare(s)).toEqual({ kind: "fallback", reason: "notConfigured" });
  });

  it("fails in words on any other refusal, e.g. too many tokens", async () => {
    const { s } = steps({ token: async () => refused("rate_limited", 429) });
    expect(await prepare(s)).toEqual({ kind: "failed", code: "rate_limited" });
  });

  it("falls back without hardware DRM, before checking the clip", async () => {
    const { s } = steps({ probe: async () => results() });
    expect(await prepare(s)).toEqual({ kind: "fallback", reason: "noHardware" });
    expect(s.clipBuilt).not.toHaveBeenCalled();
  });

  it("says FairPlay isn't set up on Safari until its certificate is", async () => {
    const safari = async () => results({ fairplay: "supported" });
    expect(await prepare(steps({ probe: safari }).s)).toEqual({
      kind: "fallback",
      reason: "fairplayOff",
    });
    const { s } = steps({ probe: safari, token: async () => ok(config(true)) });
    expect(await prepare(s)).toMatchObject({
      kind: "play",
      plan: { kind: "fairplay", manifest: "/drm-test/master.m3u8" },
    });
  });

  it("stops quietly once cancelled (Try again, or leaving the page)", async () => {
    let cancelled = false;
    const { s } = steps({
      cancelled: () => cancelled,
      probe: async () => {
        cancelled = true;
        return results({ widevineHwAll: "supported" });
      },
    });
    expect(await prepare(s)).toBeNull();
    expect(s.token).not.toHaveBeenCalled();
  });
});

describe("licenseRequestFilter", () => {
  const LICENSE = 2;
  it("gives each license request a fresh token, and nothing else any", async () => {
    let n = 0;
    const fresh = vi.fn(async () => `token-${++n}`);
    const filter = licenseRequestFilter(LICENSE, fresh);
    const manifest = { headers: {} as Record<string, string> };
    const segment = { headers: {} as Record<string, string> };
    await filter(0, manifest);
    await filter(1, segment);
    expect(manifest.headers).toEqual({});
    expect(segment.headers).toEqual({});
    expect(fresh).not.toHaveBeenCalled();
    const a = { headers: {} as Record<string, string> };
    const b = { headers: {} as Record<string, string> };
    await filter(LICENSE, a);
    await filter(LICENSE, b);
    expect(a.headers).toEqual({ "X-AxDRM-Message": "token-1" });
    expect(b.headers).toEqual({ "X-AxDRM-Message": "token-2" });
  });

  it("lets a failed token fail the license request", async () => {
    const filter = licenseRequestFilter(2, async () => {
      throw new Error("rate_limited");
    });
    await expect(filter(2, { headers: {} })).rejects.toThrow("rate_limited");
  });
});

describe("watchPlayback", () => {
  afterEach(() => vi.useRealTimers());

  function setup(statuses: Record<string, string> = {}) {
    vi.useFakeTimers();
    const player = new EventTarget();
    const video = Object.assign(new EventTarget(), {
      readyState: 0,
      error: null as { code: number } | null,
    });
    const keys = { ...statuses };
    const onOutcome = vi.fn();
    const stop = watchPlayback({ player, video, keyStatuses: () => keys, onOutcome });
    return { player, video, keys, onOutcome, stop };
  }

  it("is playing only once the first frame is decoded and a key is usable", () => {
    const { player, video, keys, onOutcome } = setup();
    video.readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    expect(onOutcome).not.toHaveBeenCalled();
    keys.k = "usable";
    player.dispatchEvent(new Event("keystatuschanged"));
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith({ kind: "playing" });
  });

  it("isn't playing with a usable key but no decoded frame", () => {
    const { player, video, keys, onOutcome } = setup();
    keys.k = "usable";
    player.dispatchEvent(new Event("keystatuschanged"));
    video.readyState = 1;
    video.dispatchEvent(new Event("loadeddata"));
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ["output-restricted", "outputRestricted"],
    ["internal-error", "keyError"],
  ])("fails when a key is %s", (status, reason) => {
    const { player, keys, onOutcome } = setup();
    keys.k = status;
    player.dispatchEvent(new Event("keystatuschanged"));
    expect(onOutcome).toHaveBeenCalledWith({ kind: "failed", reason, code: "" });
  });

  it("fails on Shaka's error, with its code", () => {
    const { player, onOutcome } = setup();
    player.dispatchEvent(new CustomEvent("error", { detail: { code: 6007 } }));
    expect(onOutcome).toHaveBeenCalledWith({ kind: "failed", reason: "player", code: "6007" });
  });

  it("fails on the video element's error, with its code", () => {
    const { video, onOutcome } = setup();
    video.error = { code: 3 };
    video.dispatchEvent(new Event("error"));
    expect(onOutcome).toHaveBeenCalledWith({ kind: "failed", reason: "media", code: "3" });
  });

  it("fails after 15 seconds without a picture, and only once", () => {
    const { player, onOutcome } = setup();
    vi.advanceTimersByTime(PLAYBACK_TIMEOUT_MS - 1);
    expect(onOutcome).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onOutcome).toHaveBeenCalledWith({ kind: "failed", reason: "timeout", code: "" });
    player.dispatchEvent(new CustomEvent("error", { detail: { code: 1 } }));
    expect(onOutcome).toHaveBeenCalledTimes(1);
  });

  it("doesn't time out once playing, but still reports a later restriction", () => {
    const { player, video, keys, onOutcome } = setup({ k: "usable" });
    video.readyState = 4;
    video.dispatchEvent(new Event("loadeddata"));
    vi.advanceTimersByTime(PLAYBACK_TIMEOUT_MS * 2);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    keys.k = "output-restricted";
    player.dispatchEvent(new Event("keystatuschanged"));
    expect(onOutcome).toHaveBeenLastCalledWith({
      kind: "failed",
      reason: "outputRestricted",
      code: "",
    });
  });

  it("stops listening when cleaned up", () => {
    const { player, onOutcome, stop } = setup();
    stop();
    player.dispatchEvent(new CustomEvent("error", { detail: { code: 1 } }));
    vi.advanceTimersByTime(PLAYBACK_TIMEOUT_MS);
    expect(onOutcome).not.toHaveBeenCalled();
  });
});
