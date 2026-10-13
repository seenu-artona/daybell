import "server-only";
import { ApiError } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import { assertFunctionRegion } from "../region-guard";
import type { CheckoutSessionFacts, PaymentsProvider } from "../stripe";
import { checkoutSystemRpc } from "../supabase/service";

/**
 * Completing a paid checkout (ADR 0023 §5.2): one function for Stripe's webhook, the confirmation page and the cron.
 * 1. Stripe's checkout is read (the payment, its charge and Stripe's fee), never trusted from a payload.
 * 2. Complete and paid: the database checks it against the order's snapshot and pays it, once.
 * 3. The first time, Stripe is given the email the parent typed so it sends its receipt (call 18): in memory only.
 * 4. Once Stripe's balance transaction exists, its fee is recovered from the studio's transfer (call 1) and the
 *    order's ledger transaction written (once); until then the order is paid and its fees pending (retried).
 * Nothing personal is logged: fixed names and codes only.
 */

/** A refusal no retry can fix (Stripe's answer doesn't match the order): recorded, alerted, resolved by support. */
export class CheckoutProblem extends Error {
  constructor(readonly code: "checkout_mismatch" | "fee_currency" | "not_daybells") {
    super(code);
    this.name = "CheckoutProblem";
  }
}

export type CompleteOutcome =
  /** Paid, and Stripe's fee settled in the ledger. */
  | "settled"
  /** Paid; Stripe's fee isn't known yet (its balance transaction), so the ledger waits. */
  | "fee_pending"
  /** Stripe hasn't taken the money (still open, or expired). */
  | "unpaid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stripe's facts as complete_order takes them; the recipient only for home delivery (the database decides). */
export function factsForDatabase(facts: CheckoutSessionFacts): Record<string, unknown> {
  return {
    checkout_session_id: facts.id,
    payment_intent_id: facts.paymentIntentId,
    charge_id: facts.chargeId,
    transfer_id: facts.transferId,
    livemode: facts.livemode,
    currency: facts.currency,
    amount_subtotal: facts.amountSubtotal,
    amount_shipping: facts.amountShipping,
    amount_tax: facts.amountTax,
    amount_total: facts.amountTotal,
    destination: facts.destination,
    application_fee_amount: facts.applicationFeeAmount,
    shipping: facts.shipping
      ? {
          name: facts.shipping.name,
          line1: facts.shipping.line1,
          line2: facts.shipping.line2,
          city: facts.shipping.city,
          state: facts.shipping.state,
          postal_code: facts.shipping.postalCode,
          country: facts.shipping.country,
        }
      : null,
  };
}

type DbError = { code?: string; message?: string } | null;

function dbFailure(error: NonNullable<DbError>): Error {
  if (
    error.code === "P0001" &&
    (error.message === "checkout_mismatch" || error.message === "fee_currency")
  )
    return new CheckoutProblem(error.message);
  console.error("checkout_database_failed", error.code ?? "unknown");
  return new ApiError("internal", "Something went wrong on our side.");
}

/**
 * Completes the checkout `sessionId` of the order Stripe's metadata names (which must be `expectedOrderId` when one
 * is given). `known` is a read the caller already made, used instead of reading again.
 */
export async function completeCheckout(
  region: DataRegion,
  provider: PaymentsProvider,
  sessionId: string,
  options: { expectedOrderId?: string; known?: CheckoutSessionFacts } = {},
): Promise<{ orderId: string; outcome: CompleteOutcome }> {
  // D113: a Canadian order's checkout is read and written from Montréal only.
  assertFunctionRegion(region);
  const facts = options.known ?? (await provider.retrieveCheckoutSession(sessionId));
  const orderId = facts.orderId;
  if (!orderId || !UUID.test(orderId) || facts.id !== sessionId)
    throw new CheckoutProblem("not_daybells");
  if (options.expectedOrderId && orderId !== options.expectedOrderId)
    throw new CheckoutProblem("checkout_mismatch");
  if (facts.status !== "complete" || facts.paymentStatus !== "paid")
    return { orderId, outcome: "unpaid" };

  const completed = await checkoutSystemRpc(region, "complete_order", {
    p_order_id: orderId,
    p_facts: factsForDatabase(facts),
  });
  if (completed.error) throw dbFailure(completed.error);
  const result = completed.data as "paid" | "already_paid" | "already_settled";
  if (result === "already_settled") return { orderId, outcome: "settled" };

  if (result === "paid" && facts.receiptEmail && facts.paymentIntentId) {
    try {
      await provider.setReceiptEmail(facts.paymentIntentId, facts.receiptEmail);
    } catch {
      // The order is paid either way; the Dashboard's receipt settings may still send one.
      console.error("stripe_receipt_email_failed");
    }
  }

  const balance = facts.balanceTransaction;
  if (!balance || !facts.transferId) return { orderId, outcome: "fee_pending" };
  const reversal =
    balance.feeCents > 0
      ? await provider.recoverCardFee({
          transferId: facts.transferId,
          amountCents: balance.feeCents,
          orderId,
        })
      : null;
  const settled = await checkoutSystemRpc(region, "settle_order_fees", {
    p_order_id: orderId,
    p_transfer_id: facts.transferId,
    p_stripe_fee_cents: balance.feeCents,
    p_fee_currency: balance.currency,
    p_balance_transaction_id: balance.id,
    p_fee_reversal_id: reversal?.reversalId ?? null,
  });
  if (settled.error) throw dbFailure(settled.error);
  return { orderId, outcome: "settled" };
}

/** Marks an order's checkout expired here (a no-op once paid). */
export async function expireOrder(region: DataRegion, orderId: string): Promise<void> {
  const { error } = await checkoutSystemRpc(region, "expire_order", { p_order_id: orderId });
  if (error) throw dbFailure(error);
}

/**
 * Expires a checkout at Stripe and then here, or, if Stripe says it was paid meanwhile, completes it instead. Answers
 * which happened.
 */
export async function closeCheckout(
  region: DataRegion,
  provider: PaymentsProvider,
  orderId: string,
  sessionId: string | null,
): Promise<"expired" | "paid"> {
  if (sessionId) {
    const { status } = await provider.expireCheckoutSession(sessionId);
    if (status === "complete") {
      const { outcome } = await completeCheckout(region, provider, sessionId, {
        expectedOrderId: orderId,
      });
      if (outcome !== "unpaid") return "paid";
    }
  }
  await expireOrder(region, orderId);
  return "expired";
}
