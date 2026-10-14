import { JOB_STATUSES, type JobStatus } from "@daybell/core";

/** The Jobs list's views (D144): All, then each shop state, in ?status= (enum words only, D113). */
export const JOB_VIEWS = ["", ...JOB_STATUSES] as const;
export type JobView = JobStatus | "";

/** The view in ?status=; anything unknown is All. */
export function jobViewFrom(param: string | null): JobView {
  return (JOB_STATUSES as readonly string[]).includes(param ?? "") ? (param as JobStatus) : "";
}

export function jobViewHref(view: JobView): string {
  return view ? `/app/jobs?status=${view}` : "/app/jobs";
}

/** The API query for a view: the browser's own day (ADR 0017), the status when there is one, and the cursor. */
export function jobsQuery(view: JobView, today: string, cursor: string | null): string {
  const query = new URLSearchParams({ today });
  if (view) query.set("status", view);
  if (cursor) query.set("cursor", cursor);
  return `/jobs?${query}`;
}
