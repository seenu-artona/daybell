import type { TaggingSummaryResponse } from "@daybell/api";
import {
  canMarkReviewed,
  notReviewableReason,
  reviewTaggingDone,
  type TaggingFacts,
} from "@daybell/core";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import { previewUrl } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Canadian studios' photos are handled in Montréal (D113; ADR 0016).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

interface Overview {
  photos: number;
  processing: number;
  failed: number;
  untagged_batches: number;
  leftovers: number;
  flagged: number;
  blank_cards: number;
  card_photos: number;
  reviewed_at: string | null;
  no_photos: number;
  albums: {
    group_id: string;
    name: string;
    children: number;
    children_with_photos: number;
    photos: number;
    class_photos: number;
  }[];
  no_group: { children: number; children_with_photos: number; photos: number };
}

/**
 * GET /api/v1/jobs/:id/tagging — the review screen's summary (ADR 0018): counts, whether Mark reviewed is possible and
 * why not (packages/core's rules), the review state, each class's album and the blank cards whose child is still to be
 * named, with a signed preview of each card's photo. Everyone on the team may look (staff read-only, plan answer 10);
 * row-level security keeps it to the caller's studio. Ids and counts in the URL only.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  await loadRosterJob(supabase, studio.id, jobId);

  const [overview, blanks] = await Promise.all([
    supabase.rpc("job_tagging_overview", { p_job_id: jobId }),
    supabase.rpc("tagging_blank_cards", { p_job_id: jobId }),
  ]);
  const o = check(overview) as Overview;
  const blankRows = (check(blanks) ?? []) as {
    card_id: string;
    photos: number;
    card_photo_id: string | null;
  }[];

  const ready = Number(o.photos) - Number(o.processing) - Number(o.failed);
  const facts: TaggingFacts = {
    hasReadyPhoto: ready > 0,
    taggingPending: Number(o.processing) > 0 || Number(o.untagged_batches) > 0,
    leftovers: Number(o.leftovers),
    flagged: Number(o.flagged),
    blankCardsPending: Number(o.blank_cards),
    taggingReviewed: o.reviewed_at !== null,
  };
  const storage = photoStorage(studio.region);
  const body: TaggingSummaryResponse = {
    tagging: {
      photos: Number(o.photos),
      processing: Number(o.processing),
      failed: Number(o.failed),
      pending: facts.taggingPending,
      leftovers: facts.leftovers,
      flagged: facts.flagged,
      blankCards: facts.blankCardsPending,
      cardPhotos: Number(o.card_photos),
      noPhotos: Number(o.no_photos),
      reviewedAt: o.reviewed_at,
      canMarkReviewed: canMarkReviewed(facts),
      notReviewable: notReviewableReason(facts),
      done: reviewTaggingDone(facts),
      albums: [
        ...o.albums.map((a) => ({
          groupId: a.group_id,
          name: a.name,
          children: Number(a.children),
          childrenWithPhotos: Number(a.children_with_photos),
          photos: Number(a.photos),
          classPhotos: Number(a.class_photos),
        })),
        ...(Number(o.no_group.children) > 0
          ? [
              {
                groupId: null,
                name: null,
                children: Number(o.no_group.children),
                childrenWithPhotos: Number(o.no_group.children_with_photos),
                photos: Number(o.no_group.photos),
                classPhotos: 0,
              },
            ]
          : []),
      ],
      blankCardGroups: await Promise.all(
        blankRows.map(async (b) => ({
          cardId: b.card_id,
          photos: Number(b.photos),
          cardPhotoId: b.card_photo_id,
          cardPhotoUrl: b.card_photo_id
            ? await previewUrl(
                storage,
                { studioId: studio.id, jobId, photoId: b.card_photo_id },
                "thumb.webp",
              )
            : null,
        })),
      ),
    },
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
