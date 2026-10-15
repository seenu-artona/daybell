import { type DrmProbeId, type ProbeResult, planFromProbes } from "./shop/drm-probes";

/**
 * The DRM test page's view of the device (D158; ADR 0032): the probes and the plan are the shop's
 * (lib/shop/drm-probes.ts), so the page and the large view decide alike; the page only adds where its own clip is.
 */
export {
  DRM_PROBES,
  type DrmProbeId,
  type ProbeResult,
  probeConfig,
  probeDrm,
} from "./shop/drm-probes";

/** Which way the page plays the clip: FairPlay with HLS, hardware Widevine or PlayReady with DASH, or not at all. */
export type PlaybackPlan =
  | { kind: "fairplay"; manifest: string }
  | { kind: "dash"; manifest: string }
  | { kind: "none" };

export function playbackPlan(
  results: Record<DrmProbeId, ProbeResult>,
  fairplayConfigured: boolean,
): PlaybackPlan {
  const plan = planFromProbes(results, fairplayConfigured);
  if (plan === "dash") return { kind: "dash", manifest: "/drm-test/manifest.mpd" };
  if (plan === "fairplay") return { kind: "fairplay", manifest: "/drm-test/master.m3u8" };
  return { kind: "none" };
}
