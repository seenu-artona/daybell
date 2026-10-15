"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { groupsHref, tabHref } from "../tabs";

/**
 * Photos by People or by Groups (D156): two links at the left of the card's toolbar, the current one with
 * aria-current, ink and bold (never colour alone, D91). Separate pages, so links, not a tablist.
 */
export function PhotosSwitch({ jobId, current }: { jobId: string; current: "people" | "groups" }) {
  const t = useTranslations("app.photos.switch");
  const views = [
    { key: "people", href: tabHref(jobId, "photos") },
    { key: "groups", href: groupsHref(jobId) },
  ] as const;
  return (
    <nav aria-label={t("label")} className="shrink-0">
      <ul className="m-0 flex list-none items-center gap-1 rounded-full bg-canvas p-1">
        {views.map((view) => (
          <li key={view.key}>
            <Link
              href={view.href}
              aria-current={view.key === current ? "page" : undefined}
              className={`flex h-11 items-center rounded-full px-4 text-sm no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                view.key === current
                  ? "bg-ink font-bold text-on-primary"
                  : "font-semibold text-muted hover:bg-surface hover:text-ink"
              }`}
            >
              {t(view.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
