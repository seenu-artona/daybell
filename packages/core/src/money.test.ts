import { describe, expect, it } from "vitest";
import {
  currencyForRegion,
  formatMoney,
  localeForCurrency,
  money,
  moneyInputText,
  parseMoneyInput,
} from "./money";

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

describe("currencyForRegion (ADR 0006, 0019)", () => {
  it("sells in USD in the US and CAD in Canada", () => {
    expect(currencyForRegion("us")).toBe("USD");
    expect(currencyForRegion("ca")).toBe("CAD");
    expect(localeForCurrency("USD")).toBe("en-US");
    expect(localeForCurrency("CAD")).toBe("en-CA");
    expect(formatMoney(money(2500, "CAD"), localeForCurrency("CAD"))).toBe("$25.00");
  });
});

describe("parseMoneyInput", () => {
  it("reads plain amounts as whole cents, never through a float", () => {
    expect(parseMoneyInput("12")).toBe(1200);
    expect(parseMoneyInput("12.5")).toBe(1250);
    expect(parseMoneyInput("12.50")).toBe(1250);
    expect(parseMoneyInput("12.")).toBe(1200);
    expect(parseMoneyInput(" $1,234.00 ")).toBe(123400);
    expect(parseMoneyInput("$ 8.95")).toBe(895);
    expect(parseMoneyInput("0")).toBe(0);
    expect(parseMoneyInput("0.07")).toBe(7);
    expect(parseMoneyInput(".5")).toBe(50);
    // 0.1 + 0.2 style float errors can't happen: 19.99 is 1999 exactly.
    expect(parseMoneyInput("19.99")).toBe(1999);
    expect(parseMoneyInput("1000000")).toBe(100000000);
  });

  it("refuses anything that isn't a plain, positive amount with at most two decimals", () => {
    for (const text of [
      "",
      " ",
      "-5",
      "12.345",
      "1e3",
      "abc",
      "12abc",
      "$",
      ".",
      "12,34",
      "1,2345",
      "1.2.3",
      "Infinity",
      "NaN",
      "99999999999999999",
    ])
      expect(parseMoneyInput(text), JSON.stringify(text)).toBeNull();
  });

  it("starts a field with the stored amount, and reads it back the same", () => {
    expect(moneyInputText(2500)).toBe("25.00");
    expect(moneyInputText(895)).toBe("8.95");
    expect(moneyInputText(7)).toBe("0.07");
    expect(moneyInputText(0)).toBe("0.00");
    for (const cents of [0, 1, 99, 100, 895, 123456, 1000000])
      expect(parseMoneyInput(moneyInputText(cents))).toBe(cents);
  });
});
