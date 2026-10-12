import { ApiError } from "@daybell/api";
import type { DataRegion } from "@daybell/config";

/**
 * Where a studio's data may be processed and stored (D113, D141; ADR 0015, 0016). Shared by every route that works
 * with a studio's data outside its database: QR card PDFs (codes decrypted in memory) and photos (storage URLs, the
 * image worker's calls).
 *
 * FUNCTION_REGION: the Vercel function region a region's data must be processed in. Canadian studios' requests run in
 * Montréal (yul1); routes set `preferredRegion = "yul1"`, and assertFunctionRegion refuses any other region when
 * VERCEL_REGION is set (locally and in CI it isn't). When a US database exists, US studios need their own region and
 * the mirror rule.
 */
export const FUNCTION_REGION: Record<DataRegion, string | null> = { ca: "yul1", us: null };

export function assertFunctionRegion(
  region: DataRegion,
  env: Record<string, string | undefined> = process.env,
): void {
  const required = FUNCTION_REGION[region];
  const running = env.VERCEL_REGION;
  if (required && running && running !== required) {
    // Region names only: never anything about the studio or its data.
    console.error("wrong_function_region", region, running);
    throw new ApiError(
      "region_unavailable",
      "This can't be done from here right now. Please try again.",
    );
  }
}

/**
 * Photo storage exists for Canada only (S3 in ca-central-1; Seenu, answer 8 to the step 4 brief). US studios' photos
 * will go to R2 later; until then their photo requests are refused, like QR cards outside Montréal.
 */
export const STORAGE_REGIONS: readonly DataRegion[] = ["ca"];

export function assertStorageRegion(region: DataRegion): void {
  if (!STORAGE_REGIONS.includes(region)) {
    console.error("photo_storage_unavailable", region);
    throw new ApiError("region_unavailable", "Photos can't be stored in this region yet.");
  }
}
