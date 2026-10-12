"use client";

import type { Photo } from "@daybell/api";
import { useTranslations } from "next-intl";

/** The DOM id of a photo's tile button, so focus can return to it when the panel closes. */
export const tileId = (photoId: string) => `photo-tile-${photoId}`;

/**
 * The job's photos as a grid of thumbnails in a white sheet card (D140), in tagging order. Each tile is a button of at
 * least 44px that opens the photo in the floating panel; its image's alt text is "Photo {n}" (its place in the
 * order), never the filename. Processing and failed photos say so in words. People who can bin get a checkbox on each
 * tile for bulk actions.
 */
export function PhotoGrid({
  photos,
  selectedId,
  checked,
  onToggle,
  onOpen,
  busy,
}: {
  photos: Photo[];
  selectedId: string | null;
  /** Ticked photos, or null when the person can't bin or restore. */
  checked: ReadonlySet<string> | null;
  onToggle: (photoId: string, on: boolean) => void;
  onOpen: (photoId: string) => void;
  busy: boolean;
}) {
  const t = useTranslations("app.photos");
  return (
    <ul
      aria-busy={busy}
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 rounded-xl bg-surface p-4"
    >
      {photos.map((photo, i) => {
        const n = i + 1;
        const open = selectedId === photo.id;
        return (
          <li key={photo.id} className="relative">
            <button
              id={tileId(photo.id)}
              type="button"
              aria-label={t("open", { n })}
              aria-current={open ? "true" : undefined}
              onClick={() => onOpen(photo.id)}
              className={`grid aspect-square min-h-11 w-full place-items-center overflow-hidden rounded-lg bg-subtle p-0 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                open ? "outline-3 -outline-offset-3 outline-primary" : ""
              }`}
            >
              {photo.status === "ready" && photo.thumbUrl ? (
                // biome-ignore lint/performance/noImgElement: signed, short-lived storage URLs; no image optimiser in between (D113).
                <img
                  src={photo.thumbUrl}
                  alt={t("photoAlt", { n })}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
              ) : (
                <span
                  className={`px-2 text-center text-label font-semibold ${
                    photo.status === "failed" ? "text-danger" : "text-muted"
                  }`}
                >
                  {photo.status === "failed" ? t("failed") : t("processing")}
                </span>
              )}
            </button>
            {checked ? (
              <label className="absolute top-1 left-1 grid size-11 cursor-pointer place-items-center">
                <span className="sr-only">{t("select", { n })}</span>
                <input
                  type="checkbox"
                  checked={checked.has(photo.id)}
                  onChange={(e) => onToggle(photo.id, e.target.checked)}
                  className="size-5 cursor-pointer accent-primary shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
              </label>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
