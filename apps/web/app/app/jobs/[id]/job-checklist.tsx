"use client";

import type { JobChecklist as JobChecklistData, QrCardStatus } from "@daybell/api";
import { canDoTask, MILESTONES, type TaskKey, type TaskState, taskTarget } from "@daybell/core";
import { Badge, Card } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { taskHref } from "../../checklist-links";
import { ChecklistGroups, ChecklistProgress, type ChecklistRowGroup } from "../../checklist-list";
import { useStudio } from "../../me-context";
import { useFormatDay } from "../status-badge";
import { useJob } from "./job-context";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * The job's checklist on its Overview (D143, amending D140; ADR 0017): the milestone, "N of M done" and every built
 * task, grouped by milestone. Tasks tick themselves; each row is a plain link to the page where the work happens (or
 * plain text when there is no other page, or the person's role can't do it). While the job is on track the list is
 * collapsed to its progress and the next task, with a toggle to show it all. The checklist comes from GET /jobs/:id
 * (the same facts and rules as the Jobs list); the notes come from the job's summary counts.
 */
export function JobChecklist({
  checklist,
  rosterSize,
  qrCards,
  failedPhotos,
  leftovers,
  flagged,
}: {
  checklist: JobChecklistData;
  /** Children on the roster. */
  rosterSize: number;
  qrCards: QrCardStatus | null;
  failedPhotos: number;
  /** Photos in Leftovers and photos flagged for checking (ADR 0018). */
  leftovers: number;
  flagged: number;
}) {
  const t = useTranslations("app.checklist");
  const formatDay = useFormatDay();
  const { me } = useStudio();
  const { job } = useJob();
  const titleId = useId();
  const listId = useId();
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? !checklist.onTrack;
  const role = me.studio.role;

  // A link only when the work is on another page and this person can do it (Seenu, answer 10).
  const href = (key: TaskKey) => {
    const target = taskTarget(key);
    return target !== "overview" && canDoTask(role, key) ? taskHref(job.id, target) : null;
  };

  const note = (task: { key: TaskKey; done: boolean }): string | null => {
    switch (task.key) {
      case "addRoster":
        return task.done ? t("notes.children", { count: rosterSize }) : null;
      case "printQrCards": {
        const missing = qrCards ? qrCards.eligible - qrCards.withCard : 0;
        return !task.done && qrCards && qrCards.withCard > 0 && missing > 0
          ? t("notes.withoutCard", { count: missing })
          : null;
      }
      case "pictureDay":
        return formatDay(job.pictureDay);
      case "uploadPhotos":
        // Problems are marked inline where they are (D143): failed photos on their own row.
        return failedPhotos > 0 ? t("notes.photosFailed", { count: failedPhotos }) : null;
      case "reviewTagging":
        // Problems inline where they are (D143): what is left to fix at review.
        return !task.done && leftovers + flagged > 0
          ? t("notes.taggingProblems", { leftovers, flagged })
          : null;
      default:
        return null;
    }
  };

  const state = (task: { key: TaskKey; done: boolean }): TaskState =>
    task.done ? "done" : task.key === checklist.next ? "next" : "todo";
  const groups: ChecklistRowGroup[] = MILESTONES.map((milestone) => ({
    key: milestone,
    title: t(`milestones.${milestone}`),
    current: milestone === checklist.milestone,
    rows: checklist.tasks
      .filter((task) => task.milestone === milestone)
      .map((task) => ({
        key: task.key,
        label: t(`tasks.${task.key}`),
        state: state(task),
        href: href(task.key),
        note: note(task),
      })),
  })).filter((g) => g.rows.length > 0);

  const next = checklist.next;
  const nextHref = next ? href(next) : null;

  return (
    <Card variant="sheet" asChild>
      <section aria-labelledby={titleId} className="flex flex-col gap-3 px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id={titleId} className="m-0 flex-1 text-h3 font-bold">
            {t("title")}
          </h2>
          {/* Neutral, never the Selling green: the header pill alone shows the shop state (code review S5). */}
          <Badge tone="draft" className="before:hidden">
            {checklist.milestone ? t(`milestones.${checklist.milestone}`) : t("allDone")}
          </Badge>
        </div>
        <ChecklistProgress done={checklist.done} total={checklist.total} />
        {expanded ? null : (
          <p className="m-0 text-body">
            {job.status === "closed" ? (
              t("allDone")
            ) : next ? (
              nextHref ? (
                <Link href={nextHref} className={LINK}>
                  {t("nextTask", { task: t(`tasks.${next}`) })}
                </Link>
              ) : (
                <span className="inline-flex min-h-11 items-center font-semibold">
                  {t("nextTask", { task: t(`tasks.${next}`) })}
                </span>
              )
            ) : (
              <span className="inline-flex min-h-11 items-center">{t("allDoneForNow")}</span>
            )}
          </p>
        )}
        <div id={listId} hidden={!expanded}>
          <ChecklistGroups groups={groups} />
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setOpen(!expanded)}
          className="inline-flex min-h-11 items-center self-start rounded-md px-1 font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {expanded ? t("hideAll") : t("showAll")}
        </button>
      </section>
    </Card>
  );
}
