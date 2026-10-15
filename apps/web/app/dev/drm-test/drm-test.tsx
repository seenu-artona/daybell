"use client";

import type { DrmTestTokenResponse } from "@daybell/api";
import { Button, Card } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { BlackoutPhoto, useDesktopPointer } from "@/app/_components/blackout";
import { ProtectedImage } from "@/app/shop/_components/protected-image";
import { ProtectionProvider } from "@/app/shop/_components/protection";
import { api } from "@/lib/client-api";
import {
  DRM_PROBES,
  type DrmProbeId,
  type PlaybackPlan,
  type ProbeResult,
  playbackPlan,
  probeDrm,
} from "@/lib/drm-capabilities";

const FALLBACK_SRC = "/drm-test/fallback.jpg";
const TOKEN_PATH = "/dev/drm-test/token";

type Status =
  | { kind: "loading" }
  | { kind: "playing"; keySystem: string }
  | { kind: "fallback"; reason: "noHardware" | "fairplayOff" }
  | { kind: "failed"; detail: string };

type ShakaModule = typeof import("shaka-player/dist/shaka-player.compiled").default;
type ShakaPlayer = InstanceType<ShakaModule["Player"]>;

/** Which words name a key system. */
function systemKey(keySystem: string): "widevine" | "playready" | "fairplay" | "other" {
  if (keySystem.startsWith("com.widevine")) return "widevine";
  if (keySystem.includes("playready")) return "playready";
  if (keySystem.startsWith("com.apple.fps")) return "fairplay";
  return "other";
}

/**
 * The DRM test page's screen (spike; D158; ADR 0032): what this device supports, then the test clip played with
 * hardware DRM, paused on its only picture; or, when there is no hardware DRM or playback fails, today's watermarked
 * photo (Blackout mode on a computer, the shop's blur on a phone). Every license request gets a fresh token from the
 * API (good for 60 seconds), sent only to Axinom's license server in the X-AxDRM-Message header. Nothing is logged.
 */
