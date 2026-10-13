import "server-only";
import { ApiError } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import type { PaymentsProvider } from "../stripe";
import { checkoutSystemRpc } from "../supabase/service";
import { CheckoutProblem, closeCheckout, completeCheckout } from "./complete";

/**
 * The jobs cron's checkout backstops (ADR 0023 §5.5), a page each, within the region's share of the time:
 * - paid orders whose Stripe fee is still unknown after 10 minutes are completed again (Stripe's own retries stop
 *   after a few days);
 * - checkouts that ran out two hours ago (or were never made), and replaced ones Stripe hasn't closed yet (code review
 *   M2), are closed at Stripe and here, after asking Stripe, which may say paid.
 * Ids only. A failure is logged by a fixed name and noted on the order (note_checkout_failure): its code, and a backoff
 * before the next try; a problem no retry can fix leaves both lists for good, so it can never crowd newer orders out
 * of a page (code review S1, security review M4). The database orders each page by when it is due.
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

/** The failure's code, and whether a retry could ever fix it. */
function failureOf(err: unknown): { code: string; permanent: boolean } {
  if (err instanceof CheckoutProblem) return { code: err.code, permanent: true };
  if (err instanceof ApiError) return { code: "stripe_unavailable", permanent: false };
  return { code: "unexpected_error", permanent: false };
}

async function noteFailure(region: DataRegion, orderId: string, code: string, permanent: boolean) {
  const { error } = await checkoutSystemRpc(region, "note_checkout_failure", {
    p_order_id: orderId,
    p_code: code,
    p_permanent: permanent,
  });
  if (error) console.error("checkout_cron_failed", "note", error.code ?? "unknown");
}

async function failed(region: DataRegion, step: string, orderId: string, err: unknown) {
  const { code, permanent } = failureOf(err);
  console.error("checkout_cron_failed", step, code);
  await noteFailure(region, orderId, code, permanent);
}

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
      // Stripe's fee still unknown: tried again, backing off like any other failure.
      else await noteFailure(region, order.order_id, "fee_pending", false);
    } catch (err) {
      await failed(region, "settle", order.order_id, err);
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
      await failed(region, "expire", order.order_id, err);
    }
  }
  return { settledOrders, expiredOrders };
}
