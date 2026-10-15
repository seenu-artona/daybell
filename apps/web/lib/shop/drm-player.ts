import { DRM_FAILURES_BEFORE_WEBP, type DrmManifestFormat } from "@daybell/core";
import { type DrmPlan, fairplayNeedsLegacyEme } from "./drm-probes";

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
  /**
   * Only a presented frame (requestVideoFrameCallback) counts as shown, never a decoded one (the shop where the
   * browser has the callback; review #3). Without the callback this is ignored.
   */
  presentedOnly?: boolean;
  /** Look at the element at once (the test page). The shop starts watching before load(), so it doesn't. */
  initialCheck?: boolean;
}): () => void {
  const { player, video, keyStatuses, onOutcome } = args;
  const presentedOnly =
    args.presentedOnly === true && typeof video.requestVideoFrameCallback === "function";
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
    if (!failed && !presentedOnly && frameReady(video)) show();
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
  if (args.initialCheck !== false) checkFrame();
  return stop;
}

/** What may go into the diagnostics: never a token, a header or a key. A JWT-shaped or long base64/hex run is cut. */
export function safeDiagnostic(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<token>")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "<redacted>")
    .slice(0, 300);
}

// ── Which way this browser plays (C7): lib/shop/drm-probes.ts ──────────────────────────────────────────────────

export {
  type DrmPlan,
  planFromProbes,
  probeShopDrm,
  SHOP_PROBES,
} from "./drm-probes";

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
  polyfill: { installAll(): void; PatchedMediaKeysApple?: { install(): void } };
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

/**
 * Shaka's configuration for the plan: hardware only, FairPlay played natively by Safari with our certificate. Through
 * Apple's prefixed EME (iPhone Chrome) FairPlay is named "com.apple.fps.1_0": Shaka waits for a standard `encrypted`
 * event before attaching keys for "com.apple.fps", which the polyfill only raises after attaching, so it would stall.
 */
