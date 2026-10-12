import { describe, expect, it } from "vitest";
import { DAYBELL_FEE_BASIS_POINTS, PAYOUT_FEES } from "./payout-fees";

describe("PAYOUT_FEES (D98, D59; ADR 0020)", () => {
  it("has both currencies, in whole basis points and cents only (D96)", () => {
    expect(Object.keys(PAYOUT_FEES).sort()).toEqual(["CAD", "USD"]);
    for (const table of Object.values(PAYOUT_FEES)) {
      const numbers = [
        table.daybellBasisPoints,
        table.card.basisPoints,
        table.card.fixedCents,
        table.payout.basisPoints,
        table.payout.fixedCents,
        table.activeAccountCents,
        table.instantBasisPoints,
      ];
      for (const n of numbers) expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
    }
  });

  it("charges Daybell's 3% everywhere, and marks the Stripe figures as unconfirmed placeholders", () => {
    expect(DAYBELL_FEE_BASIS_POINTS).toBe(300);
    for (const table of Object.values(PAYOUT_FEES)) {
      expect(table.daybellBasisPoints).toBe(300);
      expect(table.confirmed).toBe(false);
    }
  });
});
