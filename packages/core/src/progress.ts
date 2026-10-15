/**
 * A job's Progress (D152; ADR 0029): replaces the Overview's checklist, milestone timeline and key dates. Six stages,
 * Prepare, Picture day, Photos, Selling, Fulfilment and Wrap-up, each with its steps:
 *
 * - done: with when it happened (and who, for owners and admins), shown dimmed; some keep a quiet link (Print again);
 * - now: the first built step not done yet, with its one action;
 * - next: later built steps, with their planned day where the job's rules give one;
 * - automatic: a step the system does by itself from the job's rules (Shop closes, when it has a closing rule);
 * - soon: steps not built yet (Reminders, Send to lab, Delivery, Yearbook export, Archive), shown marked Soon (Seenu).
 *
 * Whether a built step is done comes from the job's checklist (D143; the same facts as Home's Up next, which keeps the
 * checklist), so the two never disagree. Finished stages fold to one line on screen.
 */
import type { Checklist, TaskKey } from "./checklist";
import type { JobStatus } from "./jobs";
import { type JobRules, plannedDays, type RuleKey } from "./templates";

export const PROGRESS_STAGES = [
  "prepare",
  "pictureDay",
  "photos",
  "selling",
  "fulfilment",
  "wrapUp",
] as const;
export type ProgressStage = (typeof PROGRESS_STAGES)[number];

export const PROGRESS_STEPS = [
  "createJob",
  "addRoster",
  "printQrCards",
  "pictureDay",
  "uploadPhotos",
  "reviewTagging",
  "startSelling",
  "reminders",
  "shopCloses",
  "sendToLab",
  "delivery",
  "yearbookExport",
  "archive",
] as const;
export type ProgressStepKey = (typeof PROGRESS_STEPS)[number];

export const PROGRESS_STEP_STATES = ["done", "now", "next", "automatic", "soon"] as const;
export type ProgressStepState = (typeof PROGRESS_STEP_STATES)[number];

/** Where each step sits, and the checklist task that says it is done (none for steps that aren't built). */
const STEPS: Record<
  ProgressStepKey,
  { stage: ProgressStage; task: TaskKey | null; soon: boolean }
> = {
  createJob: { stage: "prepare", task: "createJob", soon: false },
  addRoster: { stage: "prepare", task: "addRoster", soon: false },
  printQrCards: { stage: "prepare", task: "printQrCards", soon: false },
  pictureDay: { stage: "pictureDay", task: "pictureDay", soon: false },
  uploadPhotos: { stage: "photos", task: "uploadPhotos", soon: false },
  reviewTagging: { stage: "photos", task: "reviewTagging", soon: false },
  startSelling: { stage: "selling", task: "startSelling", soon: false },
  reminders: { stage: "selling", task: null, soon: true },
  shopCloses: { stage: "selling", task: null, soon: false },
  sendToLab: { stage: "fulfilment", task: null, soon: true },
  delivery: { stage: "fulfilment", task: null, soon: true },
  yearbookExport: { stage: "wrapUp", task: null, soon: true },
  archive: { stage: "wrapUp", task: null, soon: true },
};

/** The rule each step's "Changed for this job · Undo" is about. */
export const STEP_RULE: Partial<Record<ProgressStepKey, RuleKey>> = {
  printQrCards: "qrCards",
  startSelling: "shopOpens",
  shopCloses: "shopCloses",
};

/** When a step happened and who did it (a team member's id, for owners and admins only), from the event log. */
export interface StepFact {
  at: string;
  actorId: string | null;
}

/** The fact keys job_progress_facts returns: the steps, plus closeShop (the shop's last closing). */
export type ProgressFactKey = Exclude<ProgressStepKey, "shopCloses"> | "closeShop";

export interface ProgressInput {
  status: JobStatus;
  /** YYYY-MM-DD. */
  pictureDay: string;
  createdAt: string;
  closesAt: string | null;
  rules: JobRules;
  /** The rules changed for this job (changedRules). */
  changed: readonly RuleKey[];
  checklist: Pick<Checklist, "groups">;
  facts: Partial<Record<ProgressFactKey, StepFact>>;
}

export interface ProgressStep {
  key: ProgressStepKey;
  state: ProgressStepState;
  /** When it happened (done steps), an exact moment. */
  at: string | null;
  /** Who did it: a team member's id, for owners and admins only (the facts have none for anyone else). */
  actorId: string | null;
  /** The day it is planned for (YYYY-MM-DD): QR cards, picture day, a shop opening days after picture day. */
  planned: string | null;
  /** Shop closes, while selling or (when it holds one) a draft: the closing moment, or null for none. */
  closesAt: string | null;
  /** Shop closes, a draft without a date: days after opening, or null for "when you close it". */
  afterOpeningDays: number | null;
  /** Publish shop: the rule is "when photos are checked". */
  whenPhotosChecked: boolean;
  /** The step's rule differs from what the template gave the job (D152). */
  changed: boolean;
}

