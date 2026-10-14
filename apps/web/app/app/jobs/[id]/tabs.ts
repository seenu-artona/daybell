/**
 * A job's sections, in tab order (D137). Each is its own route under /app/jobs/[id]. Messages and Settings are dropped
 * (D150): per-job reminders live on the Shop tab, job parameters are rows on their own tabs.
 */
export const JOB_TABS = [
  { key: "overview", segment: "" },
  { key: "people", segment: "people" },
  { key: "photos", segment: "photos" },
  { key: "shop", segment: "shop" },
  { key: "orders", segment: "orders" },
] as const;

export type JobTabKey = (typeof JOB_TABS)[number]["key"];

/** Photos' Review (ADR 0018): QR tagging, fixed by hand. Part of the Photos tab. */
export function reviewHref(jobId: string): string {
  return `${tabHref(jobId, "photos")}/review`;
}

export function tabHref(jobId: string, tab: JobTabKey): string {
  const segment = JOB_TABS.find((t) => t.key === tab)?.segment ?? "";
  return `/app/jobs/${jobId}${segment ? `/${segment}` : ""}`;
}

/** Which tab a job path belongs to; the import page is part of People. Null outside a job. */
export function tabForPath(pathname: string): JobTabKey | null {
  const match = pathname.replace(/\/+$/, "").match(/^\/app\/jobs\/([^/]+)(?:\/([^/]+))?/);
  if (!match || match[1] === "new") return null;
  const segment = match[2] ?? "";
  if (segment === "import") return "people";
  return JOB_TABS.find((t) => t.segment === segment)?.key ?? null;
}
