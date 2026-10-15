import {
  DRM_FAILURES_BEFORE_WEBP,
  DRM_FALLBACK_TIMEOUT_MS,
  type DrmManifestFormat,
} from "@daybell/core";
import { DRM_PROBES, type DrmProbeId, type ProbeResult, probeConfig } from "../drm-capabilities";

/**
 * The parent shop's large view under DRM (D158; ADR 0034), apart from React so it can be tested with a fake Shaka:
 * which way this browser plays (C7), the tab's fallback memory (C2), the license request filter, when a clip counts as
 * shown or failed, and one player per open viewer that loads one photo at a time. Generalised from the DRM test page
 * (ADR 0032), which re-exports the shared parts. Nothing here logs or stores anything personal.
 */

// ── Shared with the DRM test page ─────────────────────────────────────────────────────────────────────────────────

/**
 * A Shaka request filter that gives each license request (and nothing else) a fresh token, as the X-AxDRM-Message
 * header. Manifest and segment requests never carry it.
 */
export function licenseRequestFilter(licenseType: number, freshToken: () => Promise<string>) {
  return async (type: number, request: { headers: Record<string, string> }): Promise<void> => {
    if (type !== licenseType) return;
    request.headers["X-AxDRM-Message"] = await freshToken();
  };
}

export type FailureReason = "timeout" | "outputRestricted" | "keyError" | "player" | "media";
export type Outcome = { kind: "playing" } | { kind: "failed"; reason: FailureReason; code: string };

/** HTMLMediaElement.HAVE_CURRENT_DATA: the current frame is decoded. */
const HAVE_CURRENT_DATA = 2;

