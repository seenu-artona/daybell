"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/** A small dropdown anchored to a button. Closes on outside click and Escape; returns focus to the button. */
export function Popover({
  label,
  icon,
  showLabel = false,
  align = "right",
  children,
}: {
  label: string;
  icon: ReactNode;
  showLabel?: boolean;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={showLabel ? undefined : label}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-2.5 text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary [&_svg]:size-5"
      >
        {icon}
        {showLabel ? <span className="hidden font-medium md:inline">{label}</span> : null}
      </button>
      {open ? (
        <div
          id={id}
          className={`absolute top-full z-30 mt-2 w-72 rounded-lg border border-line bg-surface p-4 shadow-md ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
