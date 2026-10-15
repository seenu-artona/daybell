import "server-only";
import { ApiError, JOB_TEMPLATE_CONFLICTS, type JobTemplate } from "@daybell/api";
import { rulesValid } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";
import { type DbRules, rulesFromDb } from "./jobs";

/** At most this many templates per studio (D154; ADR 0029, call 6). */
export const MAX_JOB_TEMPLATES = 50;

/** A row of list_job_templates. */
export interface TemplateRow extends DbRules {
  id: string;
  name: string;
  is_default: boolean;
  used_by: number | string;
  price_list_id: string | null;
  deliver_to_school: boolean;
  class_label: string;
  created_at: string;
  updated_at: string;
}

export function toTemplate(row: TemplateRow): JobTemplate {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    usedBy: Number(row.used_by),
    rules: rulesFromDb(row),
    priceListId: row.price_list_id,
    deliverToSchool: row.deliver_to_school,
    classLabel: row.class_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const TEMPLATE_NOT_FOUND = () => new ApiError("not_found", "Template not found.");

/**
 * The studio's templates, the default first, with how many jobs use each: one query (list_job_templates, row-level
 * security and an explicit studio filter).
 */
export async function loadTemplates(
  supabase: SupabaseClient,
  studioId: string,
): Promise<JobTemplate[]> {
  const rows = (check(await supabase.rpc("list_job_templates", { p_studio_id: studioId })) ??
    []) as TemplateRow[];
  return rows.map(toTemplate);
}

/** One of the studio's templates, or not found (another studio's is simply not found, D96). */
export async function loadTemplate(
  supabase: SupabaseClient,
  studioId: string,
  id: string,
): Promise<JobTemplate> {
  const found = (await loadTemplates(supabase, studioId)).find((t) => t.id === id);
  if (!found) throw TEMPLATE_NOT_FOUND();
  return found;
}

/** The template must be the studio's: a field error rather than the composite key's failure. */
export async function assertTemplateInStudio(
  supabase: SupabaseClient,
  studioId: string,
  templateId: string | undefined,
): Promise<void> {
  if (!templateId) return;
  const rows = check(
    await supabase
      .from("job_templates")
      .select("id")
      .eq("studio_id", studioId)
      .eq("id", templateId)
      .limit(1),
  );
  if (!rows || rows.length === 0)
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      templateId: "validation.template",
    });
}

const TEMPLATE_LIMIT = () =>
  new ApiError("conflict", "A studio can have at most 50 templates.", {
    form: JOB_TEMPLATE_CONFLICTS.limit,
  });

/** The database's own limit (two adds at the same moment): its named refusal becomes the same 409. */
export function templateInsertError(
  error: { code?: string; message?: string } | null,
): ApiError | null {
  return error?.code === "P0001" && error.message === "template_limit" ? TEMPLATE_LIMIT() : null;
}

/** The studio has room for one more template (the database checks again, race-safe). */
export async function assertTemplateRoom(
  supabase: SupabaseClient,
  studioId: string,
): Promise<void> {
  const result = await supabase
    .from("job_templates")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", studioId);
  check(result);
  if ((result.count ?? 0) >= MAX_JOB_TEMPLATES) throw TEMPLATE_LIMIT();
}

/** Rules that don't make a whole (days without "after picture day", or the other way round): a field error. */
export function assertRulesWhole(rules: Parameters<typeof rulesValid>[0]): void {
  if (!rulesValid(rules))
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      shopOpensDays: "validation.shopOpensDays",
    });
}

export const TEMPLATE_IS_DEFAULT = () =>
  new ApiError(
    "conflict",
    "The default template can't be deleted. Make another the default first.",
    {
      form: JOB_TEMPLATE_CONFLICTS.isDefault,
    },
  );
