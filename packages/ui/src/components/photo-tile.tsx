"use client";

import { Check } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface PhotoTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** The image (an <img> or <Image>). Its alt text names the photo. */
  image: ReactNode;
  tag?: ReactNode;
  selected?: boolean;
  /** Parent shop: studio watermark text plus save/drag blocking. Deters casual copying only. */
  watermark?: string;
}

/** Portrait 4:5 tile used in culling, tagging and the parent shop. Selecting it toggles `selected`. */
export function PhotoTile({
  image,
  tag,
  selected = false,
  watermark,
  className,
  onContextMenu,
  ...props
}: PhotoTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onContextMenu={(e) => {
        if (watermark) e.preventDefault();
        onContextMenu?.(e);
      }}
      className={cn(
        "group relative block aspect-[4/5] w-full overflow-hidden rounded-lg bg-subtle p-0 text-left shadow-sm",
        "transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-studio",
        selected && "outline-3 -outline-offset-3 outline-studio",
        watermark && "select-none [-webkit-touch-callout:none]",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none block size-full [&>*]:size-full [&>*]:object-cover">
        {image}
      </span>
      {watermark ? (
        <>
          <span
            className="pointer-events-none absolute inset-0 opacity-50 [background:repeating-linear-gradient(-30deg,transparent_0_38px,rgb(255_255_255/0.55)_38px_40px)]"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute inset-0 z-[1] grid -rotate-30 place-items-center text-sm font-extrabold tracking-[0.2em] text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.25)]"
            aria-hidden="true"
          >
            {watermark}
          </span>
        </>
      ) : null}
      <span
        className={cn(
          "absolute top-2 right-2 grid size-6 place-items-center rounded-full border-2 border-line-strong bg-surface text-on-studio",
          selected && "border-studio bg-studio",
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
      {tag ? (
        <span className="absolute bottom-2 left-2 rounded-sm bg-ink/80 px-2 py-1.5 text-xs leading-none font-semibold text-white">
          {tag}
        </span>
      ) : null}
    </button>
  );
}
