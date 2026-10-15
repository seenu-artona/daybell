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
  createTimeline,
  describeVideo,
  type FallbackReason,
  licenseRequestFilter,
  type Outcome,
  prepare,
  watchPlayback,
} from "@/lib/drm-test-player";

/** Video element events the diagnostics record (Seenu, Oct 14). */
const DIAGNOSTIC_EVENTS = [
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "canplaythrough",
  "play",
  "playing",
  "pause",
  "waiting",
  "stalled",
  "suspend",
  "seeking",
  "seeked",
  "ended",
  "resize",
  "encrypted",
  "waitingforkey",
  "error",
] as const;

/** Shaka's load modes, by number (shaka.Player.LoadMode). */
const LOAD_MODES = ["DESTROYED", "NOT_LOADED", "MEDIA_SOURCE", "SRC_EQUALS"];

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
 * lib/drm-test-player.ts (tested): the order of the checks, a fresh token on license requests only, and "showing" once
 * a frame is ready (decoded with a size, or presented); any error, a restricted key or 15 seconds without a picture is
 * a failure, in words. A Diagnostics timeline (no keys or tokens) can be copied and sent back; nothing is logged.
 */
export function DrmTest() {
  const t = useTranslations("drmTest");
  const desktop = useDesktopPointer();
  const video = useRef<HTMLVideoElement>(null);
  const [results, setResults] = useState<Record<DrmProbeId, ProbeResult> | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [diagnostics, setDiagnostics] = useState("");
  const [copied, setCopied] = useState<"" | "copied" | "copyFailed">("");

  const failure = useCallback(
    (outcome: Extract<Outcome, { kind: "failed" }>) =>
      t(`errors.${outcome.reason}`, { code: outcome.code || "?" }),
    [t],
  );

  const run = useCallback(
    async (
      isCancelled: () => boolean,
      onCleanup: (cleanup: () => void) => void,
      log: (line: string) => void,
    ) => {
      log(`user agent: ${navigator.userAgent}`);
      const prepared = await prepare({
        probe: () => probeDrm(),
        onProbed: (probed) => {
          log(
            `probes: ${Object.entries(probed)
              .map(([id, result]) => `${id}=${result}`)
              .join(" ")}`,
          );
          setResults(probed);
        },
        token: () => api<DrmTestTokenResponse>(TOKEN_PATH, { method: "POST" }),
        clipBuilt,
        cancelled: isCancelled,
      });
      if (!prepared) return;
      log(
        `prepared: ${prepared.kind}${prepared.kind === "fallback" ? ` (${prepared.reason})` : ""}`,
      );
      if (prepared.kind === "fallback") {
        setStatus({ kind: "fallback", reason: prepared.reason });
        return;
      }
      if (prepared.kind === "failed") {
        setStatus({ kind: "failed", detail: t("errors.token", { code: prepared.code }) });
        return;
      }
      const { plan, config } = prepared;
      log(
        `plan: ${plan.kind === "fairplay" ? "HLS + FairPlay" : "DASH + Widevine/PlayReady"} (${plan.manifest}); FairPlay certificate ${config.fairplayCertificateUrl ? "set" : "not set"}`,
      );

      const shaka: ShakaModule = (await import("shaka-player/dist/shaka-player.compiled")).default;
      const element = video.current;
      if (isCancelled() || !element) return;
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        setStatus({ kind: "failed", detail: t("errors.unsupported") });
        return;
      }
      log(`shaka ${shaka.Player.version}`);
      const player = new shaka.Player();
      onCleanup(() => void player.destroy());
      await player.attach(element);
      const playready = config.licenseUrls.playready;
      const mapping = player.getConfiguration().drm.keySystemsMapping;
      player.configure({
        // Safari: play FairPlay HLS natively (src=), as Shaka recommends; this is already Shaka 5's default, set here
        // so it is visible. Other browsers play DASH through Media Source Extensions.
        streaming: { useNativeHlsForFairPlay: true },
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

      // Diagnostics: every video event with the element's state, Shaka's key statuses and errors. No request, header,
      // token or key is ever recorded (lib/drm-test-player.ts, safeDiagnostic).
      const onVideoEvent = (event: Event) => {
        const extra =
          event.type === "error" && element.error
            ? ` code=${element.error.code} ${element.error.message}`
            : event.type === "encrypted"
              ? ` initDataType=${(event as MediaEncryptedEvent).initDataType}`
              : "";
        log(`video ${event.type}${extra} ${describeVideo(element)}`);
      };
      for (const type of DIAGNOSTIC_EVENTS) element.addEventListener(type, onVideoEvent);
      onCleanup(() => {
        for (const type of DIAGNOSTIC_EVENTS) element.removeEventListener(type, onVideoEvent);
      });
      const onKeyStatus = () => {
        const statuses = Object.entries(player.getKeyStatuses()).map(
          ([keyId, keyStatus]) => `${keyId.slice(0, 8)}…=${keyStatus}`,
        );
        log(`shaka keystatuschanged ${statuses.join(" ") || "(none reported)"}`);
      };
      const onShakaError = (event: Event) => {
        const detail = (
          event as CustomEvent<{ code?: number; category?: number; severity?: number }>
        ).detail;
        log(
          `shaka error code=${detail?.code ?? "?"} category=${detail?.category ?? "?"} severity=${detail?.severity ?? "?"}`,
        );
      };
      player.addEventListener("keystatuschanged", onKeyStatus);
      player.addEventListener("error", onShakaError);
      onCleanup(() => {
        player.removeEventListener("keystatuschanged", onKeyStatus);
        player.removeEventListener("error", onShakaError);
      });

      // Listening starts before loading, so no error or decoded frame is missed.
      onCleanup(
        watchPlayback({
          player,
          video: element,
          keyStatuses: () => player.getKeyStatuses(),
          onOutcome: (outcome) => {
            if (isCancelled()) return;
            log(
              `outcome: ${outcome.kind === "playing" ? "shown" : `failed (${outcome.reason}${outcome.code ? ` ${outcome.code}` : ""})`} ${describeVideo(element)}`,
            );
            setStatus(
              outcome.kind === "playing"
                ? { kind: "playing", keySystem: player.drmInfo()?.keySystem ?? player.keySystem() }
                : { kind: "failed", detail: failure(outcome) },
            );
          },
        }),
      );
      // Some browsers (Safari) only paint a frame once playing: play the muted clip, and pause only once a frame has
      // been presented (a video frame callback, or else the first time update past 0), never on "playing", which can
      // come before anything is painted.
      let paused = false;
      const pauseOnce = (why: string) => {
        if (paused) return;
        paused = true;
        log(`pausing after ${why} ${describeVideo(element)}`);
        element.pause();
      };
      if (typeof element.requestVideoFrameCallback === "function") {
        const handle = element.requestVideoFrameCallback(() => {
          log("video frame callback: a frame was presented");
          pauseOnce("the first presented frame");
        });
        onCleanup(() => element.cancelVideoFrameCallback(handle));
      } else {
        log("no requestVideoFrameCallback: pausing on the first time update");
      }
      const onTime = () => {
        if (element.currentTime > 0) pauseOnce("the first time update");
      };
      element.addEventListener("timeupdate", onTime);
      onCleanup(() => element.removeEventListener("timeupdate", onTime));

      try {
        await player.load(plan.manifest);
      } catch (err) {
        const e = err as { code?: number; category?: number };
        log(`shaka load rejected code=${e?.code ?? "?"} category=${e?.category ?? "?"}`);
        throw err;
      }
      if (isCancelled()) return;
      log(
        `shaka load resolved: mode=${LOAD_MODES[player.getLoadMode()] ?? player.getLoadMode()} keySystem=${player.drmInfo()?.keySystem ?? (player.keySystem() || "(none yet)")} ${describeVideo(element)}`,
      );
      element.muted = true;
      // Not awaited: the outcome comes from watchPlayback, never from play()'s promise; both answers are recorded.
      element.play().then(
        () => log(`play() resolved ${describeVideo(element)}`),
        (err: unknown) =>
          log(
            `play() rejected ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
          ),
      );
    },
    [t, failure],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the test (Try again).
  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    const timeline = createTimeline();
    const log = (line: string) => {
      if (cancelled) return;
      timeline.add(line);
      setDiagnostics(timeline.text());
    };
    setStatus({ kind: "loading" });
    setResults(null);
    setDiagnostics("");
    setCopied("");
    run(
      () => cancelled,
      (cleanup) => cleanups.push(cleanup),
      log,
    ).catch((err: unknown) => {
      if (cancelled) return;
      const code =
        typeof err === "object" && err !== null && "code" in err ? String(err.code) : "?";
      log(`failed: ${code}`);
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

      {/* Open by itself when the protected photo fails, so the timeline is right there to copy. */}
      <details
        key={`${attempt}-${status.kind === "failed" ? "open" : "closed"}`}
        open={status.kind === "failed"}
        className="rounded-lg border border-line bg-surface p-4"
      >
        <summary className="min-h-11 cursor-pointer content-center text-title-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {t("diagnostics.title")}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="m-0 text-sm text-muted">{t("diagnostics.intro")}</p>
          <pre
            // Focusable so keyboard users can scroll it.
            tabIndex={0}
            aria-label={t("diagnostics.label")}
            className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-canvas p-3 text-caption focus-visible:outline-2 focus-visible:outline-primary"
          >
            {diagnostics || t("diagnostics.empty")}
          </pre>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={!diagnostics}
              onClick={() => {
                navigator.clipboard?.writeText(diagnostics).then(
                  () => setCopied("copied"),
                  () => setCopied("copyFailed"),
                ) ?? setCopied("copyFailed");
              }}
            >
              {t("diagnostics.copy")}
            </Button>
            <p role="status" className="m-0 text-sm">
              {copied ? t(`diagnostics.${copied}`) : ""}
            </p>
          </div>
        </div>
      </details>
    </main>
  );
}
