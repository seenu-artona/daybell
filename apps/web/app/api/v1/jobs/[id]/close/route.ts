import { jobStatusHandler } from "@/lib/job-status";

/**
 * POST /api/v1/jobs/:id/close — Close shop (ADR 0021, call 2): a selling job closes now and its closing date goes
 * (409 jobs.notSelling otherwise). One job.closed event.
 */
export const POST = jobStatusHandler("close_job");
