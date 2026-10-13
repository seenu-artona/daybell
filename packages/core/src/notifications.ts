/**
 * Bell notifications (Phase 1 step 8; D143: the bell is information only, never tasks; ADR 0021, call 4). The database
 * makes them from the event log, with ids and counts only; the screens put the words in. The same lists live in the
 * database (the notification_kind enum and app.notification_audience); a test in packages/api keeps them in step.
 */

export const NOTIFICATION_KINDS = [
  "job_selling",
  "job_closed",
  "payouts_active",
  "payouts_restricted",
  "photos_failed",
  "tagging_ready",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

type Role = "owner" | "admin" | "photographer" | "staff";

/**
 * Who hears about each kind: everyone about the shop opening and closing; owners and admins about payouts (only they
 * see Payouts, ADR 0020); owners, admins and photographers about photos and tagging (the people who fix them, ADR
 * 0018). The person who opened or closed a shop isn't told about their own action.
 */
export const NOTIFICATION_AUDIENCE: Record<NotificationKind, readonly Role[]> = {
  job_selling: ["owner", "admin", "photographer", "staff"],
  job_closed: ["owner", "admin", "photographer", "staff"],
  payouts_active: ["owner", "admin"],
  payouts_restricted: ["owner", "admin"],
  photos_failed: ["owner", "admin", "photographer"],
  tagging_ready: ["owner", "admin", "photographer"],
};

export function hearsAbout(role: string, kind: NotificationKind): boolean {
  return (NOTIFICATION_AUDIENCE[kind] as readonly string[]).includes(role);
}

/**
 * Where a notification leads: the job's Overview, its Photos showing the failed ones, Photos' Review, or Settings ›
 * Payouts. Screens turn these into links.
 */
export type NotificationTarget = "jobOverview" | "jobFailedPhotos" | "jobReview" | "payouts";

export function notificationTarget(kind: NotificationKind): NotificationTarget {
  switch (kind) {
    case "job_selling":
    case "job_closed":
      return "jobOverview";
    case "photos_failed":
      return "jobFailedPhotos";
    case "tagging_ready":
      return "jobReview";
    case "payouts_active":
    case "payouts_restricted":
      return "payouts";
  }
}

/** The bell's panel lists the latest ones. */
export const NOTIFICATIONS_SHOWN = 20;
/** The bell asks for the unread count this often while the page is visible (no live connection; Claude's call). */
export const NOTIFICATION_POLL_MS = 60_000;
/** Mark read takes at most this many at once. */
export const MAX_NOTIFICATIONS_PER_READ = 100;

/**
 * How many new notifications to announce when the unread count changes: only a rise, and never the first count after
 * the page loads (that would read out old news on every page). Null: say nothing.
 */
export function newNotifications(previous: number | null, next: number): number | null {
  if (previous === null || next <= previous) return null;
  return next - previous;
}
