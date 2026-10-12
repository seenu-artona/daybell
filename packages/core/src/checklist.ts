/**
 * One checklist (D143, amending D140; ADR 0017). Each job type has a fixed list of tasks grouped by milestone. Tasks
 * tick themselves from data the system already has, never by hand, and tasks whose screens aren't built yet are left
 * out of the list until they are (so they never count toward the total). The current milestone is worked out from the
 * list: the group of the next unfinished task (Seenu, answer 2).
 *
 * Built tasks today (Seenu, answers 1 and 3): Set up = Create the job, Add the roster, Print QR cards; Picture day =
 * Picture day (ticks itself once the date has passed); Photos in = Upload photos, Review tagging (step 5; ADR 0018).
 * Selling and Fulfilment tasks arrive with their steps.
 */
import {
  daysUntil,
  MILESTONES,
  type Milestone,
  type QrCardProgress,
  qrCardsDone,
} from "./job-page";
import { JOB_TYPES, type JobStatus, type JobType } from "./jobs";
import { canEditRoster } from "./roster";
import { reviewTaggingDone, type TaggingFacts } from "./tagging";

/** Every built job task, in checklist order. */
export const TASK_KEYS = [
  "createJob",
  "addRoster",
  "printQrCards",
  "pictureDay",
  "uploadPhotos",
  "reviewTagging",
] as const;
export type TaskKey = (typeof TASK_KEYS)[number];

/**
 * Where the work happens. Screens map these to their links: the job's Overview, People, People with the print dialog
 * open, Photos, or Photos' Review.
 */
export type TaskTarget = "overview" | "people" | "peoplePrint" | "photos" | "photosReview";

/** What the checklist knows about a job. Only data that exists today. */
export interface ChecklistFacts extends TaggingFacts {
  status: JobStatus;
  /** A calendar date, YYYY-MM-DD. */
  pictureDay: string;
  /** Children on the roster. */
  children: number;
  /** Children who may be photographed and how many of them have a card; null if unknown. */
  qrCards: QrCardProgress | null;
  /** Photos that failed (not in the bin). */
  failedPhotos: number;
  /** Today's calendar date where the person is, YYYY-MM-DD (see localDay). */
  today: string;
}

interface TaskSpec {
  milestone: Milestone;
  target: TaskTarget;
  /** Who can do the work: other roles see the row as plain text (Seenu, answer 10). */
  canDo: (role: string) => boolean;
  done: (facts: ChecklistFacts) => boolean;
}

const anyone = () => true;

const TASKS: Record<TaskKey, TaskSpec> = {
  // The job exists, so this is always done: it shows where the list starts.
  createJob: { milestone: "setUp", target: "overview", canDo: anyone, done: () => true },
  addRoster: {
    milestone: "setUp",
    target: "people",
    canDo: canEditRoster,
    done: (f) => f.children > 0,
  },
  printQrCards: {
    milestone: "setUp",
    target: "peoplePrint",
    canDo: canEditRoster,
    done: (f) => qrCardsDone(f.qrCards, f.children),
  },
  // Ticks itself once the picture day has passed in the person's own day (Seenu, answer 1).
  pictureDay: {
    milestone: "pictureDay",
    target: "overview",
    canDo: anyone,
    done: (f) => daysUntil(f.pictureDay, f.today) < 0,
  },
  uploadPhotos: {
    milestone: "photosIn",
    target: "photos",
    canDo: canEditRoster,
    done: (f) => f.hasReadyPhoto,
  },
  // Clean (no Leftovers, flags or blank cards to name) and marked reviewed; reopens when new photos arrive (Seenu,
  // answer 4; ADR 0018).
  reviewTagging: {
    milestone: "photosIn",
    target: "photosReview",
    canDo: canEditRoster,
    done: reviewTaggingDone,
  },
};

/** The tasks of one list, in order. Today every job type shares it; it is per type so the lists can diverge. */
const STANDARD: readonly TaskKey[] = [
  "createJob",
  "addRoster",
  "printQrCards",
  "pictureDay",
  "uploadPhotos",
  "reviewTagging",
];

export const JOB_CHECKLISTS: Record<JobType, readonly TaskKey[]> = Object.fromEntries(
  JOB_TYPES.map((type) => [type, STANDARD]),
) as Record<JobType, readonly TaskKey[]>;

export type TaskState = "done" | "next" | "todo";

export interface Task {
  key: TaskKey;
  milestone: Milestone;
  target: TaskTarget;
  done: boolean;
  /** Done, the next unfinished task, or still to do. */
  state: TaskState;
}

