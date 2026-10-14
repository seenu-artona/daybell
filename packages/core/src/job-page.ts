/**
 * Shared pieces of the job page (D140, D143; ADR 0014, 0017, 0021): calendar days, the five milestones, the Print QR
 * cards rule, the Start selling dialog's list (which the server checks too) and closing dates. The job checklist itself
 * is in checklist.ts.
 */
import type { JobStatus } from "./jobs";

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
}

/** What "Before you can sell" needs to know about a job and its studio. */
export interface SellFacts {
  /** Children on the roster. */
  children: number;
  /** The job has a ready photo outside the bin. */
  hasReadyPhoto: boolean;
  /** The Review tagging task is done (reviewTaggingDone). */
  taggingReviewed: boolean;
  /** The job's price list has at least one item (ADR 0021, A2). */
  hasPriceList: boolean;
  /** The studio's payout account is Active. */
  payoutsConnected: boolean;
}

/**
 * "Before you can sell", in the Start selling dialog (D138), and what the server checks before a job may sell (ADR
 * 0021, call 1 and A1): Roster added, Photos uploaded (a ready photo), Tagging reviewed (reviewTaggingDone, ADR 0018),
 * Price list chosen (a list with at least one item, A2) and Payouts connected (Active, ADR 0020). All five are real and
 * the same for every studio (Seenu, Oct 12).
 */
export function sellChecklist(f: SellFacts): SellChecklistItem[] {
  const done: Record<SellChecklistKey, boolean> = {
    roster: f.children > 0,
    photos: f.hasReadyPhoto,
    tagging: f.taggingReviewed,
    priceList: f.hasPriceList,
    payouts: f.payoutsConnected,
  };
  return SELL_CHECKLIST.map((key) => ({ key, done: done[key] }));
}

/** What still stops a job selling, in the dialog's order; empty when it may. */
export function sellBlockers(f: SellFacts): SellChecklistKey[] {
  return sellChecklist(f)
    .filter((item) => !item.done)
    .map((item) => item.key);
}

/** The database's names for the blockers (start_selling's not_ready detail). */
export const SELL_BLOCKER_DB_KEYS: Record<SellChecklistKey, string> = {
  roster: "roster",
  photos: "photos",
  tagging: "tagging",
  priceList: "price_list",
  payouts: "payouts",
};

/**
 * The blockers the database named (a comma-separated list of its keys), in the dialog's order. Anything it doesn't know
 * is ignored, so a refusal can never put unknown words on screen.
 */
export function sellBlockersFromDb(detail: string | null | undefined): SellChecklistKey[] {
  const named = new Set((detail ?? "").split(",").map((k) => k.trim()));
  return SELL_CHECKLIST.filter((key) => named.has(SELL_BLOCKER_DB_KEYS[key]));
}

/** D47: campaigns send only while a job is Selling, as GotPhoto. The hook campaigns will use; nothing sends yet. */
export function campaignsMaySend(status: JobStatus): boolean {
  return status === "selling";
}

/** A closing date is at most this many days away (the database's jobs_guard_closes_at checks the same). */
export const MAX_CLOSING_DAYS = 400;

/** Whether a closing moment may be set now: in the future and at most MAX_CLOSING_DAYS away. */
export function closingDateAllowed(closesAt: Date, now: Date = new Date()): boolean {
  const ms = closesAt.getTime() - now.getTime();
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_CLOSING_DAYS * 86_400_000;
}

/**
 * The moment a calendar day (YYYY-MM-DD) ends in the local time zone: the next day's local midnight. A job's closing
 * date is stored as this moment, in the time zone of whoever set it (ADR 0021, Q2); daylight saving is handled by the
 * platform's local time.
 */
export function endOfLocalDay(day: string, timeZone?: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  if (!timeZone) return new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  // Midnight starting the next day in `timeZone`: guess it as UTC, then correct by that zone's offset (twice, for DST edges).
  const target = Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0);
  let at = target;
  for (let i = 0; i < 2; i += 1) at = target - zoneOffsetMs(new Date(at), timeZone);
  return new Date(at);
}

/** The zone's offset from UTC at `date`, in milliseconds (positive east of Greenwich). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The local calendar day a closing moment ends (the day before its local midnight), for the date field. */
export function closingDay(closesAt: string | Date, timeZone?: string): string {
  const at = new Date(new Date(closesAt).getTime() - 1);
  if (!timeZone) return localDay(at);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A shop closing this many days ahead or fewer is "closing soon" (D147): the Jobs list shows it in amber with words. */
export const CLOSES_SOON_DAYS = 2;

/**
 * Whole days from `today` (YYYY-MM-DD, the viewer's day) to the closing moment's local day (the last day to order):
 * 0 when the shop closes at the end of today. Null when that is more than CLOSES_SOON_DAYS away or already past, so
 * only shops closing soon get the warning (D147).
 */
export function closesSoon(
  closesAt: string | Date,
  today: string,
  timeZone?: string,
): number | null {
  const days = daysUntil(closingDay(closesAt, timeZone), today);
  return days >= 0 && days <= CLOSES_SOON_DAYS ? days : null;
}
