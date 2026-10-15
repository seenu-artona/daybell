import { jobTemplatePatch } from "@daybell/api";
import { withRules } from "@daybell/core";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import {
  assertRulesWhole,
  loadTemplate,
  TEMPLATE_IS_DEFAULT,
  TEMPLATE_NOT_FOUND,
} from "@/lib/job-templates";
import { rulesToDb } from "@/lib/jobs";
import { assertPriceListInStudio } from "@/lib/price-lists";
import { pathId } from "@/lib/roster";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/job-templates/:id — one of the studio's templates (D154). */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Template not found.");
  const { supabase, studio } = await studioScope();
  return NextResponse.json({ template: await loadTemplate(supabase, studio.id, id) });
});

/**
 * PATCH /api/v1/job-templates/:id — owners and admins change a template. The rules must still make a whole (days after
 * picture day exactly when the shop opens then). Jobs already made from it keep their own rules (D154). The database
 * writes job_template.updated with the changed fields' names.
 */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Template not found.");
  const patch = await parseBody(request, jobTemplatePatch);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const current = await loadTemplate(supabase, studio.id, id);
  const { name, priceListId, deliverToSchool, classLabel, ...rulePatch } = patch;
  const rules = withRules(current.rules, rulePatch);
  assertRulesWhole(rules);
  await assertPriceListInStudio(supabase, studio.id, priceListId ?? undefined);
  const changed = {
    ...(name !== undefined ? { name } : {}),
    ...(priceListId !== undefined ? { price_list_id: priceListId } : {}),
    ...(deliverToSchool !== undefined ? { deliver_to_school: deliverToSchool } : {}),
    ...(classLabel !== undefined ? { class_label: classLabel } : {}),
    ...rulesToDb({ ...rulePatch, shopOpensDays: rules.shopOpensDays }),
  };
  const rows = check(
    await supabase
      .from("job_templates")
      .update(changed)
      .eq("studio_id", studio.id)
      .eq("id", id)
      .select("id"),
  ) as { id: string }[] | null;
  if (!rows || rows.length === 0) throw TEMPLATE_NOT_FOUND();
  return NextResponse.json({ template: await loadTemplate(supabase, studio.id, id) });
});

/**
 * DELETE /api/v1/job-templates/:id — owners and admins delete a template that isn't the default (the database's key
 * refuses that too). Jobs made from it keep their own rules; the database writes job_template.deleted.
 */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Template not found.");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const current = await loadTemplate(supabase, studio.id, id);
  if (current.isDefault) throw TEMPLATE_IS_DEFAULT();
  const result = await supabase
    .from("job_templates")
    .delete()
    .eq("studio_id", studio.id)
    .eq("id", id)
    .select("id");
  // It became the default between the check and the delete.
  if (result.error?.code === "23503") throw TEMPLATE_IS_DEFAULT();
  if ((check(result) ?? []).length === 0) throw TEMPLATE_NOT_FOUND();
  return new NextResponse(null, { status: 204 });
});
