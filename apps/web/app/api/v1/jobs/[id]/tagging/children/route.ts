import { type TaggingChildrenResponse, taggingChildrenQuery } from "@daybell/api";
import { REVIEW_STRIP_PHOTOS } from "@daybell/core";
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

interface ChildRow {
  id: string;
  first_name: string;
  last_name: string;
  group_id: string | null;
  do_not_photograph: boolean;
  photos: number;
  strip: TaggedPhotoRow[];
}

/**
 * GET /api/v1/jobs/:id/tagging/children — an album's children on the review screen (Seenu, answer 5): a class
 * (groupId) or the children without one (noGroup=true), by name, each with a count and a strip of their first photos
 * (card photos included, labelled on screen), signed for the studio only. Names travel in the body, never the URL.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const query = parseQuery(request, taggingChildrenQuery);
  await loadRosterJob(supabase, studio.id, jobId);

  const rows = (check(
    await supabase.rpc("tagging_children", {
      p_job_id: jobId,
      p_group_id: query.groupId ?? null,
      p_no_group: query.noGroup,
      p_after: query.cursor ?? null,
      p_limit: query.limit + 1,
      p_strip: REVIEW_STRIP_PHOTOS,
    }),
  ) ?? []) as ChildRow[];
  const page = rows.slice(0, query.limit);
  const storage = photoStorage(studio.region);
  const ids = { studioId: studio.id, jobId };
  const body: TaggingChildrenResponse = {
    children: await Promise.all(
      page.map(async (c) => ({
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        groupId: c.group_id,
        doNotPhotograph: c.do_not_photograph,
        photos: Number(c.photos),
        strip: await Promise.all(
          c.strip.map((row) => toTaggedPhoto(storage, ids, { ...row, child_id: c.id })),
        ),
      })),
    ),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
