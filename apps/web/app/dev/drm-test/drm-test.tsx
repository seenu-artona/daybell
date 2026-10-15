"use client";

import type { DrmTestTokenResponse } from "@daybell/api";
import { Button, Card } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { BlackoutPhoto, useDesktopPointer } from "@/app/_components/blackout";
import { ProtectedImage } from "@/app/shop/_components/protected-image";
import { ProtectionProvider } from "@/app/shop/_components/protection";
import { api } from "@/lib/client-api";
import { DRM_PROBES, type DrmProbeId, type ProbeResult, probeDrm } from "@/lib/drm-capabilities";
import {
  type FallbackReason,
  licenseRequestFilter,
  type Outcome,
  prepare,
  watchPlayback,
} from "@/lib/drm-test-player";

const FALLBACK_SRC = "/drm-test/fallback.jpg";
const TOKEN_PATH = "/dev/drm-test/token";

type Status =
  | { kind: "loading" }
  | { kind: "playing"; keySystem: string }
  | { kind: "fallback"; reason: FallbackReason }
  | { kind: "failed"; detail: string };

type ShakaModule = typeof import("shaka-player/dist/shaka-player.compiled").default;

/** Which words name a key system. */
function systemKey(keySystem: string): "widevine" | "playready" | "fairplay" | "other" {
  if (keySystem.startsWith("com.widevine")) return "widevine";
  if (keySystem.includes("playready")) return "playready";
  if (keySystem.startsWith("com.apple.fps")) return "fairplay";
  return "other";
}

async function clipBuilt(manifest: string): Promise<boolean> {
  const res = await fetch(manifest, { method: "HEAD", cache: "no-store" }).catch(() => null);
  return res?.ok === true;
}

async function freshToken(): Promise<string> {
  const res = await api<DrmTestTokenResponse>(TOKEN_PATH, { method: "POST" });
  if (!res.ok) throw new Error(res.code);
  return res.data.token;
}

/**
 * The DRM test page's screen (spike; D158; ADR 0032): what this device supports, then the test clip played with
 * hardware DRM, stopped on its only picture; or, when there is no hardware DRM, the test isn't set up, or playback
 * fails, today's watermarked photo (Blackout mode on a computer, the shop's blur on a phone). The decisions live in
 * lib/drm-test-player.ts (tested): the order of the checks, a fresh token on license requests only, and "showing" only
 * once a frame is decoded with a usable key; any error, a restricted key or 15 seconds without a picture is a failure,
 * in words. Nothing is logged.
 */
export function DrmTest() {
  const t = useTranslations("drmTest");
  const desktop = useDesktopPointer();
  const video = useRef<HTMLVideoElement>(null);
  const [results, setResults] = useState<Record<DrmProbeId, ProbeResult> | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  const failure = useCallback(
    (outcome: Extract<Outcome, { kind: "failed" }>) =>
      t(`errors.${outcome.reason}`, { code: outcome.code || "?" }),
    [t],
  );

  const run = useCallback(
    async (isCancelled: () => boolean, onCleanup: (cleanup: () => void) => void) => {
      const prepared = await prepare({
        probe: () => probeDrm(),
        onProbed: setResults,
        token: () => api<DrmTestTokenResponse>(TOKEN_PATH, { method: "POST" }),
        clipBuilt,
        cancelled: isCancelled,
      });
      if (!prepared) return;
      if (prepared.kind === "fallback") {
        setStatus({ kind: "fallback", reason: prepared.reason });
        return;
      }
      if (prepared.kind === "failed") {
        setStatus({ kind: "failed", detail: t("errors.token", { code: prepared.code }) });
        return;
      }
      const { plan, config } = prepared;

      const shaka: ShakaModule = (await import("shaka-player/dist/shaka-player.compiled")).default;
      const element = video.current;
      if (isCancelled() || !element) return;
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        setStatus({ kind: "failed", detail: t("errors.unsupported") });
        return;
      }
      const player = new shaka.Player();
      onCleanup(() => void player.destroy());
      await player.attach(element);
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
      net?.registerRequestFilter(
        licenseRequestFilter(shaka.net.NetworkingEngine.RequestType.LICENSE, freshToken),
      );
      if (plan.kind === "fairplay")
        net?.registerResponseFilter(shaka.drm.FairPlay.commonFairPlayResponse);

      // Listening starts before loading, so no error or decoded frame is missed.
      onCleanup(
        watchPlayback({
          player,
          video: element,
          keyStatuses: () => player.getKeyStatuses(),
          onOutcome: (outcome) => {
            if (isCancelled()) return;
            setStatus(
              outcome.kind === "playing"
                ? { kind: "playing", keySystem: player.drmInfo()?.keySystem ?? player.keySystem() }
                : { kind: "failed", detail: failure(outcome) },
            );
          },
        }),
      );
      // Some browsers only paint a frame once playing: play the muted clip and stop on its first picture.
      element.addEventListener("playing", () => element.pause(), { once: true });
      await player.load(plan.manifest);
      if (isCancelled()) return;
      // Not awaited: the outcome comes from watchPlayback, never from play()'s promise.
      void element.play().catch(() => {});
    },
    [t, failure],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the test (Try again).
  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    setStatus({ kind: "loading" });
    setResults(null);
    run(
      () => cancelled,
      (cleanup) => cleanups.push(cleanup),
    ).catch((err: unknown) => {
      if (cancelled) return;
      const code =
        typeof err === "object" && err !== null && "code" in err ? String(err.code) : "?";
      setStatus({ kind: "failed", detail: t("errors.player", { code }) });
    });
    return () => {
      cancelled = true;
      for (const cleanup of cleanups.reverse()) cleanup();
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
          <Button type="button" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {t("player.retry")}
          </Button>
        </div>
      </Card>
    </main>
  );
}
