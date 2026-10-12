import "server-only";
import { ApiError } from "@daybell/api";
import { type DataRegion, regionDatabase } from "@daybell/config";
import { supabaseSecretKey } from "@daybell/config/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only writes of access codes (ADR 0011). Browsers can't write codes: adding a child, importing a roster and
 * preparing QR cards (blank cards carry pre-made codes, ADR 0015) go through these database functions, which only the
 * service role can run. Call this only from route handlers, after studioScope() and assertCanEditRoster(); the
 * function checks the acting person's role again and attributes the events to them. Nothing else may use the service
 * role: it bypasses row-level security.
 */
export type CodeWriteRpc = "add_child" | "import_roster" | "prepare_qr_cards";

const clients = new Map<DataRegion, SupabaseClient>();

function serviceClient(region: DataRegion): SupabaseClient {
  const cached = clients.get(region);
  if (cached) return cached;
  const db = regionDatabase(region);
  if (!db) throw new ApiError("region_unavailable", "That region isn't available yet.");
  let key: string;
  try {
    key = supabaseSecretKey(region);
  } catch {
    // The variable's name only, never a value.
    console.error("supabase_secret_key_missing", region);
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  // No session: this client never signs anyone in and never stores tokens.
  const client = createClient(db.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  clients.set(region, client);
  return client;
}

/** Runs a code-writing database function for `actorId` (the signed-in person) in the studio's region. */
export function codeWriteRpc(
  region: DataRegion,
  fn: CodeWriteRpc,
  actorId: string,
  args: Record<string, unknown>,
) {
  return serviceClient(region).rpc(fn, { p_actor: actorId, ...args });
}