export interface ChecklistGroup {
  milestone: Milestone;
  tasks: Task[];
}

export interface Checklist {
  /** Milestones with at least one built task, in milestone order. */
  groups: ChecklistGroup[];
  done: number;
  total: number;
  /** The first unfinished task, or null when every built task is done or the job is closed. */
  next: Task | null;
  /** Where the job is (see currentMilestone); null once it is closed ("All done"). */
  milestone: Milestone | null;
}

/** The milestone the job has reached: the next task's group; with nothing left, the first milestone after the list. */
function milestoneOf(
  status: JobStatus,
  tasks: readonly Task[],
  next: Task | null,
): Milestone | null {
  if (status === "closed") return null;
  if (status === "selling") return "selling";
  if (next) return next.milestone;
  // Every built task is done in a draft: the next stage, whose tasks aren't built yet (Seenu, answer 2).
  const last = tasks.reduce((at, t) => Math.max(at, MILESTONES.indexOf(t.milestone)), -1);
  return MILESTONES[last + 1] ?? null;
}

/** A job's checklist, from its type and facts. */
export function jobChecklist(type: JobType, facts: ChecklistFacts): Checklist {
  const closed = facts.status === "closed";
  const ticked = JOB_CHECKLISTS[type].map((key) => ({
    key,
    ...TASKS[key],
    done: TASKS[key].done(facts),
  }));
  const nextKey = closed ? null : (ticked.find((t) => !t.done)?.key ?? null);
  const tasks: Task[] = ticked.map(({ key, milestone, target, done }) => ({
    key,
    milestone,
    target,
    done,
    state: done ? "done" : key === nextKey ? "next" : "todo",
  }));
  const next = tasks.find((t) => t.key === nextKey) ?? null;
  const groups = MILESTONES.map((milestone) => ({
    milestone,
    tasks: tasks.filter((t) => t.milestone === milestone),
  })).filter((g) => g.tasks.length > 0);
  return {
    groups,
    done: tasks.filter((t) => t.done).length,
    total: tasks.length,
    next,
    milestone: milestoneOf(facts.status, tasks, next),
  };
}

/** Whether someone in this role can do the task (and so gets a link to it). */
export function canDoTask(role: string, key: TaskKey | AttentionTaskKey): boolean {
  return key === "reviewFailedPhotos" ? canEditRoster(role) : TASKS[key].canDo(role);
}

/** Where a task's work happens. */
export function taskTarget(key: TaskKey | AttentionTaskKey): TaskTarget {
  return key === "reviewFailedPhotos" ? "photos" : TASKS[key].target;
}

// ── Up next (Home after onboarding) and "on track" ──────────────────────────────────────────────────────────────────

/** "A date is close" for Set up tasks: within this many days before picture day (Seenu, answer 7). */
export const DATE_CLOSE_DAYS = 14;

/**
 * Not a checklist task: a problem that needs someone (ADR 0017 answer 9: failed photos). Leftovers and flagged photos
 * are broken too (ADR 0018, plan answer 9), but they point at the Review tagging task itself.
 */
export type AttentionTaskKey = "reviewFailedPhotos";

/**
 * Why a task was picked, most urgent kind first (D143): a date is close (a past picture day with no photos ranks
 * highest; Seenu, answer 7), something is broken, money is waiting, the next step in a job. "Money is waiting" has no
 * data yet (payouts arrive later), so it is never produced.
 */
export type UpNextReason =
  | { kind: "photosOverdue"; days: number }
  | { kind: "dateClose"; days: number }
  | { kind: "brokenPhotos"; count: number }
  | { kind: "taggingProblems"; leftovers: number; flagged: number }
  | { kind: "nextStep" };

export const UP_NEXT_REASONS = [
  "photosOverdue",
  "dateClose",
  "brokenPhotos",
  "taggingProblems",
  "nextStep",
] as const;

const REASON_RANK: Record<UpNextReason["kind"], number> = {
  photosOverdue: 0,
  dateClose: 1,
  brokenPhotos: 2,
  // The same tier as failed photos (plan answer 9).
  taggingProblems: 2,
  nextStep: 4,
};

export interface UpNextPick {
  task: TaskKey | AttentionTaskKey;
  reason: UpNextReason;
}

/**
 * The one task Up next would pick for a job (Seenu, answer 8: at most one per job), or null if it needs nothing.
 * Closed jobs need nothing. Tasks whose page is the job's Overview itself (Create the job, Picture day) are skipped:
 * there is nothing to go and do (code review N1), so the next step is the first unfinished task that has a page.
 */
