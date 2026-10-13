import { describe, expect, it } from "vitest";
import {
  CARD_PREFIX,
  checkoutBlocker,
  DEFAULT_DAYBELL_FEE_BPS,
  daybellFeeCents,
  downloadFileName,
  formatOrderReference,
  isOrderReference,
  MIN_CHARGE_CENTS,
  orderLedger,
  STATEMENT_DESCRIPTOR_MAX,
  statementSuffix,
  studioReceivesCents,
  unlocksDownloads,
} from "./orders";

describe("daybellFeeCents (D59; calls 16)", () => {
  it("is 3% of products, half up, in whole cents", () => {
    expect(DEFAULT_DAYBELL_FEE_BPS).toBe(300);
    expect(daybellFeeCents(10_000, 300)).toBe(300);
    expect(daybellFeeCents(0, 300)).toBe(0);
    expect(daybellFeeCents(1, 300)).toBe(0);
    // 33 × 3% = 0.99 → 1; 50 × 3% = 1.5 → 2 (half up); 16 × 3% = 0.48 → 0.
    expect(daybellFeeCents(33, 300)).toBe(1);
    expect(daybellFeeCents(50, 300)).toBe(2);
    expect(daybellFeeCents(16, 300)).toBe(0);
    expect(daybellFeeCents(22_300, 350)).toBe(781);
    expect(daybellFeeCents(10_000_000, 300)).toBe(300_000);
  });

  it("matches the database's rule at every cent up to $10", () => {
    for (let cents = 0; cents <= 1000; cents++)
      expect(daybellFeeCents(cents, 300)).toBe(Math.floor((cents * 300 + 5000) / 10000));
  });

  it("refuses fractions, negatives and rates over 20%", () => {
    expect(() => daybellFeeCents(10.5, 300)).toThrow();
    expect(() => daybellFeeCents(-1, 300)).toThrow();
    expect(() => daybellFeeCents(100, 2001)).toThrow();
    expect(() => daybellFeeCents(100, 2.5)).toThrow();
    expect(daybellFeeCents(100, 2000)).toBe(20);
  });
});

describe("orderLedger (ADR 0006; ADR 0023 worked example)", () => {
  const example = {
    totalCents: 12_650,
    taxCents: 1_455,
    daybellFeeCents: 300,
    stripeFeeCents: 397,
  };

  it("posts the payment, tax, Daybell's fee, Stripe's fee and the studio's share, balanced", () => {
    expect(orderLedger(example)).toEqual([
      { account: "parent_payments", cents: 12_650 },
      { account: "tax_payable", cents: -1_455 },
      { account: "daybell_fees", cents: -300 },
      { account: "payment_fees", cents: -397 },
      { account: "studio_payable", cents: -10_498 },
    ]);
  });

  it("always sums to zero, and the studio's balance gets total − Daybell's fee − Stripe's fee", () => {
    for (const order of [
      example,
      { totalCents: 50, taxCents: 0, daybellFeeCents: 2, stripeFeeCents: 31 },
      { totalCents: 26_549, taxCents: 3_054, daybellFeeCents: 781, stripeFeeCents: 800 },
      {
        totalCents: 999_999_999,
        taxCents: 123_456_789,
        daybellFeeCents: 26_296_336,
        stripeFeeCents: 29_000_030,
      },
    ]) {
      const lines = orderLedger(order);
      expect(lines.reduce((s, l) => s + l.cents, 0)).toBe(0);
      const owed = lines
        .filter((l) => l.account === "studio_payable" || l.account === "tax_payable")
        .reduce((s, l) => s - l.cents, 0);
      expect(owed).toBe(studioReceivesCents(order));
      expect(studioReceivesCents(order)).toBe(
        order.totalCents - order.daybellFeeCents - order.stripeFeeCents,
      );
    }
  });

  it("leaves out zero lines (no tax, no fee)", () => {
    expect(
      orderLedger({ totalCents: 3_300, taxCents: 0, daybellFeeCents: 0, stripeFeeCents: 126 }).map(
        (l) => l.account,
      ),
    ).toEqual(["parent_payments", "payment_fees", "studio_payable"]);
  });

  it("refuses fractions of a cent", () => {
    expect(() => orderLedger({ ...example, stripeFeeCents: 1.5 })).toThrow();
  });
});

