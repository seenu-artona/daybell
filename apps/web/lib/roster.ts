import "server-only";
import {
  ApiError,
  type Child,
  type ChildInput,
  childInput,
  fieldErrors,
  type Group,
  type RosterImportResponse,
  type RosterRow,
} from "@daybell/api";
import {
  type AccessCodeCryptoKeys,
  decryptAccessCode,
  type ExistingChild,
  findDuplicates,
  formatAccessCode,
  type JobStatus,
  type RosterPlan,
  type RosterRowDraft,
} from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { check } from "./api";

/**
 * Server helpers for the roster (Phase 1 step 2, ADR 0011). Queries only ever put IDs in URLs: names, emails and codes
 * travel in request bodies (inserts, updates, RPC calls), so they never reach request logs (D96).
 */

/** Columns the API reads from children. Never the code hash (browsers can't read it anyway). */
export const CHILD_COLUMNS =
  "id, job_id, group_id, first_name, last_name, student_id, grade, parent_email, do_not_photograph, do_not_publish, school_provided, access_code_ciphertext, created_at, updated_at";

export interface ChildRow {
  id: string;
  job_id: string;
  group_id: string | null;
  /** From list_children; looked up separately elsewhere. */
  group_name?: string | null;
  first_name: string;
  last_name: string;
  student_id: string | null;
  grade: string | null;
  parent_email: string | null;
  do_not_photograph: boolean;
  do_not_publish: boolean;
  school_provided: boolean;
  access_code_ciphertext: string;
  /** From list_children; computed separately elsewhere. */
  duplicate?: boolean;
  created_at: string;
  updated_at: string;
}

/** The child's code, or null when its encrypted copy can't be read (e.g. a wrong key); never breaks the list. */
async function readableCode(row: ChildRow, keys: AccessCodeCryptoKeys): Promise<string | null> {
  try {
    return formatAccessCode(
      await decryptAccessCode(row.access_code_ciphertext, row.id, keys.encryption),
    );
  } catch {
    // A fixed event name and the child's id only: never the ciphertext, a code or a name (D96).
    console.error("access_code_unreadable", row.id);
    return null;
  }
}

/** A child for the API, with the code decrypted for the studio to see (Seenu #2). */
export async function toChild(row: ChildRow, keys: AccessCodeCryptoKeys): Promise<Child> {
  const accessCode = await readableCode(row, keys);
  return {
    id: row.id,
    jobId: row.job_id,
    group: row.group_id ? { id: row.group_id, name: row.group_name ?? "" } : null,
    firstName: row.first_name,
    lastName: row.last_name,
    studentId: row.student_id,
    grade: row.grade,
    parentEmail: row.parent_email,
    doNotPhotograph: row.do_not_photograph,
    doNotPublish: row.do_not_publish,
    schoolProvided: row.school_provided,
    accessCode,
    duplicate: row.duplicate ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CHILD_COLUMN_FOR: Record<keyof ChildInput, string> = {
  firstName: "first_name",
  lastName: "last_name",
  groupId: "group_id",
  studentId: "student_id",
  grade: "grade",
  parentEmail: "parent_email",
  doNotPhotograph: "do_not_photograph",
  doNotPublish: "do_not_publish",
};

/** Database columns for the given API fields (only those present), from an already validated input. */
export function childColumns(
  input: ChildInput,
  keys: (keyof ChildInput)[] = Object.keys(input) as (keyof ChildInput)[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.map((k) => {
      const value = input[k];
      const empty = k === "doNotPhotograph" || k === "doNotPublish" ? false : null;
      return [CHILD_COLUMN_FOR[k], value ?? empty];
    }),
  );
}

/** Validates a whole child (e.g. an existing one with a patch applied). */
export function validChild(value: unknown): ChildInput {
  const result = childInput.safeParse(value);
  if (!result.success)
    throw new ApiError(
      "invalid_input",
      "Please check the highlighted fields.",
      fieldErrors(result.error),
    );
  return result.data;
}

/** A uuid path parameter, or a 404 that says what wasn't found. */
export async function pathId(
  ctx: { params: Promise<{ id: string }> },
  notFound: string,
): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", notFound);
  return id;
}

export interface RosterJob {
  id: string;
  status: JobStatus;
}

export async function loadRosterJob(
  supabase: SupabaseClient,
  studioId: string,
  jobId: string,
): Promise<RosterJob> {
  const job = check(
    await supabase
      .from("jobs")
      .select("id, status")
      .eq("studio_id", studioId)
      .eq("id", jobId)
      .maybeSingle(),
  ) as RosterJob | null;
  if (!job) throw new ApiError("not_found", "Job not found.");
  return job;
}

/** Children can be removed only while their job is a draft (Seenu #12). The database trigger is the backstop. */
export function assertCanRemoveFrom(job: RosterJob): void {
  if (job.status !== "draft")
    throw new ApiError("conflict", "Children can be removed only while the job is a draft.");
}

/**
 * The group, which must be one of this job's. The composite FK enforces it too; checking first gives a field error
 * instead of a generic one.
 */
export async function assertGroupInJob(
  supabase: SupabaseClient,
  studioId: string,
  jobId: string,
  groupId: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!groupId) return null;
  const group = check(
    await supabase
      .from("job_groups")
      .select("id, name")
      .eq("studio_id", studioId)
      .eq("job_id", jobId)
      .eq("id", groupId)
      .maybeSingle(),
  ) as { id: string; name: string } | null;
  if (!group)
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      groupId: "validation.group",
    });
  return group;
}