export function upNextForJob(checklist: Checklist, facts: ChecklistFacts): UpNextPick | null {
  if (facts.status === "closed") return null;
  const tasks = checklist.groups.flatMap((g) => g.tasks);
  const days = daysUntil(facts.pictureDay, facts.today);
  const upload = tasks.find((t) => t.key === "uploadPhotos");
  if (days < 0 && upload && !upload.done)
    return { task: "uploadPhotos", reason: { kind: "photosOverdue", days: -days } };
  const setUp = tasks.find((t) => t.milestone === "setUp" && !t.done);
  if (setUp && days >= 0 && days <= DATE_CLOSE_DAYS)
    return { task: setUp.key, reason: { kind: "dateClose", days } };
  if (facts.failedPhotos > 0)
    return {
      task: "reviewFailedPhotos",
      reason: { kind: "brokenPhotos", count: facts.failedPhotos },
    };
  if (facts.leftovers > 0 || facts.flagged > 0)
    return {
      task: "reviewTagging",
      reason: { kind: "taggingProblems", leftovers: facts.leftovers, flagged: facts.flagged },
    };
  const step = tasks.find((t) => !t.done && t.target !== "overview");
  return step ? { task: step.key, reason: { kind: "nextStep" } } : null;
}

/**
 * The Overview collapses the checklist to its progress and next task while the job is on track (ADR 0017): past Set
 * up, with no date close and nothing broken. A closed job reads "All done" and stays collapsed.
 */
export function isOnTrack(checklist: Checklist, facts: ChecklistFacts): boolean {
  if (facts.status === "closed") return true;
  if (checklist.milestone === "setUp") return false;
  const pick = upNextForJob(checklist, facts);
  return pick === null || pick.reason.kind === "nextStep";
}

export interface UpNextCandidate extends UpNextPick {
  jobId: string;
  pictureDay: string;
}

/** Most urgent first; ties go to the nearest picture day, then the job id so the order never flickers. */
export function rankUpNext<C extends UpNextCandidate>(
  candidates: readonly C[],
  today: string,
): C[] {
  const distance = (c: C) => Math.abs(daysUntil(c.pictureDay, today));
  return [...candidates].sort(
    (a, b) =>
      REASON_RANK[a.reason.kind] - REASON_RANK[b.reason.kind] ||
      distance(a) - distance(b) ||
      (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0),
  );
}

/** Home shows the three best (D143); the rest are counted for "N more". */
export const UP_NEXT_SHOWN = 3;

// ── Studio onboarding (Home during onboarding) ──────────────────────────────────────────────────────────────────────

/**
 * The studio setup checklist (D143): account, studio name and logo, payouts, price list, first job. Only the built
 * ones are listed (Seenu, answer 4: "Studio name and logo" waits for branding; payouts and price lists come later).
 * Inviting the team is not part of it (Seenu, answer 12): it stays in Settings.
 */
export const ONBOARDING_TASKS = ["account", "firstJob"] as const;
export type OnboardingTaskKey = (typeof ONBOARDING_TASKS)[number];

export interface OnboardingFacts {
  /** The studio has a job. */
  hasJob: boolean;
}

export interface OnboardingTask {
  key: OnboardingTaskKey;
  done: boolean;
  state: TaskState;
}

export function onboardingChecklist(facts: OnboardingFacts): OnboardingTask[] {
  const done: Record<OnboardingTaskKey, boolean> = {
    account: true,
    firstJob: facts.hasJob,
  };
  const next = ONBOARDING_TASKS.find((key) => !done[key]);
  return ONBOARDING_TASKS.map((key) => ({
    key,
    done: done[key],
    state: done[key] ? "done" : key === next ? "next" : "todo",
  }));
}

/** Onboarding is complete when every built task is done; the server then records it once, for good (Seenu, answer 5). */
export function onboardingComplete(tasks: readonly OnboardingTask[]): boolean {
  return tasks.every((t) => t.done);
}

/** Owners and admins create jobs. The account row has nowhere to go. */
export function canDoOnboardingTask(role: string, key: OnboardingTaskKey): boolean {
  if (key === "firstJob") return role === "owner" || role === "admin";
  return false;
}

/** Owners and admins see onboarding (Seenu, answer 5); everyone else goes straight to Up next. */
export function seesOnboarding(role: string): boolean {
  return role === "owner" || role === "admin";
}
