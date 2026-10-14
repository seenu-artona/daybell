import type { CronJobsResponse } from "@daybell/api";
import { DATA_REGIONS, regionDatabase } from "@daybell/config";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { runCheckoutBackstops } from "@/lib/checkout/cron";
import { runRefundBackstops } from "@/lib/orders/cron";
import { assertFunctionRegion, PAYOUT_REGIONS } from "@/lib/region-guard";
import { payments, paymentsConfigured } from "@/lib/stripe";
import { jobSystemRpc, orderSystemRpc } from "@/lib/supabase/service";
import { assertCron } from "@/lib/worker-auth";

export const runtime = "nodejs";
// Canadian studios' data is handled in Montréal (D113), like the photo clean-up.
export const preferredRegion = "yul1";
export const maxDuration = 60;

/** Stops starting new work after this long; whatever is left closes on the next run. */
const BUDGET_MS = 50_000;
const PAGE = 500;
const PRUNE = 1000;
const PURGE = 1000;

/**
 * GET /api/v1/internal/cron/jobs — the jobs cron (ADR 0021, 0024): hourly from Vercel Cron (CRON_SECRET; vercel.json,
 * the Pro plan). In every region that has a database, in that region's function region:
 * - closes every selling job whose closing date has passed (job.closed {scheduled: true}, no actor; the team hears
 *   through the bell), a page at a time;
 * - removes read notifications over 90 days old and any over 180 (Claude's call);
 * - removes expired shop sessions with their bags, and day-old wrong-code and hour-old request counts (ADR 0022), a
 *   page at a time until none are left or the region's time is up;
 * - removes home delivery addresses and tracking numbers 90 days after shipping, or after payment once cancelled or
 *   refunded, and 365 days after payment at most (ADR 0024; step 10's launch blocker), a page at a time;
 * - where payments are set up (a payout region with Stripe), settles paid orders whose Stripe fee came late and
 *   expires checkouts that ran out, after asking Stripe (ADR 0023; lib/checkout/cron.ts); retries refunds (sending
 *   back a failed refund's share), recovers refund shortfalls from later sales and absorbs those owed after 180 days
 *   without a settled sale (ADR 0024; lib/orders/cron.ts).
 * Each region gets an equal share of the time budget, so one region's backlog never starves the next (code review
 * S2). A region this function can't serve (its data must be handled in another function region, D113) is skipped and
 * logged by name, while the others still run; if no region could run, the request is refused as before (security
 * review nice-to-have 3: per-region routes once the US has its own function region).
 * Answers counts only and logs nothing about studios or people.
 */
export const GET = handle(async (request: Request) => {
  assertCron(request);
  const started = Date.now();
  const totals: CronJobsResponse = {
    closedJobs: 0,
    prunedNotifications: 0,
    prunedShop: 0,
    settledOrders: 0,
    expiredOrders: 0,
    retriedRefunds: 0,
    purgedAddresses: 0,
    absorbedShortfalls: 0,
  };
  const regions = DATA_REGIONS.filter((region) => regionDatabase(region));
  let ran = 0;
  let refusal: unknown = null;

  for (const [index, region] of regions.entries()) {
    try {
      assertFunctionRegion(region);
    } catch (err) {
      console.error("jobs_cron_region_skipped", region);
      refusal = err;
      continue;
    }
    ran += 1;
    // This region's share ends here; whatever it leaves closes on the next run.
    const until = started + (BUDGET_MS * (index + 1)) / regions.length;
    while (Date.now() < until) {
      const closed = Number(
        check(await jobSystemRpc(region, "close_due_jobs", { p_limit: PAGE })) ?? 0,
      );
      totals.closedJobs += closed;
      if (closed < PAGE) break;
    }
    if (Date.now() - started < BUDGET_MS) {
      totals.prunedNotifications += Number(
        check(await jobSystemRpc(region, "prune_notifications", { p_limit: PRUNE })) ?? 0,
      );
      // A page at a time until a page comes back short, within the region's share of the time (security review M2).
      while (Date.now() < until) {
        const pruned = Number(
          check(await jobSystemRpc(region, "prune_shop", { p_limit: PRUNE })) ?? 0,
        );
        totals.prunedShop += pruned;
        if (pruned < PRUNE) break;
      }
      while (Date.now() < until) {
        const purged = Number(
          check(await orderSystemRpc(region, "purge_shipping_addresses", { p_limit: PURGE })) ?? 0,
        );
        totals.purgedAddresses += purged;
        if (purged < PURGE) break;
      }
    }
    if (Date.now() < until && PAYOUT_REGIONS.includes(region) && paymentsConfigured()) {
      const done = await runCheckoutBackstops(region, payments(), until);
      totals.settledOrders += done.settledOrders;
      totals.expiredOrders += done.expiredOrders;
      if (Date.now() < until) {
        const refunds = await runRefundBackstops(region, payments(), until);
        totals.retriedRefunds += refunds.retriedRefunds;
        totals.absorbedShortfalls += refunds.absorbedShortfalls;
      }
    }
  }
  if (ran === 0 && refusal) throw refusal;
  return NextResponse.json(totals);
});
