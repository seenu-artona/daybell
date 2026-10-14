import { type NotificationKind, notificationTarget } from "@daybell/core";
import { reviewHref, tabHref } from "./jobs/[id]/tabs";

/** An order's page in the studio app (ADR 0024). */
export function orderHref(orderId: string): string {
  return `/app/orders/${encodeURIComponent(orderId)}`;
}

/**
 * Where a bell row leads (ADR 0021, 0024): the job's Overview, its Photos (failed photos show there, as for the
 * checklist's "Check failed photos"), Photos' Review, Settings › Payouts, or the order's page. Null when a job or order
 * notification has none (it can't happen; the database deletes them with it).
 */
export function notificationHref(
  kind: NotificationKind,
  jobId: string | null,
  orderId: string | null = null,
): string | null {
  const target = notificationTarget(kind);
  if (target === "payouts") return "/app/settings/payouts";
  if (target === "order") return orderId ? orderHref(orderId) : null;
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
