"use client";

import { cn } from "@daybell/ui";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

const PLACEMENT = {
  /** Under the trigger, right edges lined up (header menus, toolbar menus). */
  "below-end": "top-full right-0 mt-2",
  /** Under the trigger, left edges lined up (section bar menus). */
  "below-start": "top-full left-0 mt-2",
  /** Above the trigger, left edges lined up (the open menu's footer). */
  "above-start": "bottom-full left-0 mb-2",
  /** To the right of the trigger, bottom edges lined up (the folded menu's footer). */
  "right-end": "bottom-0 left-full ml-2",
} as const;

const TONE = {
  light: "text-ink hover:bg-subtle focus-visible:outline-primary",
  /** On the dark menu. */
  dark: "text-white/75 hover:bg-white/6 hover:text-white focus-visible:outline-lime",
} as const;

/**
 * A small dropdown anchored to a button (disclosure pattern). Closes on outside click, on Escape pressed inside it,
 * and when focus leaves it; Escape returns focus to the button. The trigger's visible text is its accessible name
 * (WCAG 2.5.3); `label` is only for icon-only triggers. The studio app is desktop only (D136), so the panel is always
 * anchored to its trigger and may overlap the page next to it.
 */
export function Popover({
  label,
  trigger,
  children,
  placement = "below-end",
  tone = "light",
  triggerClassName,
  panelClassName,
}: {
  /** Accessible name for an icon-only trigger. Leave out when the trigger shows text. */
  label?: string;
  trigger: ReactNode;
  /**
   * The panel's content. `close` shuts it; `closeToButton` also puts focus back on the button, for an action that goes
   * away with the panel.
   */
  children: (close: () => void, closeToButton: () => void) => ReactNode;
  placement?: keyof typeof PLACEMENT;
  tone?: keyof typeof TONE;
  triggerClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md focus-visible:outline-2 [&_svg]:size-5 [&_svg]:shrink-0",
          TONE[tone],
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={id}
          className={cn(
            "absolute z-40 w-72 rounded-lg border border-line bg-surface p-2 text-sm text-ink shadow-md",
            PLACEMENT[placement],
            panelClassName,
          )}
        >
          {children(
            () => setOpen(false),
            () => {
              setOpen(false);
              button.current?.focus();
            },
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One row in a popover menu: 44px tall, full width (D91). */
export const MENU_ROW =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-ink no-underline hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";
