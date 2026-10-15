import { DRM_CODEC_MIME } from "@daybell/core";

/**
 * What this device's browser says about DRM (D158), for the shop's large view (ADR 0034) and the DRM test page (ADR
 * 0032), and the plan chosen from it. Each probe asks requestMediaKeySystemAccess for the clips' format (H.264 High 4.0
 * in MP4, cbcs; core's DRM_CODEC_MIME) at one key system and robustness. Browser-only; no network.
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
        contentType: DRM_CODEC_MIME,
        ...(probe.robustness ? { robustness: probe.robustness } : {}),
        // The EME encryption scheme extension; browsers that don't know it ignore it.
        encryptionScheme: "cbcs",
      } as MediaKeySystemMediaCapability,
    ],
  };
}

const browserRequest = (): RequestAccess | undefined =>
  typeof navigator !== "undefined" && typeof navigator.requestMediaKeySystemAccess === "function"
    ? navigator.requestMediaKeySystemAccess.bind(navigator)
    : undefined;

async function probeSome(
  probes: readonly (typeof DRM_PROBES)[number][],
  request: RequestAccess | undefined,
): Promise<Record<DrmProbeId, ProbeResult>> {
  const results = Object.fromEntries(DRM_PROBES.map((p) => [p.id, "notSupported"])) as Record<
    DrmProbeId,
    ProbeResult
  >;
  await Promise.all(
    probes.map(async (probe) => {
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

/** Every probe (the test page shows them all). */
export function probeDrm(request: RequestAccess | undefined = browserRequest()) {
  return probeSome(DRM_PROBES, request);
}

/** Only the probes that can choose a plan (hardware Widevine, PlayReady SL3000, FairPlay): the others never matter. */
export const SHOP_PROBES = DRM_PROBES.filter((p) =>
  ["widevineHwAll", "playready3000", "playready3000KeySystem", "fairplay"].includes(p.id),
);

/**
 * Apple's older, prefixed EME (`WebKitMediaKeys`). Browsers inside iPhone and iPad apps (Chrome, Edge, Firefox on iOS)
 * run Safari's engine in a web view, where WebKit has turned this on since 2019 (r245491) and FairPlay plays through it
 * while the standard `requestMediaKeySystemAccess` may be missing. Shaka Player's PatchedMediaKeysApple polyfill plays
 * through it; this only asks whether FairPlay is there.
 */
export interface AppleLegacyKeys {
  isTypeSupported(keySystem: string, type?: string): boolean;
}

/** The FairPlay names Shaka asks the prefixed API for (drm_engine: "com.apple.fps.1_0", then "com.apple.fps"). */
const LEGACY_FAIRPLAY_KEY_SYSTEMS = ["com.apple.fps.1_0", "com.apple.fps"] as const;

const browserLegacyKeys = (): AppleLegacyKeys | undefined => {
  if (typeof window === "undefined") return undefined;
  const keys = (window as unknown as { WebKitMediaKeys?: Partial<AppleLegacyKeys> })
    .WebKitMediaKeys;
  return typeof keys?.isTypeSupported === "function" ? (keys as AppleLegacyKeys) : undefined;
};

/** Whether the prefixed API says it plays the clips with FairPlay. Never throws. */
export function legacyFairplaySupported(legacy: AppleLegacyKeys | undefined): boolean {
  if (!legacy) return false;
  return LEGACY_FAIRPLAY_KEY_SYSTEMS.some((keySystem) => {
    try {
      return legacy.isTypeSupported(keySystem, "video/mp4");
    } catch {
      return false;
    }
  });
}

/**
 * Whether FairPlay plays here only through the prefixed API: the standard one is missing or refuses FairPlay, and the
 * prefixed one has it. The player then installs Shaka's Apple polyfill before loading (iPhone Chrome).
 */
export async function fairplayNeedsLegacyEme(
  request: RequestAccess | undefined = browserRequest(),
  legacy: AppleLegacyKeys | undefined = browserLegacyKeys(),
): Promise<boolean> {
  if (!legacyFairplaySupported(legacy)) return false;
  const fairplay = DRM_PROBES.find((p) => p.id === "fairplay");
  if (!request || !fairplay) return true;
  try {
    await request(fairplay.keySystem, [probeConfig(fairplay)]);
    return false;
  } catch {
    return true;
  }
}

/**
 * Asks the browser, once, which hardware DRM it has for the clips' codec (no network, nothing personal). FairPlay
 * counts when either the standard API or Apple's prefixed one has it (iPhone Chrome and other in-app browsers).
 */
export async function probeShopDrm(
  request: RequestAccess | undefined = browserRequest(),
  legacy: AppleLegacyKeys | undefined = browserLegacyKeys(),
) {
  const results = await probeSome(SHOP_PROBES, request);
  if (results.fairplay !== "supported" && legacyFairplaySupported(legacy))
    results.fairplay = "supported";
  return results;
}

/** How the large view plays here: DASH with hardware Widevine or PlayReady, HLS with FairPlay, or not at all. */
export type DrmPlan = "dash" | "fairplay" | "none";

/** Hardware only; FairPlay only with its certificate. The one rule, for the shop and the test page. */
export function planFromProbes(
  results: Record<DrmProbeId, ProbeResult>,
  fairplay: boolean,
): DrmPlan {
  const ok = (id: DrmProbeId) => results[id] === "supported";
  if (ok("widevineHwAll") || ok("playready3000") || ok("playready3000KeySystem")) return "dash";
  if (ok("fairplay") && fairplay) return "fairplay";
  return "none";
}
