import type { PayoutLinkResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { loadPayoutAccountRow, NOT_CONNECTED } from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { payments } from "@/lib/stripe";
import { assertOwner, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/studio/payouts/dashboard-link — "Manage on Stripe" (Seenu, Q2): a single-use login link to the studio's
 * Stripe Express dashboard, where the owner changes the bank account. Once Stripe has their details. Never logged.
 */
export const POST = handle(async () => {
  const { supabase, studio } = await studioScope();
  assertOwner(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const row = await loadPayoutAccountRow(supabase, studio.id);
  if (!row?.details_submitted) throw NOT_CONNECTED();
  const link = await payments().createLoginLink(row.stripe_account_id);
  const body: PayoutLinkResponse = { url: link.url, expiresAt: null };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