export function shakaConfig(
  plan: Exclude<DrmPlan, "none">,
  setup: DrmSetup,
  mapping: Record<string, string>,
  legacyEme = false,
): object {
  const playready = setup.licenseUrls.playready;
  const fps = legacyEme ? "com.apple.fps.1_0" : "com.apple.fps";
  return {
    streaming: { useNativeHlsForFairPlay: true },
    drm: {
      servers:
        plan === "fairplay" && setup.licenseUrls.fairplay
          ? { [fps]: setup.licenseUrls.fairplay }
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
          ? { [fps]: { serverCertificateUri: setup.fairplayCertificateUrl } }
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

export interface ShowOptions {
  /** Aborted when the viewer gives up on this photo (its 8-second budget, a swipe, closing): nothing more is asked. */
  signal: AbortSignal;
  /** When the photo's whole budget runs out (ms since the epoch). */
  deadline: number;
}

export interface ShopDrmPlayer {
  /** Loads one photo; "shown" once a frame was presented, "failed" otherwise (at the deadline at the latest). */
  show(target: DrmTarget, options: ShowOptions): Promise<"shown" | "failed">;
  destroy(): Promise<void>;
}

/**
 * One player for an open viewer: created on the first protected photo, load() per photo, destroyed on close or after a
 * failure. Each license request (and nothing else) gets a fresh token for the photo being shown, and none once that
 * photo was given up (its signal aborted; review #5). Listeners start before load() (as the spike's did), so no error
 * or frame is missed; where the browser has requestVideoFrameCallback only a presented frame counts as shown (review
 * #3). The clip plays muted (play() never awaited); a refused play() before any frame is shown is a failure. It pauses
 * once its first frame was presented, as the spike found Safari needs.
 */
export async function createShopDrmPlayer(args: {
  shaka: ShakaLike;
  video: HTMLVideoElement;
  plan: Exclude<DrmPlan, "none">;
  setup: DrmSetup;
  token: (target: DrmTarget, signal: AbortSignal) => Promise<string>;
  /** Whether FairPlay plays only through Apple's prefixed EME here (iPhone Chrome); drm-probes decides, tests fake it. */
  needsLegacyEme?: () => Promise<boolean>;
}): Promise<ShopDrmPlayer | null> {
  const { shaka, video } = args;
  // Shaka installs the Apple polyfill by itself only when the standard API is missing; where the standard API exists
  // but refuses FairPlay and the prefixed one has it, it is installed here, before anything else asks for keys.
  const legacyEme =
    args.plan === "fairplay" &&
    !!shaka.polyfill.PatchedMediaKeysApple &&
    (await (args.needsLegacyEme ?? fairplayNeedsLegacyEme)());
  if (legacyEme) shaka.polyfill.PatchedMediaKeysApple?.install();
  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) return null;
  const player = new shaka.Player();
  await player.attach(video);
  player.configure(
    shakaConfig(args.plan, args.setup, player.getConfiguration().drm.keySystemsMapping, legacyEme),
  );
  let current: { target: DrmTarget; signal: AbortSignal } | null = null;
  const net = player.getNetworkingEngine();
  net?.registerRequestFilter(
    licenseRequestFilter(shaka.net.NetworkingEngine.RequestType.LICENSE, () => {
      const now = current;
      if (!now || now.signal.aborted) return Promise.reject(new Error("drm_given_up"));
      return args.token(now.target, now.signal);
    }),
  );
  if (args.plan === "fairplay")
    net?.registerResponseFilter(shaka.drm.FairPlay.commonFairPlayResponse);

  let settleCurrent: (() => void) | null = null;
  let stopPausing: (() => void) | null = null;

  return {
    show(target, options) {
      settleCurrent?.();
      stopPausing?.();
      current = { target, signal: options.signal };
      return new Promise((resolve) => {
        let settled = false;
        let stopWatching: () => void = () => {};
        const settle = (outcome: "shown" | "failed") => {
          if (settled) return;
          settled = true;
          stopWatching();
          options.signal.removeEventListener("abort", onAbort);
          if (settleCurrent === giveUp) settleCurrent = null;
          resolve(outcome);
        };
        const giveUp = () => settle("failed");
        const onAbort = () => settle("failed");
        settleCurrent = giveUp;
        if (options.signal.aborted) return settle("failed");
        options.signal.addEventListener("abort", onAbort);

        // Pause once the first frame was presented (or, without the callback, once time moved).
        let paused = false;
        let frameHandle: number | null = null;
        const pauseOnce = () => {
          if (paused) return;
          paused = true;
          video.pause();
          stopPausing?.();
        };
        const onTime = () => {
          if (video.currentTime > 0) pauseOnce();
        };
        video.addEventListener("timeupdate", onTime);
        if (typeof video.requestVideoFrameCallback === "function")
          frameHandle = video.requestVideoFrameCallback(() => {
            frameHandle = null;
            pauseOnce();
          });
        stopPausing = () => {
          video.removeEventListener("timeupdate", onTime);
          if (frameHandle !== null) video.cancelVideoFrameCallback?.(frameHandle);
          frameHandle = null;
          stopPausing = null;
        };

        // Watching starts before load(), so no error or presented frame is missed.
        stopWatching = watchPlayback({
          player,
          video,
          keyStatuses: () => player.getKeyStatuses(),
          timeoutMs: Math.max(0, options.deadline - Date.now()),
          presentedOnly: true,
          initialCheck: false,
          // A photo once shown never falls back (C2): only the first outcome counts.
          onOutcome: (outcome) => settle(outcome.kind === "playing" ? "shown" : "failed"),
        });
        player.load(manifestUrl(target, args.plan)).then(
          () => {
            if (settled) return;
            video.muted = true;
            // Not awaited: the outcome comes from watchPlayback. A refused play() before any frame is a failure.
            const playing = video.play() as Promise<void> | undefined;
            playing?.catch?.(() => settle("failed"));
          },
          () => settle("failed"),
        );
      });
    },
    async destroy() {
      settleCurrent?.();
      stopPausing?.();
      current = null;
      await player.destroy().catch(() => {});
    },
  };
}
