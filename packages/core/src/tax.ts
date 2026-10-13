/**
 * Sales tax registrations (Phase 1 step 10; Seenu's answer 2; Claude's calls 3–6; ADR 0023). A Canadian studio enters
 * its GST/HST number and, in British Columbia, Saskatchewan or Manitoba, its PST number; Stripe Tax calculates with
 * those registrations, and no registration means no tax (a small supplier). The studio's business address is sent to
 * Stripe as its tax head office. Placeholders until a tax adviser checks them before real launch (ADR 0023).
 *
 * The database checks the same formats (studio_tax_registrations, studio_tax_settings).
 */

export const TAX_REGISTRATION_KINDS = ["gst_hst", "pst"] as const;
export type TaxRegistrationKind = (typeof TAX_REGISTRATION_KINDS)[number];

/** Provinces and territories a studio's head office may be in: Canada without Quebec at launch. */
export const HEAD_OFFICE_PROVINCES = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "SK",
  "YT",
] as const;
export type HeadOfficeProvince = (typeof HEAD_OFFICE_PROVINCES)[number];

/** Provinces with a separate PST that Stripe registers (HST provinces need GST/HST only). */
export const PST_PROVINCES = ["BC", "MB", "SK"] as const;
export type PstProvince = (typeof PST_PROVINCES)[number];

const GST_HST = /^[0-9]{9}RT[0-9]{4}$/;
const PST = /^[A-Z0-9]([A-Z0-9 -]{0,28}[A-Z0-9])?$/;

/**
 * A registration number as kept: GST/HST as 9 digits, RT and 4 digits ("123456789 RT 0001" and "123456789-rt-0001"
 * both become "123456789RT0001"); PST in capitals with single spaces, as the province writes it. Null when it can't be
 * one.
 */
export function normalizeTaxNumber(kind: TaxRegistrationKind, text: string): string | null {
  const upper = text.trim().toUpperCase().replace(/\s+/g, " ");
  if (kind === "gst_hst") {
    const compact = upper.replace(/[\s-]/g, "");
    return GST_HST.test(compact) ? compact : null;
  }
  return PST.test(upper) ? upper : null;
}

/** A Canadian postal code as "A1A 1A1", or null. */
export function normalizePostalCode(text: string): string | null {
  const compact = text.trim().toUpperCase().replace(/[\s-]/g, "");
  return /^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z][0-9][ABCEGHJ-NPRSTV-Z][0-9]$/.test(compact)
    ? `${compact.slice(0, 3)} ${compact.slice(3)}`
    : null;
}

export function isHeadOfficeProvince(value: unknown): value is HeadOfficeProvince {
  return typeof value === "string" && (HEAD_OFFICE_PROVINCES as readonly string[]).includes(value);
}

export function isPstProvince(value: unknown): value is PstProvince {
  return typeof value === "string" && (PST_PROVINCES as readonly string[]).includes(value);
}
