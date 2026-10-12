import "server-only";
import { ApiError, type JobChecklist, type JobChecklistSummary } from "@daybell/api";
import {
  type ChecklistFacts,
  daysUntil,
  isOnTrack,
  type JobStatus,
  type JobType,
  jobChecklist,
} from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";

/** One job's counts from job_checklist_facts (ADR 0017). */
export interface FactsRow {
  job_id: string;
  children: number;
  qr_eligible: number;
  qr_with_card: number;
  has_ready_photo: boolean;
  failed_photos: number;
  /** QR tagging (ADR 0018). */
  tagging_pending: boolean;
  leftovers: number;
  flagged: number;
  blank_cards_pending: number;
  tagging_reviewed: boolean;
}

/**
 * The checklist counts of many jobs in one query (never one per job), keyed by job id. Studio-scoped in the database:
 * another studio's ids return nothing (D96).
 */
export async function loadChecklistFacts(
  supabase: SupabaseClient,
  studioId: string,
  jobIds: readonly string[],
): Promise<Map<string, FactsRow>> {
  if (jobIds.length === 0) return new Map();
  const rows = (check(
    await supabase.rpc("job_checklist_facts", { p_studio_id: studioId, p_job_ids: jobIds }),
  ) ?? []) as FactsRow[];
  return new Map(rows.map((r) => [r.job_id, r]));
}

/** A job's checklist facts; a job with no row (it can't happen inside one studio) counts as empty. */
export function checklistFacts(
  job: { status: JobStatus; pictureDay: string },
  row: FactsRow | undefined,
  today: string,
): ChecklistFacts {
  return {
    status: job.status,
    pictureDay: job.pictureDay,
    children: Number(row?.children ?? 0),
    qrCards: row ? { eligible: Number(row.qr_eligible), withCard: Number(row.qr_with_card) } : null,
    hasReadyPhoto: row?.has_ready_photo === true,
    failedPhotos: Number(row?.failed_photos ?? 0),
    taggingPending: row?.tagging_pending === true,
    leftovers: Number(row?.leftovers ?? 0),
    flagged: Number(row?.flagged ?? 0),
    blankCardsPending: Number(row?.blank_cards_pending ?? 0),
    taggingReviewed: row?.tagging_reviewed === true,
    today,
  };
}

/** What the Jobs list shows per row: milestone, done of total, and the next task (D143). */
export function checklistSummary(
  job: { type: JobType; status: JobStatus; pictureDay: string },
  row: FactsRow | undefined,
  today: string,
): JobChecklistSummary {
  const c = jobChecklist(job.type, checklistFacts(job, row, today));
  return { milestone: c.milestone, done: c.done, total: c.total, next: c.next?.key ?? null };
}

/** A job's whole checklist, for its Overview (D143): the same facts and rules as the Jobs list. */
export function checklistDetail(
  job: { type: JobType; status: JobStatus; pictureDay: string },
  row: FactsRow | undefined,
  today: string,
): JobChecklist {
  const facts = checklistFacts(job, row, today);
  const c = jobChecklist(job.type, facts);
  return {
    milestone: c.milestone,
    done: c.done,
    total: c.total,
    next: c.next?.key ?? null,
    tasks: c.groups.flatMap((g) =>
      g.tasks.map(({ key, milestone, done }) => ({ key, milestone, done })),
    ),
    onTrack: isOnTrack(c, facts),
  };
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/**
 * "Today" for the checklist: the browser's own day when it sends one (picture day is a calendar date and there is no
 * studio time zone yet; ADR 0014), else the server's UTC day. Every time zone's date is within a day of UTC's, so
 * anything further is refused.
 */
export function checklistToday(param: string | undefined, now: Date = new Date()): string {
  const utc = utcDay(now);
  if (param === undefined) return utc;
  if (Math.abs(daysUntil(param, utc)) > 1)
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      today: "validation.invalid",
    });
  return param;
}
