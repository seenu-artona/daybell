import { type GroupsMadeResponse, groupsFromColumnInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { groupResult } from "@/lib/photo-groups";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { groupWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
// Reads the roster's classes and grades: Canadian studios' are handled in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/groups/from-column — Make groups from a column (C3): one group per value of a roster column (class, grade, first or last name, student ID; ADR 0030, call 9), its
 * people as members, once (D156: a shortcut, not a switch). Names already used by a group are skipped; blank values make
 * no group; all or nothing (groups.limit). Owners, admins and photographers.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, groupsFromColumnInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const made = groupResult<{ groups: number; members: number; skipped: number }>(
    await groupWriteRpc(studio.region, "make_photo_groups_from_column", userId, {
      p_job_id: jobId,
      p_column: input.column,
    }),
  );
  const body: GroupsMadeResponse = {
    made: Number(made.groups),
    members: Number(made.members),
    skipped: Number(made.skipped),
  };
  return NextResponse.json(body);
});
