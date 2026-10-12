"use client";

import type { JobListItem, JobsResponse } from "@daybell/api";
import { canDoTask, localDay, taskTarget } from "@daybell/core";
import { Badge, Banner, Button, Card, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { Camera, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { taskHref } from "../checklist-links";
import { Dialog } from "../dialog";
import { useStudio } from "../me-context";
import { PageFrame } from "../page-frame";
import { JobForm } from "./job-form";
import { StatusBadge, useFormatDay } from "./status-badge";

const LINK =
  "font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

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
        <Badge tone={milestone ? "selling" : "draft"} className="before:hidden">
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

/**
 * Jobs list (Phase 1 step 1; D143). Everyone on the team sees it; owners and admins create jobs in a dialog
 * ("New job", or /app/jobs?new=1 from Home). Each row shows the job's checklist progress.
 */
export default function JobsPage() {
  const t = useTranslations("app.jobs");
  const text = useApiText();
  const router = useRouter();
  const formatDay = useFormatDay();
  const { me, changed } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (cursor: string | null) => {
      // The browser's own day, so Picture day ticks on the person's calendar (ADR 0017).
      const query = new URLSearchParams({ today: localDay(new Date()) });
      if (cursor) query.set("cursor", cursor);
      const res = await api<JobsResponse>(`/jobs?${query}`);
      if (!res.ok) {
        setError(text.error(res.code));
        return;
      }
      setJobs((prev) => (cursor && prev ? [...prev, ...res.data.jobs] : res.data.jobs));
      setNextCursor(res.data.nextCursor);
    },
    [text],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on open; ?new=1 opens the form once.
  useEffect(() => {
    void load(null);
    if (canManage && new URLSearchParams(window.location.search).get("new") === "1") {
      setCreating(true);
      router.replace("/app/jobs");
    }
  }, []);

  const newJob = canManage ? (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t("new")}
    </Button>
  ) : null;

  return (
    <PageFrame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-h1">{t("title")}</h1>
          <p className="mt-1 mb-0 text-muted">{t("intro")}</p>
        </div>
        {jobs && jobs.length > 0 ? newJob : null}
      </div>

      {error ? <Banner tone="danger" title={error} /> : null}
      {!jobs && !error ? <p className="m-0 text-muted">{t("loading")}</p> : null}

      {jobs && jobs.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
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

      {jobs && jobs.length > 0 ? (
        <>
          <Table>
            <thead>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.number")}</TableHead>
                <TableHead>{t("columns.client")}</TableHead>
                <TableHead>{t("columns.pictureDay")}</TableHead>
                <TableHead numeric>{t("columns.subjects")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.progress")}</TableHead>
              </TableRow>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link
                      href={`/app/jobs/${job.id}`}
                      className={`${LINK} inline-flex min-h-11 items-center`}
                    >
                      {job.name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{job.internalNumber}</TableCell>
                  <TableCell>{job.client?.name ?? t("none")}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDay(job.pictureDay)}</TableCell>
                  <TableCell numeric>{job.subjectsExpected ?? t("none")}</TableCell>
                  <TableCell>
                    <StatusBadge status={job.status} />
                  </TableCell>
                  <TableCell>
                    <ProgressCell job={job} role={me.studio.role} />
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
          {nextCursor ? (
            <Button variant="secondary" className="self-start" onClick={() => load(nextCursor)}>
              {t("loadMore")}
            </Button>
          ) : null}
        </>
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
    </PageFrame>
  );
}
