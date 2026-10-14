import {
  ApiError,
  isJobListPage,
  type ListFiltersInput,
  type ListFiltersResponse,
  type ListPage,
  listFilterNeedsValue,
  listFiltersInput,
  listFiltersQuery,
} from "@daybell/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { check, handle, parseBody, parseQuery } from "@/lib/api";
import { studioScope } from "@/lib/studio";

/**
 * The filter chips a person added to a list (D147, ADR 0026). Their own only, in their studio: every query names the
 * studio and the person, and row-level security says the same. Chips are keys and record ids; nothing here is logged,
 * and refusals never repeat what was sent.
 */

const CHIPS_REFUSED = new ApiError("invalid_input", "Please check the highlighted fields.", {
  chips: "validation.filterChips",
});

const JOB_REQUIRED = new ApiError("invalid_input", "Please check the query parameters.", {
  jobId: "validation.invalid",
});

/** For a job's tab, the job must be the studio's; studio lists take no job. */
async function assertJobFits(
  supabase: SupabaseClient,
  studioId: string,
  page: ListPage,
  jobId: string | undefined,
): Promise<void> {
  if ((jobId !== undefined) !== isJobListPage(page)) throw JOB_REQUIRED;
  if (!jobId) return;
  const job = check(
    await supabase
      .from("jobs")
      .select("id")
      .eq("studio_id", studioId)
      .eq("id", jobId)
      .maybeSingle(),
  );
  if (!job) throw new ApiError("not_found", "Job not found.");
}

/** The table and scope each id-taking key's records live in: the studio's clients, jobs, or the job's classes. */
const RECORDS: Record<string, { table: string; inJob: boolean }> = {
  client: { table: "clients", inJob: false },
  job: { table: "jobs", inJob: false },
  class: { table: "job_groups", inJob: true },
};

/** Every id a chip names must be the studio's own record of the right kind (a class, of this job). */
async function assertRecordsFit(
  supabase: SupabaseClient,
  studioId: string,
  input: ListFiltersInput,
): Promise<void> {
  const byKey = new Map<string, Set<string>>();
  for (const chip of input.chips) {
    if (!chip.value) continue;
    const ids = byKey.get(chip.key) ?? new Set<string>();
    ids.add(chip.value.toLowerCase());
    byKey.set(chip.key, ids);
  }
  for (const [key, ids] of byKey) {
    const records = RECORDS[key];
    if (!records) throw CHIPS_REFUSED;
    let query = supabase
      .from(records.table)
      .select("id")
      .eq("studio_id", studioId)
      .in("id", [...ids]);
    if (records.inJob) query = query.eq("job_id", input.jobId ?? "");
    const found = (check(await query) ?? []) as { id: string }[];
    if (found.length !== ids.size) throw CHIPS_REFUSED;
  }
}

/** GET /api/v1/me/list-filters?page=&jobId= — the person's chips for one list, in order. */
export const GET = handle(async (request: Request) => {
  const { page, jobId } = parseQuery(request, listFiltersQuery);
  const { supabase, studio, userId } = await studioScope();
  await assertJobFits(supabase, studio.id, page, jobId);
  let query = supabase
    .from("list_filter_chips")
    .select("filter_key, filter_value")
    .eq("studio_id", studio.id)
    .eq("user_id", userId)
    .eq("page", page)
    .order("position", { ascending: true });
  query = jobId ? query.eq("job_id", jobId) : query.is("job_id", null);
  const rows = (check(await query) ?? []) as {
    filter_key: string;
    filter_value: string | null;
  }[];
  // A key the list no longer takes is left out rather than shown as a chip that does nothing.
  const body: ListFiltersResponse = {
    chips: rows
      .filter((r) => listFilterNeedsValue(page, r.filter_key) === (r.filter_value !== null))
      .map((r) => ({ key: r.filter_key, value: r.filter_value })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
});

/**
 * PUT /api/v1/me/list-filters — replaces the person's chips for one list (and job) with these, in order (at most 8).
 * Who is asking comes first, before the body is read (S4). Then the keys (by the schema), the job, and every id; the
 * database's save_list_filters checks membership, the job and the count again and writes one event with the page and
 * the count only.
 */
export const PUT = handle(async (request: Request) => {
  const { supabase, studio } = await studioScope();
  const input = await parseBody(request, listFiltersInput);
  await assertJobFits(supabase, studio.id, input.page, input.jobId);
  await assertRecordsFit(supabase, studio.id, input);
  const result = await supabase.rpc("save_list_filters", {
    p_studio_id: studio.id,
    p_page: input.page,
    p_job_id: input.jobId ?? null,
    p_chips: input.chips.map((chip) => ({ key: chip.key, value: chip.value ?? null })),
  });
  // The function's own refusals (e.g. the job removed meanwhile) are fixed words, never the values sent.
  if (result.error?.code === "22023") throw CHIPS_REFUSED;
  check(result);
  return new NextResponse(null, { status: 204 });
});
