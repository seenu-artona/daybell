import type { DrmTestTokenResponse } from "@daybell/api";
import type { ApiResult } from "./client-api";
import {
  type DrmProbeId,
  type PlaybackPlan,
  type ProbeResult,
  playbackPlan,
} from "./drm-capabilities";
import { safeDiagnostic, watchPlayback as watchShared } from "./shop/drm-player";

// Shared with the parent shop's large view (ADR 0034): moved to lib/shop/drm-player.ts, re-exported for the test page.
export {
  type FailureReason,
  frameReady,
  type Listenable,
  licenseRequestFilter,
  type Outcome,
  safeDiagnostic,
  type WatchedVideo,
} from "./shop/drm-player";

/**
 * The DRM test page's decisions, apart from React and Shaka so they can be tested (spike; D158; ADR 0032): the order
 * of the checks before playing and the diagnostics. The license request filter and when a clip counts as shown or
 * failed are shared with the shop (lib/shop/drm-player.ts).
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

/** How long the clip may take to show before the page calls it a failure. */
export const PLAYBACK_TIMEOUT_MS = 15_000;

/** The shop's watcher (lib/shop/drm-player.ts) with the test page's 15 seconds unless told otherwise. */
export function watchPlayback(
  args: Omit<Parameters<typeof watchShared>[0], "timeoutMs"> & { timeoutMs?: number },
): () => void {
  return watchShared({ ...args, timeoutMs: args.timeoutMs ?? PLAYBACK_TIMEOUT_MS });
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
