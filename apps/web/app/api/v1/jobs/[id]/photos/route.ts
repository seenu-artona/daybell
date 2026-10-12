import { type PhotosResponse, photoListQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseQuery } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import { type PhotoRow, previewUrl, toPhoto } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/photos — a page of the job's photos (or its bin) in tagging order (D142 answers 5 and 7), with
 * signed 400 px preview URLs for ready ones. The cursor is a photo's id, so no filename is ever in a URL. Everyone on
 * the team may look; previews are unwatermarked and for the studio only.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const query = parseQuery(request, photoListQuery);
  await loadRosterJob(supabase, studio.id, jobId);

  // One more than asked, to know whether there is a next page.
  const rows = (check(
    await supabase.rpc("job_photos_page", {
      p_job_id: jobId,
      p_after: query.cursor ?? null,
      p_limit: query.limit + 1,
      p_bin: query.bin,
      p_status: query.status ?? null,
    }),
  ) ?? []) as PhotoRow[];
  const page = rows.slice(0, query.limit);
  const storage = photoStorage(studio.region);
  const photos = await Promise.all(
    page.map(async (row) =>
      toPhoto(
        row,
        row.status === "ready"
          ? await previewUrl(storage, { studioId: studio.id, jobId, photoId: row.id }, "thumb.webp")
          : null,
      ),
    ),
  );
  const body: PhotosResponse = {
    photos,
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
