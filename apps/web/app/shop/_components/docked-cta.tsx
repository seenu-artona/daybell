"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * One main action per screen, docked at the bottom with its price beside it (the ShopFlow board), as a named region
 * (code review S4). Pages leave room at the bottom, and globals.css adds scroll padding while it is shown, so a
 * focused control is never hidden under it (WCAG 2.4.11).
 */
export function DockedCta({
  price,
  label,
  children,
}: {
  price?: string;
  label?: string;
  children: ReactNode;
}) {
  const t = useTranslations("shop.header");
  return (
    <section
      aria-label={t("docked")}
      data-docked-cta=""
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-[480px] items-center gap-3 px-4 py-3">
        {price ? (
          <p className="m-0 min-w-0 flex-1">
            <span className="block text-base font-bold tabular-nums">{price}</span>
            {label ? <span className="block truncate text-caption text-muted">{label}</span> : null}
          </p>
        ) : null}
        <div className={price ? "shrink-0" : "flex-1 [&>*]:w-full"}>{children}</div>
      </div>
    </section>
  );
}
