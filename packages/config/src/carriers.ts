/**
 * Where each carrier's own tracking page is, with `{number}` for the tracking number (Phase 1 step 11; Claude's call;
 * ADR 0024). "Other" carriers take the studio's own link instead. The page addresses are the carriers' public ones as
 * known from here, NOT checked against each carrier's site: `CARRIER_TRACKING_URLS_CONFIRMED` stays false until
 * someone opens each with a real number.
 */
export const CARRIER_TRACKING_URLS = {
  canada_post:
    "https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor={number}",
  purolator: "https://www.purolator.com/en/shipping/tracker?pin={number}",
  ups: "https://www.ups.com/track?loc=en_CA&tracknum={number}",
  fedex: "https://www.fedex.com/fedextrack/?trknbr={number}",
} as const;

export type TrackedCarrier = keyof typeof CARRIER_TRACKING_URLS;

/** False until each address above is checked with a real tracking number. */
export const CARRIER_TRACKING_URLS_CONFIRMED = false;
