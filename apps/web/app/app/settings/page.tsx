"use client";

import { useTranslations } from "next-intl";
import { TeamCard } from "./team-card";

/** Settings › Team (the heading and sections are in the layout). */
export default function SettingsPage() {
  const t = useTranslations("app.settings");
  return (
    <>
      <p className="m-0 text-muted">{t("teamIntro")}</p>
      <TeamCard />
    </>
  );
}
