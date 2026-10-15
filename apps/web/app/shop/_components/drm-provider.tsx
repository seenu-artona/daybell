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
 */
export type DrmReady = { plan: Exclude<DrmPlan, "none">; setup: DrmSetup } | null;

export interface DrmContextValue {
  /** For a gallery: how to play its protected large views here, or null to show the watermarked WebP. */
  prepare(galleryId: string): Promise<DrmReady>;
  loadShaka(): Promise<ShakaLike>;
  /** A fresh license token for the photo being shown. */
  token(target: DrmTarget): Promise<string>;
  /** A large view was shown under DRM, or fell back. */
  report(shown: boolean): void;
}

const off: DrmContextValue = {
  prepare: async () => null,
  loadShaka: () => Promise.reject(new Error("drm_off")),
  token: () => Promise.reject(new Error("drm_off")),
  report: () => {},
};

const DrmContext = createContext<DrmContextValue>(off);

/** Shaka Player 5.2.12, compiled, imported only when a protected large view is about to play. */
const importShaka = async (): Promise<ShakaLike> =>
  (await import("shaka-player/dist/shaka-player.compiled")).default as unknown as ShakaLike;

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
  const configs = useRef(new Map<string, Promise<DrmSetup | null>>());
  const planning = useRef<Promise<DrmPlan> | null>(null);

  const value = useMemo<DrmContextValue>(() => {
    const setupFor = (galleryId: string) => {
      let made = configs.current.get(galleryId);
      if (!made) {
        made = api.drm(galleryId).then((res) =>
          res.ok && res.data.enabled && res.data.licenseUrls
            ? {
                licenseUrls: res.data.licenseUrls,
                fairplayCertificateUrl: res.data.fairplayCertificateUrl,
              }
            : null,
        );
        configs.current.set(galleryId, made);
      }
      return made;
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
      async prepare(galleryId) {
        if (drmOffForTab()) return null;
        const setup = await setupFor(galleryId).catch(() => null);
        if (!setup) return null;
        const chosen = await plan().catch((): DrmPlan => "none");
        if (chosen === "none") return null;
        if (chosen === "fairplay" && (!setup.licenseUrls.fairplay || !setup.fairplayCertificateUrl))
          return null;
        return { plan: chosen, setup };
      },
      loadShaka,
      async token(target) {
        const res = await api.drmToken(target.galleryId, target.childId, target.photoId);
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
