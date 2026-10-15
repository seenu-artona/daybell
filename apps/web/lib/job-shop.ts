import "server-only";
import {
  ApiError,
  fromDatabaseError,
  JOB_SHOP_CONFLICTS,
  type JobItemPatch,
  type JobShop,
  type JobShopConflict,
} from "@daybell/api";
import type { Currency, PriceItemKind, PrintSize } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { check } from "./api";
import { itemPayload } from "./price-lists";

/**
 * Job › Shop (D157; ADR 0033): what a job sells, read through the database's one resolver (job_shop, which reads
 * app.job_offer), and the database's named errors as API errors. Every query names the caller's studio as well as
 * row-level security (D96). Money leaves as whole cents with the list's currency, never anything else.
 */

type DbError = { code?: string; message?: string } | null;

interface JobShopDb {
  job_id: string;
  price_list: {
    id: string;
    name: string;
    currency: Currency;
    home_shipping_cents: number | string;
  };
  rows: {
    item_id: string;
    source: "list" | "job";
    kind: PriceItemKind;
    name: string;
    description: string | null;
    print_size: PrintSize | null;
    contents: { kind: "print" | "digital"; print_size: PrintSize | null; quantity: number }[];
    list_price_cents: number | string | null;
    price_cents: number | string;
    sold: boolean;
    changed: boolean;
  }[];
  changes: number;
}

/** Postgres bigint may arrive as a string; it is always whole cents within the database's bounds. */
const cents = (value: number | string) => Number(value);

export function toJobShop(db: JobShopDb): JobShop {
  const currency = db.price_list.currency;
  return {
    jobId: db.job_id,
    priceList: {
      id: db.price_list.id,
      name: db.price_list.name,
      homeShipping: { cents: cents(db.price_list.home_shipping_cents), currency },
    },
    rows: db.rows.map((row) => ({
      itemId: row.item_id,
      source: row.source,
      kind: row.kind,
      name: row.name,
      description: row.description,
      printSize: row.print_size,
      contents: row.contents.map((l) => ({
        kind: l.kind,
        printSize: l.print_size,
        quantity: l.quantity,
      })),
      listPrice:
        row.list_price_cents === null ? null : { cents: cents(row.list_price_cents), currency },
      price: { cents: cents(row.price_cents), currency },
      sold: row.sold,
      changed: row.changed,
    })),
    changes: Number(db.changes),
  };
}

/** Path ids that aren't UUIDs are simply not found (they can't be another studio's). */
export async function shopPathIds(ctx: {
  params: Promise<{ id: string; itemId?: string }>;
}): Promise<{ jobId: string; itemId: string | null }> {
  const { id, itemId } = await ctx.params;
  const uuid = z.uuid();
  if (!uuid.safeParse(id).success) throw new ApiError("not_found", "Job not found.");
  if (itemId !== undefined && !uuid.safeParse(itemId).success)
    throw new ApiError("not_found", "Item not found.");
  return { jobId: id, itemId: itemId ?? null };
}

export const JOB_NOT_FOUND = () => new ApiError("not_found", "Job not found.");
export const ITEM_NOT_FOUND = () => new ApiError("not_found", "Item not found.");

const conflict = (message: string, form: JobShopConflict) =>
  new ApiError("conflict", message, { form });

const NAMED: Record<string, () => ApiError> = {
  job_closed: () =>
    conflict("This job is closed, so its shop can't change.", JOB_SHOP_CONFLICTS.jobClosed),
  not_on_list: () =>
    conflict("That item isn't on this job's price list any more.", JOB_SHOP_CONFLICTS.notOnList),
  item_limit: () =>
    conflict("A job can have up to 100 products of its own.", JOB_SHOP_CONFLICTS.itemLimit),
  package_empty: () =>
    new ApiError("invalid_input", "Please check the highlighted fields.", {
      contents: "validation.packageEmpty",
    }),
};

/** The database's named errors (no values in them) as API errors; anything else as usual. */
export function jobShopError(error: NonNullable<DbError>): ApiError {
  const named = error.code === "P0001" && error.message ? NAMED[error.message] : undefined;
  if (named) return named();
  if (error.code === "P0002") return new ApiError("not_found", "We couldn't find that.");
  return fromDatabaseError(error);
}

/** The data of a Job › Shop call, or the matching API error. */
export function jobShopResult<T>(result: { data: unknown; error: DbError }): T {
  if (result.error) throw jobShopError(result.error);
  return result.data as T;
}

/** The job's shop as the API returns it (any member: ADR 0019 answer 8, N10). Another studio's job is not found. */
export async function loadJobShop(
  supabase: SupabaseClient,
  studioId: string,
  jobId: string,
): Promise<JobShop> {
  const db = jobShopResult<JobShopDb>(
    await supabase.rpc("job_shop", { p_studio_id: studioId, p_job_id: jobId }),
  );
  return toJobShop(db);
}

/** The job must be the studio's own (404 otherwise), checked before any write. */
export async function assertJobInStudio(
  supabase: SupabaseClient,
  studioId: string,
  jobId: string,
): Promise<void> {
  const rows = check(
    await supabase.from("jobs").select("id").eq("studio_id", studioId).eq("id", jobId).limit(1),
  );
  if (!rows || rows.length === 0) throw JOB_NOT_FOUND();
}

/**
 * A list item the studio has (404 otherwise, so another studio's id says nothing). Whether it is on this job's list
 * is the database's call (409 jobShop.notOnList: the list may have been swapped meanwhile).
 */
export async function assertListItemInStudio(
  supabase: SupabaseClient,
  studioId: string,
  itemId: string,
): Promise<void> {
  const rows = check(
    await supabase
      .from("price_list_items")
      .select("id")
      .eq("studio_id", studioId)
      .eq("id", itemId)
      .limit(1),
  );
  if (!rows || rows.length === 0) throw ITEM_NOT_FOUND();
}

/** One of this job's own products, with its kind, or 404 (another job's or studio's is never found). */
export async function loadJobItemKind(
  supabase: SupabaseClient,
  studioId: string,
  jobId: string,
  itemId: string,
): Promise<PriceItemKind> {
  const row = check(
    await supabase
      .from("job_shop_items")
      .select("kind")
      .eq("studio_id", studioId)
      .eq("job_id", jobId)
      .eq("id", itemId)
      .maybeSingle(),
  ) as { kind: PriceItemKind } | null;
  if (!row) throw ITEM_NOT_FOUND();
  return row.kind;
}

/** What save_job_item takes: the price list item's columns, and Sold. */
export function jobItemPayload(patch: JobItemPatch & { kind?: string }): Record<string, unknown> {
  return {
    ...itemPayload(patch as Parameters<typeof itemPayload>[0]),
    ...(patch.sold !== undefined ? { sold: patch.sold } : {}),
  };
}
