import { describe, expect, it } from "vitest";
import { TAX_CODES, TAX_CODES_CONFIRMED } from "./tax-codes";

describe("TAX_CODES (ADR 0023, call 4)", () => {
  it("names a Stripe tax code for every kind sold and for shipping", () => {
    expect(Object.keys(TAX_CODES).sort()).toEqual(
      ["digital_all", "digital_single", "package", "print", "shipping"].sort(),
    );
    for (const code of Object.values(TAX_CODES)) expect(code).toMatch(/^txcd_\d{8}$/);
  });

  it("stays marked unconfirmed until a tax adviser checks it", () => {
    expect(TAX_CODES_CONFIRMED).toBe(false);
  });
});
