"use client";

import type { ShopPhoto } from "@daybell/api";
import { type PoseSet, shopPoses } from "@daybell/core";
import { cn } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { ProtectedImage } from "./protected-image";
import { useProtection } from "./protection";

/**
 * Every pose a parent may choose (D24, D91; D156 C5, ADR 0033 N6): the child's portraits, then the group photos of
 * their groups, as one set of radio buttons shown as thumbnails in two labelled groups ("Portraits", "Group photos").
 * The radio is stacked above the protected image so it, not the image's transparent layer (D60), is what a tap or click
 * lands on. The image underneath is then never under the pointer, so the copy deterrents move to the label:
 * right-click, long-press and dragging stay blocked.
 */
export function PosePicker({
  portraits,
  groupPhotos = [],
  value,
  onChange,
  onImageError,
}: {
  portraits: ShopPhoto[];
  groupPhotos?: ShopPhoto[];
  value: string | null;
  onChange: (id: string) => void;
  onImageError: () => void;
}) {
  const t = useTranslations("shop.pose");
  const { attempted } = useProtection();
  const name = useId();
  const portraitsId = useId();
  const groupsId = useId();
  const block = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    attempted();
  };
  const poses = shopPoses(portraits, groupPhotos);
  const sets: { set: PoseSet; titleId: string }[] = [
    { set: "portraits", titleId: portraitsId },
    { set: "groupPhotos", titleId: groupsId },
  ];
  const showTitles = groupPhotos.length > 0;
  return (
    <fieldset className="m-0 mt-5 flex flex-col gap-4 border-0 p-0">
      <legend className="mb-2 p-0 text-title-sm">{t("legend")}</legend>
      {sets.map(({ set, titleId }) => {
        const mine = poses.filter((p) => p.set === set);
        if (mine.length === 0) return null;
        return (
          <div
            key={set}
            role={showTitles ? "group" : undefined}
            aria-labelledby={showTitles ? titleId : undefined}
          >
            {showTitles ? (
              <p id={titleId} className="m-0 mb-2 text-sm font-semibold text-muted">
                {t(set)}
              </p>
            ) : null}
            <div className="grid grid-cols-4 gap-2">
              {mine.map(({ photo, n, total }) => (
                <label
                  key={photo.id}
                  className="relative block cursor-pointer select-none [-webkit-touch-callout:none]"
                  onContextMenu={block}
                  onDragStart={block}
                >
                  <input
                    type="radio"
                    name={name}
                    value={photo.id}
                    checked={value === photo.id}
                    onChange={() => onChange(photo.id)}
                    className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                  />
                  <span
                    className={cn(
                      "block aspect-[4/5] overflow-hidden rounded-md bg-subtle outline-offset-2 peer-focus-visible:outline-3 peer-focus-visible:outline-studio-ring",
                      value === photo.id && "outline-3 outline-studio-ring",
                    )}
                  >
                    <ProtectedImage
                      src={photo.thumbUrl}
                      alt={
                        set === "portraits"
                          ? t("poseAlt", { n, total })
                          : t("groupAlt", { n, total })
                      }
                      onError={onImageError}
                    />
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
