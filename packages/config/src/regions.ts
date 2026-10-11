/**
 * Data regions a studio can choose at sign-up (D113). Quebec is excluded at launch (D90).
 * A region is "available" only when its Supabase project is configured, so staging can run Canada-only and the US
 * switches on just by adding its two environment variables (D122).
 */
export const DATA_REGIONS = ["us", "ca"] as const;
export type DataRegion = (typeof DATA_REGIONS)[number];

export interface RegionDatabase {
  region: DataRegion;
  url: string;
  publishableKey: string;
}

// Next.js only inlines NEXT_PUBLIC_* variables written out literally, so each one is named here.
const RAW: Record<DataRegion, { url: string | undefined; key: string | undefined }> = {
  us: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL_US,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_US,
  },
  ca: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL_CA,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_CA,
  },
};

export function isDataRegion(value: unknown): value is DataRegion {
  return typeof value === "string" && (DATA_REGIONS as readonly string[]).includes(value);
}

/** Regions with a configured database, in a stable order. */
export function availableRegions(
  raw: Record<DataRegion, { url: string | undefined; key: string | undefined }> = RAW,
): RegionDatabase[] {
  return DATA_REGIONS.flatMap((region) => {
    const { url, key } = raw[region];
    return url && key ? [{ region, url, publishableKey: key }] : [];
  });
}

/** The database for a region, or null when that region isn't set up in this environment. */
export function regionDatabase(
  region: DataRegion,
  raw: Record<DataRegion, { url: string | undefined; key: string | undefined }> = RAW,
): RegionDatabase | null {
  return availableRegions(raw).find((r) => r.region === region) ?? null;
}