/** Anything events can be listened to on: a video element, or Shaka's player (its own event target, not the DOM's). */
export interface Listenable {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** The parts of a video element the watcher reads. requestVideoFrameCallback exists in Chrome and Safari 15.4+. */
export interface WatchedVideo extends Listenable {
  readyState: number;
  videoWidth: number;
  error: { code: number } | null;
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

/** Video events after which the current frame may be decoded. */
const READY_EVENTS = ["loadeddata", "canplay", "playing", "timeupdate", "resize"] as const;

/** A decoded picture with a size: the frame is there to be shown. */
export function frameReady(video: Pick<WatchedVideo, "readyState" | "videoWidth">): boolean {
  return video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0;
}

/**
 * Watches one playback attempt (amended after the first Safari run, Oct 14: Axinom issued the FairPlay license, but the
 * page never saw a "usable" key and timed out). "playing" once a frame is ready: readyState at HAVE_CURRENT_DATA or more
 * with a video width, seen on any of READY_EVENTS, or a requestVideoFrameCallback firing (a frame was presented). Key
 * statuses no longer need to say "usable" (Safari's native FairPlay path may not report them through Shaka), but a
 * key that is output-restricted or has an internal error is still a failure, as are Shaka's error, the video's error,
 * and nothing within the timeout. A failure is final; "playing" is reported once and can still be followed by a
 * failure. Returns a cleanup.
 */
export function watchPlayback(args: {
  player: Listenable;
  video: WatchedVideo;
  keyStatuses: () => Record<string, string>;
  onOutcome: (outcome: Outcome) => void;
  timeoutMs: number;
}): () => void {
  const { player, video, keyStatuses, onOutcome } = args;
  let failed = false;
  let playing = false;
  let frameHandle: number | null = null;

  const fail = (reason: FailureReason, code = "") => {
    if (failed) return;
    failed = true;
    stop();
    onOutcome({ kind: "failed", reason, code });
  };
  const show = () => {
    if (failed || playing) return;
    playing = true;
    clearTimeout(timer);
    onOutcome({ kind: "playing" });
  };
  const checkKeys = () => {
    if (failed) return;
    const statuses = Object.values(keyStatuses());
    if (statuses.includes("output-restricted")) return fail("outputRestricted");
    if (statuses.includes("internal-error")) return fail("keyError");
  };
  const checkFrame = () => {
    checkKeys();
    if (!failed && frameReady(video)) show();
  };
  const onPlayerError = (event: Event) => {
    const detail = (event as CustomEvent<{ code?: number } | undefined>).detail;
    fail("player", detail?.code === undefined ? "" : String(detail.code));
  };
  const onVideoError = () => fail("media", video.error ? String(video.error.code) : "");

  player.addEventListener("error", onPlayerError);
  player.addEventListener("keystatuschanged", checkKeys);
  for (const type of READY_EVENTS) video.addEventListener(type, checkFrame);
  video.addEventListener("error", onVideoError);
  if (typeof video.requestVideoFrameCallback === "function")
    frameHandle = video.requestVideoFrameCallback(() => {
      frameHandle = null;
      checkKeys();
      if (!failed) show();
    });
  const timer = setTimeout(() => {
    if (!playing) fail("timeout");
  }, args.timeoutMs);

  function stop() {
    clearTimeout(timer);
    player.removeEventListener("error", onPlayerError);
    player.removeEventListener("keystatuschanged", checkKeys);
    for (const type of READY_EVENTS) video.removeEventListener(type, checkFrame);
    video.removeEventListener("error", onVideoError);
    if (frameHandle !== null) video.cancelVideoFrameCallback?.(frameHandle);
    frameHandle = null;
  }
  checkFrame();
  return stop;
}

/** What may go into the diagnostics: never a token, a header or a key. A JWT-shaped or long base64/hex run is cut. */
export function safeDiagnostic(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<token>")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "<redacted>")
    .slice(0, 300);
}

// ── Which way this browser plays (C7) ─────────────────────────────────────────────────────────────────────────────

/** How the large view plays here: DASH with hardware Widevine or PlayReady, HLS with FairPlay, or not at all. */
export type DrmPlan = "dash" | "fairplay" | "none";

/** The spike's choice (drm-capabilities' playbackPlan), as a plan: hardware only; FairPlay only with its certificate. */
export function planFromProbes(
  results: Record<DrmProbeId, ProbeResult>,
  fairplay: boolean,
): DrmPlan {
  const ok = (id: DrmProbeId) => results[id] === "supported";
  if (ok("widevineHwAll") || ok("playready3000") || ok("playready3000KeySystem")) return "dash";
  if (ok("fairplay") && fairplay) return "fairplay";
  return "none";
}

/** Only the probes that can choose a plan (hardware Widevine, PlayReady SL3000, FairPlay): the others never matter. */
export const SHOP_PROBES = DRM_PROBES.filter((p) =>
  ["widevineHwAll", "playready3000", "playready3000KeySystem", "fairplay"].includes(p.id),
);

type RequestAccess = (
  keySystem: string,
  configs: MediaKeySystemConfiguration[],
) => Promise<unknown>;

/** Asks the browser, once, which hardware DRM it has for the clips' codec (no network, nothing personal). */
export async function probeShopDrm(
  request: RequestAccess | undefined = typeof navigator !== "undefined" &&
  typeof navigator.requestMediaKeySystemAccess === "function"
    ? navigator.requestMediaKeySystemAccess.bind(navigator)
    : undefined,
): Promise<Record<DrmProbeId, ProbeResult>> {
  const results = Object.fromEntries(DRM_PROBES.map((p) => [p.id, "notSupported"])) as Record<
    DrmProbeId,
    ProbeResult
  >;
  await Promise.all(
    SHOP_PROBES.map(async (probe) => {
      if (!request) {
        results[probe.id] = "noEme";
        return;
      }
      try {
        await request(probe.keySystem, [probeConfig(probe)]);
        results[probe.id] = "supported";
      } catch {
        results[probe.id] = "notSupported";
      }
    }),
  );
  return results;
}

// ── The tab's memory (C2, C7): sessionStorage, a plan and a count, nothing personal ──────────────────────────────

export const DRM_PLAN_KEY = "daybell.shop.drmPlan";
export const DRM_FAILURES_KEY = "daybell.shop.drmFailures";

type Store = Pick<Storage, "getItem" | "setItem">;

function tabStore(): Store | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The plan probed earlier in this tab, if any. */
export function storedPlan(store: Store | null = tabStore()): DrmPlan | null {
  const value = store?.getItem(DRM_PLAN_KEY);
  return value === "dash" || value === "fairplay" || value === "none" ? value : null;
}

export function storePlan(plan: DrmPlan, store: Store | null = tabStore()): void {
  try {
    store?.setItem(DRM_PLAN_KEY, plan);
  } catch {
    // Private modes may refuse: the plan is probed again next time.
  }
}

/** Failures in a row in this tab; at DRM_FAILURES_BEFORE_WEBP the rest of the tab's session uses the WebP. */
export function failuresInARow(store: Store | null = tabStore()): number {
  const n = Number(store?.getItem(DRM_FAILURES_KEY) ?? "0");
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function drmOffForTab(store: Store | null = tabStore()): boolean {
  return failuresInARow(store) >= DRM_FAILURES_BEFORE_WEBP;
}

export function recordOutcome(shown: boolean, store: Store | null = tabStore()): void {
  try {
    // Once off, it stays off for the tab (C2).
    if (drmOffForTab(store)) return;
    store?.setItem(DRM_FAILURES_KEY, shown ? "0" : String(failuresInARow(store) + 1));
  } catch {
    // Ignored: a refused write only means counting again.
  }
}

// ── One player per open viewer ────────────────────────────────────────────────────────────────────────────────────

/** The parts of Shaka Player 5.2.12 the viewer uses (a fake in tests). */
export interface ShakaPlayerLike extends Listenable {
  attach(video: HTMLMediaElement): Promise<void>;
  configure(config: object): boolean | undefined;
  getConfiguration(): { drm: { keySystemsMapping: Record<string, string> } };
  getNetworkingEngine(): {
    registerRequestFilter(filter: unknown): void;
    registerResponseFilter(filter: unknown): void;
  } | null;
  load(uri: string): Promise<void>;
  destroy(): Promise<void>;
  getKeyStatuses(): Record<string, string>;
}
export interface ShakaLike {
  polyfill: { installAll(): void };
  Player: { new (): ShakaPlayerLike; isBrowserSupported(): boolean };
  net: { NetworkingEngine: { RequestType: { LICENSE: number } } };
  drm: { FairPlay: { commonFairPlayResponse: unknown } };
}

export interface DrmSetup {
  licenseUrls: { widevine: string; playready: string; fairplay: string | null };
  fairplayCertificateUrl: string | null;
}

/** The photo being shown: where its manifest is and how to get a token for it. */
export interface DrmTarget {
  childId: string;
  photoId: string;
  galleryId: string;
}

/** The manifest route for a photo: DASH, or HLS (FairPlay) whose master names its media playlist itself. */
export function manifestUrl(target: DrmTarget, plan: Exclude<DrmPlan, "none">): string {
  const format: DrmManifestFormat = plan === "fairplay" ? "hls" : "dash";
  return `/api/v1/shop/children/${encodeURIComponent(target.childId)}/photos/${encodeURIComponent(target.photoId)}/drm-manifest?format=${format}&gallery=${encodeURIComponent(target.galleryId)}`;
}

/** Shaka's configuration for the plan: hardware only, FairPlay played natively by Safari with our certificate. */
export function shakaConfig(
  plan: Exclude<DrmPlan, "none">,
  setup: DrmSetup,
  mapping: Record<string, string>,
): object {
  const playready = setup.licenseUrls.playready;
  return {
    streaming: { useNativeHlsForFairPlay: true },
    drm: {
      servers:
        plan === "fairplay" && setup.licenseUrls.fairplay
          ? { "com.apple.fps": setup.licenseUrls.fairplay }
          : {
              "com.widevine.alpha": setup.licenseUrls.widevine,
              "com.microsoft.playready": playready,
              "com.microsoft.playready.recommendation": playready,
              "com.microsoft.playready.recommendation.3000": playready,
            },
      advanced: {
        "com.widevine.alpha": { videoRobustness: ["HW_SECURE_ALL"] },
        "com.microsoft.playready.recommendation": { videoRobustness: ["3000"] },
        ...(setup.fairplayCertificateUrl
          ? { "com.apple.fps": { serverCertificateUri: setup.fairplayCertificateUrl } }
          : {}),
      },
      ...(mapping["com.microsoft.playready"]
        ? {}
        : {
            keySystemsMapping: {
              "com.microsoft.playready": "com.microsoft.playready.recommendation",
            },
          }),
    },
  };
}

export interface ShopDrmPlayer {
  /** Loads one photo; resolves "shown" once a frame is ready or presented, "failed" otherwise (8 s at most). */
  show(target: DrmTarget): Promise<"shown" | "failed">;
  destroy(): Promise<void>;
}

/**
 * One player for an open viewer: created on the first protected photo, load() per photo, destroyed on close. Each
 * license request (and nothing else) gets a fresh token for the photo being shown. The clip plays muted (play() never
 * awaited) and pauses once its first frame was presented, as the spike found Safari needs.
 */
export async function createShopDrmPlayer(args: {
  shaka: ShakaLike;
  video: HTMLVideoElement;
  plan: Exclude<DrmPlan, "none">;
  setup: DrmSetup;
  token: (target: DrmTarget) => Promise<string>;
  timeoutMs?: number;
}): Promise<ShopDrmPlayer | null> {
  const { shaka, video } = args;
  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) return null;
  const player = new shaka.Player();
  await player.attach(video);
  player.configure(
    shakaConfig(args.plan, args.setup, player.getConfiguration().drm.keySystemsMapping),
  );
  let current: DrmTarget | null = null;
  const net = player.getNetworkingEngine();
  net?.registerRequestFilter(
    licenseRequestFilter(shaka.net.NetworkingEngine.RequestType.LICENSE, () => {
      if (!current) return Promise.reject(new Error("no_photo"));
      return args.token(current);
    }),
  );
  if (args.plan === "fairplay")
    net?.registerResponseFilter(shaka.drm.FairPlay.commonFairPlayResponse);

  let generation = 0;
  let stopWatching: (() => void) | null = null;
  const timeoutMs = args.timeoutMs ?? DRM_FALLBACK_TIMEOUT_MS;

  return {
    async show(target) {
      const mine = ++generation;
      stopWatching?.();
      stopWatching = null;
      current = target;
      const started = Date.now();
      const expired = new Promise<"timeout">((ok) => setTimeout(() => ok("timeout"), timeoutMs));
      const loaded = await Promise.race([
        player.load(manifestUrl(target, args.plan)).then(
          () => "loaded" as const,
          () => "error" as const,
        ),
        expired,
      ]);
      if (mine !== generation) return "failed";
      if (loaded !== "loaded") return "failed";
      return new Promise((resolve) => {
        let paused = false;
        const pauseOnce = () => {
          if (paused) return;
          paused = true;
          video.pause();
        };
        const onTime = () => {
          if (video.currentTime > 0) pauseOnce();
        };
        video.addEventListener("timeupdate", onTime);
        let frameHandle: number | null = null;
        if (typeof video.requestVideoFrameCallback === "function")
          frameHandle = video.requestVideoFrameCallback(() => {
            frameHandle = null;
            pauseOnce();
          });
        const stopPlayback = watchPlayback({
          player,
          video,
          keyStatuses: () => player.getKeyStatuses(),
          timeoutMs: Math.max(0, timeoutMs - (Date.now() - started)),
          onOutcome: (outcome) => {
            if (mine !== generation) return;
            // A photo already shown never falls back (C2): later failures are ignored.
            resolve(outcome.kind === "playing" ? "shown" : "failed");
          },
        });
        stopWatching = () => {
          stopPlayback();
          video.removeEventListener("timeupdate", onTime);
          if (frameHandle !== null) video.cancelVideoFrameCallback?.(frameHandle);
          // Superseded by the next photo (or closed): this one settles as not shown.
          resolve("failed");
        };
        video.muted = true;
        // Not awaited: the outcome comes from watchPlayback, never from play()'s promise.
        const playing = video.play() as Promise<void> | undefined;
        playing?.catch?.(() => {});
      });
    },
    async destroy() {
      generation++;
      stopWatching?.();
      current = null;
      await player.destroy().catch(() => {});
    },
  };
}
