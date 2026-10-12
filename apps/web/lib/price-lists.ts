import "server-only";
import {
  ApiError,
  fromDatabaseError,
  PRICE_LIST_CONFLICTS,
  type PriceList,
  type PriceListConflict,
  type PriceListItem,
  type PriceListItemInput,
  type PriceListSummary,
} from "@daybell/api";
import type { Currency, PriceItemKind, PrintSize } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { check } from "./api";

/**
 * Price lists (Phase 1 step 6, ADR 0019): reading them in the API's shapes, and the database's named errors as API
 * errors. Every query is filtered by the caller's studio as well as by row-level security (D96). Money leaves here as
 * whole cents with the list's currency, never anything else (D96).
 */

type DbError = { code?: string; message?: string } | null;

export const PRICE_LIST_COLUMNS = "id, name, currency, home_shipping_cents, created_at, updated_at";
export const ITEM_COLUMNS =
  "id, price_list_id, kind, name, description, print_size, price_cents, position, lines:price_list_package_lines (line_kind, print_size, quantity, position)";

export interface PriceListRow {
  id: string;
  name: string;
  currency: Currency;
  home_shipping_cents: number;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: string;
  price_list_id: string;
  kind: PriceItemKind;
  name: string;
  description: string | null;
  print_size: PrintSize | null;
  price_cents: number;
  position: number;
  lines:
    | {
        line_kind: "print" | "digital";
        print_size: PrintSize | null;
        quantity: number;
        position: number;
      }[]
    | null;
}

export interface SummaryRow {
  id: string;
  name: string;
  currency: Currency;
  is_default: boolean;
  packages: number;
  prints: number;
  digitals: number;
  jobs: number;
  selling_jobs: number;
  updated_at: string;
}

/** Postgres bigint may arrive as a string; it is always whole cents within the database's bounds. */
const cents = (value: number | string) => Number(value);

export function toItem(row: ItemRow, currency: Currency): PriceListItem {
  return {
    id: row.id,
    priceListId: row.price_list_id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    printSize: row.print_size,
    price: { cents: cents(row.price_cents), currency },
    contents: [...(row.lines ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ kind: l.line_kind, printSize: l.print_size, quantity: l.quantity })),
    position: row.position,
  };
}

export function toSummary(row: SummaryRow): PriceListSummary {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    isDefault: row.is_default,
    jobs: Number(row.jobs),
    sellingJobs: Number(row.selling_jobs),
    counts: {
      packages: Number(row.packages),
      prints: Number(row.prints),
      digitals: Number(row.digitals),
    },
    updatedAt: row.updated_at,
  };
}

/** A path id that isn't a UUID is simply not found (it can't be another studio's). */
export async function pathId(
  ctx: { params: Promise<{ id: string }> },
  what: string,
): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", `${what} not found.`);
  return id;
}

export const LIST_NOT_FOUND = () => new ApiError("not_found", "Price list not found.");
export const ITEM_NOT_FOUND = () => new ApiError("not_found", "Item not found.");

/** One of the studio's lists, or 404 (another studio's list is never found). */
export async function loadPriceListRow(
  supabase: SupabaseClient,
  studioId: string,
  id: string,
): Promise<PriceListRow> {
  const row = check(
    await supabase
      .from("price_lists")
      .select(PRICE_LIST_COLUMNS)
      .eq("studio_id", studioId)
      .eq("id", id)
      .maybeSingle(),
  ) as PriceListRow | null;
  if (!row) throw LIST_NOT_FOUND();
  return row;
}

/** Every list of the studio, or one, with counts and usage (price_list_summaries). */
export async function loadSummaries(
  supabase: SupabaseClient,
  studioId: string,
  id?: string,
): Promise<PriceListSummary[]> {
  const rows = (check(
    await supabase.rpc("price_list_summaries", {
      p_studio_id: studioId,
      ...(id ? { p_price_list_id: id } : {}),
    }),
  ) ?? []) as SummaryRow[];
  return rows.map(toSummary);
}

