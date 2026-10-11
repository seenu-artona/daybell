import { ApiError, rosterImportInput } from "@daybell/api";
import { countNewGroups, planRosterImport } from "@daybell/core";
import { NextResponse } from "next/server";
import { accessCodeCryptoKeys, newAccessCode } from "@/lib/access-codes";
import { check, handle, parseBody } from "@/lib/api";
import {
  importRpcRows,
  importSummary,
  isRpcError,
  loadRoster,
  loadRosterJob,
  pathId,
  rosterDrafts,
} from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";

/**
 * POST /api/v1/jobs/:id/children/import — the confirmed rows of a roster file (the file itself never leaves the
 * browser, D113). The plan (adds, updates by student ID, duplicates) is made here from the current roster; with dryRun
 * nothing is saved. Otherwise every row is saved in one transaction by import_roster.
 */
export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const jobId = await pathId(ctx, "Job not found.");
  const input = await parseBody(request, rosterImportInput);
  const { supabase, studio } = await studioScope();
  assertCanEditRoster(studio);
  await loadRosterJob(supabase, studio.id, jobId);
  const drafts = rosterDrafts(input.rows);

  const makePlan = async () => {
    const roster = await loadRoster(supabase, studio.id, jobId);
    return {
      plan: planRosterImport(roster.children, drafts),
      groupsAdded: countNewGroups(
        roster.groups.map((g) => g.name),
        drafts,
      ),
    };
  };
  let current = await makePlan();
  if (input.dryRun)
    return NextResponse.json(importSummary(current.plan, current.groupsAdded, true));

  const keys = await accessCodeCryptoKeys();
  let collisions = 0;
  let replanned = false;
  for (;;) {
    const rows = await importRpcRows(drafts, current.plan, (id) =>
      newAccessCode(studio.region, id, keys),
    );
    const result = await supabase.rpc("import_roster", { p_job_id: jobId, p_rows: rows });
    if (isRpcError(result.error, "access_code_collision") && ++collisions < 3) continue;
    if (isRpcError(result.error, "roster_changed") && !replanned) {
      // A matched child was removed meanwhile: plan again from the roster as it is now.
      replanned = true;
      current = await makePlan();
      continue;
    }
    if (
      isRpcError(result.error, "access_code_collision") ||
      isRpcError(result.error, "roster_changed")
    )
      throw new ApiError(
        "conflict",
        "The roster changed while importing. Please check the rows again.",
      );
    const saved = check(result) as { added: number; updated: number; groups_added: number };
    return NextResponse.json({
      ...importSummary(current.plan, saved.groups_added, false),
      added: saved.added,
      updated: saved.updated,
    });
  }
});
