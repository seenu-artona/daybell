import type { PhotoDetailResponse } from "@daybell/api";
import { reviewActions } from "@daybell/core";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import { loadPhoto, previewUrl, toPhoto } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { flagFromDb, placeFromDb, qrKindOf } from "@/lib/tagging";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/photos/:id — one photo with its 400 px and 1600 px previews (studio only, signed for about an hour), and
 * where tagging (or a person) put it with what review allows, for the panel's Give to a person (C13; ADR 0030). Read
 * through row-level security: another studio's photo is not found.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const photoId = await pathId(ctx, "Photo not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const row = await loadPhoto(supabase, studio.id, photoId);
  const [tag, qr] = await Promise.all([
    supabase
      .from("photo_tags")
      .select("place, flag, source")
      .eq("studio_id", studio.id)
      .eq("photo_id", photoId)
      .maybeSingle(),
    supabase
      .from("photos")
      .select("qr_kind, qr_card_id")
      .eq("studio_id", studio.id)
      .eq("id", photoId)
      .maybeSingle(),
  ]);
  const tagRow = check(tag) as {
    place: string;
    flag: string | null;
    source: "auto" | "manual";
  } | null;
  const qrRow = check(qr) as { qr_kind: string | null; qr_card_id: string | null } | null;
  const ready = row.status === "ready";
  const storage = photoStorage(studio.region);
  const ids = { studioId: studio.id, jobId: row.job_id, photoId };
  const status = row.status === "uploading" ? "processing" : row.status;
  const tagging = tagRow
    ? (() => {
        const place = placeFromDb(tagRow.place);
        const flag = flagFromDb(tagRow.flag);
        const qrKind = qrKindOf({
          qr_kind: qrRow?.qr_kind ?? null,
          qr_card: qrRow?.qr_card_id !== null && qrRow?.qr_card_id !== undefined,
        });
        return {
          place,
          flag,
          actions: reviewActions({
            status,
            place,
            flag,
            qrKind,
            manual: tagRow.source === "manual",
          }),
        };
      })()
    : null;
  const body: PhotoDetailResponse = {
    photo: {
      ...toPhoto(row, ready ? await previewUrl(storage, ids, "thumb.webp") : null),
      viewUrl: ready ? await previewUrl(storage, ids, "view.webp") : null,
      // A photo in the bin is restored before anything else happens to it.
      tagging: row.binned_at ? null : tagging,
    },
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
