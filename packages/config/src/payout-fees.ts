/**
 * The fees Settings › Payouts explains (D98, D59; ADR 0020, Claude's call Q8). Not secrets: shared constants.
 *
 * Daybell's own fee is 3% of product sales, nothing if nothing sells (D59: product value only, never shipping or tax).
 * Stripe's card fees and Connect payout fees (per payout and per monthly active account) are passed on to studios at
 * Stripe's rates (D98); instant payouts are at Stripe's fee too (D56) but are not offered in Phase 1 (Q7).
 *
 * PLACEHOLDERS: the Stripe figures below are Stripe's published standard rates as far as we know, written down so the
 * screen has numbers to show. Seenu confirms them against Daybell's own Stripe pricing (it may be custom) before
 * launch; how payout fees are charged to studios is decided in step 10 / Phase 3. Basis points (1/100 of a percent)
 * and whole cents only, never floats (D96).
 */
export type FeeCurrency = "USD" | "CAD";

export interface PercentPlusFixed {
  /** Hundredths of a percent: 290 is 2.9%. */
  basisPoints: number;
  /** Whole cents in the fee's currency. */
  fixedCents: number;
}

export interface PayoutFeeTable {
  /** Daybell's fee on product sales (D59). */
  daybellBasisPoints: number;
  /** Stripe's fee on each card payment. */
  card: PercentPlusFixed;
  /** Stripe Connect's fee on each payout to the studio's bank. */
  payout: PercentPlusFixed;
  /** Stripe Connect's fee for each month a studio receives a payout ("monthly active account"), in whole cents. */
  activeAccountCents: number;
  /** Stripe's instant payout fee (not offered in Phase 1). */
  instantBasisPoints: number;
  /** False until Seenu confirms the Stripe figures (Claude's call Q8). */
  confirmed: boolean;
}

export const DAYBELL_FEE_BASIS_POINTS = 300;

export const PAYOUT_FEES: Record<FeeCurrency, PayoutFeeTable> = {
  CAD: {
    daybellBasisPoints: DAYBELL_FEE_BASIS_POINTS,
    card: { basisPoints: 290, fixedCents: 30 },
    payout: { basisPoints: 25, fixedCents: 25 },
    activeAccountCents: 200,
    instantBasisPoints: 100,
    confirmed: false,
  },
  USD: {
    daybellBasisPoints: DAYBELL_FEE_BASIS_POINTS,
    card: { basisPoints: 290, fixedCents: 30 },
    payout: { basisPoints: 25, fixedCents: 25 },
    activeAccountCents: 200,
    instantBasisPoints: 150,
    confirmed: false,
  },
};