describe("statementSuffix (D104; call 7)", () => {
  const fits = (s: string | null) =>
    expect(CARD_PREFIX.length + 2 + (s?.length ?? 0)).toBeLessThanOrEqual(STATEMENT_DESCRIPTOR_MAX);

  it("upper-cases the studio's name and keeps letters, digits and spaces", () => {
    expect(statementSuffix("Riverside Photo")).toBe("RIVERSIDE PHOTO");
    expect(statementSuffix("  Maple   Lane  ")).toBe("MAPLE LANE");
  });

  it("drops accents and characters Stripe refuses", () => {
    expect(statementSuffix("Éclat Studio")).toBe("ECLAT STUDIO");
    expect(statementSuffix(`Bob's "Best" <Photo>*`)).toBe("BOB S BEST PHOTO");
    expect(statementSuffix("Smith & Sons")).toBe("SMITH AND SONS");
  });

  it("cuts long names to fit 22 characters with the prefix, at a word", () => {
    const suffix = statementSuffix("Maple Lane Photography and Portraits");
    expect(suffix).toBe("MAPLE LANE");
    fits(suffix);
    const word = statementSuffix("Supercalifragilisticexpialidocious");
    expect(word).toBe("SUPERCALIFRAGILIS");
    fits(word);
  });

  it("is null when no letter is left", () => {
    expect(statementSuffix("1234")).toBeNull();
    expect(statementSuffix("***")).toBeNull();
    expect(statementSuffix("写真館")).toBeNull();
  });
});

describe("order references", () => {
  it("are 8 Crockford base32 characters, shown in two halves", () => {
    expect(isOrderReference("7KQ2M9XA")).toBe(true);
    expect(isOrderReference("7KQ2M9XI")).toBe(false);
    expect(isOrderReference("7kq2m9xa")).toBe(false);
    expect(formatOrderReference("7KQ2M9XA")).toBe("7KQ2-M9XA");
  });

  it("name downloads with no name in them", () => {
    expect(downloadFileName("7KQ2M9XA", 3)).toBe("daybell-7KQ2M9XA-3.jpg");
    expect(() => downloadFileName("Ava Patel", 1)).toThrow();
    expect(() => downloadFileName("7KQ2M9XA", 0)).toThrow();
  });
});

describe("checkoutBlocker (ADR 0023 §6; call 13)", () => {
  const line = { available: true };
  it("says what stops paying, in the order the parent fixes it", () => {
    expect(checkoutBlocker({ lines: [], totalCents: 0, currency: "CAD" })).toBe("empty");
    expect(
      checkoutBlocker({ lines: [line, { available: false }], totalCents: 100, currency: "CAD" }),
    ).toBe("unavailable");
    expect(checkoutBlocker({ lines: [line], totalCents: null, currency: "CAD" })).toBe(
      "chooseDelivery",
    );
    expect(checkoutBlocker({ lines: [line], totalCents: 49, currency: "CAD" })).toBe(
      "belowMinimum",
    );
    expect(checkoutBlocker({ lines: [line], totalCents: 0, currency: "USD" })).toBe("belowMinimum");
    expect(MIN_CHARGE_CENTS.CAD).toBe(50);
    expect(checkoutBlocker({ lines: [line], totalCents: 50, currency: "CAD" })).toBeNull();
  });
});

describe("unlocksDownloads (calls 9, 10)", () => {
  it("is true for downloads and packages with a digital, never prints", () => {
    expect(unlocksDownloads("digital_single")).toBe(true);
    expect(unlocksDownloads("digital_all")).toBe(true);
    expect(unlocksDownloads("print")).toBe(false);
    expect(unlocksDownloads("package", [{ kind: "print" }])).toBe(false);
    expect(unlocksDownloads("package", [{ kind: "print" }, { kind: "digital" }])).toBe(true);
  });
});
