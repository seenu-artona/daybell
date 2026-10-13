import { jobStatusHandler } from "@/lib/job-status";

/**
 * POST /api/v1/jobs/:id/start-selling — a draft's shop opens (D75, D143; ADR 0021, call 1), once the roster, a ready
 * photo, reviewed tagging, a price list with an item and Active payouts are all there (409 jobs.notReady naming what is
 * missing otherwise). One job.selling event; the rest of the team hears through the bell.
 */
export const POST = jobStatusHandler("start_selling");
