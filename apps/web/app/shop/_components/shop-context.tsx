"use client";

import type { ShopChild, ShopSessionResponse } from "@daybell/api";
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
 * The parent's shop session on this device (ADR 0022), read once from the API and shared by every shop page. Pages are
 * client-rendered: child names reach the browser only through the Montréal-pinned API (D113), never a server render.
 */
type SessionState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "error" }
  | { status: "ready"; session: ShopSessionResponse };

interface ShopContextValue {
  state: SessionState;
  refresh: () => Promise<SessionState>;
  setBagCount: (count: number) => void;
  child: (id: string) => ShopChild | null;
}

const ShopContext = createContext<ShopContextValue | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async (): Promise<SessionState> => {
    const result = await shopApi.session();
    const next: SessionState = result.ok
      ? { status: "ready", session: result.data }
      : result.status === 401
        ? { status: "none" }
        : { status: "error" };
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<ShopContextValue>(
    () => ({
      state,
      refresh,
      setBagCount: (bagCount) =>
        setState((s) => (s.status === "ready" ? { ...s, session: { ...s.session, bagCount } } : s)),
      child: (id) =>
        state.status === "ready" ? (state.session.children.find((c) => c.id === id) ?? null) : null,
    }),
    [state, refresh],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopContextValue {
  const value = useContext(ShopContext);
  if (!value) throw new Error("useShop needs ShopProvider");
  return value;
}
