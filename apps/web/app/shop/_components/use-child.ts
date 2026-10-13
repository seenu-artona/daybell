"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { isShopId, type ShopResult } from "@/lib/shop-client";
import { useShop } from "./shop-context";

/**
 * The child named in the address, their gallery (studio) on this device, and something loaded for them. An id that
 * isn't one (security review L3), no session, or a child not on this device goes back to the code page. Signed
 * previews last 10 minutes: an image that fails to load reloads, at most twice a minute.
 */
export function useChildData<T>(
  load: (gallery: string, childId: string) => Promise<ShopResult<T>>,
) {
  const { childId } = useParams<{ childId: string }>();
  const router = useRouter();
  const shop = useShop();
  const gallery = shop.galleryOf(childId);
  const galleryId = gallery?.id ?? null;
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const lastLoad = useRef(0);
  const valid = isShopId(childId);

  const reload = useCallback(async () => {
    if (!valid || !galleryId) return;
    lastLoad.current = Date.now();
    const result = await load(galleryId, childId);
    if (result.ok) {
      setData(result.data);
      setFailed(false);
    } else if (result.status === 401 || result.status === 404) {
      router.replace("/shop");
    } else {
      setFailed(true);
    }
  }, [childId, galleryId, valid, load, router]);

  const status = shop.state.status;
  useEffect(() => {
    if (!valid || status === "none" || (status === "ready" && !galleryId)) router.replace("/shop");
  }, [valid, status, galleryId, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onImageError = useCallback(() => {
    if (Date.now() - lastLoad.current > 30_000) void reload();
  }, [reload]);

  return {
    childId,
    galleryId,
    child: shop.child(childId),
    studio: gallery?.studio.name ?? "",
    data,
    failed: failed || status === "error",
    reload: status === "error" ? shop.refresh : reload,
    onImageError,
  };
}
