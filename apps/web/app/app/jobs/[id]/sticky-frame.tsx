"use client";

import { IconButton } from "@daybell/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/** True when the person asked for less motion: scrolling then jumps instead of gliding. */
function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * A record's header and tabs in one sticky block (D144), with the section's actions at the right end of the tab row
 * (D147). Its negative top lets the header scroll away while the tab
 * row stays. Once the tab row reaches the top it is "stuck": a canvas bar with a hairline under it, a back link and the
 * record's name in small type (hidden from screen readers; the h1 is still on the page), and the same tab navigation.
 * The tab row is always `--sticky-header-height` tall (globals.css), so nothing below moves when it sticks; the page
 * keeps focused controls clear of it (WCAG 2.4.11).
 *
 * While stuck, the header's controls are above the window. They stay reachable: focus moving into the header scrolls
 * the page back to it (instantly with reduced motion), which unsticks the row. The header gets `stuck` so it can take
 * its own back link out of the tab order and the accessibility tree meanwhile: there is only ever one back link.
 */
export function StickyFrame({
  name,
  backHref,
  backLabel,
  header,
  tabs,
  actionsRef,
}: {
  name: string;
  backHref: string;
  backLabel: string;
  header: (stuck: boolean) => ReactNode;
  tabs: ReactNode;
  /** The tab row's right end, for the section's actions (D147): JobTabActions renders into it. */
  actionsRef?: (element: HTMLDivElement | null) => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [stuck, setStuck] = useState(false);

  // How far the tab row sits below the block's top: the header's height, which changes with its text.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => setOffset(el.offsetTop);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, []);

  // The sentinel sits just above the block: once it has scrolled further above the window than the header is tall,
  // the tab row is at the top of the window. The root reaches that far above the window (rootMargin).
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(entry ? !entry.isIntersecting && entry.boundingClientRect.top < 0 : false),
      { rootMargin: `${offset}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [offset]);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="-mb-px h-px" />
      <div
        data-sticky-header=""
        data-stuck={stuck ? "" : undefined}
        style={{ top: -offset }}
        className={`sticky z-30 -mx-10 px-10 motion-safe:transition-colors motion-safe:duration-[var(--duration-base)] ${
          stuck ? "border-b border-line-canvas bg-canvas" : "border-b border-transparent"
        }`}
      >
        <div
          data-sticky-header-top=""
          onFocusCapture={(event) => {
            // A dialog opened from the header (Start selling, Edit) is not the header coming back into view.
            if (stuck && !(event.target as Element).closest("dialog"))
              sentinel.current?.scrollIntoView({
                block: "start",
                behavior: reducedMotion() ? "instant" : "smooth",
              });
          }}
        >
          {header(stuck)}
        </div>
        <div ref={row} className="flex h-[var(--sticky-header-height)] items-center gap-4">
          {stuck ? (
            <>
              <IconButton asChild label={backLabel}>
                <Link href={backHref}>
                  <ArrowLeft aria-hidden="true" />
                </Link>
              </IconButton>
              <p
                aria-hidden="true"
                data-sticky-name=""
                className="m-0 max-w-80 truncate text-h3 font-bold"
              >
                {name}
              </p>
            </>
          ) : null}
          {tabs}
          {actionsRef ? (
            <div
              ref={actionsRef}
              data-tab-actions=""
              className="ml-auto flex shrink-0 items-center gap-2 empty:hidden"
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
