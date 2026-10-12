import { regionDatabase } from "@daybell/config";
import { photoPrefix } from "@daybell/core";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import { photoResult } from "@/lib/photos";
import { assertFunctionRegion, STORAGE_REGIONS } from "@/lib/region-guard";
import { photoSystemRpc } from "@/lib/supabase/service";
import { assertCron } from "@/lib/worker-auth";

export const runtime = "nodejs";
export const preferredRegion = "yul1";
export const maxDuration = 300;

/** Stops starting new work after this long, so a big day finishes tomorrow instead of timing out half-way. */
const BUDGET_MS = 240_000;
const PAGE = 200;

type Row = { id: string; studio_id: string; job_id: string; upload_id?: string | null };
const prefixOf = (r: Row) => photoPrefix({ studioId: r.studio_id, jobId: r.job_id, photoId: r.id });

/**
 * GET /api/v1/internal/cron/photos — the daily photo clean-up (Vercel Cron, CRON_SECRET; ADR 0016), in each region
 * with photo storage, in that region:
 * - finishes batches idle for a day (their photos.uploaded event);
 * - drops uploads never finished after 7 days (storage aborts their parts after 7 days too);
 * - deletes photos in the bin for more than 30 days (Seenu, answer 7): every stored version first, then the row, so a
 *   failure never leaves objects without a row. One photos.purged event per job.
 * Logs photo ids only, and only when something fails.
 */
export const GET = handle(async (request: Request) => {
  assertCron(request);
  const started = Date.now();
  const inTime = () => Date.now() - started < BUDGET_MS;
  const totals = { finishedBatches: 0, droppedUploads: 0, purgedPhotos: 0 };

  for (const region of STORAGE_REGIONS) {
    if (!regionDatabase(region)) continue;
    assertFunctionRegion(region);
    const storage = photoStorage(region);

    totals.finishedBatches += photoResult<number>(
      await photoSystemRpc(region, "finish_idle_batches", {}),
    );

    while (inTime()) {
      const rows = photoResult<Row[]>(
        await photoSystemRpc(region, "abandoned_uploads", { p_limit: PAGE }),
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        if (row.upload_id)
          await storage.abort(`${prefixOf(row)}original`, row.upload_id).catch(() => {
            console.error("photo_abort_failed", row.id);
          });
        // An upload completed but never marked leaves an object behind: it goes too.
        await storage.deleteAllVersions(prefixOf(row)).catch(() => {
          console.error("photo_abort_failed", row.id);
        });
      }
      totals.droppedUploads += photoResult<number>(
        await photoSystemRpc(region, "delete_abandoned_uploads", {
          p_photo_ids: rows.map((r) => r.id),
        }),
      );
      if (rows.length < PAGE) break;
    }

    while (inTime()) {
      // Marked as purging first, so nobody restores a photo whose objects are being deleted.
      const rows = photoResult<Row[]>(
        await photoSystemRpc(region, "begin_photo_purge", { p_limit: PAGE }),
      );
      if (rows.length === 0) break;
      const deleted: string[] = [];
      for (const row of rows) {
        try {
          await storage.deleteAllVersions(prefixOf(row));
          deleted.push(row.id);
        } catch {
          console.error("photo_purge_failed", row.id);
        }
      }
      if (deleted.length === 0) break;
      totals.purgedPhotos += photoResult<number>(
        await photoSystemRpc(region, "delete_purged_photos", { p_photo_ids: deleted }),
      );
      if (rows.length < PAGE) break;
    }
  }
  return NextResponse.json(totals);
});
