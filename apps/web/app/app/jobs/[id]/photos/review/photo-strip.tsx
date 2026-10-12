"use client";

import type { TaggedPhoto } from "@daybell/api";
import { Badge } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { DRAG_TYPE, dragIds, droppedIds, useReview } from "./review-context";

/**
 * A row of photos on the review screen (ADR 0018; Seenu, answer 5). Each tile is the 400 px preview with its alt text
 * "{where}, photo {n}" (never a filename). Card photos say "Card" in words and can't be moved or confirmed; flagged
 * photos say why. People who fix tagging get a 44px checkbox on each photo they can act on (core's reviewActions), and
 * can drag a photo that can move (or every ticked one) onto a child, a class or Leftovers; Move to… does the same
 * without dragging (WCAG 2.5.7). A photo that may be a card is confirmed before it moves.
 */
export function PhotoStrip({
  photos,
  where,
  showFlags = true,
}: {
  photos: readonly TaggedPhoto[];
  /** Where these photos are, for their names: "Leftovers", a child's name, "Room 4 class photo". */
  where: string;
  showFlags?: boolean;
}) {
  const t = useTranslations("app.photos.review");
  const { canEdit, checked, toggle } = useReview();
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {photos.map((photo, i) => {
        const n = i + 1;
        const isCard = photo.cardRead || photo.place === "card";
        const movable = canEdit && photo.actions.move;
        const selectable =
          canEdit && (photo.actions.move || photo.actions.confirm || photo.actions.markCard);
        // A card of the job that has since been removed isn't "another job's card" (code review nice 3).
        const flagKey =
          photo.flag === "otherCard" && photo.qrKind === "removedCard" ? "removedCard" : photo.flag;
        return (
          <li
            key={photo.id}
            className="relative size-28 shrink-0"
            draggable={movable}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragIds(photo.id, checked)));
              e.dataTransfer.effectAllowed = "move";
            }}
          >
            <div className="grid size-full place-items-center overflow-hidden rounded-lg bg-subtle">
              {photo.status === "ready" && photo.thumbUrl ? (
                // biome-ignore lint/performance/noImgElement: signed, short-lived storage URLs; no image optimiser in between (D113).
                <img
                  src={photo.thumbUrl}
                  alt={t("tile.alt", { where, n })}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="size-full object-cover"
                />
              ) : (
                <span
                  className={`px-2 text-center text-label font-semibold ${
                    photo.status === "failed" ? "text-danger" : "text-muted"
                  }`}
                >
                  {photo.status === "failed" ? t("tile.failed") : t("tile.processing")}
                </span>
              )}
            </div>
            <div className="pointer-events-none absolute right-1 bottom-1 left-1 flex flex-wrap justify-end gap-1">
              {isCard ? (
                <Badge tone="draft" className="bg-surface before:hidden">
                  {t("tile.card")}
                </Badge>
              ) : null}
              {showFlags && flagKey ? <Badge tone="warning">{t(`flags.${flagKey}`)}</Badge> : null}
            </div>
            {selectable ? (
              <label className="absolute top-0 left-0 grid size-11 cursor-pointer place-items-center">
                <span className="sr-only">{t("tile.select", { where, n })}</span>
                <input
                  type="checkbox"
                  checked={checked.has(photo.id)}
                  onChange={(e) => toggle(photo, e.target.checked)}
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

/**
 * Where photos can be dropped: a child, a class's photo set or Leftovers. Only our own drags (photo ids) are taken; the
 * outline while dragging over is decoration, the drop itself is announced in words.
 */
export function useDropTarget(onDrop: (ids: string[]) => void) {
  const { canEdit } = useReview();
  if (!canEdit) return {};
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      e.currentTarget.setAttribute("data-drop", "true");
    },
    onDragLeave: (e: React.DragEvent) => e.currentTarget.removeAttribute("data-drop"),
    onDrop: (e: React.DragEvent) => {
      e.currentTarget.removeAttribute("data-drop");
      const ids = droppedIds(e.dataTransfer.getData(DRAG_TYPE));
      if (ids.length === 0) return;
      e.preventDefault();
      onDrop(ids);
    },
  };
}

/** The outline a drop target shows while photos are dragged over it. */
export const DROP_TARGET =
  "rounded-lg outline-offset-2 data-[drop=true]:outline-2 data-[drop=true]:outline-dashed data-[drop=true]:outline-primary";
