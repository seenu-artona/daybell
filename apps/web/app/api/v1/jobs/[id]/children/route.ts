import { childInput, rosterQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { accessCodeCryptoKeys, newAccessCode } from "@/lib/access-codes";
import { check, handle, parseBody, parseQuery } from "@/lib/api";
import { page } from "@/lib/jobs";
import {
  assertGroupInJob,
  CHILD_COLUMNS,
  type ChildRow,
  childColumns,
  isCodeTaken,
  isDuplicate,
  loadRoster,
  loadRosterJob,
  pathId,
  toChild,
} from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/children — the roster, by last and first name, in pages. Read through the list_children RPC so
 * names never appear in a URL; the cursor and filter are IDs (D96).
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { limit, cursor, groupId } = parseQuery(request, rosterQuery);
  const { supabase, studio } = await studioScope();
  await loadRosterJob(supabase, studio.id, jobId);
  const list = check(
    await supabase.rpc("list_children", {
      p_job_id: jobId,
      p_group_id: groupId && groupId !== "none" ? groupId : null,
      p_after: cursor ?? null,
      p_limit: limit + 1,
      p_no_group: groupId === "none",
    }),
  ) as { children: ChildRow[]; total: number; duplicates: number };
  const { items, nextCursor } = page(list.children, limit);
  const keys = await accessCodeCryptoKeys();
  const children = await Promise.all(items.map((row) => toChild(row, keys)));
  return NextResponse.json({
    children,
    nextCursor,
    total: list.total,
    duplicates: list.duplicates,
  });
});

/**
 * POST /api/v1/jobs/:id/children — owners, admins and photographers add a child. The server generates the access code
 * (CSPRNG), stores its hash and an encrypted copy, and tries a new code if one were ever taken.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const input = await parseBody(request, childInput);
  const { supabase, studio } = await studioScope();
  assertCanEditRoster(studio);
  await loadRosterJob(supabase, studio.id, jobId);
  const group = await assertGroupInJob(supabase, studio.id, jobId, input.groupId);
  const keys = await accessCodeCryptoKeys();
  for (let attempt = 0; ; attempt++) {
    const id = crypto.randomUUID();
    const code = await newAccessCode(studio.region, id, keys);
    const result = await supabase
      .from("children")
      .insert({
        id,
        studio_id: studio.id,
        job_id: jobId,
        ...childColumns(input),
        access_code_hash: code.hash,
        access_code_ciphertext: code.ciphertext,
      })
      .select(CHILD_COLUMNS)
      .single();
    if (isCodeTaken(result.error) && attempt < 2) continue;
    const row = check(result) as ChildRow;
    const roster = await loadRoster(supabase, studio.id, jobId);
    const child = await toChild(
      { ...row, group_name: group?.name ?? null, duplicate: isDuplicate(roster.children, id) },
      keys,
    );
    return NextResponse.json({ child }, { status: 201 });
  }
});
