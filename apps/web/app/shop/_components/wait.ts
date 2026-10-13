/**
 * How long a locked parent waits, in words they can read (D91): minutes up to an hour ("Wait 14 minutes"), rounded
 * hours beyond it ("Try again in about 24 hours"), not "Wait 1,440 minutes" after the per-child new-session limit.
 * No Retry-After means the code lockout's 15 minutes (ADR 0022).
 */
export type LockedWait = { key: "locked"; minutes: number } | { key: "lockedHours"; hours: number };

export function lockedWait(retryAfterSeconds: number | null): LockedWait {
  const minutes = Math.max(1, Math.ceil((retryAfterSeconds ?? 900) / 60));
  if (minutes <= 60) return { key: "locked", minutes };
  return { key: "lockedHours", hours: Math.max(1, Math.round(minutes / 60)) };
}
