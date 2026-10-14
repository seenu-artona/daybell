"use client";

import type { JobListItem, JobsResponse } from "@daybell/api";
import { canDoTask, localDay, taskTarget } from "@daybell/core";
import {
  Badge,
  Banner,
  Button,
  Card,
  ClickableRow,
  ListCard,
  MainTab,
  MainTabs,
  RowChevron,
  RowChevronHead,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "@daybell/ui";
import { Camera, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { createLoadGuard } from "@/lib/load-guard";
import { taskHref } from "../checklist-links";
import { Dialog } from "../dialog";
import { ListPage } from "../list-page";
import { useStudio } from "../me-context";
import { JobForm } from "./job-form";
import { JOB_VIEWS, jobsQuery, jobViewFrom, jobViewHref } from "./job-views";
import { StatusBadge, useFormatDay } from "./status-badge";

const LINK =
  "font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";
const NAME_LINK =
  "inline-flex min-h-11 items-center font-bold text-ink no-underline hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * A job's checklist in one cell (D143; ADR 0017): the milestone pill, "3 of 5 done", and the next task as a link to
 * where the work happens (plain text if the person's role can't do it). Closed jobs say "All done".
 */
function ProgressCell({ job, role }: { job: JobListItem; role: string }) {
  const t = useTranslations("app.checklist");
  const { milestone, done, total, next } = job.checklist;
  const nextText = next ? t("nextTask", { task: t(`tasks.${next}`) }) : null;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone="draft" className="before:hidden">
          {milestone ? t(`milestones.${milestone}`) : t("allDone")}
        </Badge>
        <span className="text-caption whitespace-nowrap text-muted">
          {t("progress", { done, total })}
        </span>
      </span>
      {next && nextText ? (
        canDoTask(role, next) ? (
          <Link
            href={taskHref(job.id, taskTarget(next))}
            // Many rows say "Next: Print QR cards"; the name says which job (and starts with the visible words).
            aria-label={t("nextTaskIn", { task: t(`tasks.${next}`), job: job.name })}
            className={`${LINK} inline-flex min-h-11 items-center text-label text-primary`}
          >
            {nextText}
          </Link>
        ) : (
          <span className="text-label">{nextText}</span>
        )
      ) : null}
    </div>
  );
}

export default function JobsPageRoute() {
  // useSearchParams (the view) needs a Suspense boundary.
  return (
    <Suspense>
      <JobsPage />
    </Suspense>
  );
}

/**
 * Jobs list (Phase 1 step 1; D143, D144). Everyone on the team sees it; owners and admins create jobs in a dialog
 * ("New job", or /app/jobs?new=1 from Home). Views All, Draft, Selling and Closed (?status=, GET /jobs?status=). Each
 * row shows the job's checklist progress and opens the job on a click; its name stays the link.
 */
function JobsPage() {
  const t = useTranslations("app.jobs");
  const text = useApiText();
  const router = useRouter();
  const formatDay = useFormatDay();
  const { me, changed } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const view = jobViewFrom(useSearchParams().get("status"));
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [guard] = useState(createLoadGuard);

  const load = useCallback(
    async (cursor: string | null) => {
      // An older view's slow answer is dropped; Show more runs once at a time (no duplicate pages).
      const ticket = cursor ? guard.more() : guard.first();
      if (!ticket) return;
      // The browser's own day, so Picture day ticks on the person's calendar (ADR 0017).
      const res = await api<JobsResponse>(jobsQuery(view, localDay(new Date()), cursor));
      if (!ticket.finish()) return;
      if (!res.ok) {
        setError(text.error(res.code));
        return;
      }
      setError(null);
      setJobs((prev) => (cursor && prev ? [...prev, ...res.data.jobs] : res.data.jobs));
      setNextCursor(res.data.nextCursor);
    },
    [text, view, guard],
  );

  useEffect(() => {
    setJobs(null);
    void load(null);
  }, [load]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ?new=1 opens the form once.
  useEffect(() => {
    if (canManage && new URLSearchParams(window.location.search).get("new") === "1") {
      setCreating(true);
      router.replace("/app/jobs");
    }
  }, []);

  // With no jobs at all, the empty card has its own "Create your first job".
  const noJobsYet = view === "" && jobs !== null && jobs.length === 0;

  return (
    <ListPage
      title={t("title")}
      views={
        <MainTabs label={t("views.label")}>
          {JOB_VIEWS.map((v) => (
            <MainTab key={v || "all"} asChild current={view === v}>
              <Link href={jobViewHref(v)} scroll={false}>
                {v ? t(`statuses.${v}`) : t("views.all")}
              </Link>
            </MainTab>
          ))}
        </MainTabs>
      }
      actions={
        canManage && !noJobsYet ? (
          <Button shape="pill" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("new")}
          </Button>
        ) : null
      }
    >
      {error ? <Banner tone="danger" title={error} /> : null}
      {!jobs && !error ? <p className="m-0 text-muted">{t("loading")}</p> : null}

      {noJobsYet ? (
        <Card variant="sheet" className="flex flex-col items-center gap-3 py-12 text-center">
          <span
            className="grid size-14 place-items-center rounded-full bg-primary-soft"
            aria-hidden="true"
          >
            <Camera className="size-6" />
          </span>
          <h2 className="m-0 text-h2">{t("emptyTitle")}</h2>
          <p className="m-0 max-w-100 text-muted">{t("emptyBody")}</p>
          {canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t("emptyCta")}
            </Button>
          ) : (
            <p className="m-0 text-caption text-muted">{t("emptyReadOnly")}</p>
          )}
        </Card>
      ) : null}

      {jobs && jobs.length === 0 && !noJobsYet ? (
        <p className="m-0 rounded-list bg-surface px-6 py-10 text-center text-muted shadow-card">
          {t("emptyView")}
        </p>
      ) : null}

      {jobs && jobs.length > 0 ? (
        <ListCard
          footer={
            nextCursor ? (
              <Button variant="quiet" shape="pill" onClick={() => load(nextCursor)}>
                {t("loadMore")}
              </Button>
            ) : null
          }
        >
          <Table variant="list">
            <thead>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.client")}</TableHead>
                <TableHead>{t("columns.pictureDay")}</TableHead>
                <TableHead numeric>{t("columns.subjects")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.progress")}</TableHead>
                <RowChevronHead />
              </TableRow>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <ClickableRow key={job.id} onActivate={() => router.push(`/app/jobs/${job.id}`)}>
                  <TableCell>
                    <span className="flex flex-col items-start">
                      <Link href={`/app/jobs/${job.id}`} className={NAME_LINK}>
                        {job.name}
                      </Link>
                      {job.internalNumber ? (
                        <span className="-mt-2 text-body text-muted">{job.internalNumber}</span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{job.client?.name ?? t("none")}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDay(job.pictureDay)}</TableCell>
                  <TableCell numeric>{job.subjectsExpected ?? t("none")}</TableCell>
                  <TableCell>
                    <StatusBadge status={job.status} />
                  </TableCell>
                  <TableCell>
                    <ProgressCell job={job} role={me.studio.role} />
                  </TableCell>
                  <RowChevron />
                </ClickableRow>
              ))}
            </tbody>
          </Table>
        </ListCard>
      ) : null}

      <Dialog open={creating} onClose={() => setCreating(false)} title={t("form.createTitle")}>
        <JobForm
          job={null}
          onCancel={() => setCreating(false)}
          onSaved={(job) => {
            setCreating(false);
            changed();
            router.push(`/app/jobs/${job.id}`);
          }}
        />
      </Dialog>
    </ListPage>
  );
}
