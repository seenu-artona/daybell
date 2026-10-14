"use client";

import { FilterChip, FilterChips } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { reviewHref, tabHref } from "../tabs";

/**
 * The Photos tab's chips (ADR 0018; D147, amends D144): All and Review, in the toolbar of the section's white card.
 * Separate pages, so links with aria-current; the selected one has a check and an ink border, never colour alone
 * (D91). Photos has no "+ Add filter" (Seenu, Oct 14).
 */
export function PhotosViews({ jobId, current }: { jobId: string; current: "all" | "review" }) {
  const t = useTranslations("app.photos.views");
  const views = [
    { key: "all", href: tabHref(jobId, "photos") },
    { key: "review", href: reviewHref(jobId) },
  ] as const;
  return (
    <FilterChips label={t("label")}>
      {views.map((view) => (
        <FilterChip key={view.key} asChild selected={view.key === current}>
          <Link href={view.href}>{t(view.key)}</Link>
        </FilterChip>
      ))}
    </FilterChips>
  );
}
