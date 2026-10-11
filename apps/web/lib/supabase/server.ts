import "server-only";
import { ApiError } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import { regionDatabase } from "@daybell/config";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { REGION_COOKIE, resolveRegion } from "../region";

/**
 * A Supabase client for one regional database, acting as the signed-in person (never as admin).
 * Every query it makes is filtered by row-level security (D96).
 */
export async function supabaseFor(region: DataRegion) {
  const db = regionDatabase(region);
  if (!db) throw new ApiError("region_unavailable", "That region isn't available yet.");
  const store = await cookies();
  return createServerClient(db.url, db.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; the proxy refreshes them instead.
        }
      },
    },
  });
}

/** The client for the region this browser signed in to. */
export async function supabaseForSession() {
  const store = await cookies();
  const region = resolveRegion(store.get(REGION_COOKIE)?.value);
  if (!region)
    throw new ApiError("region_unavailable", "No database is set up for this environment.");
  return { region, supabase: await supabaseFor(region) };
}
