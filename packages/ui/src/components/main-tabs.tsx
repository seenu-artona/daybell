import { Slot } from "@radix-ui/react-slot";
import type { AnchorHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface MainTabsProps extends HTMLAttributes<HTMLElement> {
  /** The navigation landmark's name, e.g. "Job sections". */
  label: string;
}

/**
 * A record's main sections as pills on the canvas (D144): separate pages, so a navigation of links with
 * aria-current, not an ARIA tablist. No container behind the pills.
 */
export function MainTabs({ label, className, children, ...props }: MainTabsProps) {
  return (
    <nav aria-label={label} className={className} {...props}>
      <ul className="m-0 flex list-none items-center gap-1 p-0">{children}</ul>
    </nav>
  );
}

export interface MainTabProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  current?: boolean;
  /** Render the child element (for example a Next.js Link) with the tab's styles. */
  asChild?: boolean;
}

/**
 * One 44px pill. The current one is ink with white bold text (bold as well as colour, D91); the others are muted text
 * that turns white behind on hover.
 */
export function MainTab({ current, asChild = false, className, ...props }: MainTabProps) {
  const Comp = asChild ? Slot : "a";
  return (
    <li>
      <Comp
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-5 text-body-lg no-underline transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          current
            ? "bg-ink font-bold text-on-primary"
            : "bg-transparent font-semibold text-muted hover:bg-surface hover:text-ink",
          className,
        )}
        {...props}
      />
    </li>
  );
}
