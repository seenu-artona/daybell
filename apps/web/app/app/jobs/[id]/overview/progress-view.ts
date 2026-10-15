import type { ProgressStepView } from "@daybell/api";
import {
  canDoTask,
  closingDay,
  daysUntil,
  type RuleKey,
  STEP_RULE,
  type TaskKey,
  taskTarget,
} from "@daybell/core";
import { taskHref } from "../../../checklist-links";

/** What a step's second line says (the component puts it in words, D96). */
export type StepDetail =
  | { type: "done"; at: string | null; day: string | null; by: string | null }
  | { type: "pictureDay"; day: string; days: number }
  | { type: "planned"; day: string }
  | { type: "whenPhotosChecked" }
  | { type: "closes"; at: string; days: number }
  | { type: "noClosingDate" }
  | { type: "afterOpening"; days: number }
  | { type: "byHand" }
  | null;

/** The one action of the step to do now (D152), or a done step's quiet link (e.g. Print again). */
export type StepAction =
  | {
      kind: "link";
      href: string;
      label: "addRoster" | "printQrCards" | "uploadPhotos" | "reviewTagging";
    }
  | { kind: "publish"; href: string }
  | { kind: "changeClosingDate" }
  | { kind: "printAgain"; href: string }
  | null;

export interface StepView {
  detail: StepDetail;
  action: StepAction;
  /** A rule an owner or admin can change on this step ("Change"), for steps still ahead that aren't "now". */
  change: RuleKey | null;
  /** "Changed for this job · Undo" (D152): Undo for owners and admins only. */
  undo: RuleKey | null;
}

const TASK_OF: Partial<Record<ProgressStepView["key"], TaskKey>> = {
  addRoster: "addRoster",
  printQrCards: "printQrCards",
  uploadPhotos: "uploadPhotos",
  reviewTagging: "reviewTagging",
  startSelling: "startSelling",
};

/**
 * How one Progress step shows (D152; ADR 0029): its second line, its action, and whether its rule can be changed or
 * its change undone here. Links only where the person's role can do the work (ADR 0017, answer 10).
 */
export function stepView(
  step: ProgressStepView,
  job: { id: string; status: string; pictureDay: string },
  role: string,
  today: string,
): StepView {
  const manager = role === "owner" || role === "admin";
  const rule = STEP_RULE[step.key] ?? null;
  const task = TASK_OF[step.key];
  const can = task ? canDoTask(role, task) : false;
  const href = task ? taskHref(job.id, taskTarget(task)) : "";
  let detail: StepDetail = null;
  let action: StepAction = null;

  switch (step.state) {
    case "done":
      detail = {
        type: "done",
        at: step.at,
        // Picture day is a day, not a moment someone did something.
        day: step.key === "pictureDay" ? step.planned : null,
        by: step.by,
      };
      if (step.key === "printQrCards" && can && job.status !== "closed")
        action = { kind: "printAgain", href };
      break;
    case "now":
    case "next":
      if (step.key === "pictureDay" && step.planned && step.state === "now")
        detail = { type: "pictureDay", day: step.planned, days: daysUntil(step.planned, today) };
      else if (step.key === "shopCloses" && job.status === "selling")
        detail = step.closesAt
          ? {
              type: "closes",
              at: step.closesAt,
              days: daysUntil(closingDay(step.closesAt), today),
            }
          : { type: "noClosingDate" };
      else if (step.key === "shopCloses") detail = { type: "byHand" };
      else if (step.planned) detail = { type: "planned", day: step.planned };
      else if (step.whenPhotosChecked) detail = { type: "whenPhotosChecked" };
      if (step.state === "now") {
        if (step.key === "startSelling") action = manager ? { kind: "publish", href } : null;
        else if (step.key === "shopCloses")
          action = manager && job.status === "selling" ? { kind: "changeClosingDate" } : null;
        else if (task && can && step.key !== "createJob")
          action = {
            kind: "link",
            href,
            label: step.key as "addRoster" | "printQrCards" | "uploadPhotos" | "reviewTagging",
          };
      }
      break;
    case "automatic":
      if (step.afterOpeningDays !== null)
        detail = { type: "afterOpening", days: step.afterOpeningDays };
      break;
    case "soon":
      break;
  }
  const ahead = step.state === "next" || step.state === "automatic";
  // While the shop sells, Shop closes is changed with its date (the now action), not its rule.
  const change =
    manager && rule && ahead && !(step.key === "shopCloses" && job.status !== "draft")
      ? rule
      : null;
  return { detail, action, change, undo: manager && step.changed ? rule : null };
}
