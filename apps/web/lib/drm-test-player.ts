import type { DrmTestTokenResponse } from "@daybell/api";
import type { ApiResult } from "./client-api";
import {
  type DrmProbeId,
  type PlaybackPlan,
  type ProbeResult,
  playbackPlan,
} from "./drm-capabilities";

/**
 * The DRM test page's decisions, apart from React and Shaka so they can be tested (spike; D158; ADR 0032): the order
 * of the checks before playing, the license request filter, and when the clip counts as shown or failed.
 */

export type FallbackReason = "noHardware" | "fairplayOff" | "notConfigured";

export type Prepared =
  | { kind: "fallback"; reason: FallbackReason }
  | { kind: "failed"; code: string }
  | {
      kind: "play";
      plan: Exclude<PlaybackPlan, { kind: "none" }>;
      config: DrmTestTokenResponse;
    };

/**
 * Before any player exists: 1. ask the browser what it supports (shown at once); 2. ask the API for a token, which also
 * says whether this deployment is set up (409: not set up) and whether FairPlay is; 3. choose DASH, HLS or the
 * fallback; 4. only then check the build made the clip (no clip: not set up). Null once cancelled.
 */
export async function prepare(steps: {
  probe: () => Promise<Record<DrmProbeId, ProbeResult>>;
  onProbed: (results: Record<DrmProbeId, ProbeResult>) => void;
  token: () => Promise<ApiResult<DrmTestTokenResponse>>;
  clipBuilt: (manifest: string) => Promise<boolean>;
  cancelled: () => boolean;
}): Promise<Prepared | null> {
  const results = await steps.probe();
  if (steps.cancelled()) return null;
  steps.onProbed(results);

  const first = await steps.token();
  if (steps.cancelled()) return null;
  if (!first.ok)
    return first.code === "conflict"
      ? { kind: "fallback", reason: "notConfigured" }
      : { kind: "failed", code: first.code };

  const config = first.data;
  const plan = playbackPlan(results, config.fairplayCertificateUrl !== null);
  if (plan.kind === "none") {
    const fairplayOff = results.fairplay === "supported" && !config.fairplayCertificateUrl;
    return { kind: "fallback", reason: fairplayOff ? "fairplayOff" : "noHardware" };
  }

  const built = await steps.clipBuilt(plan.manifest);
  if (steps.cancelled()) return null;
  if (!built) return { kind: "fallback", reason: "notConfigured" };
  return { kind: "play", plan, config };
}

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

/** How long the clip may take to show before the page calls it a failure. */
export const PLAYBACK_TIMEOUT_MS = 15_000;

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
  timeoutMs?: number;
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
  }, args.timeoutMs ?? PLAYBACK_TIMEOUT_MS);

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

// ── Diagnostics (Seenu, Oct 14: a copyable timeline to paste back from real devices) ─────────────────────────────────

/** The media element's state, for each diagnostics line. Numbers only. */
export function describeVideo(video: {
  readyState: number;
  networkState: number;
  currentTime: number;
  videoWidth: number;
  videoHeight: number;
  paused: boolean;
}): string {
  return `readyState=${video.readyState} networkState=${video.networkState} currentTime=${video.currentTime.toFixed(3)} size=${video.videoWidth}x${video.videoHeight} paused=${video.paused}`;
}

/** What may go into the diagnostics: never a token, a header or a key. A JWT-shaped or long base64/hex run is cut. */
export function safeDiagnostic(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<token>")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "<redacted>")
    .slice(0, 300);
}

/**
 * A timeline of what happened, in milliseconds since the start, as lines of plain text to copy. Each line is passed
 * through safeDiagnostic. At most 200 lines.
 */
export function createTimeline(now: () => number = () => performance.now()) {
  const start = now();
  const lines: string[] = [];
  return {
    add(text: string) {
      if (lines.length >= 200) return;
      lines.push(`+${Math.round(now() - start)}ms ${safeDiagnostic(text)}`);
    },
    text: () => lines.join("\n"),
    size: () => lines.length,
  };
}
