"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ShopResult } from "@/lib/shop-client";
import { useShop } from "./shop-context";

/**
 * The child named in the address, and something loaded for them. No session, or a child not in it, goes back to the
 * code page. Signed previews last 10 minutes: an image that fails to load reloads, at most twice a minute.
 */
export function useChildData<T>(load: (childId: string) => Promise<ShopResult<T>>) {
  const { childId } = useParams<{ childId: string }>();
  const router = useRouter();
  const shop = useShop();
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const lastLoad = useRef(0);

  const reload = useCallback(async () => {
    lastLoad.current = Date.now();
    const result = await load(childId);
    if (result.ok) {
      setData(result.data);
      setFailed(false);
    } else if (result.status === 401 || result.status === 404) {
      router.replace("/shop");
    } else {
      setFailed(true);
    }
  }, [childId, load, router]);

  useEffect(() => {
    if (shop.state.status === "none") router.replace("/shop");
  }, [shop.state.status, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onImageError = useCallback(() => {
    if (Date.now() - lastLoad.current > 30_000) void reload();
  }, [reload]);

  return {
    childId,
    child: shop.child(childId),
    studio: shop.state.status === "ready" ? shop.state.session.studio.name : "",
    data,
    failed,
    reload,
    onImageError,
  };
}
