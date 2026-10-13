import "server-only";
import type { DataRegion } from "@daybell/config";
import type { PaymentsProvider } from "../stripe";
import { orderSystemRpc } from "../supabase/service";
import { noteRefundFailure, recoverShortfalls, runRefund } from "./refunds";

/**
 * The jobs cron's refund backstops (ADR 0024), a page each, within the region's share of the time:
 * - refunds Stripe hasn't accepted after a minute, accepted ones whose reversal isn't done, and pending ones to ask
 *   Stripe about, run again (runRefund is idempotent; each failure backs off; a problem no retry can fix is kept for
 *   support and never retried);
 * - shortfalls owed by studios, tried against their latest settled sale (Q2);
 * - shortfalls still owed after 180 days, absorbed by Daybell (Q2; the database writes the ledger).
 * Ids only; logs hold fixed names and codes.
 */
export const REFUND_PAGE = 50;

export async function runRefundBackstops(
  region: DataRegion,
  provider: PaymentsProvider,
  until: number,
): Promise<{ retriedRefunds: number; absorbedShortfalls: number }> {
  let retriedRefunds = 0;
  const due = await orderSystemRpc(region, "refunds_to_retry", { p_limit: REFUND_PAGE });
  if (due.error) console.error("refund_cron_failed", "refunds_to_retry");
  for (const { refund_id } of (due.data ?? []) as { refund_id: string }[]) {
    if (Date.now() >= until) break;
    try {
      await runRefund(region, provider, refund_id);
      retriedRefunds += 1;
    } catch (err) {
      await noteRefundFailure(region, refund_id, err);
    }
  }
  const shortfalls = await orderSystemRpc(region, "refund_shortfalls_due", {
    p_limit: REFUND_PAGE,
  });
  if (shortfalls.error) console.error("refund_cron_failed", "refund_shortfalls_due");
  // Each sale once: recoverShortfalls takes every shortfall it can pay, oldest first.
  const sales = new Map<string, string>();
  for (const s of (shortfalls.data ?? []) as { order_id: string; transfer_id: string }[])
    sales.set(s.order_id, s.transfer_id);
  for (const [orderId, transferId] of sales) {
    if (Date.now() >= until) break;
    await recoverShortfalls(region, provider, orderId, transferId);
  }
  let absorbedShortfalls = 0;
  if (Date.now() < until) {
    const absorbed = await orderSystemRpc(region, "absorb_refund_shortfalls", {
      p_limit: REFUND_PAGE,
    });
    if (absorbed.error) console.error("refund_cron_failed", "absorb_refund_shortfalls");
    else absorbedShortfalls = Number(absorbed.data ?? 0);
  }
  return { retriedRefunds, absorbedShortfalls };
}
