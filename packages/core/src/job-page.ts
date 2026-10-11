/**
 * The job page's Overview (D137, D138; ADR 0013): where a job is in its journey, the one next step, the picture day
 * countdown and the "Before you can sell" checklist. Only data that exists today is used: the job's status, its
 * picture day and how many children are on its roster. Photos, tagging, price lists and payouts arrive in later
 * steps, so their stages are never returned and their checklist items are never done yet.
 */
import type { JobStatus } from "./jobs";

export const JOURNEY_STAGES = [
  "setUp",
  "pictureDay",
  "reviewPhotos",
  "selling",
  "fulfilment",
  "closed",
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

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

/**
 * The journey stage, from data that exists now. A draft without a roster is being set up whatever the date; with a
 * roster it moves to picture day on the day and stays there until photos arrive (step 4).
 */
export function jobStage({ status, pictureDay, children, today }: JobFacts): JourneyStage {
  if (status === "closed") return "closed";
  if (status === "selling") return "selling";
  if (children === 0) return "setUp";
  return today < pictureDay ? "setUp" : "pictureDay";
}

export type NextStep =
  | { key: "addRoster" }
  | { key: "getReady"; pictureDay: string }
  | { key: "uploadPhotos"; soon: true };

/** The one thing to do next on a job, or null once it sells (the card is hidden). */
export function nextStep(facts: JobFacts): NextStep | null {
  const stage = jobStage(facts);
  if (stage === "selling" || stage === "closed") return null;
  if (facts.children === 0) return { key: "addRoster" };
  if (stage === "setUp") return { key: "getReady", pictureDay: facts.pictureDay };
  return { key: "uploadPhotos", soon: true };
}

export const SELL_CHECKLIST = ["roster", "photos", "tagging", "priceList", "payouts"] as const;
export type SellChecklistKey = (typeof SELL_CHECKLIST)[number];

export interface SellChecklistItem {
  key: SellChecklistKey;
  done: boolean;
  /** Not built yet: shown muted as "Coming soon", never done. */
  soon: boolean;
}

/** "Before you can sell". Only "Roster added" is real today. */
export function sellChecklist({ children }: { children: number }): SellChecklistItem[] {
  return SELL_CHECKLIST.map((key) =>
    key === "roster" ? { key, done: children > 0, soon: false } : { key, done: false, soon: true },
  );
}
