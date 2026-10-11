import type { ComponentPropsWithoutRef, ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SideMenuProps extends HTMLAttributes<HTMLElement> {
  /** Logo and name at the top. Optional: the studio app puts its brand row outside the navigation landmark. */
  brand?: ReactNode;
  /** Accessible name for the navigation landmark. */
  label: string;
  /** A 64px icon rail; every item keeps its name for screen readers. */
  folded?: boolean;
}

/** The dark menu (D137). Full width of its container; the container sets 220px open or 64px folded. */
export function SideMenu({ brand, label, folded, className, children, ...props }: SideMenuProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-col gap-0.5 bg-ink py-4 text-white/75",
        folded ? "w-16 px-2" : "w-58 px-3",
        className,
      )}
      {...props}
    >
      {brand ? (
        <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-4 text-lg font-extrabold text-on-primary">
          {brand}
        </div>
      ) : null}
      {children}
    </nav>
  );
}

type SideMenuItemProps<T extends ElementType> = {
  /** Link component to render, e.g. Next.js `Link`. Defaults to `a`. */
  as?: T;
  icon?: ReactNode;
  current?: boolean;
  count?: number;
  /** Read aloud with the count, e.g. "12 new orders". */
  countLabel?: string;
  /** A small label after the name, e.g. "Soon" for sections still being built. */
  tag?: ReactNode;
  /** Icon only: the name and tag stay for screen readers (sr-only). No hover tooltips (WCAG 1.4.13). */
  folded?: boolean;
} & Omit<ComponentPropsWithoutRef<T>, "as">;

export function SideMenuItem<T extends ElementType = "a">({
  as,
  icon,
  current,
  count,
  countLabel,
  tag,
  folded,
  className,
  children,
  ...props
}: SideMenuItemProps<T>) {
  const Comp: ElementType = as ?? "a";
  return (
    <Comp
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-md font-medium text-white/75 no-underline",
        "hover:bg-white/6 hover:text-white focus-visible:outline-2 focus-visible:outline-lime",
        folded ? "justify-center px-0" : "px-2.5",
        current && "bg-primary font-semibold text-white hover:bg-primary",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="flex size-[18px] shrink-0 [&_svg]:size-[18px]" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={folded ? "sr-only" : "flex-1"}>{children}</span>
      {/* A space, so the accessible name reads "Orders Soon", not "OrdersSoon". Flex layout doesn't render it. */}
      {tag || count ? " " : null}
      {tag ? (
        <span
          className={
            folded
              ? "sr-only"
              : "rounded-full border border-white/20 px-[7px] text-micro font-semibold text-white/60"
          }
        >
          {tag}
        </span>
      ) : null}
      {count ? (
        <span className={folded ? "sr-only" : "rounded-full bg-lime px-[7px] text-micro text-ink"}>
          <span aria-hidden="true">{folded ? null : count}</span>
          <span className="sr-only">{countLabel ?? count}</span>
        </span>
      ) : null}
    </Comp>
  );
}
