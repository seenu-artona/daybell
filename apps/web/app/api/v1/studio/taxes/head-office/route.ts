import { taxHeadOfficeInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import {
  assertCanManageTaxes,
  loadStudioTaxes,
  TAXES_NOT_CONNECTED,
  taxResult,
} from "@/lib/checkout/taxes";
import { loadPayoutAccountRow, takeStripeCall } from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { payments } from "@/lib/stripe";
import { studioScope } from "@/lib/studio";
import { taxWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * PUT /api/v1/studio/taxes/head-office — the studio's business address, sent to Stripe as its tax head office (call
 * 3); Daybell keeps its province only. The owner (call 6). Stripe first, then saved. Never logged.
 */
export const PUT = handle(async (request: Request) => {
  const { supabase, studio, userId } = await studioScope();
  assertCanManageTaxes(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const address = await parseBody(request, taxHeadOfficeInput);
  const row = await loadPayoutAccountRow(supabase, studio.id);
  if (!row) throw TAXES_NOT_CONNECTED();
  const provider = payments();
  await takeStripeCall(studio);
  await provider.setTaxHeadOffice(row.stripe_account_id, address);
  taxResult(
    await taxWriteRpc(studio.region, "set_tax_head_office", userId, {
      p_studio_id: studio.id,
      p_province: address.province,
    }),
  );
  return NextResponse.json(await loadStudioTaxes(supabase, studio), {
    headers: { "cache-control": "private, no-store" },
  });
});
