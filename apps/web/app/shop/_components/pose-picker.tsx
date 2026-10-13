"use client";

import type { ShopPhoto } from "@daybell/api";
import { cn } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { ProtectedImage } from "./protected-image";
import { useProtection } from "./protection";

/**
 * The child's portraits as radio buttons shown as thumbnails (D24, D91). The radio is stacked above the protected image
 * so it, not the image's transparent layer (D60), is what a tap or click lands on. The image underneath is then never
 * under the pointer, so the copy deterrents move to the label: right-click, long-press and dragging stay blocked.
 */
export function PosePicker({
  portraits,
  value,
  onChange,
  onImageError,
}: {
  portraits: ShopPhoto[];
  value: string | null;
  onChange: (id: string) => void;
  onImageError: () => void;
}) {
  const t = useTranslations("shop.pose");
  const { attempted } = useProtection();
  const block = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    attempted();
  };
  return (
    <fieldset className="m-0 mt-5 border-0 p-0">
      <legend className="mb-2 p-0 text-title-sm">{t("legend")}</legend>
      <div className="grid grid-cols-4 gap-2">
        {portraits.map((p, index) => (
          <label
            key={p.id}
            className="relative block cursor-pointer select-none [-webkit-touch-callout:none]"
            onContextMenu={block}
            onDragStart={block}
          >
            <input
              type="radio"
              name="pose"
              value={p.id}
              checked={value === p.id}
              onChange={() => onChange(p.id)}
              className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
            />
            <span
              className={cn(
                "block aspect-[4/5] overflow-hidden rounded-md bg-subtle outline-offset-2 peer-focus-visible:outline-3 peer-focus-visible:outline-studio-ring",
                value === p.id && "outline-3 outline-studio-ring",
              )}
            >
              <ProtectedImage
                src={p.thumbUrl}
                alt={t("poseAlt", { n: index + 1, total: portraits.length })}
                onError={onImageError}
              />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
