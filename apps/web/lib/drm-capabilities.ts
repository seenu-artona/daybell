/**
 * What this device's browser says about hardware DRM (D158; ADR 0032). Each probe asks requestMediaKeySystemAccess
 * for the test clip's format (H.264 High in MP4, cbcs) at one key system and robustness. Browser-only; no network.
 */
export const DRM_PROBES = [
  { id: "widevineHwAll", keySystem: "com.widevine.alpha", robustness: "HW_SECURE_ALL" },
  { id: "widevineHwDecode", keySystem: "com.widevine.alpha", robustness: "HW_SECURE_DECODE" },
  { id: "widevineSwDecode", keySystem: "com.widevine.alpha", robustness: "SW_SECURE_DECODE" },
  { id: "playready3000", keySystem: "com.microsoft.playready.recommendation", robustness: "3000" },
  { id: "playready2000", keySystem: "com.microsoft.playready.recommendation", robustness: "2000" },
  {
    id: "playready3000KeySystem",
    keySystem: "com.microsoft.playready.recommendation.3000",
    robustness: "",
  },
  { id: "fairplay", keySystem: "com.apple.fps", robustness: "" },
] as const;

export type DrmProbeId = (typeof DRM_PROBES)[number]["id"];
export type ProbeResult = "supported" | "notSupported" | "noEme";

/** The clip's codec string (H.264 High, level 4.0), as the packager wrote it. */
export const TEST_CLIP_CODEC = 'video/mp4; codecs="avc1.640028"';

type RequestAccess = (
  keySystem: string,
  configs: MediaKeySystemConfiguration[],
) => Promise<unknown>;

export function probeConfig(probe: (typeof DRM_PROBES)[number]): MediaKeySystemConfiguration {
  const fairplay = probe.keySystem === "com.apple.fps";
  return {
    initDataTypes: fairplay ? ["sinf", "skd"] : ["cenc"],
    videoCapabilities: [
      {
        contentType: TEST_CLIP_CODEC,
        ...(probe.robustness ? { robustness: probe.robustness } : {}),
        // The EME encryption scheme extension; browsers that don't know it ignore it.
        encryptionScheme: "cbcs",
      } as MediaKeySystemMediaCapability,
    ],
  };
}

export async function probeDrm(
  request: RequestAccess | undefined = typeof navigator !== "undefined" &&
  typeof navigator.requestMediaKeySystemAccess === "function"
    ? navigator.requestMediaKeySystemAccess.bind(navigator)
    : undefined,
): Promise<Record<DrmProbeId, ProbeResult>> {
  const entries = await Promise.all(
    DRM_PROBES.map(async (probe): Promise<[DrmProbeId, ProbeResult]> => {
      if (!request) return [probe.id, "noEme"];
      try {
        await request(probe.keySystem, [probeConfig(probe)]);
        return [probe.id, "supported"];
      } catch {
        return [probe.id, "notSupported"];
      }
    }),
  );
  return Object.fromEntries(entries) as Record<DrmProbeId, ProbeResult>;
}

/** Which way the page plays the clip: FairPlay with HLS, hardware Widevine or PlayReady with DASH, or not at all. */
export type PlaybackPlan =
  | { kind: "fairplay"; manifest: string }
  | { kind: "dash"; manifest: string }
  | { kind: "none" };

export function playbackPlan(
  results: Record<DrmProbeId, ProbeResult>,
  fairplayConfigured: boolean,
): PlaybackPlan {
  const ok = (id: DrmProbeId) => results[id] === "supported";
  if (ok("widevineHwAll") || ok("playready3000") || ok("playready3000KeySystem"))
    return { kind: "dash", manifest: "/drm-test/manifest.mpd" };
  if (ok("fairplay") && fairplayConfigured)
    return { kind: "fairplay", manifest: "/drm-test/master.m3u8" };
  return { kind: "none" };
}
