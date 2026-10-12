import "server-only";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "@daybell/api";
import { type DataRegion, isDataRegion, regionDatabase } from "@daybell/config";
import { cronSecret, photoWorkerSecrets } from "@daybell/config/server";
import { verifyWorkerRequest, WORKER_REGION_HEADER, WORKER_SIGNATURE_HEADER } from "@daybell/core";
import { assertFunctionRegion, assertStorageRegion } from "./region-guard";

/**
 * Who may call the internal routes (ADR 0016): the image worker, by an HMAC-SHA256 signature over the time, region,
 * method, path and body; and Vercel Cron, by CRON_SECRET. Nobody signed in, and no browser. Refusals log a fixed
 * event name only.
 */

const REFUSED = () => new ApiError("not_signed_in", "Not allowed.");
/** A worker request's body is a small JSON result; anything bigger is refused before it is hashed. */
const MAX_WORKER_BODY = 4096;

export async function workerRequest(
  request: Request,
): Promise<{ region: DataRegion; body: string }> {
  const region = request.headers.get(WORKER_REGION_HEADER);
  if (!isDataRegion(region)) throw REFUSED();
  let secrets: string[];
  try {
    secrets = photoWorkerSecrets();
  } catch (err) {
    console.error("photo_worker_misconfigured", err instanceof Error ? err.message : "unknown");
    throw new ApiError("internal", "Something went wrong on our side.");
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_WORKER_BODY) throw REFUSED();
  const body = await request.text();
  if (body.length > MAX_WORKER_BODY) throw REFUSED();
  const ok = await verifyWorkerRequest(secrets, request.headers.get(WORKER_SIGNATURE_HEADER), {
    method: request.method,
    path: new URL(request.url).pathname,
    region,
    body,
  });
  if (!ok) {
    console.error("photo_worker_refused");
    throw REFUSED();
  }
  assertFunctionRegion(region);
  assertStorageRegion(region);
  if (!regionDatabase(region))
    throw new ApiError("region_unavailable", "That region isn't available.");
  return { region, body };
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Compared in constant time. */
export function assertCron(request: Request): void {
  let secret: string;
  try {
    secret = cronSecret();
  } catch (err) {
    console.error("cron_misconfigured", err instanceof Error ? err.message : "unknown");
    throw new ApiError("internal", "Something went wrong on our side.");
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    console.error("cron_refused");
    throw REFUSED();
  }
}