export interface ProgressStageView {
  key: ProgressStage;
  /** Every built step in it is done: it folds to one line. */
  done: boolean;
  steps: ProgressStep[];
}

export interface JobProgress {
  /** The stage of the step to do now; once everything built is done, the stage after the last finished one. */
  current: ProgressStage | null;
  stages: ProgressStageView[];
}

/** A job's Progress, from its checklist, rules and the event log's facts. */
export function jobProgress(input: ProgressInput): JobProgress {
  const doneTasks = new Map(
    input.checklist.groups.flatMap((g) => g.tasks.map((t) => [t.key, t.done] as const)),
  );
  const planned = plannedDays(input.rules, input.pictureDay);
  const selling = input.status === "selling";
  const draft = input.status === "draft";

  const isDone = (key: ProgressStepKey): boolean => {
    if (key === "shopCloses") return input.status === "closed";
    const task = STEPS[key].task;
    return task !== null && doneTasks.get(task) === true;
  };
  const factOf = (key: ProgressStepKey): StepFact | undefined => {
    if (key === "shopCloses") return input.facts.closeShop;
    if (key === "createJob") return input.facts.createJob ?? { at: input.createdAt, actorId: null };
    return input.facts[key as ProgressFactKey];
  };

  let nowTaken = false;
  const steps: ProgressStep[] = PROGRESS_STEPS.map((key) => {
    const spec = STEPS[key];
    const done = !spec.soon && isDone(key);
    // A draft's rule closes the shop by itself once it opens, unless the draft already holds a date (ADR 0021).
    const automatic =
      key === "shopCloses" &&
      draft &&
      input.rules.shopClosesDays !== null &&
      input.closesAt === null &&
      !done;
    let state: ProgressStepState;
    if (spec.soon) state = "soon";
    else if (done) state = "done";
    else if (automatic) state = "automatic";
    else if (!nowTaken) {
      state = "now";
      nowTaken = true;
    } else state = "next";
    const fact = done ? factOf(key) : undefined;
    const rule = STEP_RULE[key];
    return {
      key,
      state,
      at: fact?.at ?? null,
      actorId: fact?.actorId ?? null,
      planned:
        key === "printQrCards"
          ? planned.qrCards
          : key === "pictureDay"
            ? input.pictureDay
            : key === "startSelling"
              ? planned.shopOpens
              : null,
      // A draft may hold a closing date too (ADR 0021): it shows that date rather than the rule.
      closesAt: key === "shopCloses" && (selling || draft) ? input.closesAt : null,
      afterOpeningDays:
        key === "shopCloses" && draft && input.closesAt === null
          ? input.rules.shopClosesDays
          : null,
      whenPhotosChecked: key === "startSelling" && input.rules.shopOpens === "photosChecked",
      // A finished step's rule is history: only steps still ahead say they were changed.
      changed: rule !== undefined && !done && input.changed.includes(rule),
    };
  });

  const stages = PROGRESS_STAGES.map((stage) => {
    const own = steps.filter((s) => STEPS[s.key].stage === stage);
    const built = own.filter((s) => s.state !== "soon");
    return {
      key: stage,
      done: built.length > 0 && built.every((s) => s.state === "done"),
      steps: own,
    };
  });
  const now = steps.find((s) => s.state === "now");
  // With nothing built left to do (a closed shop), the stage after the last one with a finished step: Fulfilment.
  const lastDone = stages.reduce(
    (at, s, i) => (s.steps.some((x) => x.state === "done") ? i : at),
    -1,
  );
  const current = now
    ? STEPS[now.key].stage
    : (PROGRESS_STAGES[Math.min(lastDone + 1, PROGRESS_STAGES.length - 1)] ?? null);
  return { current, stages };
}

/** The stage a step belongs to. */
export function stepStage(key: ProgressStepKey): ProgressStage {
  return STEPS[key].stage;
}

/** The latest moment (or planned day) among a finished stage's steps, for its folded line ("Done Sep 20"). */
export function stageDoneOn(stage: {
  steps: readonly Pick<ProgressStep, "state" | "at" | "planned">[];
}): string | null {
  const days = stage.steps
    .filter((s) => s.state === "done")
    .map((s) => s.at ?? s.planned)
    .filter((d): d is string => d !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return days.at(-1) ?? null;
}
