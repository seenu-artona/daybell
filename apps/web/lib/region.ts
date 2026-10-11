import { availableRegions, type DataRegion, isDataRegion } from "@daybell/config";

/** Remembers which regional database this browser's session lives in (D113). Not personal data. */
export const REGION_COOKIE = "daybell_region";

export const REGION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 400,
};

/** The region named in the cookie if it is set up here, otherwise the first available region, or null if none. */
export function resolveRegion(cookieValue: string | undefined): DataRegion | null {
  const regions = availableRegions().map((r) => r.region);
  if (isDataRegion(cookieValue) && regions.includes(cookieValue)) return cookieValue;
  return regions[0] ?? null;
}
