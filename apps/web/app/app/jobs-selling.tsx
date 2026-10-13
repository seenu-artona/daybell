"use client";

import type { JobsResponse } from "@daybell/api";
import { localDay } from "@daybell/core";
import { Megaphone } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { tabHref } from "./jobs/[id]/tabs";
import { useFormatClosing } from "./jobs/closing-date";

/** Home shows this many; "View all jobs" when there are more. */
export const JOBS_SELLING_SHOWN = 5;

/**
 * Home's "Jobs selling now" (D127; ADR 0021, call 7): the studio's selling jobs, newest first, each a link to the job
 * with its closing date in the viewer's own time. Sales numbers come with checkout (step 10).
 */
export function JobsSelling({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations("app.home");
  const formatClosing = useFormatClosing();
  const [data, setData] = useState<JobsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-fetches after a change.
  useEffect(() => {
    let live = true;
    api<JobsResponse>(
      `/jobs?status=selling&limit=${JOBS_SELLING_SHOWN}&today=${localDay(new Date())}`,
    ).then((res) => {
      if (!live) return;
      if (res.ok) setData(res.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (failed)
    return (
      <p className="m-0 border-t border-line px-5 py-4 text-muted">{t("jobsSellingFailed")}</p>
    );
  if (!data)
    return <p className="m-0 border-t border-line px-5 py-4 text-muted">{t("checking")}</p>;
  if (data.jobs.length === 0)
    return (
      <p className="m-0 flex items-center gap-3 border-t border-line px-5 py-4 text-muted">
        <Megaphone className="size-5 shrink-0" aria-hidden="true" />
        {t("noJobs")}
      </p>
    );
  return (
    <>
      <ul className="m-0 list-none p-0">
        {data.jobs.map((job) => (
          <li key={job.id} className="border-t border-line">
            <Link
              href={tabHref(job.id, "overview")}
              className="flex min-h-14 flex-col justify-center px-5 py-2 no-underline hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
            >
              <span className="font-semibold text-ink">{job.name}</span>
              <span className="text-caption text-muted">
                {job.closesAt
                  ? t("closesOn", { when: formatClosing(job.closesAt) })
                  : t("noClosingDate")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {data.nextCursor ? (
        <p className="m-0 border-t border-line px-5 py-2">
          <Link
            href="/app/jobs"
            className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t("viewAllJobs")}
          </Link>
        </p>
      ) : null}
    </>
  );
}
