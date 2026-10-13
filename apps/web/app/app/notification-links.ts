import { type NotificationKind, notificationTarget } from "@daybell/core";
import { reviewHref, tabHref } from "./jobs/[id]/tabs";

/**
 * Where a bell row leads (ADR 0021): the job's Overview, its Photos (failed photos show there, as for the checklist's
 * "Check failed photos"), Photos' Review, or Settings › Payouts. Null when a job notification has no job (it can't
 * happen; the database deletes them with the job).
 */
export function notificationHref(kind: NotificationKind, jobId: string | null): string | null {
  const target = notificationTarget(kind);
  if (target === "payouts") return "/app/settings/payouts";
  if (!jobId) return null;
  switch (target) {
    case "jobOverview":
      return tabHref(jobId, "overview");
    case "jobFailedPhotos":
      return tabHref(jobId, "photos");
    case "jobReview":
      return reviewHref(jobId);
  }
}
