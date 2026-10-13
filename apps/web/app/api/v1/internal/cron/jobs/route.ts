import type { CronJobsResponse } from "@daybell/api";
import { DATA_REGIONS, regionDatabase } from "@daybell/config";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { assertFunctionRegion } from "@/lib/region-guard";
import { jobSystemRpc } from "@/lib/supabase/service";
import { assertCron } from "@/lib/worker-auth";

export const runtime = "nodejs";
// Canadian studios' data is handled in Montréal (D113), like the photo clean-up.
export const preferredRegion = "yul1";
export const maxDuration = 60;

/** Stops starting new work after this long; whatever is left closes on the next run. */
const BUDGET_MS = 50_000;
const PAGE = 500;
const PRUNE = 1000;

/**
 * GET /api/v1/internal/cron/jobs — the jobs cron (ADR 0021): hourly from GitHub Actions and daily from Vercel Cron, with
 * CRON_SECRET. In every region that has a database, in that region's function region:
 * - closes every selling job whose closing date has passed (job.closed {scheduled: true}, no actor; the team hears
 *   through the bell), a page at a time;
 * - removes read notifications over 90 days old and any over 180 (Claude's call).
 * Answers counts only and logs nothing about studios or people.
 */
export const GET = handle(async (request: Request) => {
  assertCron(request);
  const started = Date.now();
  const inTime = () => Date.now() - started < BUDGET_MS;
  const totals: CronJobsResponse = { closedJobs: 0, prunedNotifications: 0 };

  for (const region of DATA_REGIONS) {
    if (!regionDatabase(region)) continue;
    assertFunctionRegion(region);
    while (inTime()) {
      const closed = Number(
        check(await jobSystemRpc(region, "close_due_jobs", { p_limit: PAGE })) ?? 0,
      );
      totals.closedJobs += closed;
      if (closed < PAGE) break;
    }
    if (inTime())
      totals.prunedNotifications += Number(
        check(await jobSystemRpc(region, "prune_notifications", { p_limit: PRUNE })) ?? 0,
      );
  }
  return NextResponse.json(totals);
});
