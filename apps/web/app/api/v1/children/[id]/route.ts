import { ApiError, type ChildInput, childPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { accessCodeCryptoKeys } from "@/lib/access-codes";
import { check, handle, parseBody } from "@/lib/api";
import {
  assertCanRemoveFrom,
  assertGroupInJob,
  CHILD_COLUMNS,
  type ChildRow,
  childColumns,
  isDuplicate,
  loadRoster,
  loadRosterJob,
  pathId,
  toChild,
  validChild,
} from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/v1/children/:id — owners, admins and photographers change a child. The access code never changes. */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Child not found.");
  const { supabase, studio } = await studioScope();
  assertCanEditRoster(studio);
  const patch = await parseBody(request, childPatch);
  const current = check(
    await supabase
      .from("children")
      .select(CHILD_COLUMNS)
      .eq("studio_id", studio.id)
      .eq("id", id)
      .maybeSingle(),
  ) as ChildRow | null;
  if (!current) throw new ApiError("not_found", "Child not found.");
  // The child as it will be, checked as a whole.
  const next = validChild({
    firstName: current.first_name,
    lastName: current.last_name,
    groupId: current.group_id,
    studentId: current.student_id,
    grade: current.grade,
    parentEmail: current.parent_email,
    doNotPhotograph: current.do_not_photograph,
    doNotPublish: current.do_not_publish,
    ...patch,
  });
  const group = await assertGroupInJob(supabase, studio.id, current.job_id, next.groupId);
  const row = check(
    await supabase
      .from("children")
      .update(childColumns(next, Object.keys(patch) as (keyof ChildInput)[]))
      .eq("studio_id", studio.id)
      .eq("id", id)
      .select(CHILD_COLUMNS)
      .maybeSingle(),
  ) as ChildRow | null;
  if (!row) throw new ApiError("not_found", "Child not found.");
  const [keys, roster] = await Promise.all([
    accessCodeCryptoKeys(),
    loadRoster(supabase, studio.id, row.job_id),
  ]);
  const child = await toChild(
    { ...row, group_name: group?.name ?? null, duplicate: isDuplicate(roster.children, id) },
    keys,
  );
  return NextResponse.json({ child });
});

/**
 * DELETE /api/v1/children/:id — removes a child and their access code, only while the job is a draft (Seenu #12). The
 * database refuses it too.
 */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Child not found.");
  const { supabase, studio } = await studioScope();
  assertCanEditRoster(studio);
  const current = check(
    await supabase
      .from("children")
      .select("id, job_id")
      .eq("studio_id", studio.id)
      .eq("id", id)
      .maybeSingle(),
  ) as { id: string; job_id: string } | null;
  if (!current) throw new ApiError("not_found", "Child not found.");
  assertCanRemoveFrom(await loadRosterJob(supabase, studio.id, current.job_id));
  const result = await supabase
    .from("children")
    .delete()
    .eq("studio_id", studio.id)
    .eq("id", id)
    .select("id");
  // The job left draft between the check and the delete.
  if (result.error?.code === "23514")
    throw new ApiError("conflict", "Children can be removed only while the job is a draft.");
  const rows = check(result) ?? [];
  if (rows.length === 0) throw new ApiError("not_found", "Child not found.");
  return new NextResponse(null, { status: 204 });
});
