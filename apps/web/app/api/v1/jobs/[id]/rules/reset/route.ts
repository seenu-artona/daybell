import { ApiError, JOB_CONFLICTS, jobRuleResetInput } from "@daybell/api";
import { undoRule } from "@daybell/core";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import {
  CLOSES_AT_INVALID,
  givenRulesOf,
  JOB_COLUMNS,
  type JobRow,
  jobWriteError,
  loadJobRow,
  rulesToDb,
  toJob,
} from "@/lib/jobs";
import { pathId } from "@/lib/roster";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/rules/reset — owners and admins undo a job's own change to one rule (D152: "Changed for this
 * job · Undo"): the rule goes back to what the job's template gave it and, while the shop sells, so does the closing
 * date (the template rule's, counted from the shop's first opening). A job made before templates has nothing to go
 * back to (409 jobs.noTemplate); a template date that has passed is refused like any closing date in the past.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Job not found.");
  const { rule } = await parseBody(request, jobRuleResetInput);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const current = await loadJobRow(supabase, studio.id, id);
  const given = givenRulesOf(current);
  if (!given)
    throw new ApiError("conflict", "This job wasn't made from a template.", {
      form: JOB_CONFLICTS.noTemplate,
    });
  const undo = undoRule(rule, given, {
    status: current.status,
    openedAt: current.opened_at ?? null,
    closesAt: current.closes_at,
  });
  if (undo.closesAtPassed) throw CLOSES_AT_INVALID();
  const result = await supabase
    .from("jobs")
    .update({
      ...rulesToDb(undo.rules),
      ...(undo.closesAt !== undefined ? { closes_at: undo.closesAt } : {}),
    })
    .eq("studio_id", studio.id)
    .eq("id", id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  const named = jobWriteError(result.error, { shopChanged: false });
  if (named) throw named;
  const row = check(result) as unknown as JobRow | null;
  if (!row) throw new ApiError("not_found", "Job not found.");
  return NextResponse.json({ job: toJob(row) });
});
