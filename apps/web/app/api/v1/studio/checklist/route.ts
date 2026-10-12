import { type StudioChecklistResponse, studioChecklistQuery, type UpNextItem } from "@daybell/api";
import {
  jobChecklist,
  onboardingChecklist,
  onboardingComplete,
  rankUpNext,
  seesOnboarding,
  UP_NEXT_SHOWN,
  type UpNextCandidate,
  upNextForJob,
} from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { check, handle, parseQuery } from "@/lib/api";
import { checklistFacts, checklistToday, loadChecklistFacts } from "@/lib/checklist-facts";
import type { JobRow } from "@/lib/jobs";
import { studioScope } from "@/lib/studio";

/** Up next looks at draft and selling jobs only; a studio has far fewer than this at once. */
const ACTIVE_JOBS_MAX = 1000;

/** Throws the matching ApiError on failure; returns the row count of a head-only count query. */
function counted(result: {
  count: number | null;
  error: { code?: string; message?: string } | null;
}) {
  check({ data: null, error: result.error });
  return result.count ?? 0;
}

/**
 * The studio setup checklist (D143) for owners and admins, until it is first complete. The first time it is, the
 * server records it on the studio (Seenu, answer 5); from then on it is never shown again, even if the only job or
 * teammate goes. Returns null once it's done. Reads and the one write go through the person's own session, so
 * row-level security applies (only owners and admins may update the studio).
 */
async function onboarding(
  supabase: SupabaseClient,
  studioId: string,
): Promise<StudioChecklistResponse["onboarding"]> {
  const studio = check(
    await supabase.from("studios").select("onboarded_at").eq("id", studioId).maybeSingle(),
  ) as { onboarded_at: string | null } | null;
  if (!studio || studio.onboarded_at) return null;
  const [members, invites, jobs] = await Promise.all([
    supabase
      .from("studio_members")
      .select("user_id", { count: "exact", head: true })
      .eq("studio_id", studioId),
    supabase
      .from("studio_invites")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString()),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("studio_id", studioId),
  ]);
  const tasks = onboardingChecklist({
    hasTeam: counted(members) > 1 || counted(invites) > 0,
    hasJob: counted(jobs) > 0,
  });
  if (!onboardingComplete(tasks)) return { tasks: tasks.map(({ key, done }) => ({ key, done })) };
  // The database stamps its own time and keeps the first one (ADR 0017); the event carries the studio id only.
  check(
    await supabase
      .from("studios")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", studioId)
      .is("onboarded_at", null),
  );
  return null;
}

/** Up next (D143): at most one task per draft or selling job, most urgent first. */
async function upNext(
  supabase: SupabaseClient,
  studioId: string,
  today: string,
): Promise<NonNullable<StudioChecklistResponse["upNext"]>> {
  const rows = (check(
    await supabase
      .from("jobs")
      .select("id, name, type, status, picture_day")
      .eq("studio_id", studioId)
      .in("status", ["draft", "selling"])
      .order("picture_day")
      .order("id")
      .limit(ACTIVE_JOBS_MAX),
  ) ?? []) as Pick<JobRow, "id" | "name" | "type" | "status" | "picture_day">[];
  const facts = await loadChecklistFacts(
    supabase,
    studioId,
    rows.map((r) => r.id),
  );
  const candidates: (UpNextCandidate & { jobName: string })[] = [];
  for (const row of rows) {
    const job = { type: row.type, status: row.status, pictureDay: row.picture_day };
    const f = checklistFacts(job, facts.get(row.id), today);
    const pick = upNextForJob(jobChecklist(job.type, f), f);
    if (pick)
      candidates.push({ ...pick, jobId: row.id, jobName: row.name, pictureDay: row.picture_day });
  }
  const items: UpNextItem[] = rankUpNext(candidates, today)
    .slice(0, UP_NEXT_SHOWN)
    .map(({ jobId, jobName, task, reason }) => ({ jobId, jobName, task, reason }));
  return { items, total: candidates.length };
}

/**
 * GET /api/v1/studio/checklist — Home's checklist (D143; ADR 0017): the studio setup checklist while it is shown,
 * otherwise Up next. Database reads only (no storage), so it runs where the rest of the API does (D113). Ids, counts
 * and job names only, as /jobs already returns.
 */
export const GET = handle(async (request: Request) => {
  const { today: todayParam } = parseQuery(request, studioChecklistQuery);
  const today = checklistToday(todayParam);
  const { supabase, studio } = await studioScope();
  const setup = seesOnboarding(studio.role) ? await onboarding(supabase, studio.id) : null;
  const body: StudioChecklistResponse = {
    onboarding: setup,
    upNext: setup ? null : await upNext(supabase, studio.id, today),
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
