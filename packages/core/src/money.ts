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
