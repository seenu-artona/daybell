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
 * role (photo writes and the image worker's and cron's photo work below are the only other uses): it bypasses
 * row-level security.
 */
export type CodeWriteRpc =
  | "add_child"
  | "import_roster"
  | "prepare_qr_cards"
  // Naming a blank QR card's child moves the card's code to them (ADR 0018).
  | "blank_card_code"
  | "claim_blank_card";

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

/**
 * Photo writes (ADR 0016): uploads, the bin and retries. Browsers can't write photos (the storage upload id and the
 * status must never be chosen by a browser), so these run as the service role, like code writes: only from route
 * handlers after studioScope() and the uploader check; each function acts for the person and checks their role again.
 */
export type PhotoWriteRpc =
  | "create_upload_batch"
  | "register_photos"
  | "photos_uploading"
  | "set_photo_upload_id"
  | "mark_photo_uploaded"
  | "cancel_photo_upload"
  | "finish_upload_batch"
  | "retry_photo"
  | "bin_photos"
  | "restore_photos"
  // Review (ADR 0018): moves, confirmations and Mark reviewed.
  | "move_photos"
  | "confirm_photos"
  | "mark_tagging_reviewed";

export function photoWriteRpc(
  region: DataRegion,
  fn: PhotoWriteRpc,
  actorId: string,
  args: Record<string, unknown>,
) {
  return serviceClient(region).rpc(fn, { p_actor: actorId, ...args });
}

/**
 * Photo work nobody signed in does: the image worker's read and result (only from the HMAC-checked internal routes),
 * the daily clean-up (only from the CRON_SECRET-checked cron route), and tagging upload batches (ADR 0018), which runs
 * after those and after a signed-in person's own checked write (finishing an upload, the bin), for that batch only.
 */
export type PhotoSystemRpc =
  | "photo_for_worker"
  | "record_photo_result"
  | "begin_photo_purge"
  | "delete_purged_photos"
  | "abandoned_uploads"
  | "delete_abandoned_uploads"
  | "finish_idle_batches"
  // Tagging upload batches (ADR 0018), after a result, a finished upload, the bin and in the daily sweep.
  | "tagging_inputs"
  | "apply_batch_tags"
  | "batches_of_photos"
  | "batches_to_tag";

export function photoSystemRpc(
  region: DataRegion,
  fn: PhotoSystemRpc,
  args: Record<string, unknown>,
) {
  return serviceClient(region).rpc(fn, args);
}