/** A whole list as the API returns it: settings, usage and every item in position order. */
export async function loadPriceList(
  supabase: SupabaseClient,
  studioId: string,
  id: string,
): Promise<PriceList> {
  const row = await loadPriceListRow(supabase, studioId, id);
  const [summary] = await loadSummaries(supabase, studioId, id);
  const items = (check(
    await supabase
      .from("price_list_items")
      .select(ITEM_COLUMNS)
      .eq("studio_id", studioId)
      .eq("price_list_id", id)
      .order("position")
      .order("id"),
  ) ?? []) as unknown as ItemRow[];
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    homeShipping: { cents: cents(row.home_shipping_cents), currency: row.currency },
    isDefault: summary?.isDefault ?? false,
    jobs: summary?.jobs ?? 0,
    sellingJobs: summary?.sellingJobs ?? 0,
    items: items.map((item) => toItem(item, row.currency)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** One of the studio's items with its list's currency, or 404. */
export async function loadItem(
  supabase: SupabaseClient,
  studioId: string,
  id: string,
): Promise<{ row: ItemRow; currency: Currency }> {
  const row = check(
    await supabase
      .from("price_list_items")
      .select(`${ITEM_COLUMNS}, list:price_lists (currency)`)
      .eq("studio_id", studioId)
      .eq("id", id)
      .maybeSingle(),
  ) as unknown as (ItemRow & { list: { currency: Currency } | null }) | null;
  if (!row?.list) throw ITEM_NOT_FOUND();
  const { list, ...item } = row;
  return { row: item, currency: list.currency };
}

/** What save_price_list_item takes: database column names, only the fields given. */
export function itemPayload(input: {
  kind?: PriceListItemInput["kind"] | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  priceCents?: number | undefined;
  printSize?: PrintSize | undefined;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.kind !== undefined) out.kind = input.kind;
  if (input.name !== undefined) out.name = input.name;
  if (input.description !== undefined) out.description = input.description;
  if (input.priceCents !== undefined) out.price_cents = input.priceCents;
  if (input.printSize !== undefined) out.print_size = input.printSize;
  return out;
}

/** A package's contents as save_price_list_item takes them, or null to keep them. */
export function linesPayload(
  contents: PriceListItemInput["contents"] | undefined,
): unknown[] | null {
  if (contents === undefined) return null;
  return contents.map((line) =>
    line.kind === "print"
      ? { kind: "print", print_size: line.printSize, quantity: line.quantity }
      : { kind: "digital", print_size: null, quantity: 1 },
  );
}

export const conflict = (message: string, form: PriceListConflict) =>
  new ApiError("conflict", message, { form });

const NAMED: Record<string, () => ApiError> = {
  price_list_limit: () =>
    conflict("A studio can have up to 50 price lists.", PRICE_LIST_CONFLICTS.limit),
  item_limit: () =>
    conflict("A price list can have up to 100 items.", PRICE_LIST_CONFLICTS.itemLimit),
  job_closed: () =>
    conflict(
      "This job is closed, so its price list and delivery can't change.",
      PRICE_LIST_CONFLICTS.jobClosed,
    ),
  package_empty: () =>
    new ApiError("invalid_input", "Please check the highlighted fields.", {
      contents: "validation.packageEmpty",
    }),
};

export const DIGITAL_TAKEN = () =>
  conflict("This price list already has that digital download.", PRICE_LIST_CONFLICTS.digitalTaken);
export const IS_DEFAULT = () =>
  conflict(
    "This is the default price list. Make another list the default first.",
    PRICE_LIST_CONFLICTS.isDefault,
  );
export const IN_USE = () =>
  conflict("Jobs use this price list. Give them another list first.", PRICE_LIST_CONFLICTS.inUse);

/** The database's named errors (no values in them) as API errors; anything else as usual. */
export function priceListError(error: NonNullable<DbError>): ApiError {
  const named = error.code === "P0001" && error.message ? NAMED[error.message] : undefined;
  if (named) return named();
  if (error.code === "P0002") return new ApiError("not_found", "We couldn't find that.");
  // The list's one single digital / one "all digitals" only, not a package's one digital line (zod catches that one).
  if (error.code === "23505" && /price_list_items_one_digital/.test(error.message ?? ""))
    return DIGITAL_TAKEN();
  return fromDatabaseError(error);
}

/** The data of a price list call, or the matching API error. */
export function priceListResult<T>(result: { data: unknown; error: DbError }): T {
  if (result.error) throw priceListError(result.error);
  return result.data as T;
}

/**
 * The price list must be one of the studio's. The composite FK enforces it too; checking first gives a field error
 * instead of a generic one.
 */
export async function assertPriceListInStudio(
  supabase: SupabaseClient,
  studioId: string,
  priceListId: string | undefined,
): Promise<void> {
  if (!priceListId) return;
  const rows = check(
    await supabase
      .from("price_lists")
      .select("id")
      .eq("studio_id", studioId)
      .eq("id", priceListId)
      .limit(1),
  );
  if (!rows || rows.length === 0)
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      priceListId: "validation.priceList",
    });
}