type DbError = { code?: string; message?: string } | null;

export function isGroupNameTaken(error: DbError): boolean {
  return error?.code === "23505" && (error.message ?? "").includes("job_groups_job_name_key");
}

export const GROUP_NAME_TAKEN = new ApiError(
  "invalid_input",
  "Please check the highlighted fields.",
  {
    name: "validation.groupNameTaken",
  },
);

/** The named failures add_child and import_roster raise (their messages carry no values). */
export function isRpcError(
  error: DbError,
  name: "access_code_collision" | "roster_changed",
): boolean {
  return error?.code === "P0001" && error.message === name;
}

const PAGE = 1000; // Supabase returns at most 1,000 rows per request by default.

async function allRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = (check(await fetchPage(from, from + PAGE - 1)) ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** A job's groups (id and name). */
export async function loadGroups(
  supabase: SupabaseClient,
  studioId: string,
  jobId: string,
): Promise<{ id: string; name: string }[]> {
  return allRows((from, to) =>
    supabase
      .from("job_groups")
      .select("id, name")
      .eq("studio_id", studioId)
      .eq("job_id", jobId)
      .order("id")
      .range(from, to),
  );
}

/** Everything the import plan and duplicate checks need about a job's children, plus its groups. */
export async function loadRoster(
  supabase: SupabaseClient,
  studioId: string,
  jobId: string,
): Promise<{ children: ExistingChild[]; groups: { id: string; name: string }[] }> {
  const [groups, rows] = await Promise.all([
    loadGroups(supabase, studioId, jobId),
    allRows<{
      id: string;
      student_id: string | null;
      first_name: string;
      last_name: string;
      group_id: string | null;
    }>((from, to) =>
      supabase
        .from("children")
        .select("id, student_id, first_name, last_name, group_id")
        .eq("studio_id", studioId)
        .eq("job_id", jobId)
        .order("id")
        .range(from, to),
    ),
  ]);
  const names = new Map(groups.map((g) => [g.id, g.name]));
  return {
    groups,
    children: rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      firstName: r.first_name,
      lastName: r.last_name,
      groupName: r.group_id ? (names.get(r.group_id) ?? null) : null,
    })),
  };
}

/** Whether a child duplicates another child in its job (same rule as the roster list). */
export function isDuplicate(children: readonly ExistingChild[], childId: string): boolean {
  const entries = children.map((c) => ({
    firstName: c.firstName,
    lastName: c.lastName,
    studentId: c.studentId,
    group: c.groupName,
  }));
  const index = children.findIndex((c) => c.id === childId);
  return index >= 0 && findDuplicates(entries).has(index);
}

