"use client";

import type {
  ChildrenResponse,
  GroupsResponse,
  Job,
  JobDetailResponse,
  PhotoCountsResponse,
  QrCardStatusResponse,
} from "@daybell/api";
import { canEditRoster } from "@daybell/core";
import { Banner, IconButton } from "@daybell/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { useStudio } from "../../me-context";
import { JobContext, type JobContextValue, type JobSummary } from "./job-context";
import { JobHeader } from "./job-header";
import { JobTabs } from "./job-tabs";

/**
 * Every job section's frame (D137, D144): the title row and the pill tabs on the grey canvas, then the section.
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
      api<GroupsResponse>(`/jobs/${jobId}/groups`),
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
          groups: groups.data.groups.length,
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
          }
        : null,
    [job, summary, refreshSummary, taggingReviewed, role],
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
      <div className="flex min-h-dvh flex-col px-10 pt-8 pb-12">
        <StickyFrame name={value.job.name} />
        <div className="mt-2 flex flex-col">{children}</div>
      </div>
    </JobContext.Provider>
  );
}

/**
 * The header and the tabs in one sticky block (D144). Its negative top lets the title row scroll away while the tab row
 * stays. Once the tab row reaches the top it is "stuck": a canvas bar with a hairline under it, a back button and the
 * job's name in small type (hidden from screen readers; the h1 is still on the page), and the same tab navigation.
 * The tab row is always 72px, so nothing below moves when it sticks. The page keeps focused controls clear of it
 * (globals.css, WCAG 2.4.11).
 */
function StickyFrame({ name }: { name: string }) {
  const tj = useTranslations("app.jobs.detail");
  const sentinel = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [stuck, setStuck] = useState(false);

  // How far the tab row sits below the block's top: the title row's height, which changes with its text.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => setOffset(el.offsetTop);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, []);

  // The sentinel sits just above the block: once it has scrolled further above the window than the title row is tall,
  // the tab row is at the top of the window. The root reaches that far above the window (rootMargin).
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(entry ? !entry.isIntersecting && entry.boundingClientRect.top < 0 : false),
      { rootMargin: `${offset}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [offset]);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px -mb-px" />
      <div
        data-sticky-header=""
        data-stuck={stuck ? "" : undefined}
        style={{ top: -offset }}
        className={`sticky z-30 -mx-10 px-10 motion-safe:transition-colors motion-safe:duration-[var(--duration-base)] ${
          stuck ? "border-b border-line-canvas bg-canvas" : "border-b border-transparent"
        }`}
      >
        <JobHeader />
        <div ref={row} className="flex h-18 items-center gap-4">
          {stuck ? (
            <>
              <IconButton asChild label={tj("back")}>
                <Link href="/app/jobs">
                  <ArrowLeft aria-hidden="true" />
                </Link>
              </IconButton>
              <p aria-hidden="true" className="m-0 max-w-80 truncate text-h3 font-bold">
                {name}
              </p>
            </>
          ) : null}
          <JobTabs />
        </div>
      </div>
    </>
  );
}
