/**
 * The Jobs list's "Show only" filters (D147, ADR 0026), as date bounds from the viewer's `today` (YYYY-MM-DD).
 * Pure, so the route stays a list of query filters and the bounds are tested here.
 */

/** The latest UTC offset at which a US or Canadian day ends: Hawaii, UTC−10. */
const LATEST_DAY_END_HOURS = 10;

/**
 * The upper bound for "Shop closes this week": the end of the seventh day counting today (today + 6). A shop closes
 * at the end of its last day in the setter's time zone (ADR 0021), which is midnight UTC−2:30 to UTC−10 for the US and
 * Canada, so a closing at the end of today + 6 anywhere there falls on or before this bound and one at the end of
 * today + 7 after it, whatever the viewer's own zone.
 */
export function closingWeekEnd(today: string): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 7, LATEST_DAY_END_HOURS)).toISOString();
}

/** "Picture day this month": from the first of today's month to before the first of the next (picture days are dates). */
export function monthRange(today: string): { from: string; before: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${y}-${pad(m)}-01`,
    before: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`,
  };
}
