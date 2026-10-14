import "server-only";
import type { StudioOrderDetail, StudioSummary } from "@daybell/api";
import { ApiError } from "@daybell/api";
import { canSeeSales } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "../api";
import { type DbStudioOrderDetail, toStudioOrderDetail } from "./views";

/**
 * One order as the signed-in person may see it (ADR 0024): read as them (studio_order is SECURITY INVOKER, so row-level
 * security decides), with refunds and the ledger only for owners and admins (Q4). Another studio's is not found.
 */
export async function loadOrderDetail(
  supabase: SupabaseClient,
  studio: StudioSummary,
  orderId: string,
): Promise<StudioOrderDetail> {
  const row = check(
    await supabase.rpc("studio_order", { p_studio_id: studio.id, p_order_id: orderId }),
  ) as DbStudioOrderDetail | null;
  if (!row) throw new ApiError("not_found", "Order not found.");
  return toStudioOrderDetail(row, canSeeSales(studio.role));
}

export const NO_STORE = { "cache-control": "private, no-store" };
