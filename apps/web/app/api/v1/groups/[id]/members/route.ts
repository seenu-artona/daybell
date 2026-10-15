import {
  type GroupMembersChangedResponse,
  type GroupMembersResponse,
  groupMembersInput,
  groupPageQuery,
} from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody, parseQuery } from "@/lib/api";
import { page } from "@/lib/jobs";
import { groupResult, loadPhotoGroup, type MemberRow, toGroupMember } from "@/lib/photo-groups";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { groupWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
// People's names: Canadian studios' rosters are read in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/groups/:id/members — a group's members by last name, in pages; ids only in the URL. */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const groupId = await pathId(ctx, "Group not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  const query = parseQuery(request, groupPageQuery);
  await loadPhotoGroup(supabase, studio.id, groupId);
  const rows = (check(
    await supabase.rpc("list_photo_group_members", {
      p_group_id: groupId,
      p_after: query.cursor ?? null,
      p_limit: query.limit + 1,
    }),
  ) ?? []) as MemberRow[];
  const { items, nextCursor } = page(rows, query.limit);
  const body: GroupMembersResponse = { members: items.map(toGroupMember), nextCursor };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});

/**
 * POST /api/v1/groups/:id/members — Add or remove people (D156): up to 500 of the job's children each way. Someone of
 * another job is groups.notInJob. Owners, admins and photographers (C11). One members_changed event, counts only.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const groupId = await pathId(ctx, "Group not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, groupMembersInput);
  await loadPhotoGroup(supabase, studio.id, groupId);
  const changed = groupResult<{ added: number; removed: number; count: number }>(
    await groupWriteRpc(studio.region, "set_photo_group_members", userId, {
      p_group_id: groupId,
      p_add: input.add,
      p_remove: input.remove,
    }),
  );
  const body: GroupMembersChangedResponse = {
    added: Number(changed.added),
    removed: Number(changed.removed),
    members: Number(changed.count),
  };
  return NextResponse.json(body);
});
