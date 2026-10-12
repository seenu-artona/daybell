import "server-only";
import {
  ApiError,
  type Client,
  type ClientInput,
  clientInput,
  fieldErrors,
  type Job,
  type JobInput,
  jobInput,
} from "@daybell/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";

/** Columns the API reads; the client is embedded through the composite studio FK (ADR 0008). */
export const JOB_COLUMNS =
  "id, name, type, status, picture_day, internal_number, subjects_expected, price_list_id, deliver_to_school, created_at, updated_at, client:clients (id, name, city)";
export const CLIENT_COLUMNS =
  "id, name, address_line1, address_line2, postal_code, city, region_code, country, contact_first_name, contact_last_name, contact_phone, contact_email, notes, created_at, updated_at";

export interface JobRow {
  id: string;
  name: string;
  type: Job["type"];
  status: Job["status"];
  picture_day: string;
  internal_number: string;
  subjects_expected: number | null;
  price_list_id: string;
  deliver_to_school: boolean;
  created_at: string;
  updated_at: string;
  client: { id: string; name: string; city: string | null } | null;
}

export interface ClientRow {
  id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  region_code: string | null;
  country: Client["country"];
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    pictureDay: row.picture_day,
    client: row.client,
    internalNumber: row.internal_number,
    subjectsExpected: row.subjects_expected,
    priceListId: row.price_list_id,
    deliverToSchool: row.deliver_to_school,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    postalCode: row.postal_code,
    city: row.city,
    region: row.region_code,
    country: row.country,
    contactFirstName: row.contact_first_name,
    contactLastName: row.contact_last_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CLIENT_COLUMN_FOR: Record<keyof ClientInput, keyof ClientRow> = {
  name: "name",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  postalCode: "postal_code",
  city: "city",
  region: "region_code",
  country: "country",
  contactFirstName: "contact_first_name",
  contactLastName: "contact_last_name",
  contactPhone: "contact_phone",
  contactEmail: "contact_email",
  notes: "notes",
};

const JOB_COLUMN_FOR: Record<keyof JobInput, string> = {
  name: "name",
  pictureDay: "picture_day",
  clientId: "client_id",
  internalNumber: "internal_number",
  type: "type",
  subjectsExpected: "subjects_expected",
  priceListId: "price_list_id",
  deliverToSchool: "deliver_to_school",
};

/** Database columns for the given API fields (only those present), from an already validated input. */
export function clientColumns(
  input: ClientInput,
  keys: (keyof ClientInput)[] = Object.keys(input) as (keyof ClientInput)[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [CLIENT_COLUMN_FOR[k], input[k] ?? null]));
}

/** A new job without a price list gets the studio's default from the database, so it is never sent as null. */
export function jobColumns(
  input: JobInput,
  keys: (keyof JobInput)[] = Object.keys(input) as (keyof JobInput)[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((k) => !(k === "priceListId" && input[k] === undefined))
      .map((k) => [JOB_COLUMN_FOR[k], input[k] ?? null]),
  );
}

function valid<T>(
  result: { success: true; data: T } | { success: false; error: Parameters<typeof fieldErrors>[0] },
): T {
  if (!result.success)
    throw new ApiError(
      "invalid_input",
      "Please check the highlighted fields.",
      fieldErrors(result.error),
    );
  return result.data;
}

/** Validates a whole client (e.g. an existing one with a patch applied). */
export function validClient(value: unknown): ClientInput {
  return valid(clientInput.safeParse(value));
}

/** Validates a whole job (e.g. an existing one with a patch applied). */
export function validJob(value: unknown): JobInput {
  return valid(jobInput.safeParse(value));
}

/**
 * The client must exist in this studio. The composite FK enforces it too; checking first gives a field error instead
 * of a generic one.
 */
export async function assertClientInStudio(
  supabase: SupabaseClient,
  studioId: string,
  clientId: string | null | undefined,
): Promise<void> {
  if (!clientId) return;
  const rows = check(
    await supabase
      .from("clients")
      .select("id")
      .eq("studio_id", studioId)
      .eq("id", clientId)
      .limit(1),
  );
  if (!rows || rows.length === 0)
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      clientId: "validation.client",
    });
}

/** The studio's next free JOBnnnnn number (database function, RLS-scoped). */
export async function nextJobNumber(supabase: SupabaseClient, studioId: string): Promise<string> {
  return check(await supabase.rpc("next_job_number", { p_studio_id: studioId })) as string;
}

/** A unique-number clash becomes a field error on internalNumber; other errors are mapped as usual. */
export function isNumberTaken(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === "23505" && (error.message ?? "").includes("jobs_studio_internal_number_key")
  );
}

export const NUMBER_TAKEN = new ApiError("invalid_input", "Please check the highlighted fields.", {
  internalNumber: "validation.internalNumberTaken",
});

/** Of `limit + 1` rows, the page to return and the cursor for the next one. */
export function page<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
  };
}
