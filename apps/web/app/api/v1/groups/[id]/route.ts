import { ApiError, groupPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import { GROUP_NAME_TAKEN, isGroupNameTaken, pathId } from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";

/** PATCH /api/v1/groups/:id — owners, admins and photographers rename a class, team or group. */
export const PATCH = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = await pathId(ctx, "Group not found.");
  const input = await parseBody(request, groupPatch);
  const { supabase, studio } = await studioScope();
  assertCanEditRoster(studio);
  const result = await supabase
    .from("job_groups")
    .update({ name: input.name })
    .eq("studio_id", studio.id)
    .eq("id", id)
    .select("id, name")
    .maybeSingle();
  if (isGroupNameTaken(result.error)) throw GROUP_NAME_TAKEN;
  const row = check(result) as { id: string; name: string } | null;
  if (!row) throw new ApiError("not_found", "Group not found.");
  // Only IDs in the URL: a head request that counts.
  const { count } = await supabase
    .from("children")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", studio.id)
    .eq("group_id", id);
  return NextResponse.json({ group: { ...row, childCount: count ?? 0 } });
});
