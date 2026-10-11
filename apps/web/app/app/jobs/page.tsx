"use client";

import type { Job, JobsResponse } from "@daybell/api";
import { Banner, Button, Card, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { Camera, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../dialog";
import { useStudio } from "../me-context";
import { JobForm } from "./job-form";
import { StatusBadge, useFormatDay } from "./status-badge";

const LINK =
  "font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Jobs list (Phase 1 step 1). Everyone on the team sees it; owners and admins create jobs in a dialog
 * ("New job", or /app/jobs?new=1 from Home).
 */
export default function JobsPage() {
  const t = useTranslations("app.jobs");
  const text = useApiText();
  const router = useRouter();
  const formatDay = useFormatDay();
  const { me, changed } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (cursor: string | null) => {
      const res = await api<JobsResponse>(cursor ? `/jobs?cursor=${cursor}` : "/jobs");
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
    <>
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
    </>
  );
}
