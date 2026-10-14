/**
 * Home's numbers (D127; ADR 0024): today, this week (from Monday) and this season (from August 1: the school photo
 * year; Claude's call), in the person's own time zone. The database counts them from the ledger
 * (public.studio_sales); these are the same boundaries for the screens and the tests, DST included.
 */
export const SALES_RANGES = ["today", "week", "season"] as const;
export type SalesRange = (typeof SALES_RANGES)[number];

/** The month the season starts (August). */
export const SEASON_START_MONTH = 8;

/** The local date and time of an instant in a time zone, from Intl (no library, no floats). */
function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

/** How far a time zone is ahead of UTC at an instant, in milliseconds. */
function offsetMs(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a local date's midnight happens in a time zone (DST-safe: the offset is checked at the answer). */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  let at = guess - offsetMs(new Date(guess), timeZone);
  at = guess - offsetMs(new Date(at), timeZone);
  return new Date(at);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** When each of Home's ranges starts, for `now` in `timeZone`. */
export function salesRanges(now: Date, timeZone: string): Record<SalesRange, Date> {
  const p = localParts(now, timeZone);
  const back = WEEKDAYS.indexOf(p.weekday);
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - Math.max(back, 0)));
  const seasonYear = p.month < SEASON_START_MONTH ? p.year - 1 : p.year;
  return {
    today: zonedMidnight(p.year, p.month, p.day, timeZone),
    week: zonedMidnight(
      monday.getUTCFullYear(),
      monday.getUTCMonth() + 1,
      monday.getUTCDate(),
      timeZone,
    ),
    season: zonedMidnight(seasonYear, SEASON_START_MONTH, 1, timeZone),
  };
}

/** The average order in whole cents, half up; null without orders. */
export function averageOrderCents(salesCents: number, orders: number): number | null {
  if (!Number.isSafeInteger(salesCents) || !Number.isSafeInteger(orders) || orders <= 0)
    return null;
  const sign = salesCents < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(salesCents) * 2 + orders) / (orders * 2));
}
