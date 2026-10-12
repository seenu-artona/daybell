"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { reviewHref, tabHref } from "../tabs";

/**
 * The Photos tab's two views (ADR 0018): All photos and Review. Separate pages, so links with aria-current, not an ARIA
 * tablist; the current one is white and bold, never colour alone (D91). 44px targets.
 */
export function PhotosViews({ jobId, current }: { jobId: string; current: "all" | "review" }) {
  const t = useTranslations("app.photos.views");
  const views = [
    { key: "all", href: tabHref(jobId, "photos") },
    { key: "review", href: reviewHref(jobId) },
  ] as const;
  return (
    <nav aria-label={t("label")}>
      <ul className="m-0 flex list-none gap-1 p-0">
        {views.map((view) => {
          const active = view.key === current;
          return (
            <li key={view.key}>
              <Link
                href={view.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-11 items-center rounded-full px-4 text-sm no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  active
                    ? "bg-surface font-bold text-ink shadow-sm"
                    : "font-semibold text-muted hover:bg-surface/60 hover:text-ink"
                }`}
              >
                {t(view.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
