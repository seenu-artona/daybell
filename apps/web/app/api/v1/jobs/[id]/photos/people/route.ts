import { ApiError, type PhotoPeopleResponse, photoPeopleQuery } from "@daybell/api";
import { PERSON_STRIP_PHOTOS } from "@daybell/core";
import { NextResponse } from "next/server";
import { check, handle, parseQuery } from "@/lib/api";
import { page } from "@/lib/jobs";
import { loadPhotoGroup, type PersonRow, toPhotoPerson } from "@/lib/photo-groups";
import { photoStorage } from "@/lib/photo-storage";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Names and the studio's previews: Canadian studios' photos and rosters are handled in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/photos/people — Photos' People view (D156, C15): everyone with photos, by last name, 50 at a
 * time, each with their first 12 photos (the first card photo first) as signed 400 px previews (studio only). With
 * groupId, only one of the job's groups' members. Read through row-level security; ids only in the URL.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const query = parseQuery(request, photoPeopleQuery);
  await loadRosterJob(supabase, studio.id, jobId);
  if (query.groupId) {
    const group = await loadPhotoGroup(supabase, studio.id, query.groupId);
    if (group.job_id !== jobId) throw new ApiError("not_found", "Group not found.");
  }
  const data = check(
    await supabase.rpc("photo_people", {
      p_job_id: jobId,
      p_group_id: query.groupId ?? null,
      p_after: query.cursor ?? null,
      // One more than asked, to know whether there is a next page.
      p_limit: query.limit + 1,
      p_strip: PERSON_STRIP_PHOTOS,
    }),
  ) as { people: PersonRow[]; total: number } | null;
  const { items, nextCursor } = page(data?.people ?? [], query.limit);
  const storage = photoStorage(studio.region);
  const body: PhotoPeopleResponse = {
    people: await Promise.all(
      items.map((row) => toPhotoPerson(storage, { studioId: studio.id, jobId }, row)),
    ),
    nextCursor,
    total: Number(data?.total ?? 0),
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
