"use client";

import type { JobListItem } from "@daybell/api";
import { canDoTask, taskTarget } from "@daybell/core";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { taskHref } from "../checklist-links";
import { progressEnd } from "./job-views";

const LINK =
  "font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * A job's checklist on one line (D143; D145, amends D144): "5 of 7 · Next: Picture day", the next task a link to
 * where the work happens (plain text if the person's role can't do it); closed jobs end with "All done". No milestone
 * pill: the Status pill already says the shop's state. The line never wraps; a long task is cut with an ellipsis on
 * screen only (the text, and the link's name, stay whole for screen readers).
 */
export function ProgressCell({ job, role }: { job: JobListItem; role: string }) {
  const t = useTranslations("app.checklist");
  const { done, total } = job.checklist;
  const end = progressEnd(job.checklist);
  return (
    <div className="flex max-w-80 items-center whitespace-nowrap">
      <span className="shrink-0 text-muted">{t("progressShort", { done, total })}</span>
      {end ? (
        <span aria-hidden="true" className="shrink-0 px-1.5 text-muted">
          {t("separator")}
        </span>
      ) : null}
      {end?.kind === "next" ? (
        canDoTask(role, end.task) ? (
          <Link
            href={taskHref(job.id, taskTarget(end.task))}
            // Many rows say "Next: Print QR cards"; the name says which job (and starts with the visible words).
            aria-label={t("nextTaskIn", { task: t(`tasks.${end.task}`), job: job.name })}
            className={`${LINK} flex min-h-11 min-w-0 items-center text-primary`}
          >
            <span className="truncate">{t("nextTask", { task: t(`tasks.${end.task}`) })}</span>
          </Link>
        ) : (
          <span className="min-w-0 truncate">
            {t("nextTask", { task: t(`tasks.${end.task}`) })}
          </span>
        )
      ) : end?.kind === "allDone" ? (
        <span className="min-w-0 truncate">{t("allDone")}</span>
      ) : null}
    </div>
  );
}
