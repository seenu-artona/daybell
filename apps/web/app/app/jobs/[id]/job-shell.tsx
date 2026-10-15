"use client";

import type {
  ChildrenResponse,
  ClassesResponse,
  Job,
  JobDetailResponse,
  PhotoCountsResponse,
  QrCardStatusResponse,
} from "@daybell/api";
import { canEditRoster } from "@daybell/core";
import { Banner } from "@daybell/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { useStudio } from "../../me-context";
import { JobContext, type JobContextValue, type JobSummary } from "./job-context";
import { JobHeader } from "./job-header";
import { JobTabs } from "./job-tabs";
import { StickyFrame } from "./sticky-frame";

/**
 * Every job section's frame (D137, D144): the title row and the pill tabs on the grey canvas, the section's actions at
 * the tab row's right end (D147), then the section.
 * Loads the job and its roster numbers once; the layout stays mounted while people move between sections, so
 * switching tabs never loads the job again.
 */
export function JobShell({ children }: { children: ReactNode }) {
  const tj = useTranslations("app.jobs.detail");
  const text = useApiText();
  const { id } = useParams<{ id: string }>();
  const { me } = useStudio();
  const [job, setJob] = useState<Job | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [taggingReviewed, setTaggingReviewed] = useState(false);
  const [tabActions, setTabActions] = useState<HTMLElement | null>(null);

  useEffect(() => {
    api<JobDetailResponse>(`/jobs/${encodeURIComponent(id)}`).then((res) => {
      if (res.ok) {
        const { checklist, ...rest } = res.data.job;
        setJob(rest);
        setTaggingReviewed(
          checklist.tasks.some((task) => task.key === "reviewTagging" && task.done),
        );
      } else setProblem(res.code === "not_found" ? tj("notFound") : text.error(res.code));
    });
  }, [id, tj, text]);

  const refreshSummary = useCallback(() => {
    const jobId = encodeURIComponent(id);
    void Promise.all([
      api<ChildrenResponse>(`/jobs/${jobId}/children?limit=1`),
      api<ClassesResponse>(`/jobs/${jobId}/classes`),
      api<QrCardStatusResponse>(`/jobs/${jobId}/qr-cards`),
      api<PhotoCountsResponse>(`/jobs/${jobId}/photos/summary`),
    ]).then(([kids, groups, cards, photos]) => {
      // The card and photo counts only feed the checklist's notes: if they fail, the rest of the summary still shows.
      // The checklist itself is loaded by the Overview, never here: People refreshes this summary after every roster
      // change and must not reload the job each time (ADR 0017).
      if (kids.ok && groups.ok)
        setSummary({
          children: kids.data.total,
          duplicates: kids.data.duplicates,
          groups: groups.data.classes.length,
          qrCards: cards.ok ? cards.data.qrCards : null,
          photos: photos.ok ? photos.data.counts : null,
        });
    });
  }, [id]);

  useEffect(() => refreshSummary(), [refreshSummary]);

  const role = me.studio.role;
  const value = useMemo<JobContextValue | null>(
    () =>
      job
        ? {
            job,
            setJob,
            summary,
            refreshSummary,
            taggingReviewed,
            setTaggingReviewed,
            canManage: role === "owner" || role === "admin",
            canEditRoster: canEditRoster(role),
            tabActions,
          }
        : null,
    [job, summary, refreshSummary, taggingReviewed, role, tabActions],
  );

  if (!value) {
    return (
      <div className="flex flex-col gap-4 px-10 pt-8">
        <Link
          href="/app/jobs"
          className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {tj("back")}
        </Link>
        {problem ? (
          <Banner tone="danger" title={problem} />
        ) : (
          <p className="m-0 text-muted">{tj("loading")}</p>
        )}
      </div>
    );
  }

  return (
    <JobContext.Provider value={value}>
      <div className="flex min-h-dvh flex-col px-10 pt-8 pb-12">
        <StickyFrame
          name={value.job.name}
          backHref="/app/jobs"
          backLabel={tj("back")}
          header={(stuck) => <JobHeader stuck={stuck} />}
          tabs={<JobTabs />}
          actionsRef={setTabActions}
        />
        <div className="mt-2 flex flex-col">{children}</div>
      </div>
    </JobContext.Provider>
  );
}
