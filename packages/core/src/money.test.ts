import { describe, expect, it } from "vitest";
import { formatMoney, money } from "./money";

describe("money", () => {
  it("refuses fractions of a cent", () => {
    expect(() => money(10.5, "USD")).toThrow("whole number of cents");
  });

  it("formats US dollars", () => {
    expect(formatMoney(money(4826000, "USD"))).toBe("$48,260.00");
    expect(formatMoney(money(4826000, "USD"), "en-US", { whole: true })).toBe("$48,260");
  });

  it("formats Canadian dollars for Canadian studios", () => {
    expect(formatMoney(money(7800, "CAD"), "en-CA")).toBe("$78.00");
    expect(formatMoney(money(7800, "CAD"), "en-US")).toBe("CA$78.00");
  });
});
