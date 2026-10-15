import {
  deleteGroupQuery,
  type GroupDeletedResponse,
  type PhotoGroupResponse,
  photoGroupPatch,
} from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody, parseQuery } from "@/lib/api";
import { groupResult, loadPhotoGroup, readPhotoGroup } from "@/lib/photo-groups";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { groupWriteRpc } from "@/lib/supabase/service";
import { tagDueBatchesOfJob } from "@/lib/tagging";

export const runtime = "nodejs";
// Groups name the job's people: Canadian studios' are handled in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/groups/:id — one of the studio's photo groups (another studio's is not found). */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const groupId = await pathId(ctx, "Group not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  const group = await loadPhotoGroup(supabase, studio.id, groupId);
  const body: PhotoGroupResponse = { group: await readPhotoGroup(supabase, group.job_id, groupId) };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});

/**
 * PATCH /api/v1/groups/:id — renames a group. Owners, admins and photographers (C11), before the body is read; unique
 * per job ignoring case (groups.nameTaken). One photo_group.updated event with the field's name only.
 */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const groupId = await pathId(ctx, "Group not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, photoGroupPatch);
  const group = await loadPhotoGroup(supabase, studio.id, groupId);
  groupResult(
    await groupWriteRpc(studio.region, "rename_photo_group", userId, {
      p_group_id: groupId,
      p_name: input.name,
    }),
  );
  const body: PhotoGroupResponse = { group: await readPhotoGroup(supabase, group.job_id, groupId) };
  return NextResponse.json(body);
});

/**
 * DELETE /api/v1/groups/:id?photosTo=group&targetId= | ?photosTo=bin — deletes a group (C4; ADR 0030, call 3): its
 * members leave with it; its photos go to another group of the job, or to the bin (only those in no other group). A
 * group with photos needs photosTo (groups.hasPhotos); a sold photo is never binned (groups.photoSold, nothing changes).
 * Binned photos' uploads are tagged again before it answers.
 */
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const groupId = await pathId(ctx, "Group not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  const query = parseQuery(request, deleteGroupQuery);
  const group = await loadPhotoGroup(supabase, studio.id, groupId);
  const result = groupResult<{ moved: number; binned: number }>(
    await groupWriteRpc(studio.region, "delete_photo_group", userId, {
      p_group_id: groupId,
      p_photos_to: query.photosTo ?? null,
      p_target: query.targetId ?? null,
    }),
  );
  // Before answering, as after naming a blank card's child: it never throws, and logs batch ids only.
  if (result.binned > 0) await tagDueBatchesOfJob(supabase, studio.region, studio.id, group.job_id);
  const body: GroupDeletedResponse = { moved: Number(result.moved), binned: Number(result.binned) };
  return NextResponse.json(body);
});
