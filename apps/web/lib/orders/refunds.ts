import "server-only";
import { ApiError, type RefundInput } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import {
  type RefundKind,
  type RefundReason,
  type RefundStatus,
  stripeRefundReason,
} from "@daybell/core";
import { assertFunctionRegion } from "../region-guard";
import { type PaymentsProvider, type RefundFacts, StripeCallError } from "../stripe";
import { checkoutSystemRpc, orderSystemRpc, orderWriteRpc } from "../supabase/service";
import { orderCheck, orderConflict } from "./errors";

/**
 * Refunds (ADR 0024; answers 1–3; Q1–Q3). The database writes a refund with every amount (app.refund_split: tax and
 * Daybell's fee pro rata, the last refund taking the exact remainders); then, in the studio's region's function region
 * (D113):
 * 1. Stripe refunds the parent that exact amount, with no reverse_transfer or refund_application_fee (Q1), Daybell's ids
 *    in its metadata and the key daybell-refund-{id}; an earlier refund with the same id is found first, so retries
 *    (even after Stripe's key expired) never refund twice. Stripe refusing it outright cancels it (nothing happened).
 * 2. refund_accepted writes its ledger transaction (and, for a parent's cancel, cancels the order).
 * 3. The studio's share (the refund less Daybell's fee on it) is taken back from the order's transfer: as much as is
 *    left in it (Stripe's card fee was reversed from it at payment, so a full refund usually falls short by about the
 *    card fee less Daybell's). What couldn't be is the shortfall, recovered from the studio's next settled sale (Q2).
 * runRefund is idempotent and resumable: the route, a parent's cancel, the webhook and the cron all call it. Logs hold
 * fixed names and codes only: never an amount, an id or a name.
 */

export class RefundProblem extends Error {
  constructor(readonly code: "refund_mismatch" | "payment_missing" | "refund_unexpected") {
    super(code);
    this.name = "RefundProblem";
  }
}

interface DbRefundForStripe {
  refund_id: string;
  order_id: string;
  studio_id: string;
  kind: RefundKind;
  reason: RefundReason | null;
  status: RefundStatus;
  amount_cents: number;
  daybell_fee_cents: number;
  currency: string;
  stripe_refund_id: string | null;
  reversal_cents: number | null;
  reversal_needed_cents: number;
  payment_intent_id: string | null;
  transfer_id: string | null;
}

async function load(region: DataRegion, refundId: string): Promise<DbRefundForStripe> {
  const row = orderCheck<DbRefundForStripe | null>(
    await orderSystemRpc(region, "refund_for_stripe", { p_refund_id: refundId }),
  );
  if (!row) throw new ApiError("not_found", "Refund not found.");
  return row;
}

const accepted = (status: RefundStatus) => status === "pending" || status === "succeeded";

/** Stripe's word on a refund it made: finished, or failed after all. */
async function applyStripeStatus(
  region: DataRegion,
  refundId: string,
  facts: RefundFacts,
): Promise<void> {
  if (facts.status === "succeeded")
    orderCheck(await orderSystemRpc(region, "refund_settled", { p_refund_id: refundId }));
  else if (facts.status === "failed" || facts.status === "canceled") {
    console.error("refund_failed_at_stripe", facts.failureReason ?? "unknown");
    orderCheck(
      await orderSystemRpc(region, "refund_failed", {
        p_refund_id: refundId,
        p_code: facts.failureReason ?? `stripe_${facts.status}`,
      }),
    );
  }
}

