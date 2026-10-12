"use client";

import type { JobChecklist as JobChecklistData, JobDetailResponse } from "@daybell/api";
import { daysUntil, localDay } from "@daybell/core";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
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
  const { job, summary, canManage, setTaggingReviewed } = useJob();
  const today = localDay(new Date());
  const days = daysUntil(job.pictureDay, today);
  const [checklist, setChecklist] = useState<JobChecklistData | null>(null);

  // The checklist comes from GET /jobs/:id, the same facts as the Jobs list (one data path; ADR 0017). Loaded here,
  // only while the Overview shows: again after an edit (the picture day may move) or a summary refresh (a roster or
  // print change made from this page), never on People's roster changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt and a new summary only signal that the job changed.
  useEffect(() => {
    // The card needs the summary too: wait for it, so the first visit loads the checklist once.
    if (!summary) return;
    let live = true;
    api<JobDetailResponse>(`/jobs/${job.id}?today=${localDay(new Date())}`).then((res) => {
      if (live && res.ok) {
        setChecklist(res.data.job.checklist);
        setTaggingReviewed(
          res.data.job.checklist.tasks.some((task) => task.key === "reviewTagging" && task.done),
        );
      }
    });
    return () => {
      live = false;
    };
  }, [job.id, job.updatedAt, summary]);

  const hero =
    job.status === "closed"
      ? t("hero.closed")
      : days >= 0
        ? t("hero.countdown", { days })
        : t("hero.ago", { days: -days });

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 mt-1 text-hero">{hero}</p>
      {summary && checklist ? (
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1">
            <JobChecklist
              checklist={checklist}
              rosterSize={summary.children}
              qrCards={summary.qrCards}
              failedPhotos={summary.photos?.failed ?? 0}
              leftovers={summary.photos?.leftovers ?? 0}
              flagged={summary.photos?.flagged ?? 0}
            />
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
