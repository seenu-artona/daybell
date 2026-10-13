import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { loadStudioTaxes } from "@/lib/checkout/taxes";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { assertCanSeePayouts, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Canadian studios' payment settings are handled in Montréal (D113).
export const preferredRegion = "yul1";

/**
 * GET /api/v1/studio/taxes — Settings › Taxes (ADR 0023; answer 2): the business address's province and the active
 * registrations. Owners and admins, Canadian studios only for now (like payouts). Daybell's copy only: no Stripe call.
 */
export const GET = handle(async () => {
  const { supabase, studio } = await studioScope();
  assertCanSeePayouts(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  return NextResponse.json(await loadStudioTaxes(supabase, studio), {
    headers: { "cache-control": "private, no-store" },
  });
});
