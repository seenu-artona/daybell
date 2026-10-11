import type { ComponentPropsWithoutRef, ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SideMenuProps extends HTMLAttributes<HTMLElement> {
  brand: ReactNode;
  /** Accessible name for the navigation landmark. */
  label: string;
}

export function SideMenu({ brand, label, className, children, ...props }: SideMenuProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex w-58 flex-col gap-0.5 rounded-lg bg-ink px-3 py-4 text-white/75",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-4 text-lg font-extrabold text-on-primary">
        {brand}
      </div>
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
} & Omit<ComponentPropsWithoutRef<T>, "as">;

export function SideMenuItem<T extends ElementType = "a">({
  as,
  icon,
  current,
  count,
  countLabel,
  className,
  children,
  ...props
}: SideMenuItemProps<T>) {
  const Comp: ElementType = as ?? "a";
  return (
    <Comp
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-md px-2.5 font-medium text-white/75 no-underline",
        "hover:bg-white/6 hover:text-white focus-visible:outline-2 focus-visible:outline-lime",
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
      <span className="flex-1">{children}</span>
      {count ? (
        <span className="rounded-full bg-lime px-[7px] text-micro text-ink">
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{countLabel ?? count}</span>
        </span>
      ) : null}
    </Comp>
  );
}