/** The studio's share taken back from the order's transfer: all of it, or what is left (the rest is a shortfall). */
async function reverse(
  region: DataRegion,
  provider: PaymentsProvider,
  r: DbRefundForStripe,
): Promise<void> {
  if (!r.transfer_id) throw new RefundProblem("payment_missing");
  const needed = Number(r.reversal_needed_cents);
  let reversalId: string | null = null;
  let cents = 0;
  if (needed > 0) {
    const { remainingCents } = await provider.transferRemaining(r.transfer_id);
    const amount = Math.min(needed, remainingCents);
    if (amount > 0) {
      const reversal = await provider.reverseForRefund({
        transferId: r.transfer_id,
        amountCents: amount,
        refundId: r.refund_id,
        purpose: "refund",
        orderId: r.order_id,
      });
      reversalId = reversal.reversalId;
      cents = reversal.amountCents;
    }
  }
  const owed = Number(
    orderCheck(
      await orderSystemRpc(region, "refund_recovered", {
        p_refund_id: r.refund_id,
        p_reversal_id: reversalId,
        p_cents: cents,
      }),
    ),
  );
  // Expected on most full refunds (ADR 0024 §mechanics); recovered from the studio's next sale (Q2).
  if (owed > 0) console.warn("refund_shortfall");
}

/**
 * Takes a refund as far as it can go: made at Stripe, accepted here, its status from Stripe, the studio's share
 * reversed. Answers its status. A Stripe failure that may pass throws (the caller notes it; the cron retries).
 */
export async function runRefund(
  region: DataRegion,
  provider: PaymentsProvider,
  refundId: string,
): Promise<RefundStatus> {
  // D113: a Canadian studio's refund is asked of Stripe and written from Montréal only.
  assertFunctionRegion(region);
  let r = await load(region, refundId);
  if (r.status === "failed" || r.status === "canceled") return r.status;
  if (!r.payment_intent_id || !r.transfer_id) throw new RefundProblem("payment_missing");
  if (r.status === "requested") {
    let facts: RefundFacts;
    try {
      facts = await provider.createRefund({
        paymentIntentId: r.payment_intent_id,
        amountCents: Number(r.amount_cents),
        refundId: r.refund_id,
        orderId: r.order_id,
        region,
        reason: stripeRefundReason(r.kind, r.reason),
      });
    } catch (err) {
      // Refused for good (more than is left, an old charge): nothing happened, so it is cancelled and said so.
      if (
        err instanceof StripeCallError &&
        err.outcome === "refused" &&
        err.stripeType === "StripeInvalidRequestError"
      ) {
        orderCheck(
          await orderSystemRpc(region, "refund_abandoned", {
            p_refund_id: refundId,
            p_code: "stripe_refused",
          }),
        );
        return "canceled";
      }
      throw err;
    }
    if (
      facts.amountCents !== Number(r.amount_cents) ||
      (facts.refundId !== null && facts.refundId !== refundId)
    )
      throw new RefundProblem("refund_mismatch");
    orderCheck(
      await orderSystemRpc(region, "refund_accepted", {
        p_refund_id: refundId,
        p_stripe_refund_id: facts.id,
        p_stripe_status: facts.status === "requires_action" ? "pending" : facts.status,
      }),
    );
    r = await load(region, refundId);
  } else if (r.status === "pending" && r.stripe_refund_id) {
    await applyStripeStatus(region, refundId, await provider.retrieveRefund(r.stripe_refund_id));
    r = await load(region, refundId);
  }
  if (accepted(r.status) && r.reversal_cents === null) {
    await reverse(region, provider, r);
    r = await load(region, refundId);
  }
  return r.status;
}

/** Notes a refund's failed try (backing off) or a problem no retry can fix (kept for support). Best effort. */
export async function noteRefundFailure(
  region: DataRegion,
  refundId: string,
  err: unknown,
): Promise<void> {
  const permanent = err instanceof RefundProblem;
  const code = permanent
    ? (err as RefundProblem).code
    : err instanceof ApiError
      ? "stripe_unavailable"
      : "unexpected_error";
  console.error(permanent ? "refund_problem" : "refund_retry_later", code);
  const { error } = await orderSystemRpc(region, "note_refund_failure", {
    p_refund_id: refundId,
    p_code: code,
    p_permanent: permanent,
  });
  if (error) console.error("refund_failure_unrecorded", code);
}

/**
 * Runs a refund just asked for; a failure that may pass leaves it requested (the cron tries again) and the person is
 * told it is on its way. Answers its status.
 */
