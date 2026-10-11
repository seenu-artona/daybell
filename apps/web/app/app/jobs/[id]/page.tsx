"use client";

import {
  daysUntil,
  groupLabel,
  localDay,
  MILESTONES,
  milestone,
  milestoneTodos,
  timeline,
  todoProgress,
} from "@daybell/core";
import { useFormatter, useTranslations } from "next-intl";
import { ActivityCard } from "../../activity-card";
import { useStudio } from "../../me-context";
import { useFormatDay } from "../status-badge";
import { useJob } from "./job-context";
import { JobTimeline } from "./job-timeline";
import { MilestoneTodos } from "./milestone-todos";

/**
 * A job's Overview (D140, amending D138): one big hero line (the picture day countdown) with where the job is, the
 * five-milestone job timeline, then the current milestone's to-dos beside the job's recent activity (owners and
 * admins; otherwise the to-dos take the full width). A closed job has every milestone done and no to-dos.
 */
export default function JobOverviewPage() {
  const t = useTranslations("app.job");
  const formatDay = useFormatDay();
  const format = useFormatter();
  const { version } = useStudio();
  const { job, summary, canManage, canEditRoster } = useJob();
  const today = localDay(new Date());
  const facts = {
    status: job.status,
    pictureDay: job.pictureDay,
    children: summary?.children ?? 0,
    today,
  };
  const current = milestone(facts);
  const todos = current ? milestoneTodos(current, facts) : [];
  const progress = current ? todoProgress(todos) : null;
  const days = daysUntil(job.pictureDay, today);
  const steps = MILESTONES.length;

  const hero =
    job.status === "closed"
      ? t("hero.closed")
      : days >= 0
        ? t("hero.countdown", { days })
        : t("hero.ago", { days: -days });

  return (
    <div className="flex flex-col gap-5">
      <div className="mt-1 flex flex-col gap-0.5">
        <p className="m-0 text-hero">{hero}</p>
        {summary ? (
          <p className="m-0 text-title-sm font-semibold text-primary">
            {current && progress
              ? t("hero.step", {
                  step: MILESTONES.indexOf(current) + 1,
                  steps,
                  milestone: t(`timeline.milestones.${current}`),
                  done: progress.done,
                  total: progress.total,
                })
              : t("hero.allDone", { steps })}
          </p>
        ) : null}
      </div>

      {summary ? (
        <>
          <JobTimeline
            milestones={timeline(facts)}
            progress={progress}
            pictureDay={formatDay(job.pictureDay)}
          />
          <div className="flex items-start gap-5">
            {current ? (
              <div className="min-w-0 flex-1">
                <MilestoneTodos
                  milestone={current}
                  todos={todos}
                  jobId={job.id}
                  createdOn={format.dateTime(new Date(job.createdAt), { dateStyle: "medium" })}
                  roster={{
                    children: summary.children,
                    groups: summary.groups,
                    duplicates: summary.duplicates,
                    word: groupLabel(job.type),
                  }}
                  canEditRoster={canEditRoster}
                />
              </div>
            ) : null}
            {canManage ? (
              <div className="min-w-0 flex-1">
                <ActivityCard refreshKey={version} jobId={job.id} variant="sheet" />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
