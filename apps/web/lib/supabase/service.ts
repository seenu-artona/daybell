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
 * role (photo, payout and job status writes and the system work below are the only other uses): it bypasses
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
  // Review (ADR 0018): moves, confirmations, undoing card photo marks and Mark reviewed.
  | "move_photos"
  | "confirm_photos"
  | "undo_card_photos"
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

/**
 * Payout writes (ADR 0020): browsers never write payout accounts (Stripe ids and status must never be chosen by a
 * browser). Only from route handlers after studioScope() and assertCanManagePayouts(); each acts for the person and checks again
 * that they are the owner.
 */
export type PayoutWriteRpc = "create_payout_account" | "set_payout_schedule";

export function payoutWriteRpc(
  region: DataRegion,
  fn: PayoutWriteRpc,
  actorId: string,
  args: Record<string, unknown>,
) {
  return serviceClient(region).rpc(fn, { p_actor: actorId, ...args });
}

/**
 * Payout work nobody signed in does: Stripe's webhook (only after its signature is checked) and the status refresh
 * (only after studioScope() and the owner-or-admin check). Each copies what Stripe says about one account it names.
 */
export type PayoutSystemRpc =
  | "record_stripe_event"
  | "finish_stripe_event"
  | "sync_payout_account"
  | "sync_payout"
  // The per-studio budget of calls to Stripe (rate limit), after the route's own role check.
  | "take_stripe_call";

export function payoutSystemRpc(
  region: DataRegion,
  fn: PayoutSystemRpc,
  args: Record<string, unknown>,
) {
  return serviceClient(region).rpc(fn, args);
}

/**
 * Job status changes (ADR 0021): browsers never write a job's status. Only from route handlers after studioScope(),
 * assertCanManage() and a check that the job is the studio's; each function acts for the person, checks again that
 * they are an owner or admin, and checks what selling needs in the same transaction.
 */
export type JobStatusRpc = "start_selling" | "reopen_job" | "close_job";

export function jobStatusRpc(
  region: DataRegion,
  fn: JobStatusRpc,
  actorId: string,
  args: Record<string, unknown>,
) {
  return serviceClient(region).rpc(fn, { p_actor: actorId, ...args });
}

/**
 * Job work nobody signed in does: closing shops whose closing date has passed, pruning old notifications and expired
 * parent shop sessions (ADR 0022), only from the CRON_SECRET-checked jobs cron route.
 */
export type JobSystemRpc = "close_due_jobs" | "prune_notifications" | "prune_shop";

export function jobSystemRpc(region: DataRegion, fn: JobSystemRpc, args: Record<string, unknown>) {
  return serviceClient(region).rpc(fn, args);
}

/**
 * The parent shop (ADR 0022): parents have no account, so every shop read and write runs as the service role, only
 * from the /api/v1/shop routes, and only with what those routes checked: the HMACs of the network and device (codes),
 * the SHA-256 of the session cookie's token. Each function works only within that session's own studio and children,
 * so a session can never reach another studio's data. Never with anything a browser chose beyond ids and quantities.
 */
export type ShopRpc =
  | "shop_enter_code"
  | "shop_session"
  | "shop_gallery"
  | "shop_price_list"
  | "shop_cart"
  | "shop_cart_add"
  | "shop_cart_set_quantity"
  | "shop_cart_remove"
  | "shop_set_shipping"
  | "shop_forget"
  | "shop_forget_device"
  | "take_shop_request"
  // Checkout (ADR 0023): the session's own bag, orders and downloads.
  | "shop_checkout_begin"
  | "shop_checkout_attach"
  | "shop_pending_checkouts"
  | "shop_orders"
  | "shop_order"
  | "shop_order_verify"
  | "shop_download_photo";

export function shopRpc(region: DataRegion, fn: ShopRpc, args: Record<string, unknown>) {
  return serviceClient(region).rpc(fn, args);
}

/**
 * Checkout work nobody signed in does (ADR 0023): what Stripe reports about a checkout (only after the webhook's
 * signature is checked, or a parent's own session asked, or the CRON_SECRET-checked cron), and the card prefix set at
 * a studio's first checkout. Each names one order or account, and checks Stripe's answer against Daybell's own copy.
 */
export type CheckoutSystemRpc =
  | "record_order_stripe_event"
  | "finish_stripe_event"
  | "complete_order"
  | "expire_order"
  | "settle_order_fees"
  | "stale_checkouts"
  | "unsettled_orders"
  | "mark_card_prefix_set";

export function checkoutSystemRpc(
  region: DataRegion,
  fn: CheckoutSystemRpc,
  args: Record<string, unknown>,
) {
  return serviceClient(region).rpc(fn, args);
}

/**
 * Tax writes (ADR 0023; call 6): Stripe first, then these, only from route handlers after studioScope() and the owner
 * check; each acts for the person and checks again that they are the owner.
 */
export type TaxWriteRpc = "set_tax_head_office" | "add_tax_registration" | "end_tax_registration";

export function taxWriteRpc(
  region: DataRegion,
  fn: TaxWriteRpc,
  actorId: string,
  args: Record<string, unknown>,
) {
  return serviceClient(region).rpc(fn, { p_actor: actorId, ...args });
}
