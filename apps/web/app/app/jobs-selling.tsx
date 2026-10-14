"use client";

import type { JobsResponse } from "@daybell/api";
import { closesSoon, closingDay, localDay } from "@daybell/core";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client-api";
import { HOME_FOOTER_LINK } from "./home-card";
import { tabHref } from "./jobs/[id]/tabs";

/** Home shows this many; "All jobs" is always there for the rest. */
export const JOBS_SELLING_SHOWN = 5;

/**
 * Home's "Selling now" (D127; ADR 0021, call 7) as quiet text on the canvas (D146, amends D145): an h2 with "All jobs"
 * at its right, then the studio's selling jobs, newest first, each one link with its name and when its shop closes:
 * the last day to order in the viewer's own time ("Closes Oct 24"), or, two days or fewer away, amber and in words
 * ("Closes in 2 days", never colour alone: D91), or "No closing date" (D147, the Jobs list's closingDay and
 * closesSoon). No sales per job (Seenu, Oct 14).
 */
export function JobsSelling({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations("app.home");
  const closes = useClosesLine();
  const headingId = useId();
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

  const note = (words: string) => <p className="m-0 py-3 text-body-lg text-muted">{words}</p>;
  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
        <h2 id={headingId} className="m-0 text-h3 font-bold text-ink">
          {t("sellingNow")}
        </h2>
        <Link href="/app/jobs" className={`${HOME_FOOTER_LINK} underline`}>
          {t("allJobs")}
        </Link>
      </div>
      {failed ? (
        note(t("jobsSellingFailed"))
      ) : !data ? (
        note(t("checking"))
      ) : data.jobs.length === 0 ? (
        note(t("noJobs"))
      ) : (
        <ul className="m-0 list-none p-0">
          {data.jobs.map((job) => (
            <li key={job.id} className="border-b border-line last:border-b-0">
              <Link
                href={tabHref(job.id, "overview")}
                className="group flex min-h-14 flex-col justify-center py-3 text-ink no-underline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="text-body-lg font-semibold group-hover:underline">{job.name}</span>
                {closes(job.closesAt)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A selling job's closing line on Home (D147): amber with words when two days or fewer away. */
function useClosesLine() {
  const t = useTranslations("app.home");
  const format = useFormatter();
  return (closesAt: string | null) => {
    if (!closesAt) return <span className="text-body text-muted">{t("noClosingDate")}</span>;
    const days = closesSoon(closesAt, localDay(new Date()));
    if (days !== null)
      return (
        <span className="text-body font-semibold text-warning-text">{t("closesIn", { days })}</span>
      );
    // The last day to order, as a calendar date: never shifted by formatting it in another zone.
    const when = format.dateTime(new Date(`${closingDay(closesAt)}T00:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return <span className="text-body text-muted">{t("closesOn", { when })}</span>;
  };
}
