import "server-only";
import type { DataRegion } from "@daybell/config";
import type { PaymentsProvider } from "../stripe";
import { checkoutSystemRpc } from "../supabase/service";
import { CheckoutProblem, closeCheckout, completeCheckout } from "./complete";

/**
 * The jobs cron's checkout backstops (ADR 0023 §5.5), a page each, within the region's share of the time:
 * - paid orders whose Stripe fee is still unknown after 10 minutes are completed again (Stripe's own retries stop
 *   after a few days);
 * - checkouts that ran out two hours ago (or were never made) are expired, after asking Stripe, which may say paid.
 * Ids only; a failure is logged by a fixed name and left for the next run.
 */
export const CHECKOUT_PAGE = 50;

type Due = { order_id: string; checkout_session_id: string | null };

async function due(region: DataRegion, fn: "unsettled_orders" | "stale_checkouts"): Promise<Due[]> {
  const { data, error } = await checkoutSystemRpc(region, fn, { p_limit: CHECKOUT_PAGE });
  if (error) {
    console.error("checkout_cron_failed", fn);
    return [];
  }
  return (data ?? []) as Due[];
}

const failed = (step: string, err: unknown) =>
  console.error("checkout_cron_failed", step, err instanceof CheckoutProblem ? err.code : "error");

export async function runCheckoutBackstops(
  region: DataRegion,
  provider: PaymentsProvider,
  until: number,
): Promise<{ settledOrders: number; expiredOrders: number }> {
  let settledOrders = 0;
  let expiredOrders = 0;
  for (const order of await due(region, "unsettled_orders")) {
    if (Date.now() >= until || !order.checkout_session_id) break;
    try {
      const { outcome } = await completeCheckout(region, provider, order.checkout_session_id, {
        expectedOrderId: order.order_id,
      });
      if (outcome === "settled") settledOrders += 1;
    } catch (err) {
      failed("settle", err);
    }
  }
  for (const order of await due(region, "stale_checkouts")) {
    if (Date.now() >= until) break;
    try {
      if (
        (await closeCheckout(region, provider, order.order_id, order.checkout_session_id)) ===
        "expired"
      )
        expiredOrders += 1;
    } catch (err) {
      failed("expire", err);
    }
  }
  return { settledOrders, expiredOrders };
}
