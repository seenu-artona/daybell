import { JOB_SHOW_FILTERS, type JobShowFilter, type ListFilterChip } from "@daybell/api";
import { JOB_STATUSES, type JobStatus } from "@daybell/core";

/**
 * The Jobs list's chips (D147, amends D144 and D145): All and each shop state built in; Shop closes this week, Picture
 * day this month and a client added by the person. One chip at a time, in the address as one of ?status=, ?show= or
 * ?client=<id> (enum words and ids only, never search text: D113).
 */
export type JobChip =
  | { kind: "all" }
  | { kind: "status"; status: JobStatus }
  | { kind: "show"; show: JobShowFilter }
  | { kind: "client"; id: string };

export const ALL_JOBS: JobChip = { kind: "all" };

/** The built-in chips, in order. */
export const BUILT_IN_JOB_CHIPS: readonly JobChip[] = [
  ALL_JOBS,
  ...JOB_STATUSES.map((status) => ({ kind: "status", status }) as const),
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARAMS = ["status", "show", "client"] as const;

/**
 * The chip in the address. Anything unknown, or more than one chip's parameter at once, is All, and `clean` says the
 * page should replace the address with All's (so it never shows a filter the list isn't using).
 */
export function jobChipFrom(params: URLSearchParams): { chip: JobChip; clean: boolean } {
  const present = PARAMS.filter((p) => params.has(p));
  if (present.length === 0) return { chip: ALL_JOBS, clean: false };
  const status = params.get("status");
  const show = params.get("show");
  const client = params.get("client");
  if (present.length === 1) {
    if (status && (JOB_STATUSES as readonly string[]).includes(status))
      return { chip: { kind: "status", status: status as JobStatus }, clean: false };
    if (show && (JOB_SHOW_FILTERS as readonly string[]).includes(show))
      return { chip: { kind: "show", show: show as JobShowFilter }, clean: false };
    if (client && UUID.test(client))
      return { chip: { kind: "client", id: client.toLowerCase() }, clean: false };
  }
  return { chip: ALL_JOBS, clean: true };
}

export function jobChipHref(chip: JobChip): string {
  switch (chip.kind) {
    case "all":
      return "/app/jobs";
    case "status":
      return `/app/jobs?status=${chip.status}`;
    case "show":
      return `/app/jobs?show=${chip.show}`;
    case "client":
      return `/app/jobs?client=${chip.id}`;
  }
}

export function sameJobChip(a: JobChip, b: JobChip): boolean {
  return jobChipHref(a) === jobChipHref(b);
}

/** A saved chip's filter, or null for a key the Jobs list doesn't take. */
export function jobChipFromSaved(saved: ListFilterChip): JobChip | null {
  if ((JOB_SHOW_FILTERS as readonly string[]).includes(saved.key) && !saved.value)
    return { kind: "show", show: saved.key as JobShowFilter };
  if (saved.key === "client" && saved.value) return { kind: "client", id: saved.value };
  return null;
}

/** The API query for a chip, the browser's own day (ADR 0017), the search and the cursor. */
export function jobsQuery(
  chip: JobChip,
  today: string,
  cursor: string | null,
  search = "",
): string {
  const query = new URLSearchParams({ today });
  if (chip.kind === "status") query.set("status", chip.status);
  if (chip.kind === "show") query.set("show", chip.show);
  if (chip.kind === "client") query.set("clientId", chip.id);
  if (search) query.set("q", search);
  if (cursor) query.set("cursor", cursor);
  return `/jobs?${query}`;
}
