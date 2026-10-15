import { rosterImportInput } from "@daybell/api";
import { countNewClasses, planRosterImport } from "@daybell/core";
import { NextResponse } from "next/server";
import { accessCodeCryptoKeys, newAccessCode } from "@/lib/access-codes";
import { handle, parseBody } from "@/lib/api";
import { assertFunctionRegion } from "@/lib/region-guard";
import {
  importRpcRows,
  importSummary,
  loadRoster,
  loadRosterJob,
  pathId,
  rosterDrafts,
  saveImport,
} from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";
import { codeWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
// Names and classes of a Canadian studio's children are handled in Montréal (D113), like the rest of the roster.
export const preferredRegion = "yul1";

/**
 * POST /api/v1/jobs/:id/children/import — the confirmed rows of a roster file (the file itself never leaves the
 * browser, D113). The plan (adds, updates by student ID, duplicates) is made here from the current roster; with dryRun
 * nothing is saved. Otherwise every row is saved in one transaction by import_roster, which only the server can run
 * (ADR 0011).
 */
export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const jobId = await pathId(ctx, "Job not found.");
  // Who and what role first: nobody else gets as far as reading the body (S4).
  const { supabase, studio, userId } = await studioScope();
  assertFunctionRegion(studio.region);
  assertCanEditRoster(studio);
  const input = await parseBody(request, rosterImportInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const drafts = rosterDrafts(input.rows);

  const makePlan = async () => {
    const roster = await loadRoster(supabase, studio.id, jobId);
    return {
      plan: planRosterImport(roster.children, drafts),
      classesAdded: countNewClasses(
        roster.classes.map((g) => g.name),
        drafts,
      ),
    };
  };
  const first = await makePlan();
  if (input.dryRun) return NextResponse.json(importSummary(first.plan, first.classesAdded, true));

  const keys = await accessCodeCryptoKeys();
  // Saved by the server-only import_roster, acting for the signed-in person (ADR 0011).
  const { plan, data } = await saveImport({
    plan: first,
    replan: makePlan,
    send: async (current) =>
      codeWriteRpc(studio.region, "import_roster", userId, {
        p_job_id: jobId,
        p_rows: await importRpcRows(drafts, current.plan, (id) =>
          newAccessCode(studio.region, id, keys),
        ),
      }),
  });
  const saved = data as { added: number; updated: number; groups_added: number };
  return NextResponse.json({
    ...importSummary(plan.plan, saved.groups_added, false),
    added: saved.added,
    updated: saved.updated,
  });
});
