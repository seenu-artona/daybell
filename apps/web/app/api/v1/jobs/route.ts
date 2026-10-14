import { type JobsResponse, jobInput, jobListQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, filterValue, handle, likePattern, parseBody, parseQuery } from "@/lib/api";
import { checklistSummary, checklistToday, loadChecklistFacts } from "@/lib/checklist-facts";
import { closingWeekEnd, monthRange } from "@/lib/job-list-filters";
import {
  assertClientInStudio,
  assertClosingDate,
  isNumberTaken,
  JOB_COLUMNS,
  type JobRow,
  jobColumns,
  jobWriteError,
  NUMBER_TAKEN,
  nextJobNumber,
  page,
  toJob,
} from "@/lib/jobs";
import { assertPriceListInStudio } from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

/**
 * GET /api/v1/jobs — the studio's jobs, newest first, in pages (D92, D96), each with its checklist progress (D143; ADR
 * 0017): the page's counts come from one query, never one per job. ?status= narrows it to one state (Home's "Jobs
 * selling now", ADR 0021). The Jobs list's chips and search (D147, ADR 0026) are plain filters on the same query, all
 * within the studio: ?show=closingThisWeek (selling, closing from now to the end of today + 6),
 * ?show=pictureDayThisMonth (today's calendar month), ?clientId= (one of the studio's clients) and ?q= (the name or
 * internal number contains it). Keyset paging is unchanged.
 */
export const GET = handle(async (request: Request) => {
  const {
    limit,
    cursor,
    today: todayParam,
    status,
    show,
    clientId,
    q,
  } = parseQuery(request, jobListQuery);
  const today = checklistToday(todayParam);
  const { supabase, studio } = await studioScope();
  let query = supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (status) query = query.eq("status", status);
  if (show === "closingThisWeek")
    query = query
      .eq("status", "selling")
      .gt("closes_at", new Date().toISOString())
      .lte("closes_at", closingWeekEnd(today));
  if (show === "pictureDayThisMonth") {
    const month = monthRange(today);
    query = query.gte("picture_day", month.from).lt("picture_day", month.before);
  }
  // Another studio's client id simply matches nothing: the studio filter above still applies.
  if (clientId) query = query.eq("client_id", clientId);
  if (q) {
    const pattern = filterValue(likePattern(q));
    query = query.or(`name.ilike.${pattern},internal_number.ilike.${pattern}`);
  }
  if (cursor) {
    // Keyset pagination: continue after the cursor job (looked up in this studio only).
    const anchor = check(
      await supabase
        .from("jobs")
        .select("created_at")
        .eq("studio_id", studio.id)
        .eq("id", cursor)
        .maybeSingle(),
    ) as { created_at: string } | null;
    if (!anchor) return NextResponse.json({ jobs: [], nextCursor: null });
    const at = filterValue(anchor.created_at);
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor})`);
  }
  const rows = (check(await query) ?? []) as unknown as JobRow[];
  const { items, nextCursor } = page(rows, limit);
  const jobs = items.map(toJob);
  const facts = await loadChecklistFacts(
    supabase,
    studio.id,
    jobs.map((j) => j.id),
  );
  const body: JobsResponse = {
    jobs: jobs.map((job) => ({
      ...job,
      checklist: checklistSummary(job, facts.get(job.id), today),
    })),
    nextCursor,
  };
  return NextResponse.json(body);
});

/**
 * POST /api/v1/jobs — owners and admins create a job. New jobs are drafts. Without an internal number the next free
 * one is used; if someone else takes it at the same moment, the next one is tried. Without a price list, the database
 * gives the job the studio's default (ADR 0019).
 */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, jobInput);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  assertClosingDate(input.closesAt);
  await assertClientInStudio(supabase, studio.id, input.clientId);
  await assertPriceListInStudio(supabase, studio.id, input.priceListId);
  for (let attempt = 0; ; attempt++) {
    const internalNumber = input.internalNumber ?? (await nextJobNumber(supabase, studio.id));
    const result = await supabase
      .from("jobs")
      .insert({ studio_id: studio.id, ...jobColumns({ ...input, internalNumber }) })
      .select(JOB_COLUMNS)
      .single();
    if (isNumberTaken(result.error)) {
      if (input.internalNumber || attempt >= 2) throw NUMBER_TAKEN;
      continue;
    }
    const named = jobWriteError(result.error, { shopChanged: false });
    if (named) throw named;
    const row = check(result) as unknown as JobRow;
    return NextResponse.json({ job: toJob(row) }, { status: 201 });
  }
});
