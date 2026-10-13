import "server-only";
import type { JobResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "./api";
import { changeJobStatus, loadJobRow, toJob } from "./jobs";
import { pathId } from "./roster";
import { assertCanManage, studioScope } from "./studio";
import type { JobStatusRpc } from "./supabase/service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/start-selling, /close and /reopen (ADR 0021, calls 1 and 2): owners and admins only, refused
 * before anything is read; the job must be the studio's (another studio's is not found, D96); the database function
 * checks the role again and, for selling, everything the Start selling dialog lists, in one transaction. Returns the
 * job as it now is. Database only, like editing a job: no region pin (ADR 0017's precedent). Logs nothing.
 */
export function jobStatusHandler(fn: JobStatusRpc) {
  return handle(async (_request: Request, ctx: Ctx) => {
    const id = await pathId(ctx, "Job not found.");
    const { supabase, studio, userId } = await studioScope();
    assertCanManage(studio);
    await loadJobRow(supabase, studio.id, id);
    await changeJobStatus(studio.region, fn, userId, id);
    const body: JobResponse = { job: toJob(await loadJobRow(supabase, studio.id, id)) };
    return NextResponse.json(body);
  });
}
