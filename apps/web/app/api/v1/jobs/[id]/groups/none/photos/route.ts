import { groupPageQuery, type TaggedPhotosResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseQuery } from "@/lib/api";
import { page } from "@/lib/jobs";
import { photoStorage } from "@/lib/photo-storage";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { type TaggedPhotoRow, toTaggedPhoto } from "@/lib/tagging";

export const runtime = "nodejs";
// The studio's previews: Canadian studios' photos are handled in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/groups/none/photos — Not in a group (C2; ADR 0030, call 1): group photos in no group, such as
 * class photos from before groups. No parent sees them until they are put in a group. Tagging order, keyset by photo
 * id, signed 400 px previews (studio only).
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const query = parseQuery(request, groupPageQuery);
  await loadRosterJob(supabase, studio.id, jobId);
  const rows = (check(
    await supabase.rpc("photo_group_photos_page", {
      p_job_id: jobId,
      p_group_id: null,
      p_after: query.cursor ?? null,
      p_limit: query.limit + 1,
    }),
  ) ?? []) as TaggedPhotoRow[];
  const { items, nextCursor } = page(rows, query.limit);
  const storage = photoStorage(studio.region);
  const body: TaggedPhotosResponse = {
    photos: await Promise.all(
      items.map((row) => toTaggedPhoto(storage, { studioId: studio.id, jobId }, row)),
    ),
    nextCursor,
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