/** Groups sorted the way people read them: "Room 2" before "Room 10". */
export function sortGroups<T extends Pick<Group, "name">>(groups: T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...groups].sort((a, b) => collator.compare(a.name, b.name));
}

/** Validated request rows as core drafts (blank optional values become null). */
export function rosterDrafts(rows: readonly RosterRow[]): RosterRowDraft[] {
  return rows.map((r) => ({
    firstName: r.firstName,
    lastName: r.lastName,
    group: r.group ?? null,
    studentId: r.studentId ?? null,
    grade: r.grade ?? null,
    parentEmail: r.parentEmail ?? null,
    doNotPhotograph: r.doNotPhotograph ?? null,
    doNotPublish: r.doNotPublish ?? null,
  }));
}

/** The import response: what a plan does (or did), row by row, in request order. */
export function importSummary(
  plan: RosterPlan,
  groupsAdded: number,
  dryRun: boolean,
): RosterImportResponse {
  return {
    dryRun,
    added: plan.actions.filter((a) => a.kind === "add").length,
    updated: plan.actions.filter((a) => a.kind === "update").length,
    groupsAdded,
    duplicates: plan.duplicate.filter(Boolean).length,
    rows: plan.actions.map((a, i) => ({ action: a.kind, duplicate: plan.duplicate[i] ?? false })),
  };
}

/**
 * The rows import_roster takes (snake_case). Adds get a fresh id and code; updates point at the matched child and carry
 * no code (a child keeps theirs).
 */
export async function importRpcRows(
  drafts: readonly RosterRowDraft[],
  plan: RosterPlan,
  newCode: (childId: string) => Promise<{ hash: string; ciphertext: string }>,
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    drafts.map(async (d, i) => {
      const fields = {
        first_name: d.firstName,
        last_name: d.lastName,
        group_name: d.group,
        student_id: d.studentId,
        grade: d.grade,
        parent_email: d.parentEmail,
        do_not_photograph: d.doNotPhotograph,
        do_not_publish: d.doNotPublish,
      };
      const action = plan.actions[i];
      if (action?.kind === "update") return { action: "update", id: action.id, ...fields };
      const id = crypto.randomUUID();
      const code = await newCode(id);
      return {
        action: "add",
        id,
        ...fields,
        access_code_hash: code.hash,
        access_code_ciphertext: code.ciphertext,
      };
    }),
  );
}

type RpcResult = { data: unknown; error: DbError };

/** Tries for codes: a taken code is astronomically rare, so three in a row means something else is wrong. */
const CODE_ATTEMPTS = 3;

/**
 * Adds a child through add_child, with a fresh id and code on each try (`attempt` makes them). A taken code tries
 * again; anything else is returned as it is.
 */
export async function addChildWithRetries(
  attempt: () => PromiseLike<RpcResult>,
): Promise<RpcResult> {
  for (let tries = 1; ; tries++) {
    const result = await attempt();
    if (isRpcError(result.error, "access_code_collision") && tries < CODE_ATTEMPTS) continue;
    return result;
  }
}

export const ROSTER_CHANGED = new ApiError(
  "conflict",
  "The roster changed while importing. Please check the rows again.",
);

/**
 * Saves an import through import_roster. `send` builds the rows for a plan (fresh codes each time) and calls the
 * database. A taken code tries again with new codes (three tries in all); a matched child removed meanwhile
 * (roster_changed) plans once more from the roster as it is now. Either happening again is a conflict the studio
 * resolves by checking the rows again.
 */
export async function saveImport<P>(options: {
  plan: P;
  replan: () => Promise<P>;
  send: (plan: P) => PromiseLike<RpcResult>;
}): Promise<{ plan: P; data: unknown }> {
  let plan = options.plan;
  let collisions = 0;
  let replanned = false;
  for (;;) {
    const result = await options.send(plan);
    if (isRpcError(result.error, "access_code_collision")) {
      if (++collisions < CODE_ATTEMPTS) continue;
      throw ROSTER_CHANGED;
    }
    if (isRpcError(result.error, "roster_changed")) {
      if (replanned) throw ROSTER_CHANGED;
      replanned = true;
      plan = await options.replan();
      continue;
    }
    return { plan, data: check(result) };
  }
}
