"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * A small dropdown anchored to a button. Closes on outside click, on Escape pressed inside it, and when focus leaves it;
 * Escape returns focus to the button. On phones it spans the screen width so it never runs off the edge.
 */
export function Popover({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: (close: () => void) => ReactNode;
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
      className="sm:relative"
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
        className="flex size-11 items-center justify-center rounded-md text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary [&_svg]:size-5"
      >
        {icon}
      </button>
      {open ? (
        <div
          id={id}
          className="fixed inset-x-3 top-15 z-30 rounded-lg border border-line bg-surface p-4 shadow-md sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-72"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