export async function tryRefund(
  region: DataRegion,
  provider: PaymentsProvider,
  refundId: string,
): Promise<RefundStatus> {
  try {
    return await runRefund(region, provider, refundId);
  } catch (err) {
    await noteRefundFailure(region, refundId, err);
    return (await load(region, refundId)).status;
  }
}

/** A studio's refund (owners and admins): written by the database, then made at Stripe. Answers the refund's id. */
export async function startStudioRefund(
  region: DataRegion,
  provider: PaymentsProvider,
  actorId: string,
  studioId: string,
  orderId: string,
  input: RefundInput,
): Promise<string> {
  assertFunctionRegion(region);
  const begun = orderCheck<{ refund_id: string; created: boolean }>(
    await orderWriteRpc(region, "begin_refund", actorId, {
      p_studio_id: studioId,
      p_order_id: orderId,
      p_request_id: input.requestId,
      p_kind: input.kind,
      p_lines:
        input.kind === "lines"
          ? input.lines.map((l) => ({ line_id: l.lineId, quantity: l.quantity }))
          : null,
      p_custom_cents: input.kind === "custom" ? input.amountCents : null,
      p_shipping: input.shipping,
      p_reason: input.reason,
    }),
  );
  const status = await tryRefund(region, provider, begun.refund_id);
  if (status === "canceled") throw orderConflict("refundRefused");
  return begun.refund_id;
}

/**
 * What Stripe says about one of a payment's refunds (the webhook): one of Daybell's is taken as far as it goes, then
 * given Stripe's latest status; one made outside Daybell (the Dashboard) is kept on the order as a problem for support,
 * since the studio's share and the ledger know nothing of it.
 */
export async function syncStripeRefund(
  region: DataRegion,
  provider: PaymentsProvider,
  orderId: string,
  facts: RefundFacts,
): Promise<"synced" | "external"> {
  const ours = facts.refundId
    ? orderCheck<string | null>(
        await orderSystemRpc(region, "refund_by_stripe", {
          p_order_id: orderId,
          p_refund_id: facts.refundId,
          p_stripe_refund_id: facts.id,
        }),
      )
    : null;
  if (!ours) {
    console.error("refund_external");
    const { error } = await checkoutSystemRpc(region, "note_checkout_failure", {
      p_order_id: orderId,
      p_code: "external_refund",
      p_permanent: true,
    });
    if (error) console.error("refund_external_unrecorded");
    return "external";
  }
  const status = await runRefund(region, provider, ours);
  if (accepted(status) && (facts.status === "failed" || facts.status === "canceled"))
    await applyStripeStatus(region, ours, facts);
  else if (status === "pending" && facts.status === "succeeded")
    await applyStripeStatus(region, ours, facts);
  return "synced";
}

/**
 * Recovers what earlier refunds left owed (Q2) from a newly settled sale's transfer, oldest first, as far as the
 * transfer goes. Never fails the sale: a failure is logged by name and the cron tries again.
 */
export async function recoverShortfalls(
  region: DataRegion,
  provider: PaymentsProvider,
  saleOrderId: string,
  transferId: string,
): Promise<number> {
  let recovered = 0;
  try {
    const owed = orderCheck<{ refund_id: string; unrecovered_cents: number }[]>(
      await orderSystemRpc(region, "refund_shortfalls_for_sale", { p_order_id: saleOrderId }),
    );
    for (const shortfall of owed) {
      const { remainingCents } = await provider.transferRemaining(transferId);
      const amount = Math.min(Number(shortfall.unrecovered_cents), remainingCents);
      if (amount <= 0) break;
      const reversal = await provider.reverseForRefund({
        transferId,
        amountCents: amount,
        refundId: shortfall.refund_id,
        purpose: "refund_shortfall",
        orderId: saleOrderId,
      });
      orderCheck(
        await orderSystemRpc(region, "refund_shortfall_recovered", {
          p_refund_id: shortfall.refund_id,
          p_order_id: saleOrderId,
          p_cents: reversal.amountCents,
          p_reversal_id: reversal.reversalId,
        }),
      );
      recovered += 1;
    }
  } catch {
    console.error("refund_shortfall_recovery_failed");
  }
  return recovered;
}
