"use client";

import { ShoppingCart } from "lucide-react";
import {
  type ClipboardEvent,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useRef,
} from "react";
import { cn } from "../lib/cn";
import { normalizeHex, readableTextOn, uiColorOn } from "../lib/contrast";
import { type StudioColorId, studioColorHex } from "../lib/studio-colors";

export interface ShopFrameProps {
  studioName: string;
  /** Shown when the studio has no logo yet, e.g. "NP". */
  studioInitials: string;
  logo?: ReactNode;
  /** The studio's chosen shop colour from the curated set (D117). Defaults to charcoal (D116). */
  studioColor?: StudioColorId;
  cartCount?: number;
  cartLabel: string;
  cartHref?: string;
  footer: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The parent shop is fully studio-branded: one layout, the studio's logo and colour.
 * No Daybell logo or "Powered by" anywhere parents see (D62).
 */
export function ShopFrame({
  studioName,
  studioInitials,
  logo,
  studioColor,
  cartCount = 0,
  cartLabel,
  cartHref = "#",
  footer,
  children,
  className,
}: ShopFrameProps) {
  const brand = normalizeHex(studioColorHex(studioColor));
  const style = brand
    ? ({
        "--color-studio": brand,
        "--color-on-studio": readableTextOn(brand),
        "--color-studio-ring": uiColorOn(brand),
      } as CSSProperties)
    : undefined;
  return (
    <div
      style={style}
      className={cn(
        "mx-auto max-w-105 overflow-hidden rounded-lg border border-line bg-canvas",
        className,
      )}
    >
      <header className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
        {logo ?? (
          <span
            className="grid size-8 place-items-center rounded-[8px] bg-studio text-sm font-extrabold text-on-studio"
            aria-hidden="true"
          >
            {studioInitials}
          </span>
        )}
        <span className="text-title-sm">{studioName}</span>
        <a
          href={cartHref}
          aria-label={cartLabel}
          className="relative ml-auto grid size-11 place-items-center rounded-md text-ink focus-visible:outline-2 focus-visible:outline-studio"
        >
          <ShoppingCart className="size-[22px]" aria-hidden="true" />
          {cartCount > 0 ? (
            <span
              className="absolute top-1 right-0.5 min-w-[18px] rounded-full bg-studio px-1 text-center text-micro text-on-studio"
              aria-hidden="true"
            >
              {cartCount}
            </span>
          ) : null}
        </a>
      </header>
      <div className="p-4">{children}</div>
      <footer className="px-4 py-3 text-center text-caption text-muted">{footer}</footer>
    </div>
  );
}

export interface CodeInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  /** Group name, e.g. "Access code". */
  label: string;
  /** Per-box name, e.g. (n) => `Character ${n}`. */
  charLabel: (position: number) => string;
  className?: string;
}

const CODE_CHARS = /[^a-z0-9]/gi;

/**
 * Access-code boxes: auto-advance, backspace goes back, paste fills all.
 * Boxes fill left to right with no gaps: focusing a box past the first empty one moves to that empty box.
 */
export function CodeInput({
  length = 6,
  value,
  onChange,
  label,
  charLabel,
  className,
}: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");

  const filled = Math.min(value.length, length);
  const setAt = (i: number, ch: string) => {
    const next = value.split("").slice(0, length);
    if (ch) next[i] = ch;
    else next.splice(i, 1);
    onChange(next.join(""));
  };
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !chars[i] && i > 0) refs.current[i - 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData
      .getData("text")
      .replace(CODE_CHARS, "")
      .toUpperCase()
      .slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <fieldset className={cn("m-0 flex gap-2 border-0 p-0", className)}>
      <legend className="sr-only">{label}</legend>
      {chars.map((ch, i) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: positions are fixed.
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          aria-label={charLabel(i + 1)}
          value={ch}
          maxLength={1}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          onFocus={() => {
            if (i > filled) refs.current[Math.min(filled, length - 1)]?.focus();
          }}
          onKeyDown={onKey(i)}
          onPaste={onPaste}
          onChange={(e) => {
            const c = e.target.value.replace(CODE_CHARS, "").slice(-1).toUpperCase();
            setAt(i, c);
            if (c && i < length - 1) refs.current[i + 1]?.focus();
          }}
          className="h-13 w-11 rounded-md border border-line-strong bg-surface text-center text-xl font-bold text-ink uppercase focus:border-studio-ring focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-studio-ring)_25%,transparent)] focus:outline-none"
        />
      ))}
    </fieldset>
  );
}

export interface OptionCardProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "title"> {
  type?: "radio" | "checkbox";
  title: ReactNode;
  description?: ReactNode;
  price: ReactNode;
  /** e.g. "Most popular". The only Daybell colour in the shop: it marks the best deal. */
  flag?: ReactNode;
}

/** A package or add-on as a large tap target. */
export function OptionCard({
  type = "radio",
  title,
  description,
  price,
  flag,
  className,
  ...props
}: OptionCardProps) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-surface p-3.5",
        "has-checked:border-studio-ring has-checked:shadow-[inset_0_0_0_1px_var(--color-studio-ring)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-studio-ring",
        className,
      )}
    >
      <input type={type} className="peer absolute opacity-0" {...props} />
      {flag ? (
        <span className="absolute -top-2.5 right-3.5 rounded-full bg-lime px-2 text-micro text-ink">
          {flag}
        </span>
      ) : null}
      <span
        className={cn(
          "size-[22px] shrink-0 border-2 border-line-strong peer-checked:border-studio-ring",
          type === "radio"
            ? "rounded-full peer-checked:[background:radial-gradient(var(--color-studio-ring)_0_5px,transparent_6px)]"
            : "rounded-[6px] peer-checked:bg-studio-ring",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-title-sm">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-body text-muted">{description}</span>
        ) : null}
      </span>
      <span className="text-base font-bold tabular-nums">{price}</span>
    </label>
  );
}
