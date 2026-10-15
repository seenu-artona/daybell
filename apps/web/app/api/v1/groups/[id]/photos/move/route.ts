import { type GroupPhotosMovedResponse, moveGroupPhotosInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { groupResult, loadPhotoGroup } from "@/lib/photo-groups";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { groupWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/groups/:id/photos/move — Move to group (D156): up to 500 of this group's photos join toGroupId and leave
 * this group, only by hand. A photo not in this group, or a group of another job, is groups.notInJob. Owners, admins
 * and photographers. One photo_group.photos_moved event, ids only.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const groupId = await pathId(ctx, "Group not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, moveGroupPhotosInput);
  const group = await loadPhotoGroup(supabase, studio.id, groupId);
  const moved = groupResult<number>(
    await groupWriteRpc(studio.region, "move_group_photos", userId, {
      p_job_id: group.job_id,
      p_from: groupId,
      p_to: input.toGroupId,
      p_photo_ids: input.photoIds,
    }),
  );
  const body: GroupPhotosMovedResponse = { moved };
  return NextResponse.json(body);
});
