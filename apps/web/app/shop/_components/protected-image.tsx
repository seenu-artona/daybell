"use client";

import { cn } from "@daybell/ui";
import { useProtection } from "./protection";

/**
 * A parent-facing preview (D60): always a signed, watermarked, low-resolution proof from the API, as a plain <img>
 * (never next/image: its optimiser would fetch and cache Canadian photos outside Canada, D113). Not draggable, no
 * long-press menu or text selection, a transparent layer over it, blurred while the page is hidden, never printed.
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
  const { blurred, attempted } = useProtection();
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
        alt={alt}
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={onError}
        className={cn(
          "pointer-events-none block size-full transition-[filter] duration-200 motion-reduce:transition-none",
          fit === "cover" ? "object-cover" : "object-contain",
          blurred && "blur-2xl",
        )}
      />
      <span aria-hidden="true" className="absolute inset-0" />
    </span>
  );
}
