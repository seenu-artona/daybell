import "server-only";
import {
  ApiError,
  type Client,
  type ClientListItem,
  type Contact,
  type ContactShowFilter,
  type ContactsResponse,
  type StudioSummary,
  type Subject,
  type SubjectShowFilter,
  type SubjectsResponse,
} from "@daybell/api";
import { canSeeOrders } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";
import { page } from "./jobs";

/**
 * People (D150, ADR 0028): the clients list's extra columns, contacts and every child across a studio's jobs. Every
 * query names the studio (D96) and row-level security says the same. Search text arrives in a POST body and goes to
 * the database as an RPC argument only: never in a URL, a log or an error (D113).
 */

// ── Clients ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface ClientDetailsRow {
  client_id: string;
  job_count: number;
  latest_job: { id: string; name: string; picture_day: string } | null;
  main_contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    role: string | null;
    email: string | null;
  } | null;
}

/** A page of clients with their main contact, job count and latest job (client_list_details), in the page's order. */
export async function withClientDetails(
  supabase: SupabaseClient,
  studioId: string,
  clients: Client[],
): Promise<ClientListItem[]> {
  if (clients.length === 0) return [];
  const rows = (check(
    await supabase.rpc("client_list_details", {
      p_studio_id: studioId,
      p_client_ids: clients.map((c) => c.id),
    }),
  ) ?? []) as ClientDetailsRow[];
  const byId = new Map(rows.map((r) => [r.client_id, r]));
  return clients.map((client) => {
    const row = byId.get(client.id);
    const main = row?.main_contact ?? null;
    return {
      ...client,
      mainContact: main
        ? {
            id: main.id,
            firstName: main.first_name,
            lastName: main.last_name,
            role: main.role,
            email: main.email,
          }
        : null,
      jobCount: Number(row?.job_count ?? 0),
      latestJob: row?.latest_job
        ? {
            id: row.latest_job.id,
            name: row.latest_job.name,
            pictureDay: row.latest_job.picture_day,
          }
        : null,
    };
  });
}

// ── Contacts ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Columns the contact routes read; the client's name is embedded through the composite studio FK (ADR 0008). */
export const CONTACT_COLUMNS =
  "id, client_id, first_name, last_name, role, email, phone, is_main, created_at, updated_at, client:clients (name)";

export interface ContactRow {
  id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_main: boolean;
  created_at: string;
  updated_at: string;
  /** From a select with CONTACT_COLUMNS. */
  client?: { name: string } | null;
  /** From list_client_contacts. */
  client_name?: string;
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name ?? row.client?.name ?? "",
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    isMain: row.is_main,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The API's contact fields and their columns. */
export const CONTACT_COLUMN_FOR = {
  firstName: "first_name",
  lastName: "last_name",
  role: "role",
  email: "email",
  phone: "phone",
  isMain: "is_main",
} as const;

/** Database columns for the contact fields present in `input` (validated already); null clears one. */
export function contactColumns(
  input: Partial<Record<keyof typeof CONTACT_COLUMN_FOR, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(CONTACT_COLUMN_FOR) as (keyof typeof CONTACT_COLUMN_FOR)[])
      .filter((k) => input[k] !== undefined)
      .map((k) => [CONTACT_COLUMN_FOR[k], input[k]]),
  );
}

/** A page of the studio's contacts (list_client_contacts), optionally searched by name or email. */
export async function listContacts(
  supabase: SupabaseClient,
  studioId: string,
  query: {
    q?: string | undefined;
    show?: ContactShowFilter | undefined;
    clientId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
): Promise<ContactsResponse> {
  const list = check(
    await supabase.rpc("list_client_contacts", {
      p_studio_id: studioId,
      p_q: query.q ?? null,
      p_main_only: query.show === "main",
      p_client_id: query.clientId ?? null,
      p_after: query.cursor ?? null,
      p_limit: query.limit + 1,
    }),
  ) as { contacts: ContactRow[]; total: number } | null;
  const { items, nextCursor } = page(list?.contacts ?? [], query.limit);
  return { contacts: items.map(toContact), nextCursor, total: Number(list?.total ?? 0) };
}

// ── Subjects ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface SubjectRow {
  id: string;
  job_id: string;
  job_name: string;
  first_name: string;
  last_name: string;
  group_name: string | null;
  has_paid_order: boolean | null;
}

/**
 * A page of every child across the studio's jobs (list_studio_children), optionally searched by name. Order data
 * (D148) only for people who see orders: anyone else gets null, here and in the database, and may not filter by it.
 */
export async function listSubjects(
  supabase: SupabaseClient,
  studio: Pick<StudioSummary, "id" | "role">,
  query: {
    q?: string | undefined;
    show?: SubjectShowFilter | undefined;
    jobId?: string | undefined;
    clientId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
): Promise<SubjectsResponse> {
  const seesOrders = canSeeOrders(studio.role);
  if (query.show && !seesOrders) throw new ApiError("forbidden", "Owners, admins and staff only.");
  const list = check(
    await supabase.rpc("list_studio_children", {
      p_studio_id: studio.id,
      p_q: query.q ?? null,
      p_show: query.show ?? null,
      p_job_id: query.jobId ?? null,
      p_client_id: query.clientId ?? null,
      p_after: query.cursor ?? null,
      p_limit: query.limit + 1,
    }),
  ) as { subjects: SubjectRow[]; total: number; jobs: number } | null;
  const { items, nextCursor } = page(list?.subjects ?? [], query.limit);
  const subjects: Subject[] = items.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    className: row.group_name,
    job: { id: row.job_id, name: row.job_name },
    hasPaidOrder: seesOrders ? (row.has_paid_order ?? null) : null,
  }));
  return {
    subjects,
    nextCursor,
    total: Number(list?.total ?? 0),
    jobs: Number(list?.jobs ?? 0),
  };
}
