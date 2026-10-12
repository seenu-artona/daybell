import type { PhotoDetailResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import { loadPhoto, previewUrl, toPhoto } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/photos/:id — one photo with its 400 px and 1600 px previews (studio only, signed for about an hour). */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const photoId = await pathId(ctx, "Photo not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const row = await loadPhoto(supabase, studio.id, photoId);
  const ready = row.status === "ready";
  const storage = photoStorage(studio.region);
  const ids = { studioId: studio.id, jobId: row.job_id, photoId };
  const body: PhotoDetailResponse = {
    photo: {
      ...toPhoto(row, ready ? await previewUrl(storage, ids, "thumb.webp") : null),
      viewUrl: ready ? await previewUrl(storage, ids, "view.webp") : null,
    },
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
