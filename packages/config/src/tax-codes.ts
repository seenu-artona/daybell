/**
 * Stripe Tax product tax codes for what Daybell sells (ADR 0023, call 4). PLACEHOLDERS for test mode only: a tax
 * adviser confirms them (place of supply, codes per kind, shipping's taxability) before real launch, and Stripe's code
 * list confirms each id (https://docs.stripe.com/tax/tax-codes). Not checked from here: `confirmed` stays false until
 * both are done.
 *
 * - Prints and packages (a package mixes prints and one digital): general tangible goods.
 * - Digital downloads: digital photographs, electronically supplied.
 * - Shipping: Stripe's shipping code; shipping is treated as taxable.
 */
export const TAX_CODES = {
  package: "txcd_99999999",
  print: "txcd_99999999",
  digital_single: "txcd_10000000",
  digital_all: "txcd_10000000",
  shipping: "txcd_92010001",
} as const;

export type TaxCodeKind = keyof typeof TAX_CODES;

/** False until a tax adviser and Stripe's list confirm TAX_CODES (call 4). */
export const TAX_CODES_CONFIRMED = false;
