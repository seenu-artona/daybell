"use client";

import type { ShopPhoto } from "@daybell/api";
import { cn } from "@daybell/ui";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type PointerEvent, useEffect, useId, useRef } from "react";
import { DrmPhoto } from "./drm-photo";
import { ShopDialog } from "./shop-dialog";
import { shopButton } from "./styles";

const SWIPE_PX = 50;

/**
 * One photo, full screen. Swipe, or the Previous and Next buttons and the arrow keys (the non-swipe alternatives, WCAG
 * 2.5.7). "Use this photo" starts the package flow with that pose, a portrait or a group photo (D156 C5). At either
 * end the button that can't go further is disabled and hidden, so focus moves to the other one, or to Close when
 * there is only one photo (code review N5). The photo itself is the large view (DrmPhoto): under DRM where it is
 * protected and this device can, otherwise the watermarked WebP (D158; ADR 0034). Navigation is unchanged.
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
  alt,
  orderHref,
  drm = null,
}: {
  photos: ShopPhoto[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  alt: (n: number, total: number) => string;
  /** Where "Use this photo" goes. */
  orderHref: (photo: ShopPhoto) => string;
  /** The child and gallery the photos are shown for, for their DRM manifests and tokens; absent, the WebP. */
  drm?: { childId: string; galleryId: string } | null;
}) {
  const t = useTranslations("shop.viewer");
  const counterId = useId();
  const start = useRef<number | null>(null);
  const previousButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const photo = index === null ? null : (photos[index] ?? null);
  const total = photos.length;
  const go = (step: number) => {
    if (index === null) return;
    const next = index + step;
    if (next >= 0 && next < total) onIndex(next);
  };
  // After a button reaches an end (and is disabled), focus moves once the photo has changed.
  const focusNext = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (index === null || !focusNext.current) return;
    focusNext.current.focus();
    focusNext.current = null;
  }, [index]);
  /** A button click: moves, and keeps focus on a button that is still there. */
  const press = (step: number) => {
    if (index === null) return;
    const next = index + step;
    const end = step > 0 ? next >= total - 1 : next <= 0;
    if (end)
      focusNext.current =
        total > 1 ? (step > 0 ? previousButton.current : nextButton.current) : closeButton.current;
    go(step);
  };
  const onPointerDown = (e: PointerEvent) => {
    start.current = e.clientX;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (start.current === null) return;
    const dx = e.clientX - start.current;
    start.current = null;
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1);
  };

  return (
    <ShopDialog
      open={photo !== null}
      onClose={onClose}
      labelledBy={counterId}
      className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-ink p-0 text-on-primary backdrop:bg-ink"
    >
      {photo && index !== null ? (
        <div
          className="mx-auto flex h-full max-w-[480px] flex-col"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
        >
          <div className="flex min-h-14 items-center gap-2 px-1.5">
            <button
              ref={closeButton}
              type="button"
              aria-label={t("close")}
              onClick={onClose}
              className="grid size-11 place-items-center rounded-full focus-visible:outline-3 focus-visible:outline-surface"
            >
              <X className="size-6" aria-hidden="true" />
            </button>
            <p id={counterId} className="m-0 flex-1 text-center text-sm font-semibold">
              {t("label", { n: index + 1, total })}
            </p>
            <span className="size-11" />
          </div>
          <div
            className="relative flex-1 touch-pan-y"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              start.current = null;
            }}
          >
            <DrmPhoto photo={photo} alt={alt(index + 1, total)} target={drm} />
            <button
              ref={previousButton}
              type="button"
              aria-label={t("previous")}
              disabled={index === 0}
              onClick={() => press(-1)}
              className="absolute top-1/2 left-1 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-ink/60 disabled:invisible focus-visible:outline-3 focus-visible:outline-surface"
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
            <button
              ref={nextButton}
              type="button"
              aria-label={t("next")}
              disabled={index === total - 1}
              onClick={() => press(1)}
              className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-ink/60 disabled:invisible focus-visible:outline-3 focus-visible:outline-surface"
            >
              <ChevronRight className="size-6" aria-hidden="true" />
            </button>
          </div>
          <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Link
              href={orderHref(photo)}
              className={cn(shopButton, "w-full bg-surface text-ink focus-visible:outline-surface")}
            >
              {t("use")}
            </Link>
          </div>
        </div>
      ) : null}
    </ShopDialog>
  );
}
