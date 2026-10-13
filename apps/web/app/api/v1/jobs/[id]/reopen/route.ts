import { jobStatusHandler } from "@/lib/job-status";

/**
 * POST /api/v1/jobs/:id/reopen — Reopen shop (ADR 0021, call 2): a closed job sells again, with Start selling's checks
 * (409 jobs.notReady or jobs.notClosed). Never back to draft. One job.selling event.
 */
export const POST = jobStatusHandler("reopen_job");
