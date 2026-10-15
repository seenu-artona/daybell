"use client";

import type { ShopPhoto } from "@daybell/api";
import { DRM_LOADING_WORDS_AFTER_MS } from "@daybell/core";
import { cn } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createShopDrmPlayer, type ShopDrmPlayer } from "@/lib/shop/drm-player";
import { useDrm } from "./drm-provider";
import { ProtectedImage } from "./protected-image";
import { useProtection } from "./protection";

type Mode = "pending" | "drm" | "webp";

/**
 * The large view of one photo (D158; ADR 0034). A protected photo plays as a one-key DRM clip of the same watermarked
 * preview, so hardware DRM blacks out screenshots and recordings; anything else, or anything going wrong, shows the
 * watermarked WebP as before, silently (C2): no hardware DRM here, DRM off for the gallery or the tab, nothing shown
 * within 8 seconds, or two failures in a row (then the rest of the tab uses the WebP). A photo once shown under DRM never
 * falls back.
 *
 * Mounted once per open viewer (not per photo): one player, load() per photo, destroyed when the viewer closes. While a
 * photo loads, its 400 px proof stands in; "Loading photo" appears after half a second (said once, politely). The
 * picture is named like the WebP's image (role="img" with the same words); the video itself is hidden from assistive
 * technology, muted, inline, never picture-in-picture or cast, with no controls. With reduced motion it doesn't fade.
 */
export function DrmPhoto({
  photo,
  alt,
  target,
}: {
  photo: ShopPhoto;
  alt: string;
  /** Where the photo's manifest and tokens are; absent, the WebP. */
  target: { childId: string; galleryId: string } | null;
}) {
  const t = useTranslations("shop.viewer.drm");
  const drm = useDrm();
  const { attempted } = useProtection();
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<Promise<ShopDrmPlayer | null> | null>(null);
  const announced = useRef(false);
  const childId = target?.childId ?? null;
  const galleryId = target?.galleryId ?? null;
  const [mode, setMode] = useState<Mode>(photo.drm && target ? "pending" : "webp");
  const [shownId, setShownId] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [announce, setAnnounce] = useState(false);

  // One player for the open viewer, destroyed when it closes.
  useEffect(
    () => () => {
      const made = player.current;
      player.current = null;
      void made?.then((p) => p?.destroy());
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setShownId(null);
    setSlow(false);
    if (!photo.drm || !childId || !galleryId) {
      setMode("webp");
      return;
    }
    setMode("pending");
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setSlow(true);
      if (!announced.current) {
        announced.current = true;
        setAnnounce(true);
      }
    }, DRM_LOADING_WORDS_AFTER_MS);
    // "Loading photo" is said once per viewer: never again after the first photo is shown or falls back.
    const settled = () => setAnnounce(false);
    const fallBack = () => {
      if (cancelled) return;
      setMode("webp");
      settled();
    };
    (async () => {
      const ready = await drm.prepare(galleryId);
      if (cancelled) return;
      const element = video.current;
      if (!ready || !element) return fallBack();
      player.current ??= drm
        .loadShaka()
        .then((shaka) =>
          createShopDrmPlayer({
            shaka,
            video: element,
            plan: ready.plan,
            setup: ready.setup,
            token: (which) => drm.token(which),
          }),
        )
        .catch(() => null);
      const made = await player.current;
      if (cancelled) return;
      if (!made) return fallBack();
      setMode("drm");
      const outcome = await made.show({ childId, galleryId, photoId: photo.id });
      if (cancelled) return;
      drm.report(outcome === "shown");
      if (outcome !== "shown") return fallBack();
      setShownId(photo.id);
      settled();
    })().catch(fallBack);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [photo.id, photo.drm, childId, galleryId, drm]);

  const shown = mode === "drm" && shownId === photo.id;
  return (
    <span className="relative block size-full select-none overflow-hidden [-webkit-touch-callout:none] print:hidden">
      {/* Always mounted while the viewer is open, so one player serves every photo; hidden until its frame is shown. */}
      <video
        ref={video}
        aria-hidden="true"
        tabIndex={-1}
        muted
        playsInline
        crossOrigin="anonymous"
        disablePictureInPicture
        disableRemotePlayback
        data-drm-video
        className={cn(
          "pointer-events-none absolute inset-0 block size-full object-contain transition-opacity duration-300 motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      {mode === "webp" ? (
        <ProtectedImage src={photo.viewUrl} alt={alt} fit="contain" eager />
      ) : (
        <span
          role="img"
          aria-label={alt}
          data-drm-photo={shown ? "shown" : "loading"}
          className="absolute inset-0 block"
          onContextMenu={(e) => {
            e.preventDefault();
            attempted();
          }}
          onDragStart={(e) => e.preventDefault()}
        >
          {shown ? null : <ProtectedImage src={photo.thumbUrl} alt="" fit="contain" eager />}
          {!shown && slow ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-md bg-ink/80 px-3 py-1.5 text-caption text-on-primary"
            >
              {t("loading")}
            </span>
          ) : null}
        </span>
      )}
      <span role="status" className="sr-only">
        {announce ? t("loading") : ""}
      </span>
    </span>
  );
}
