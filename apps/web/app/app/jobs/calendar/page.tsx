"use client";

import { useTranslations } from "next-intl";
import { ComingSoon } from "../../[section]/coming-soon";
import { ListPage } from "../../list-page";
import { JobsSections } from "../jobs-sections";

/** Jobs' Calendar section (D147): its pill tab is there, the calendar itself is still being built (D128). */
export default function JobsCalendarPage() {
  const t = useTranslations("app.jobs");
  return (
    <ListPage title={t("title")} sections={<JobsSections current="calendar" />}>
      <ComingSoon name={t("sections.calendar")} variant="section" />
    </ListPage>
  );
}
