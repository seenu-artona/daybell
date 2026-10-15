"use client";

import { createContext, type ReactNode, useContext, useMemo, useRef } from "react";
import {
  type DrmPlan,
  type DrmSetup,
  type DrmTarget,
  drmOffForTab,
  planFromProbes,
  probeShopDrm,
  recordOutcome,
  type ShakaLike,
  storedPlan,
  storePlan,
} from "@/lib/shop/drm-player";
import { shopApi } from "@/lib/shop-client";

/**
 * The large view's DRM for the whole shop (D158; ADR 0034). Nothing happens until a parent opens a large view: then,
 * once per gallery, whether DRM is on there (GET /shop/drm), and once per tab, which hardware DRM this browser has
 * (C7: kept in sessionStorage as a plan, nothing personal). Shaka Player is only loaded when a plan exists. Two failures
 * in a row turn DRM off for the rest of the tab (C2); fallback is silent.
 *
 * Review fixes: a gallery that says DRM isn't on (or this browser's plan of "none") is remembered for the tab, so its
 * photos open as the WebP at once (#9); a GET /shop/drm that failed (network, server, timeout) is not remembered and is
 * asked again next time, counting as a failure (#8). Every step can be given up (the viewer's signal; #4, #5).
 */
export type DrmReady =
  | { kind: "ready"; plan: Exclude<DrmPlan, "none">; setup: DrmSetup }
  /** Not protected here: no switch or setup for the gallery, or no hardware DRM. Not a failure. */
  | { kind: "off" }
  /** Couldn't find out (network, server, timeout, given up): a failure, asked again next time. */
  | { kind: "failed" };

export interface DrmContextValue {
  /** Whether a gallery's large views are known to be the WebP for this tab: shown at once, nothing asked. */
  knownOff(galleryId: string): boolean;
  /** For a gallery: how to play its protected large views here. */
  prepare(galleryId: string, signal: AbortSignal): Promise<DrmReady>;
  loadShaka(signal: AbortSignal): Promise<ShakaLike>;
  /** A fresh license token for the photo being shown; never once its signal is aborted. */
  token(target: DrmTarget, signal: AbortSignal): Promise<string>;
  /** A large view was shown under DRM, or fell back. */
  report(shown: boolean): void;
}

const off: DrmContextValue = {
  knownOff: () => true,
  prepare: async () => ({ kind: "off" }),
  loadShaka: () => Promise.reject(new Error("drm_off")),
  token: () => Promise.reject(new Error("drm_off")),
  report: () => {},
};

const DrmContext = createContext<DrmContextValue>(off);

/** Shaka Player 5.2.12, compiled, imported only when a protected large view is about to play. */
const importShaka = async (): Promise<ShakaLike> =>
  (await import("shaka-player/dist/shaka-player.compiled")).default as unknown as ShakaLike;

/** A promise that gives up with the signal. */
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export function DrmProvider({
  children,
  loadShaka = importShaka,
  probe = probeShopDrm,
  api = shopApi,
}: {
  children: ReactNode;
  loadShaka?: () => Promise<ShakaLike>;
  probe?: typeof probeShopDrm;
  api?: Pick<typeof shopApi, "drm" | "drmToken">;
}) {
  /** Galleries whose setup is known: enabled (with it) or not (null). Failed reads are never kept (#8). */
  const setups = useRef(new Map<string, DrmSetup | null>());
  const planning = useRef<Promise<DrmPlan> | null>(null);

  const value = useMemo<DrmContextValue>(() => {
    const setupFor = async (
      galleryId: string,
      signal: AbortSignal,
    ): Promise<DrmSetup | null | "failed"> => {
      const known = setups.current.get(galleryId);
      if (known !== undefined) return known;
      const res = await api.drm(galleryId, signal);
      if (!res.ok) return "failed";
      const setup =
        res.data.enabled && res.data.licenseUrls
          ? {
              licenseUrls: res.data.licenseUrls,
              fairplayCertificateUrl: res.data.fairplayCertificateUrl,
            }
          : null;
      setups.current.set(galleryId, setup);
      return setup;
    };
    const plan = () => {
      const stored = storedPlan();
      if (stored) return Promise.resolve(stored);
      planning.current ??= probe().then((results) => {
        // FairPlay is kept as possible; whether a gallery has its certificate is checked per gallery.
        const made = planFromProbes(results, true);
        storePlan(made);
        return made;
      });
      return planning.current;
    };
    return {
      knownOff: (galleryId) =>
        drmOffForTab() || storedPlan() === "none" || setups.current.get(galleryId) === null,
      async prepare(galleryId, signal) {
        if (drmOffForTab()) return { kind: "off" };
        const setup = await withSignal(setupFor(galleryId, signal), signal).catch(
          () => "failed" as const,
        );
        if (setup === "failed") return { kind: "failed" };
        if (!setup) return { kind: "off" };
        const chosen = await withSignal(plan(), signal).catch(() => "failed" as const);
        if (chosen === "failed") return { kind: "failed" };
        if (chosen === "none") return { kind: "off" };
        if (chosen === "fairplay" && (!setup.licenseUrls.fairplay || !setup.fairplayCertificateUrl))
          return { kind: "off" };
        return { kind: "ready", plan: chosen, setup };
      },
      loadShaka: (signal) => withSignal(loadShaka(), signal),
      async token(target, signal) {
        if (signal.aborted) throw new Error("aborted");
        const res = await api.drmToken(target.galleryId, target.childId, target.photoId, signal);
        if (!res.ok) throw new Error(res.code);
        return res.data.token;
      },
      report: (shown) => recordOutcome(shown),
    };
  }, [api, loadShaka, probe]);

  return <DrmContext.Provider value={value}>{children}</DrmContext.Provider>;
}

export function useDrm(): DrmContextValue {
  return useContext(DrmContext);
}
