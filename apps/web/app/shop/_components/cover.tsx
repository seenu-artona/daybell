"use client";

import type { ShopOpenChild, ShopPhoto } from "@daybell/api";
import { cn } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useShopDates } from "./format";
import { ProtectedImage } from "./protected-image";

/**
 * The full-screen cover (D119): the child's best pose (the first visible portrait until studios can star one, call 3),
 * the school, picture day and a "See photos" button. The words slide up on load, not with reduced motion. It never
 * moves on by itself (WCAG 2.2.1).
 */
export function Cover({
  studio,
  child,
  photo,
  total,
  onSeePhotos,
  onImageError,
}: {
  studio: string;
  child: ShopOpenChild;
  photo: ShopPhoto;
  total: number;
  onSeePhotos: () => void;
  onImageError: () => void;
}) {
  const t = useTranslations("shop");
  const dates = useShopDates();
  const [risen, setRisen] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRisen(true);
      return;
    }
    const frame = requestAnimationFrame(() => setRisen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <main className="relative grid min-h-dvh items-end overflow-hidden bg-ink text-on-primary">
      <div className="absolute inset-0">
        <ProtectedImage
          src={photo.viewUrl}
          alt={t("gallery.photoAlt", { name: child.firstName, n: 1, total })}
          eager
          onError={onImageError}
        />
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent"
      />
      <div
        data-cover-text=""
        className={cn(
          "relative mx-auto w-full max-w-[480px] px-6 pt-24 pb-[max(2.5rem,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-700 ease-out motion-reduce:transition-none",
          risen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        )}
      >
        <p className="m-0 text-caption font-semibold tracking-[0.08em] uppercase">{studio}</p>
        <h1 className="m-0 mt-1 text-h1">{child.displayName}</h1>
        <p className="m-0 mt-1 text-body">
          {t("cover.details", { school: child.school, date: dates.day(child.pictureDay) })}
        </p>
        <button
          type="button"
          onClick={onSeePhotos}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-surface px-6 text-base font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-surface"
        >
          {t("cover.seePhotos")}
        </button>
      </div>
    </main>
  );
}
