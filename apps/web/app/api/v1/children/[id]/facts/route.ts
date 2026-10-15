import { ApiError, type ChildFactsResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/children/:id/facts — for a person's record on a job's Subjects tab (D153; ADR 0029): when their QR card
 * was first printed and the camera's clock at their first photo (no zone). Dates only, no personal data. Read as the person
 * (child_record_facts is SECURITY INVOKER) and filtered by the caller's studio: another studio's person is not found.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Child not found.");
  const { supabase, studio } = await studioScope();
  const rows = (check(
    await supabase.rpc("child_record_facts", { p_studio_id: studio.id, p_child_id: id }),
  ) ?? []) as { card_printed_at: string | null; photographed_at: string | null }[];
  const row = rows[0];
  if (!row) throw new ApiError("not_found", "Child not found.");
  const body: ChildFactsResponse = {
    facts: {
      cardPrintedAt: row.card_printed_at,
      // PostgREST writes a timestamp without zone as "2026-11-02T09:15:00"; keep it zone-free (the camera's clock).
      photographedAt: row.photographed_at
        ? row.photographed_at.replace(" ", "T").slice(0, 19)
        : null,
    },
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
