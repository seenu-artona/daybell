"use client";

import { MainTab, MainTabs } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** Jobs' sections (D147): List and Calendar, the page's own pill tabs under its title row. Links, not filters. */
export function JobsSections({ current }: { current: "list" | "calendar" }) {
  const t = useTranslations("app.jobs.sections");
  return (
    <MainTabs label={t("label")}>
      <MainTab asChild current={current === "list"}>
        <Link href="/app/jobs">{t("list")}</Link>
      </MainTab>
      <MainTab asChild current={current === "calendar"}>
        <Link href="/app/jobs/calendar">{t("calendar")}</Link>
      </MainTab>
    </MainTabs>
  );
}
