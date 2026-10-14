"use client";

import { MainTab, MainTabs } from "@daybell/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useJob } from "./job-context";
import { JOB_TABS, tabForPath, tabHref } from "./tabs";

/**
 * The job's sections (D137, D144): pills on the canvas, the current one ink with white bold text. Separate routes, so
 * a navigation of links with aria-current, not an ARIA tablist. Every section shows (D150 dropped the unbuilt ones);
 * the roster's size is in Subjects' footer, not on the tab.
 */
export function JobTabs() {
  const t = useTranslations("app.job.tabs");
  const { job } = useJob();
  const current = tabForPath(usePathname());
  return (
    <MainTabs label={t("label")}>
      {JOB_TABS.map((tab) => (
        <MainTab key={tab.key} asChild current={current === tab.key}>
          <Link href={tabHref(job.id, tab.key)}>{t(tab.key)}</Link>
        </MainTab>
      ))}
    </MainTabs>
  );
}
