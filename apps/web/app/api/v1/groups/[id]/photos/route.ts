import { groupPageQuery, type TaggedPhotosResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseQuery } from "@/lib/api";
import { page } from "@/lib/jobs";
import { loadPhotoGroup } from "@/lib/photo-groups";
import { photoStorage } from "@/lib/photo-storage";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { type TaggedPhotoRow, toTaggedPhoto } from "@/lib/tagging";

export const runtime = "nodejs";
// The studio's previews: Canadian studios' photos are handled in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/groups/:id/photos — a group's photos out of the bin (card photos of a group upload aside: ADR 0030, call
 * 2), in tagging order, keyset by photo id, with signed 400 px previews (studio only).
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const groupId = await pathId(ctx, "Group not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const query = parseQuery(request, groupPageQuery);
  const group = await loadPhotoGroup(supabase, studio.id, groupId);
  const rows = (check(
    await supabase.rpc("photo_group_photos_page", {
      p_job_id: group.job_id,
      p_group_id: groupId,
      p_after: query.cursor ?? null,
      p_limit: query.limit + 1,
    }),
  ) ?? []) as TaggedPhotoRow[];
  const { items, nextCursor } = page(rows, query.limit);
  const storage = photoStorage(studio.region);
  const body: TaggedPhotosResponse = {
    photos: await Promise.all(
      items.map((row) => toTaggedPhoto(storage, { studioId: studio.id, jobId: group.job_id }, row)),
    ),
    nextCursor,
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
