"use client";

import type { ShopPhoto } from "@daybell/api";
import {
  DRM_FALLBACK_TIMEOUT_MS,
  DRM_LOADING_WORDS_AFTER_MS,
  DRM_SWIPE_SETTLE_MS,
} from "@daybell/core";
import { cn } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createShopDrmPlayer, type ShopDrmPlayer } from "@/lib/shop/drm-player";
import { useDrm } from "./drm-provider";
import { ProtectedImage } from "./protected-image";
import { useProtection } from "./protection";

type Mode = "pending" | "drm" | "webp";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });

/**
 * The large view of one photo (D158; ADR 0034). A protected photo plays as a one-key DRM clip of the same watermarked
 * preview, so hardware DRM blacks out screenshots and recordings; anything else, or anything going wrong, shows the
 * watermarked WebP as before, silently (C2).
 *
 * - One budget per photo (review: tester #1): 8 seconds from the moment it is shown here, covering the setup, the probe,
 *   loading Shaka, the manifest, the token, the license and the first presented frame. When it runs out, or anything
 *   fails, every request still running is given up and the player is destroyed, so no token or license is asked for
 *   afterwards (tester #2).
 * - Two failures in a row: the rest of the tab uses the WebP. A photo once shown under DRM never falls back.
 * - Known to be the WebP for this tab (no hardware DRM here, DRM not on for the gallery, or off after two failures): the
 *   WebP at once, with no stand-in (#9).
 * - While swiping, a photo must stay 300 ms before its clip is asked for (#7); the first photo isn't held.
 *
 * Mounted once per open viewer (not per photo): one player, load() per photo, destroyed when the viewer closes. While a
 * photo loads, its 400 px proof stands in; "Loading photo" appears after half a second (said once per viewer,
 * politely) and goes as soon as the photo is shown or falls back (#2). The picture is named like the WebP's image
 * (role="img" with the same words); the video itself is hidden from assistive technology, muted, inline, never
 * picture-in-picture or cast, with no controls. With reduced motion it doesn't fade.
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
  const firstPhoto = useRef(true);
  const childId = target?.childId ?? null;
  const galleryId = target?.galleryId ?? null;
  const [mode, setMode] = useState<Mode>(() =>
    !photo.drm || !galleryId || drm.knownOff(galleryId) ? "webp" : "pending",
  );
  const [shownId, setShownId] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [announce, setAnnounce] = useState(false);

  // The viewer closes: its player goes.
  useEffect(
    () => () => {
      const made = player.current;
      player.current = null;
      void made?.then((p) => p?.destroy());
    },
    [],
  );

  useEffect(() => {
    const held = !firstPhoto.current;
    firstPhoto.current = false;
    setShownId(null);
    setSlow(false);
    if (!photo.drm || !childId || !galleryId || drm.knownOff(galleryId)) {
      setMode("webp");
      return;
    }
    setMode("pending");
    const controller = new AbortController();
    const { signal } = controller;
    const deadline = Date.now() + DRM_FALLBACK_TIMEOUT_MS;
    let cancelled = false;
    let done = false;
    // The whole budget: when it runs out, everything still running is given up.
    const budget = window.setTimeout(() => controller.abort(), DRM_FALLBACK_TIMEOUT_MS);
    const words = window.setTimeout(() => {
      if (cancelled || done) return;
      setSlow(true);
      if (!announced.current) {
        announced.current = true;
        setAnnounce(true);
      }
    }, DRM_LOADING_WORDS_AFTER_MS);
    // Shown or fallen back: the words and their timer go (#2); "Loading photo" isn't said again in this viewer.
    const settled = () => {
      done = true;
      window.clearTimeout(words);
      window.clearTimeout(budget);
      setSlow(false);
      setAnnounce(false);
    };
    const fallBack = (counts: boolean) => {
      if (cancelled || done) return;
      settled();
      controller.abort();
      // No token or license after giving up: this player goes, the next protected photo makes a new one.
      const made = player.current;
      player.current = null;
      void made?.then((p) => p?.destroy());
      if (counts) drm.report(false);
      setMode("webp");
    };
    (async () => {
      if (held) await wait(DRM_SWIPE_SETTLE_MS, signal);
      const ready = await drm.prepare(galleryId, signal);
      if (cancelled) return;
      if (ready.kind !== "ready") return fallBack(ready.kind === "failed");
      const element = video.current;
      if (!element) return fallBack(false);
      player.current ??= drm
        .loadShaka(signal)
        .then((shaka) =>
          createShopDrmPlayer({
            shaka,
            video: element,
            plan: ready.plan,
            setup: ready.setup,
            token: (which, tokenSignal) => drm.token(which, tokenSignal),
          }),
        )
        .catch(() => null);
      const made = await player.current;
      if (cancelled) return;
      if (signal.aborted) return fallBack(true);
      // Shaka can't play here: the WebP, like a device without DRM (not a failure).
      if (!made) return fallBack(false);
      setMode("drm");
      const outcome = await made.show(
        { childId, galleryId, photoId: photo.id },
        { signal, deadline },
      );
      if (cancelled) return;
      if (outcome !== "shown") return fallBack(true);
      settled();
      drm.report(true);
      setShownId(photo.id);
    })().catch(() => fallBack(true));
    return () => {
      cancelled = true;
      window.clearTimeout(budget);
      window.clearTimeout(words);
      // Swiped on or closed: this photo's requests are given up (not a failure).
      controller.abort();
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
