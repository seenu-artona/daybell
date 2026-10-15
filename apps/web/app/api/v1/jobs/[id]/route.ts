import {
  ApiError,
  type JobDetailResponse,
  type JobInput,
  jobPatch,
  PRICE_LIST_CONFLICTS,
  splitJobPatch,
  studioChecklistQuery,
} from "@daybell/api";
import { withRules } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { check, handle, parseBody, parseQuery } from "@/lib/api";
import { checklistDetail, checklistToday, loadChecklistFacts } from "@/lib/checklist-facts";
import { assertRulesWhole } from "@/lib/job-templates";
import {
  assertClientInStudio,
  assertClosingDate,
  isNumberTaken,
  JOB_CLOSED,
  JOB_COLUMNS,
  type JobRow,
  jobColumns,
  jobRulesOf,
  jobWriteError,
  NUMBER_TAKEN,
  rulesToDb,
  toJob,
  validJob,
} from "@/lib/jobs";
import { assertPriceListInStudio, priceListError } from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

async function jobId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "Job not found.");
  return id;
}

async function loadJob(supabase: SupabaseClient, studioId: string, id: string): Promise<JobRow> {
  const row = check(
    await supabase
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("studio_id", studioId)
      .eq("id", id)
      .maybeSingle(),
  ) as unknown as JobRow | null;
  if (!row) throw new ApiError("not_found", "Job not found.");
  return row;
}

/**
 * GET /api/v1/jobs/:id — one job with its whole checklist (D143; ADR 0017), from job_checklist_facts like the Jobs
 * list, so the Overview and the list never disagree. `?today=` as on /jobs.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const id = await jobId(ctx);
  const today = checklistToday(parseQuery(request, studioChecklistQuery).today);
  const { supabase, studio } = await studioScope();
  const job = toJob(await loadJob(supabase, studio.id, id));
  const facts = await loadChecklistFacts(supabase, studio.id, [job.id]);
  const body: JobDetailResponse = {
    job: { ...job, checklist: checklistDetail(job, facts.get(job.id), today) },
  };
  return NextResponse.json(body);
});

/**
 * PATCH /api/v1/jobs/:id — owners and admins change a job's details and its own rules (D152: they show as "Changed
 * for this job"). The status changes only through start-selling, close and reopen (ADR 0021). A draft or selling job
 * may switch price list or school delivery (new orders only) and set or remove its closing date (in the future, at
 * most 400 days away); a closed job's don't change (Claude's call 4; ADR 0021; the database refuses it too). The rules
 * must make a whole (days after picture day exactly when the shop opens then).
 */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const id = await jobId(ctx);
  const { details: patch, rules: rulePatch } = splitJobPatch(await parseBody(request, jobPatch));
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const current = await loadJob(supabase, studio.id, id);
  const rules = withRules(jobRulesOf(current), rulePatch);
  assertRulesWhole(rules);
  const ruleColumns =
    Object.keys(rulePatch).length > 0
      ? rulesToDb({ ...rulePatch, shopOpensDays: rules.shopOpensDays })
      : {};
  // The job as it will be, checked as a whole.
  const next = validJob({
    name: current.name,
    pictureDay: current.picture_day,
    clientId: current.client?.id ?? null,
    internalNumber: current.internal_number,
    type: current.type,
    subjectsExpected: current.subjects_expected,
    priceListId: current.price_list_id,
    deliverToSchool: current.deliver_to_school,
    ...patch,
  });
  const shopChanged =
    (patch.priceListId !== undefined && patch.priceListId !== current.price_list_id) ||
    (patch.deliverToSchool !== undefined && patch.deliverToSchool !== current.deliver_to_school);
  if (current.status === "closed" && shopChanged)
    throw new ApiError(
      "conflict",
      "This job is closed, so its price list and delivery can't change.",
      { form: PRICE_LIST_CONFLICTS.jobClosed },
    );
  // A closing date on a closed shop: reopen it first. Removing one (null) is harmless.
  if (current.status === "closed" && patch.closesAt != null) throw JOB_CLOSED();
  assertClosingDate(patch.closesAt);
  await assertClientInStudio(supabase, studio.id, patch.clientId);
  await assertPriceListInStudio(supabase, studio.id, patch.priceListId);
  const result = await supabase
    .from("jobs")
    .update({ ...jobColumns(next, Object.keys(patch) as (keyof JobInput)[]), ...ruleColumns })
    .eq("studio_id", studio.id)
    .eq("id", id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (isNumberTaken(result.error)) throw NUMBER_TAKEN;
  const named = jobWriteError(result.error, { shopChanged });
  if (named) throw named;
  // The job closed between the check and the update.
  if (result.error?.code === "P0001") throw priceListError(result.error);
  const row = check(result) as unknown as JobRow | null;
  if (!row) throw new ApiError("not_found", "Job not found.");
  return NextResponse.json({ job: toJob(row) });
});
