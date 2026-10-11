import "server-only";
import {
  ApiError,
  fieldErrors,
  type Job,
  type JobInput,
  jobInput,
  type Organization,
  type OrganizationInput,
  organizationInput,
} from "@daybell/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";

/** Columns the API reads, with the job's organization embedded through the composite studio FK (ADR 0008). */
export const JOB_COLUMNS =
  "id, name, type, status, picture_day, created_at, updated_at, organization:organizations (id, name, city)";
export const ORGANIZATION_COLUMNS =
  "id, name, kind, notes, address_line1, address_line2, city, region_code, postal_code, country, created_at, updated_at";

export interface JobRow {
  id: string;
  name: string;
  type: Job["type"];
  status: Job["status"];
  picture_day: string | null;
  created_at: string;
  updated_at: string;
  organization: { id: string; name: string; city: string | null } | null;
}

export interface OrganizationRow {
  id: string;
  name: string;
  kind: Organization["kind"];
  notes: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region_code: string | null;
  postal_code: string | null;
  country: Organization["country"];
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
    organization: row.organization,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    notes: row.notes,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region_code,
    postalCode: row.postal_code,
    country: row.country,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ORGANIZATION_COLUMN_FOR: Record<keyof OrganizationInput, keyof OrganizationRow> = {
  name: "name",
  kind: "kind",
  notes: "notes",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "city",
  region: "region_code",
  postalCode: "postal_code",
  country: "country",
};

const JOB_COLUMN_FOR: Record<keyof JobInput, string> = {
  name: "name",
  type: "type",
  organizationId: "organization_id",
  pictureDay: "picture_day",
};

/** Database columns for the given API fields (only those present), from an already validated input. */
export function organizationColumns(
  input: OrganizationInput,
  keys: (keyof OrganizationInput)[] = Object.keys(input) as (keyof OrganizationInput)[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [ORGANIZATION_COLUMN_FOR[k], input[k] ?? null]));
}

export function jobColumns(
  input: JobInput,
  keys: (keyof JobInput)[] = Object.keys(input) as (keyof JobInput)[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [JOB_COLUMN_FOR[k], input[k] ?? null]));
}

/** Validates a whole organization (e.g. an existing one with a patch applied). */
export function validOrganization(value: unknown): OrganizationInput {
  const result = organizationInput.safeParse(value);
  if (!result.success)
    throw new ApiError(
      "invalid_input",
      "Please check the highlighted fields.",
      fieldErrors(result.error),
    );
  return result.data;
}

/** Validates a whole job, including the rule that some job types need an organization. */
export function validJob(value: unknown): JobInput {
  const result = jobInput.safeParse(value);
  if (!result.success)
    throw new ApiError(
      "invalid_input",
      "Please check the highlighted fields.",
      fieldErrors(result.error),
    );
  return result.data;
}

/** The organization must exist in this studio (the composite FK enforces it too; this gives a field error). */
export async function assertOrganizationInStudio(
  supabase: SupabaseClient,
  studioId: string,
  organizationId: string | null | undefined,
): Promise<void> {
  if (!organizationId) return;
  const rows = check(
    await supabase
      .from("organizations")
      .select("id")
      .eq("studio_id", studioId)
      .eq("id", organizationId)
      .limit(1),
  );
  if (!rows || rows.length === 0)
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      organizationId: "validation.organization",
    });
}

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
