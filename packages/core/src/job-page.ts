/**
 * Shared pieces of the job page (D140, D143; ADR 0014, 0017): calendar days, the five milestones, the Print QR cards
 * rule and the Start selling dialog's list. The job checklist itself is in checklist.ts.
 */
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

/** The five milestones a job moves through, in order (D140, D143). */
export const MILESTONES = ["setUp", "pictureDay", "photosIn", "selling", "fulfilment"] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface QrCardProgress {
  /** Children not marked Do not photograph. */
  eligible: number;
  /** Of those, how many have a card. */
  withCard: number;
}

/**
 * "Print QR cards" is done when every child who may be photographed has a card (Seenu, answer 2 to the step 3 plan),
 * so adding a child later reopens it. Read literally, a roster where every child is marked Do not photograph is done
 * too: there is no card to print. An empty roster is not done.
 */
export function qrCardsDone(
  progress: QrCardProgress | null | undefined,
  children: number,
): boolean {
  return !!progress && children > 0 && progress.withCard >= progress.eligible;
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
