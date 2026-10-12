import type { TaggingReviewedResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { assertCanUpload } from "@/lib/photos";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";
import { taggingResult } from "@/lib/tagging";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/tagging/review — Mark reviewed (Seenu, answer 4): only when tagging is clean (photos, nothing
 * still processing or untagged, no Leftovers, flags or blank cards to name; 409 tagging.notReady otherwise). Ticks the
 * checklist's Review tagging task until new photos, Leftovers or flags reopen it. Owners, admins and photographers.
 * Database only (no storage), like the roster. One tagging.reviewed event.
 */
export const POST = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  await loadRosterJob(supabase, studio.id, jobId);
  const reviewedAt = taggingResult<string>(
    await photoWriteRpc(studio.region, "mark_tagging_reviewed", userId, { p_job_id: jobId }),
  );
  const body: TaggingReviewedResponse = { reviewedAt: new Date(reviewedAt).toISOString() };
  return NextResponse.json(body);
});