export function DrmTest() {
  const t = useTranslations("drmTest");
  const desktop = useDesktopPointer();
  const video = useRef<HTMLVideoElement>(null);
  const [results, setResults] = useState<Record<DrmProbeId, ProbeResult> | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  const run = useCallback(
    async (isCancelled: () => boolean, keep: (player: ShakaPlayer) => void) => {
      const probed = await probeDrm();
      if (isCancelled()) return;
      setResults(probed);

      const first = await api<DrmTestTokenResponse>(TOKEN_PATH, { method: "POST" });
      if (isCancelled()) return;
      if (!first.ok) {
        setStatus({ kind: "failed", detail: t("errors.token", { code: first.code }) });
        return;
      }
      const config = first.data;
      const plan: PlaybackPlan = playbackPlan(probed, config.fairplayCertificateUrl !== null);
      if (plan.kind === "none") {
        const fairplayOff = probed.fairplay === "supported" && !config.fairplayCertificateUrl;
        setStatus({ kind: "fallback", reason: fairplayOff ? "fairplayOff" : "noHardware" });
        return;
      }

      const shaka = (await import("shaka-player/dist/shaka-player.compiled")).default;
      if (isCancelled() || !video.current) return;
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        setStatus({ kind: "failed", detail: t("errors.unsupported") });
        return;
      }
      const player = new shaka.Player();
      keep(player);
      await player.attach(video.current);
      const playready = config.licenseUrls.playready;
      const mapping = player.getConfiguration().drm.keySystemsMapping;
      player.configure({
        drm: {
          servers:
            plan.kind === "fairplay" && config.licenseUrls.fairplay
              ? { "com.apple.fps": config.licenseUrls.fairplay }
              : {
                  "com.widevine.alpha": config.licenseUrls.widevine,
                  "com.microsoft.playready": playready,
                  "com.microsoft.playready.recommendation": playready,
                  "com.microsoft.playready.recommendation.3000": playready,
                },
          // Hardware only, as the token's policy asks (a software CDM would be refused by the license server).
          advanced: {
            "com.widevine.alpha": { videoRobustness: ["HW_SECURE_ALL"] },
            "com.microsoft.playready.recommendation": { videoRobustness: ["3000"] },
            ...(config.fairplayCertificateUrl
              ? { "com.apple.fps": { serverCertificateUri: config.fairplayCertificateUrl } }
              : {}),
          },
          // Shaka maps PlayReady per browser already (e.g. Chrome on Windows to recommendation.3000); elsewhere
          // the plain name becomes the "recommendation" one, where SL3000 can be asked for.
          ...(mapping["com.microsoft.playready"]
            ? {}
            : {
                keySystemsMapping: {
                  "com.microsoft.playready": "com.microsoft.playready.recommendation",
                },
              }),
        },
      });
      const net = player.getNetworkingEngine();
      net?.registerRequestFilter(async (type, request) => {
        if (type !== shaka.net.NetworkingEngine.RequestType.LICENSE) return;
        const fresh = await api<DrmTestTokenResponse>(TOKEN_PATH, { method: "POST" });
        if (!fresh.ok) throw new Error(fresh.code);
        request.headers["X-AxDRM-Message"] = fresh.data.token;
      });
      if (plan.kind === "fairplay")
        net?.registerResponseFilter(shaka.drm.FairPlay.commonFairPlayResponse);

      await player.load(plan.manifest);
      if (isCancelled()) return;
      const element = video.current;
      if (element) {
        // Some browsers only paint a frame once playing: play the muted clip and stop on its first picture.
        element.addEventListener("playing", () => element.pause(), { once: true });
        await element.play().catch(() => {});
      }
      const keySystem = player.drmInfo()?.keySystem ?? player.keySystem();
      setStatus({ kind: "playing", keySystem });
    },
    [t],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the test (Try again).
  useEffect(() => {
    let cancelled = false;
    let player: ShakaPlayer | null = null;
    setStatus({ kind: "loading" });
    run(
      () => cancelled,
      (p) => {
        player = p;
      },
    ).catch((err: unknown) => {
      if (cancelled) return;
      const code =
        typeof err === "object" && err !== null && "code" in err ? String(err.code) : "unknown";
      setStatus({ kind: "failed", detail: t("errors.shaka", { code }) });
    });
    return () => {
      cancelled = true;
      void (player as ShakaPlayer | null)?.destroy();
    };
  }, [run, t, attempt]);

  const fallback = status.kind === "fallback" || status.kind === "failed";
  const statusWords =
    status.kind === "loading"
      ? t("player.loading")
      : status.kind === "playing"
        ? t("player.playing", {
            system: t(`player.system.${systemKey(status.keySystem)}`, {
              keySystem: status.keySystem,
            }),
          })
        : status.kind === "fallback"
          ? t(`fallback.${status.reason}`)
          : t("fallback.failed", { detail: status.detail });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-h1">{t("title")}</h1>
        <p className="m-0 text-body text-muted">{t("intro")}</p>
        <p className="m-0 text-body font-semibold">{t("instruction")}</p>
      </header>

      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-title-sm">{t("capabilities.title")}</h2>
        {results ? (
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[1fr_auto]">
            {DRM_PROBES.map((probe) => (
              <div key={probe.id} className="contents">
                <dt className="text-sm">{t(`capabilities.probe.${probe.id}`)}</dt>
                <dd className="m-0 text-sm font-semibold">
                  {t(`capabilities.result.${results[probe.id]}`)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-sm text-muted">{t("capabilities.checking")}</p>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-title-sm">{fallback ? t("fallback.title") : t("player.title")}</h2>
        <p role="status" className="m-0 text-sm">
          {statusWords}
        </p>
        <video
          ref={video}
          aria-label={t("player.videoLabel")}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          className={fallback ? "hidden" : "block aspect-[3/2] w-full rounded-md bg-ink"}
        />
        {fallback ? (
          <>
            <p className="m-0 text-sm text-muted">
              {desktop ? t("fallback.desktop") : t("fallback.phone")}
            </p>
            {desktop ? (
              <BlackoutPhoto
                src={FALLBACK_SRC}
                alt={t("fallback.alt")}
                label={t("fallback.label")}
                className="aspect-[3/2] w-full"
              />
            ) : (
              <ProtectionProvider>
                <ProtectedImage
                  src={FALLBACK_SRC}
                  alt={t("fallback.alt")}
                  fit="contain"
                  eager
                  className="aspect-[3/2] w-full rounded-md"
                />
              </ProtectionProvider>
            )}
          </>
        ) : null}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={status.kind === "loading"}
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t("player.retry")}
          </Button>
        </div>
      </Card>
    </main>
  );
}
