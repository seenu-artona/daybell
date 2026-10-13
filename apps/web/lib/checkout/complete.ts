import "server-only";
import { ApiError } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import { assertFunctionRegion } from "../region-guard";
import type { CheckoutSessionFacts, PaymentsProvider } from "../stripe";
import { checkoutSystemRpc } from "../supabase/service";
import { queuePaidDownloads } from "./downloads";

/**
 * Completing a paid checkout (ADR 0023 §5.2): one function for Stripe's webhook, the confirmation page and the cron.
 * 1. Stripe's checkout is read (the payment, its charge and Stripe's fee), never trusted from a payload.
 * 2. Complete and paid: the database checks it against the order's snapshot and pays it, once.
 * 3. The first time, Stripe is given the email the parent typed so it sends its receipt (call 18): in memory only.
 * 4. The first time, the sold photos' download files are asked for (made lazily, ids only: security review N1).
 * 5. Once Stripe's balance transaction exists, its fee is checked (the order's currency, at most what the studio's
 *    transfer holds) before any money moves, then recovered from the studio's transfer (call 1) and the order's ledger
 *    transaction written (once); until then the order is paid and its fees pending (retried). No money moves without
 *    its ledger entry (D96; code review M1, security review M2).
 * A problem no retry can fix is kept on the order (note_checkout_failure: out of the cron's backstops for good) and
 * logged as checkout_problem with its code, for an alert. Nothing personal is logged: fixed names and codes only.
 */

export type CheckoutProblemCode =
  | "checkout_mismatch"
  | "fee_currency"
  | "fee_invalid"
  | "completion_failed"
  | "event_mismatch"
  | "not_daybells";

/** A refusal no retry can fix (Stripe's answer doesn't match the order): recorded, alerted, resolved by support. */
export class CheckoutProblem extends Error {
  constructor(readonly code: CheckoutProblemCode) {
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
    on_behalf_of: facts.onBehalfOf,
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

/**
 * The database's answer as an error: its named refusals, and any data or integrity error (SQLSTATE classes 22 and 23:
 * the same facts would fail the same way again) are problems no retry can fix (security review M3); anything else
 * (unreachable, a lock, a timeout) is retried.
 */
function dbFailure(error: NonNullable<DbError>): Error {
  if (
    error.code === "P0001" &&
    (error.message === "checkout_mismatch" || error.message === "fee_currency")
  )
    return new CheckoutProblem(error.message);
  if (typeof error.code === "string" && /^2[23][0-9A-Z]{3}$/.test(error.code))
    return new CheckoutProblem("completion_failed");
  console.error("checkout_database_failed", error.code ?? "unknown");
  return new ApiError("internal", "Something went wrong on our side.");
}

/**
 * Keeps a problem on the order and alerts (a fixed name and the code). Best effort: the caller's error is what counts.
 */
export async function recordCheckoutProblem(
  region: DataRegion,
  orderId: string,
  code: CheckoutProblemCode,
): Promise<void> {
  console.error("checkout_problem", code);
  const { error } = await checkoutSystemRpc(region, "note_checkout_failure", {
    p_order_id: orderId,
    p_code: code,
    p_permanent: true,
  });
  if (error) console.error("checkout_problem_unrecorded", code);
}

/**
 * Stripe's fee as the ledger can take it, checked before any money moves (code review M1, security review M2): in the
 * order's currency (complete_order has checked Stripe's currency against the order), a whole number of cents, and no
 * more than what the studio's transfer holds (the total less Daybell's application fee).
 */
export function assertRecoverableFee(facts: CheckoutSessionFacts): number {
  const balance = facts.balanceTransaction;
  if (!balance) throw new CheckoutProblem("fee_invalid");
  if (
    typeof balance.currency !== "string" ||
    typeof facts.currency !== "string" ||
    balance.currency.toUpperCase() !== facts.currency.toUpperCase()
  )
    throw new CheckoutProblem("fee_currency");
  const transferred = (facts.amountTotal ?? Number.NaN) - (facts.applicationFeeAmount ?? 0);
  if (
    !Number.isSafeInteger(balance.feeCents) ||
    balance.feeCents < 0 ||
    !(balance.feeCents <= transferred)
  )
    throw new CheckoutProblem("fee_invalid");
  return balance.feeCents;
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
  try {
    return await completeKnown(region, provider, facts, orderId, options.expectedOrderId);
  } catch (err) {
    // Kept on the order Daybell meant (the caller's, else Stripe's), so the cron never retries it.
    if (err instanceof CheckoutProblem)
      await recordCheckoutProblem(region, options.expectedOrderId ?? orderId, err.code);
    throw err;
  }
}

async function completeKnown(
  region: DataRegion,
  provider: PaymentsProvider,
  facts: CheckoutSessionFacts,
  orderId: string,
  expectedOrderId: string | undefined,
): Promise<{ orderId: string; outcome: CompleteOutcome }> {
  if (expectedOrderId && orderId !== expectedOrderId)
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
  // Every call until settled (the database asks for each file once), so a crash after paying loses no download.
  await queuePaidDownloads(region, orderId);

  const balance = facts.balanceTransaction;
  if (!balance || !facts.transferId) return { orderId, outcome: "fee_pending" };
  // Checked before any money moves: a refused fee is a problem for support, never a reversal without a ledger entry.
  const feeCents = assertRecoverableFee(facts);
  const reversal =
    feeCents > 0
      ? await provider.recoverCardFee({
          transferId: facts.transferId,
          amountCents: feeCents,
          orderId,
        })
      : null;
  const settled = await checkoutSystemRpc(region, "settle_order_fees", {
    p_order_id: orderId,
    p_transfer_id: facts.transferId,
    p_stripe_fee_cents: feeCents,
    p_fee_currency: balance.currency,
    p_balance_transaction_id: balance.id,
    p_fee_reversal_id: reversal?.reversalId ?? null,
  });
  if (settled.error) throw dbFailure(settled.error);
  return { orderId, outcome: "settled" };
}

/**
 * Marks an order's checkout expired here and closed at Stripe (a no-op once paid). Only once Stripe has closed it, or
 * when it has none (code review M2).
 */
export async function expireOrder(region: DataRegion, orderId: string): Promise<void> {
  const { error } = await checkoutSystemRpc(region, "expire_order", { p_order_id: orderId });
  if (error) throw dbFailure(error);
}

/**
 * Expires a checkout at Stripe and then here, or, if Stripe says it was paid meanwhile, completes it instead. Answers
 * which happened. A Stripe failure throws before anything is written here, so the checkout stays in the lists that
 * close it (the next Pay, cancel and the cron).
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
