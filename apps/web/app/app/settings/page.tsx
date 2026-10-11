"use client";

import { useTranslations } from "next-intl";
import { TeamCard } from "./team-card";

export default function SettingsPage() {
  const t = useTranslations("app.settings");
  return (
    <>
      <div>
        <h1 className="m-0 text-h1">{t("title")}</h1>
        <p className="mt-1 mb-0 text-muted">{t("teamIntro")}</p>
      </div>
      <TeamCard />
    </>
  );
}
