import { jobInput, listQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, filterValue, handle, parseBody, parseQuery } from "@/lib/api";
import {
  assertJobReferences,
  isNumberTaken,
  JOB_COLUMNS,
  type JobRow,
  jobColumns,
  NUMBER_TAKEN,
  nextJobNumber,
  page,
  toJob,
} from "@/lib/jobs";
import { assertCanManage, studioScope } from "@/lib/studio";

/** GET /api/v1/jobs — the studio's jobs, newest first, in pages (D92, D96). */
export const GET = handle(async (request: Request) => {
  const { limit, cursor } = parseQuery(request, listQuery);
  const { supabase, studio } = await studioScope();
  let query = supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
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
  return NextResponse.json({ jobs: items.map(toJob), nextCursor });
});

/**
 * POST /api/v1/jobs — owners and admins create a job. New jobs are drafts. Without an internal number the next free
 * one is used; if someone else takes it at the same moment, the next one is tried.
 */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, jobInput);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  await assertJobReferences(supabase, studio.id, input);
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
    const row = check(result) as unknown as JobRow;
    return NextResponse.json({ job: toJob(row) }, { status: 201 });
  }
});
