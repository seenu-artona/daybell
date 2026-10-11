import "server-only";
import type { DataRegion } from "./regions";

/**
 * Server-only settings (ADR 0011). Import from "@daybell/config/server", never from code that can reach a browser.
 *
 * SUPABASE_SECRET_KEY_US / SUPABASE_SECRET_KEY_CA: each regional project's secret key (Supabase's "secret" API key,
 * sb_secret_…, or the legacy service_role key). It bypasses row-level security, so the web app uses it only for the
 * database functions that write access codes (add_child, import_roster), after checking the signed-in person's studio
 * and role; the database checks that person's role again. Never NEXT_PUBLIC_*, never logged; read on first use, so
 * builds never need it. Errors name the variable, never the value.
 */
// Written out literally, like the public region settings, so each name is easy to find.
const RAW_SECRET_KEYS: Record<DataRegion, string | undefined> = {
  us: process.env.SUPABASE_SECRET_KEY_US,
  ca: process.env.SUPABASE_SECRET_KEY_CA,
};

export function supabaseSecretKeyName(region: DataRegion): string {
  return `SUPABASE_SECRET_KEY_${region.toUpperCase()}`;
}

/** The secret key for a region's database. Throws (naming the variable only) when it isn't set. */
export function supabaseSecretKey(
  region: DataRegion,
  raw: Record<DataRegion, string | undefined> = RAW_SECRET_KEYS,
): string {
  const value = raw[region]?.trim() ?? "";
  if (!value) throw new Error(`${supabaseSecretKeyName(region)} is not set`);
  return value;
}
