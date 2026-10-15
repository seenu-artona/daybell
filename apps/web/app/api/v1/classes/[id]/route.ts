import { ApiError, type ClassResponse, classPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import { CLASS_NAME_TAKEN, isClassNameTaken, pathId } from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";

/** PATCH /api/v1/classes/:id — owners, admins and photographers rename a class (C6: was /groups/:id). */
export const PATCH = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = await pathId(ctx, "Class not found.");
  const { supabase, studio } = await studioScope();
  assertCanEditRoster(studio);
  const input = await parseBody(request, classPatch);
  const result = await supabase
    .from("job_groups")
    .update({ name: input.name })
    .eq("studio_id", studio.id)
    .eq("id", id)
    .select("id, name")
    .maybeSingle();
  if (isClassNameTaken(result.error)) throw CLASS_NAME_TAKEN;
  const row = check(result) as { id: string; name: string } | null;
  if (!row) throw new ApiError("not_found", "Class not found.");
  // Only IDs in the URL: a head request that counts.
  const { count } = await supabase
    .from("children")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", studio.id)
    .eq("group_id", id);
  const body: ClassResponse = { class: { ...row, childCount: count ?? 0 } };
  return NextResponse.json(body);
});
