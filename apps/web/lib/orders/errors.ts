import "server-only";
import { ApiError, fromDatabaseError, ORDER_CONFLICTS, ORDER_DB_REFUSALS } from "@daybell/api";
import { ApiErrorLater } from "../api";

/**
 * The order functions' named refusals (ADR 0024; their messages carry no values) as API errors: 409 with the
 * orders.* code in fields.form, Stripe's fee still unknown with Retry-After, too many zips as 429. Raw database text
 * never reaches a client.
 */

/** How long to wait before refunding an order whose Stripe fee isn't known yet (the webhook settles it in seconds). */
export const FEES_PENDING_RETRY_SECONDS = 30;
/** How long to wait after too many zips. */
export const ZIP_LIMIT_RETRY_SECONDS = 600;

const MESSAGES: Record<keyof typeof ORDER_CONFLICTS, string> = {
  notPaid: "This order isn't paid.",
  refunded: "This order was refunded.",
  canceled: "This order was cancelled.",
  refundInFlight: "A refund of this order is on its way. Try again in a moment.",
  feesPending: "Stripe is still settling this order. Try again in a moment.",
  wrongDelivery: "That isn't how this order is delivered.",
  trackingRequired: "Add the carrier and tracking number.",
  statusInvalid: "That isn't this order's next step.",
  overRefund: "That's more than is left to refund.",
  nothingToRefund: "Choose something to refund.",
  refundRefused: "Stripe refused this refund. Nothing was refunded.",
  externalRefund:
    "A refund was made outside Silverback. An owner or admin must check it before this order is printed or shipped.",
};

export function orderConflict(key: keyof typeof ORDER_CONFLICTS): ApiError {
  if (key === "feesPending")
    return new ApiErrorLater("conflict", FEES_PENDING_RETRY_SECONDS, MESSAGES.feesPending, {
      form: ORDER_CONFLICTS.feesPending,
    });
  return new ApiError("conflict", MESSAGES[key], { form: ORDER_CONFLICTS[key] });
}

export function orderError(error: { code?: string; message?: string }): ApiError {
  if (error.code === "P0001" && error.message) {
    const key = ORDER_DB_REFUSALS[error.message];
    if (key) return orderConflict(key);
    if (error.message === "zip_limit")
      return new ApiErrorLater(
        "rate_limited",
        ZIP_LIMIT_RETRY_SECONDS,
        "Too many downloads. Wait a few minutes and try again.",
      );
  }
  if (error.code === "P0002") return new ApiError("not_found", "Order not found.");
  if (error.code === "22023") return new ApiError("invalid_input", "Please check what you sent.");
  return fromDatabaseError(error);
}

/** The data of an order function's answer, or its error as an API error. */
export function orderCheck<T>(result: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}): T {
  if (result.error) throw orderError(result.error);
  return result.data as T;
}
