import { type TaggedPhotosResponse, taggingPhotosQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseQuery } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { type TaggedPhotoRow, toTaggedPhoto } from "@/lib/tagging";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

const PLACE_TO_DB = {
  leftovers: "leftovers",
  flagged: "flagged",
  child: "child",
  classSet: "class_set",
  blankCard: "blank_card",
} as const;

/**
 * GET /api/v1/jobs/:id/tagging/photos — a page of the photos in one place on the review screen (ADR 0018): Leftovers,
 * flagged photos, a child's (with their card photos), a class's Class photo set, or a blank card's. In tagging order,
 * keyset by photo id, with signed 400 px previews (studio only). Only ids go in the URL.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const query = parseQuery(request, taggingPhotosQuery);
  await loadRosterJob(supabase, studio.id, jobId);

  // One more than asked, to know whether there is a next page.
  const rows = (check(
    await supabase.rpc("tagging_photos", {
      p_job_id: jobId,
      p_place: PLACE_TO_DB[query.place],
      p_id: query.id ?? null,
      p_after: query.cursor ?? null,
      p_limit: query.limit + 1,
    }),
  ) ?? []) as TaggedPhotoRow[];
  const page = rows.slice(0, query.limit);
  const storage = photoStorage(studio.region);
  const body: TaggedPhotosResponse = {
    photos: await Promise.all(
      page.map((row) => toTaggedPhoto(storage, { studioId: studio.id, jobId }, row)),
    ),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
