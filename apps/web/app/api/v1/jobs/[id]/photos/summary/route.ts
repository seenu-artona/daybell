import type { PhotoCountsResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/photos/summary — the job's photo counts, for the Photos tab and the Overview's Upload photos
 * to-do (done once a photo is ready). Counts only; row-level security keeps it to the caller's studio.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  await loadRosterJob(supabase, studio.id, jobId);
  const c = check(await supabase.rpc("job_photo_counts", { p_job_id: jobId })) as Record<
    string,
    number
  >;
  const body: PhotoCountsResponse = {
    counts: {
      photos: Number(c.photos ?? 0),
      ready: Number(c.ready ?? 0),
      processing: Number(c.processing ?? 0),
      failed: Number(c.failed ?? 0),
      uploading: Number(c.uploading ?? 0),
      binned: Number(c.binned ?? 0),
      uploads: Number(c.uploads ?? 0),
      duplicatesSkipped: Number(c.duplicates_skipped ?? 0),
    },
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
