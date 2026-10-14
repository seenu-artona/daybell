/** A job's sections, in tab order (D137). Each is its own route under /app/jobs/[id]. */
export const JOB_TABS = [
  { key: "overview", segment: "" },
  { key: "people", segment: "people" },
  { key: "photos", segment: "photos" },
  { key: "shop", segment: "shop" },
  { key: "messages", segment: "messages" },
  { key: "orders", segment: "orders" },
  { key: "settings", segment: "settings" },
] as const;

export type JobTabKey = (typeof JOB_TABS)[number]["key"];

/**
 * The tabs that show a coming-soon panel in this step (D138). Photos is real since step 4 (ADR 0016), Shop since step
 * 6 (ADR 0019), Orders since step 11 (ADR 0024).
 */
export const SOON_TABS = ["messages", "settings"] as const;
export type SoonTab = (typeof SOON_TABS)[number];

export function isSoonTab(segment: string): segment is SoonTab {
  return (SOON_TABS as readonly string[]).includes(segment);
}

/**
 * The tabs in the job's tab row (D144): the built sections only. Messages and Settings (coming soon) still have their
 * routes and open by URL, but leave the row until they are built.
 */
export const VISIBLE_JOB_TABS = JOB_TABS.filter((t) => !isSoonTab(t.segment));

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
