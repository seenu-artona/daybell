"use client";

import type { ShopChild, ShopGallerySession } from "@daybell/api";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { shopApi } from "@/lib/shop-client";

/**
 * The parent's galleries on this device (ADR 0022; one per studio, up to 3, S6), read once from the API and shared by
 * every shop page. Pages are client-rendered: child names reach the browser only through the Montréal-pinned API
 * (D113), never a server render.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "error" }
  | { status: "ready"; galleries: ShopGallerySession[] };

interface ShopContextValue {
  state: SessionState;
  refresh: () => Promise<SessionState>;
  /** The header's bag count for a gallery. The same function for the provider's life (code review M1). */
  setBagCount: (gallery: string, count: number) => void;
  /** A gallery by id; null for the device's first. */
  gallery: (id: string | null) => ShopGallerySession | null;
  /** The gallery a child is in. */
  galleryOf: (childId: string) => ShopGallerySession | null;
  child: (id: string) => ShopChild | null;
}

const ShopContext = createContext<ShopContextValue | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async (): Promise<SessionState> => {
    const result = await shopApi.session();
    const next: SessionState = result.ok
      ? { status: "ready", galleries: result.data.galleries }
      : result.status === 401
        ? { status: "none" }
        : { status: "error" };
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Leaves the state alone when the count hasn't changed, so nothing re-renders (and nothing refetches) for nothing.
  const setBagCount = useCallback((gallery: string, count: number) => {
    setState((s) => {
      if (s.status !== "ready") return s;
      const at = s.galleries.findIndex((g) => g.id === gallery);
      if (at < 0 || s.galleries[at]?.bagCount === count) return s;
      const galleries = s.galleries.map((g, i) => (i === at ? { ...g, bagCount: count } : g));
      return { ...s, galleries };
    });
  }, []);

  const value = useMemo<ShopContextValue>(() => {
    const galleries = state.status === "ready" ? state.galleries : [];
    const galleryOf = (childId: string) =>
      galleries.find((g) => g.children.some((c) => c.id === childId)) ?? null;
    return {
      state,
      refresh,
      setBagCount,
      gallery: (id) => (id ? (galleries.find((g) => g.id === id) ?? null) : (galleries[0] ?? null)),
      galleryOf,
      child: (id) => galleryOf(id)?.children.find((c) => c.id === id) ?? null,
    };
  }, [state, refresh, setBagCount]);
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopContextValue {
  const value = useContext(ShopContext);
  if (!value) throw new Error("useShop needs ShopProvider");
  return value;
}
