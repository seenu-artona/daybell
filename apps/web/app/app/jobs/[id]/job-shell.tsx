"use client";

import type {
  ChildrenResponse,
  GroupsResponse,
  Job,
  JobDetailResponse,
  PhotoCountsResponse,
  QrCardStatusResponse,
} from "@daybell/api";
import { canEditRoster, localDay } from "@daybell/core";
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

/**
 * Every job section's frame (D137, D140): the title row and the pill tabs on the grey canvas, then the section.
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

  useEffect(() => {
    api<{ job: Job }>(`/jobs/${encodeURIComponent(id)}`).then((res) => {
      if (res.ok) setJob(res.data.job);
      else setProblem(res.code === "not_found" ? tj("notFound") : text.error(res.code));
    });
  }, [id, tj, text]);

  const refreshSummary = useCallback(() => {
    const jobId = encodeURIComponent(id);
    void Promise.all([
      api<ChildrenResponse>(`/jobs/${jobId}/children?limit=1`),
      api<GroupsResponse>(`/jobs/${jobId}/groups`),
      api<QrCardStatusResponse>(`/jobs/${jobId}/qr-cards`),
      api<PhotoCountsResponse>(`/jobs/${jobId}/photos/summary`),
      // The checklist comes from the API, from the same facts as the Jobs list (one data path; ADR 0017).
      api<JobDetailResponse>(`/jobs/${jobId}?today=${localDay(new Date())}`),
    ]).then(([kids, groups, cards, photos, detail]) => {
      // The card and photo counts only feed notes, and the checklist its card: if one fails, the rest still shows.
      if (kids.ok && groups.ok)
        setSummary({
          children: kids.data.total,
          duplicates: kids.data.duplicates,
          groups: groups.data.groups.length,
          qrCards: cards.ok ? cards.data.qrCards : null,
          photos: photos.ok ? photos.data.counts : null,
          checklist: detail.ok ? detail.data.job.checklist : null,
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
            // An edit can move the picture day, which ticks or reopens the Picture day task.
            setJob: (next: Job) => {
              setJob(next);
              refreshSummary();
            },
            summary,
            refreshSummary,
            canManage: role === "owner" || role === "admin",
            canEditRoster: canEditRoster(role),
          }
        : null,
    [job, summary, refreshSummary, role],
  );

  if (!value) {
    return (
      <div className="flex flex-col gap-4 px-12 pt-10">
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
      <div className="flex min-h-dvh flex-col gap-4 px-7 pt-5 pb-12">
        <JobHeader />
        <JobTabs />
        {children}
      </div>
    </JobContext.Provider>
  );
}
