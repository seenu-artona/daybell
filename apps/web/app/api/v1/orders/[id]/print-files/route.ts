import { handle } from "@/lib/api";
import { printFiles } from "@/lib/orders/zips";
import { pathId } from "@/lib/roster";
import { assertCanSeeOrders, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Canadian photos are read in Montréal from ca-central-1 (D113); a zip of 500 full-resolution files takes a while.
export const preferredRegion = "yul1";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/orders/:id/print-files — the order's print files as a zip for the studio's own printing (ADR 0024;
 * owners, admins and staff): each line left to print as <reference>-<line>-<size>-x<quantity>.jpg and a manifest.csv
 * with no names. 409 with Retry-After while a file is being made; at most 10 zips a person an hour.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const { studio, userId } = await studioScope();
  assertCanSeeOrders(studio);
  const id = await pathId(ctx, "Order not found.");
  return printFiles(studio.region, userId, studio.id, id, request.signal);
});
