/**
 * The job page's Overview (D140, amending D138; ADR 0014): one job timeline of five milestones, the current
 * milestone's to-dos and the picture day countdown. Only data that exists today is used: the job's status, its
 * picture day and how many children are on its roster. Photos, the shop, payouts and the lab arrive in later steps,
 * so "Photos in" and "Fulfilment" are never current yet and the to-dos that need them are "Soon", never done.
 */
import type { JobStatus } from "./jobs";

export interface JobFacts {
  status: JobStatus;
  /** A calendar date, YYYY-MM-DD. */
  pictureDay: string;
  /** Children on the roster. */
  children: number;
  /** Today's calendar date in the browser, YYYY-MM-DD (see localDay). */
  today: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A moment's calendar day in the local time zone, as YYYY-MM-DD. Picture day is a calendar date and there is no
 * studio time zone yet, so the browser's day is "today".
 */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from `today` to `day` (both YYYY-MM-DD): 0 on the day, negative once it has passed. */
export function daysUntil(day: string, today: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** The job timeline's five milestones, in order (D140). */
export const MILESTONES = ["setUp", "pictureDay", "photosIn", "selling", "fulfilment"] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Milestones whose data and screens arrive in later steps: shown as "Soon" until they are reached. */
const UNBUILT: ReadonlySet<Milestone> = new Set(["photosIn", "selling", "fulfilment"]);

export type MilestoneState = "done" | "current" | "upcoming";

export interface MilestoneView {
  key: Milestone;
  state: MilestoneState;
  /** Not built yet and not reached: shown with the word "Soon". */
  soon: boolean;
}

/**
 * Where the job is, from data that exists now, or null once it is closed (every milestone done). A draft without a
 * roster is being set up whatever the date; with a roster it moves to picture day on the day and stays there until
 * photos arrive (step 4). Selling follows the status. Photos in and Fulfilment are never returned yet.
 */
export function milestone({ status, pictureDay, children, today }: JobFacts): Milestone | null {
  if (status === "closed") return null;
  if (status === "selling") return "selling";
  if (children === 0) return "setUp";
  return today < pictureDay ? "setUp" : "pictureDay";
}

/** The five milestones with their states: done before the current one, upcoming after it; all done when closed. */
export function timeline(facts: JobFacts): MilestoneView[] {
  const current = milestone(facts);
  const at = current === null ? MILESTONES.length : MILESTONES.indexOf(current);
  return MILESTONES.map((key, i) => {
    const state: MilestoneState = i < at ? "done" : i === at ? "current" : "upcoming";
    return { key, state, soon: state === "upcoming" && UNBUILT.has(key) };
  });
}

/** Each milestone's to-dos, in order (Seenu's answer 3 to the step 2c plan). */
export const MILESTONE_TODOS = {
  setUp: ["jobCreated", "rosterAdded", "printQrCards"],
  pictureDay: ["printQrCards", "uploadPhotos"],
  photosIn: ["tagPhotos"],
  selling: ["choosePriceList", "connectPayouts", "startSelling"],
  fulfilment: ["sendToLab"],
} as const satisfies Record<Milestone, readonly string[]>;

export type TodoKey = (typeof MILESTONE_TODOS)[Milestone][number];

export interface Todo {
  key: TodoKey;
  done: boolean;
  /** Not built yet: shown as "Soon", never done and never a link. */
  soon: boolean;
}

/**
 * A milestone's to-dos. QR cards ship in step 3, photos and tagging in step 4, the shop, payouts and selling in later
 * steps, so those are "Soon". A job can only be selling once it has a price list and payouts, so once it sells (or
 * has closed) "Choose a price list", "Connect payouts" and "Start selling" are done; before that they are Soon.
 */
export function milestoneTodos(
  m: Milestone,
  { status, children }: Pick<JobFacts, "status" | "children">,
): Todo[] {
  return MILESTONE_TODOS[m].map((key): Todo => {
    switch (key) {
      case "jobCreated":
        return { key, done: true, soon: false };
      case "rosterAdded":
        return { key, done: children > 0, soon: false };
      case "choosePriceList":
      case "connectPayouts":
      case "startSelling": {
        const done = status === "selling" || status === "closed";
        return { key, done, soon: !done };
      }
      default:
        return { key, done: false, soon: true };
    }
  });
}

/** How many of a list of to-dos are done. */
export function todoProgress(todos: readonly Todo[]): { done: number; total: number } {
  return { done: todos.filter((t) => t.done).length, total: todos.length };
}

export const SELL_CHECKLIST = ["roster", "photos", "tagging", "priceList", "payouts"] as const;
export type SellChecklistKey = (typeof SELL_CHECKLIST)[number];

export interface SellChecklistItem {
  key: SellChecklistKey;
  done: boolean;
  /** Not built yet: shown muted as "Coming soon", never done. */
  soon: boolean;
}

/** "Before you can sell", in the Start selling dialog. Only "Roster added" is real today. */
export function sellChecklist({ children }: { children: number }): SellChecklistItem[] {
  return SELL_CHECKLIST.map((key) =>
    key === "roster" ? { key, done: children > 0, soon: false } : { key, done: false, soon: true },
  );
}
