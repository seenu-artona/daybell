"use client";

import { type ChecklistFacts, daysUntil, localDay } from "@daybell/core";
import { useTranslations } from "next-intl";
import { ActivityCard } from "../../activity-card";
import { useStudio } from "../../me-context";
import { JobChecklist } from "./job-checklist";
import { useJob } from "./job-context";

/**
 * A job's Overview (D140, D143; ADR 0014, 0017): one big hero line (the picture day countdown), then the job's
 * checklist beside its recent activity (owners and admins; otherwise the checklist takes the full width). The
 * milestone shows only with the checklist; the header pill shows the shop state alone (Draft, Selling or Closed).
 */
export default function JobOverviewPage() {
  const t = useTranslations("app.job");
  const { version } = useStudio();
  const { job, summary, canManage } = useJob();
  const today = localDay(new Date());
  const days = daysUntil(job.pictureDay, today);

  const hero =
    job.status === "closed"
      ? t("hero.closed")
      : days >= 0
        ? t("hero.countdown", { days })
        : t("hero.ago", { days: -days });

  const facts: ChecklistFacts | null = summary
    ? {
        status: job.status,
        pictureDay: job.pictureDay,
        children: summary.children,
        qrCards: summary.qrCards,
        hasReadyPhoto: (summary.photos?.ready ?? 0) > 0,
        failedPhotos: summary.photos?.failed ?? 0,
        today,
      }
    : null;

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 mt-1 text-hero">{hero}</p>
      {facts ? (
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1">
            <JobChecklist facts={facts} />
          </div>
          {canManage ? (
            <div className="min-w-0 flex-1">
              <ActivityCard refreshKey={version} jobId={job.id} variant="sheet" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
