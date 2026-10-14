"use client";

import { ViewTab, ViewTabs } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { reviewHref, tabHref } from "../tabs";

/**
 * The Photos tab's two views (ADR 0018, D144): All and Review, in the section's view bar. Separate pages, so links
 * with aria-current, not an ARIA tablist; the current one is bold with a dash under it, never colour alone (D91).
 */
export function PhotosViews({ jobId, current }: { jobId: string; current: "all" | "review" }) {
  const t = useTranslations("app.photos.views");
  const views = [
    { key: "all", href: tabHref(jobId, "photos") },
    { key: "review", href: reviewHref(jobId) },
  ] as const;
  return (
    <ViewTabs label={t("label")}>
      {views.map((view) => (
        <ViewTab key={view.key} asChild current={view.key === current}>
          <Link href={view.href}>{t(view.key)}</Link>
        </ViewTab>
      ))}
    </ViewTabs>
  );
}
