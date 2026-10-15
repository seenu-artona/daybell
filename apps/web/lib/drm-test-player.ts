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

/**
 * Watches one playback attempt. "playing" only once the first frame is decoded (loadeddata, or readyState already at
 * HAVE_CURRENT_DATA) and a key is usable; a failure on Shaka's error, the video's error, a key that is output-restricted
 * or has an internal error, or nothing within the timeout. A failure is final; "playing" is reported once and can
 * still be followed by a failure (e.g. a key turning output-restricted when a screen is plugged in). Returns a cleanup.
 */
/** Anything events can be listened to on: a video element, or Shaka's player (its own event target, not the DOM's). */
export interface Listenable {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export function watchPlayback(args: {
  player: Listenable;
  video: Listenable & { readyState: number; error: { code: number } | null };
  keyStatuses: () => Record<string, string>;
  onOutcome: (outcome: Outcome) => void;
  timeoutMs?: number;
}): () => void {
  const { player, video, keyStatuses, onOutcome } = args;
  let failed = false;
  let playing = false;

  const fail = (reason: FailureReason, code = "") => {
    if (failed) return;
    failed = true;
    stop();
    onOutcome({ kind: "failed", reason, code });
  };
  const check = () => {
    if (failed) return;
    const statuses = Object.values(keyStatuses());
    if (statuses.includes("output-restricted")) return fail("outputRestricted");
    if (statuses.includes("internal-error")) return fail("keyError");
    if (!playing && video.readyState >= HAVE_CURRENT_DATA && statuses.includes("usable")) {
      playing = true;
      clearTimeout(timer);
      onOutcome({ kind: "playing" });
    }
  };
  const onPlayerError = (event: Event) => {
    const detail = (event as CustomEvent<{ code?: number } | undefined>).detail;
    fail("player", detail?.code === undefined ? "" : String(detail.code));
  };
  const onVideoError = () => fail("media", video.error ? String(video.error.code) : "");

  player.addEventListener("error", onPlayerError);
  player.addEventListener("keystatuschanged", check);
  video.addEventListener("loadeddata", check);
  video.addEventListener("error", onVideoError);
  const timer = setTimeout(() => {
    if (!playing) fail("timeout");
  }, args.timeoutMs ?? PLAYBACK_TIMEOUT_MS);

  function stop() {
    clearTimeout(timer);
    player.removeEventListener("error", onPlayerError);
    player.removeEventListener("keystatuschanged", check);
    video.removeEventListener("loadeddata", check);
    video.removeEventListener("error", onVideoError);
  }
  check();
  return stop;
}
