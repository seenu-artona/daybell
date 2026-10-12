/**
 * Money is always whole cents plus a currency code (D96). Never floats.
 * Daybell sells in USD (US studios) and CAD (Canadian studios, D106).
 */
export const CURRENCIES = ["USD", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Money {
  readonly cents: number;
  readonly currency: Currency;
}

export function money(cents: number, currency: Currency): Money {
  if (!Number.isSafeInteger(cents)) throw new Error("Money must be a whole number of cents");
  return { cents, currency };
}

/** A studio sells in its data region's currency (ADR 0006, ADR 0019): US → USD, Canada → CAD. */
export function currencyForRegion(region: "us" | "ca"): Currency {
  return region === "ca" ? "CAD" : "USD";
}

/** The locale that writes a currency the way its own customers read it: "$25.00" in both, never "CA$25.00". */
export function localeForCurrency(currency: Currency): "en-US" | "en-CA" {
  return currency === "CAD" ? "en-CA" : "en-US";
}

/**
 * Whole cents from what a person typed in a price field, or null if it isn't a plain amount. Accepts "12", "12.5",
 * "12.50", ".5", "$1,234.00" and " 0 "; refuses negatives, more than two decimals, exponents, letters and empty text. Never
 * goes through a float: the digits are read as text (D96).
 */
export function parseMoneyInput(text: string): number | null {
  const plain = text.trim().replace(/^\$/, "").trim();
  // Thousands separators only in their proper places ("1,234", not "12,34").
  if (!/^(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{0,2})?|\.\d{1,2})$/.test(plain)) return null;
  const [whole = "", fraction = ""] = plain.replaceAll(",", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cents as the text a price field starts with, e.g. 2500 -> "25.00" (no symbol, no separators). */
export function moneyInputText(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Formats for display, e.g. 4826000 USD -> "$48,260.00". Pass `whole` to drop cents. */
export function formatMoney(
  value: Money,
  locale: "en-US" | "en-CA" = "en-US",
  options: { whole?: boolean } = {},
): string {
  const digits = options.whole ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value.cents / 100);
}
