"use client";

import { MoneyStat } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { ActivityCard } from "./activity-card";
import { Checklist } from "./checklist";
import { useStudio } from "./me-context";

/** Studio Home (D127): setup checklist until done, then money leads. */
export default function HomePage() {
  const t = useTranslations("app");
  const { me, version } = useStudio();
  const studio = me.studio;
  const canSeeActivity = studio.role === "owner" || studio.role === "admin";
  return (
    <>
      <div>
        <h1 className="m-0 text-h1">{t("welcome", { studio: studio.name })}</h1>
        <p className="mt-1 mb-0 text-muted">{t("welcomeBody")}</p>
      </div>
      <Checklist />
      <MoneyStat
        label={t("sales")}
        cents={0}
        currency={studio.region === "ca" ? "CAD" : "USD"}
        locale={studio.region === "ca" ? "en-CA" : "en-US"}
        delta={t("salesDelta")}
        animate={false}
        className="max-w-90"
      />
      {canSeeActivity ? <ActivityCard refreshKey={version} /> : null}
    </>
  );
}
