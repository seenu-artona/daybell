"use client";

import type { JobsResponse } from "@daybell/api";
import { localDay } from "@daybell/core";
import { Megaphone } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { HOME_FOOTER_LINK, HomeCard, HomeLinkRow, HomeNote, HomeRows } from "./home-card";
import { tabHref } from "./jobs/[id]/tabs";
import { useFormatClosing } from "./jobs/closing-date";

/** Home shows this many; "View all jobs" when there are more. */
export const JOBS_SELLING_SHOWN = 5;

/**
 * Home's "Jobs selling now" (D127; ADR 0021, call 7) as a list card (D145, amends D144): the studio's selling jobs,
 * newest first, each row a link to the job with its closing date in the viewer's own time, and "View all jobs" in the
 * footer when there are more. Sales numbers come with checkout (step 10).
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

  return (
    <HomeCard
      title={t("jobsSelling")}
      footer={
        data?.nextCursor ? (
          <Link href="/app/jobs" className={HOME_FOOTER_LINK}>
            {t("viewAllJobs")}
          </Link>
        ) : null
      }
    >
      {failed ? (
        <HomeNote>{t("jobsSellingFailed")}</HomeNote>
      ) : !data ? (
        <HomeNote>{t("checking")}</HomeNote>
      ) : data.jobs.length === 0 ? (
        <HomeNote>
          <Megaphone className="size-5 shrink-0" aria-hidden="true" />
          {t("noJobs")}
        </HomeNote>
      ) : (
        <HomeRows>
          {data.jobs.map((job) => (
            <HomeLinkRow
              key={job.id}
              href={tabHref(job.id, "overview")}
              name={job.name}
              detail={
                job.closesAt
                  ? t("closesOn", { when: formatClosing(job.closesAt) })
                  : t("noClosingDate")
              }
            />
          ))}
        </HomeRows>
      )}
    </HomeCard>
  );
}
