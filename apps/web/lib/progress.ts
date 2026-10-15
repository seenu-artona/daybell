import "server-only";
import type { JobProgressView } from "@daybell/api";
import { jobChecklist, jobProgress, type ProgressFactKey, type StepFact } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";
import { checklistFacts, loadChecklistFacts } from "./checklist-facts";
import { type JobRow, toJob } from "./jobs";

/** A row of job_progress_facts: a step, when it happened, and who did it (owners and admins only). */
interface ProgressFactRow {
  step: ProgressFactKey;
  happened_at: string;
  actor_id: string | null;
}

/**
 * A job's Progress (D152; ADR 0029): its checklist from job_checklist_facts (the same facts as Home's Up next), its
 * rules, and when and by whom each step happened from job_progress_facts. Who did it is a team member's email, read
 * from the studio's team only for owners and admins (the facts carry no ids for anyone else). Three queries, studio
 * scoped.
 */
export async function loadProgress(
  supabase: SupabaseClient,
  studio: { id: string; role: string },
  row: JobRow,
  today: string,
): Promise<JobProgressView> {
  const job = toJob(row);
  const manager = studio.role === "owner" || studio.role === "admin";
  const [factsByJob, progressRows] = await Promise.all([
    loadChecklistFacts(supabase, studio.id, [job.id]),
    supabase.rpc("job_progress_facts", { p_studio_id: studio.id, p_job_id: job.id }),
  ]);
  const rows = (check(progressRows) ?? []) as ProgressFactRow[];
  const emails = new Map<string, string>();
  if (manager && rows.some((r) => r.actor_id)) {
    const team = (check(await supabase.rpc("studio_team", { p_studio_id: studio.id })) ?? []) as {
      user_id: string;
      email: string;
    }[];
    for (const m of team) emails.set(m.user_id, m.email);
  }
  const facts: Partial<Record<ProgressFactKey, StepFact>> = Object.fromEntries(
    rows.map((r) => [r.step, { at: r.happened_at, actorId: manager ? r.actor_id : null }]),
  );
  const progress = jobProgress({
    status: job.status,
    pictureDay: job.pictureDay,
    createdAt: job.createdAt,
    closesAt: job.closesAt,
    rules: job.rules,
    changed: job.changedRules,
    checklist: jobChecklist(job.type, checklistFacts(job, factsByJob.get(job.id), today)),
    facts,
  });
  return {
    current: progress.current,
    stages: progress.stages.map((stage) => ({
      key: stage.key,
      done: stage.done,
      steps: stage.steps.map(({ actorId, ...step }) => ({
        ...step,
        // A former member's id has no email any more: nobody is named.
        by: actorId ? (emails.get(actorId) ?? null) : null,
      })),
    })),
  };
}
