import { ApiError } from "@daybell/api";

/**
 * A failed Stripe call, with what the caller needs to know (code review S1; security review 1): which step failed
 * (`create` the v2 account, set its `schedule`, or any `other` call) and whether Stripe refused it (`refused`: nothing
 * happened) or the result is `unknown` (it may have taken effect). The body sent to the browser is the ApiError's
 * own: these fields stay on the server.
 */
export type StripeStage = "create" | "schedule" | "other";
export type StripeOutcome = "refused" | "unknown";

export class StripeCallError extends ApiError {
  constructor(
    message: string,
    readonly stage: StripeStage,
    readonly outcome: StripeOutcome,
    fields?: Record<string, string>,
  ) {
    super("internal", message, fields);
    this.name = "StripeCallError";
  }
}
