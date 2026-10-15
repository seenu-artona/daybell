"use client";

import { cn } from "@daybell/ui";
import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProtection } from "./protection";

/**
 * A parent-facing preview (D60): always a signed, watermarked, low-resolution proof from the API, as a plain <img>
 * (never next/image: its optimiser would fetch and cache Canadian photos outside Canada, D113). Not draggable, no
 * long-press menu or text selection, a transparent layer over it, never printed. On a screenshot sign it turns to an
 * ink panel on computers (Blackout; ADR 0034, C1) and blurs on phones.
 */
export function ProtectedImage({
  src,
  alt,
  className,
  fit = "cover",
  onError,
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  fit?: "cover" | "contain";
  onError?: () => void;
  eager?: boolean;
}) {
  const t = useTranslations("shop.gallery");
  const { concealed, mode, attempted } = useProtection();
  const dark = concealed && mode === "blackout";
  const block = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    attempted();
  };
  return (
    <span
      className={cn(
        "relative block size-full select-none overflow-hidden [-webkit-touch-callout:none] print:hidden",
        className,
      )}
      onContextMenu={block}
      onDragStart={block}
    >
      {/* biome-ignore lint/performance/noImgElement: next/image would cache Canadian photos outside Canada (D113). */}
      <img
        src={src}
        alt={dark ? "" : alt}
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={onError}
        className={cn(
          "pointer-events-none block size-full transition-[filter] duration-200 motion-reduce:transition-none",
          fit === "cover" ? "object-cover" : "object-contain",
          concealed && mode === "blur" && "blur-2xl",
          dark && "invisible",
        )}
      />
      <span aria-hidden="true" className="absolute inset-0" />
      {dark ? (
        // For sight only: the provider's status says the same once for the page. Under about 120 px (bag and pose
        // thumbnails) the words don't fit: an icon instead (review #18).
        <span
          aria-hidden="true"
          data-blackout-panel
          className="@container absolute inset-0 flex items-center justify-center overflow-hidden bg-ink p-2 text-center text-caption text-on-primary"
        >
          <EyeOff data-blackout-icon className="size-5 @[120px]:hidden" />
          <span data-blackout-words className="hidden @[120px]:inline">
            {t("hiddenForScreenshot")}
          </span>
        </span>
      ) : null}
    </span>
  );
}
