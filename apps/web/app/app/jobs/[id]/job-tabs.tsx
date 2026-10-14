"use client";

import { MainTab, MainTabs } from "@daybell/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useJob } from "./job-context";
import { tabForPath, tabHref, VISIBLE_JOB_TABS } from "./tabs";

/**
 * The job's sections (D137, D144): pills on the canvas, the current one ink with white bold text. Separate routes, so
 * a navigation of links with aria-current, not an ARIA tablist. Only the built sections show (VISIBLE_JOB_TABS); the
 * roster's size is in Subjects' footer, not on the tab.
 */
export function JobTabs() {
  const t = useTranslations("app.job.tabs");
  const { job } = useJob();
  const current = tabForPath(usePathname());
  return (
    <MainTabs label={t("label")}>
      {VISIBLE_JOB_TABS.map((tab) => (
        <MainTab key={tab.key} asChild current={current === tab.key}>
          <Link href={tabHref(job.id, tab.key)}>{t(tab.key)}</Link>
        </MainTab>
      ))}
    </MainTabs>
  );
}
