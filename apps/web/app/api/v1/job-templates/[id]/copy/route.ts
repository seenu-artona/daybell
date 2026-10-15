import { jobTemplateCopyInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import {
  assertTemplateRoom,
  loadTemplate,
  TEMPLATE_NOT_FOUND,
  templateInsertError,
} from "@/lib/job-templates";
import { rulesToDb } from "@/lib/jobs";
import { pathId } from "@/lib/roster";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/job-templates/:id/copy — owners and admins duplicate one of the studio's templates under a new name
 * (the screens send it from the locale files): the same rules, price list, delivery and class label. Not the default.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Template not found.");
  const { name } = await parseBody(request, jobTemplateCopyInput);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const source = await loadTemplate(supabase, studio.id, id);
  await assertTemplateRoom(supabase, studio.id);
  const inserted = await supabase
    .from("job_templates")
    .insert({
      studio_id: studio.id,
      name,
      price_list_id: source.priceListId,
      deliver_to_school: source.deliverToSchool,
      class_label: source.classLabel,
      ...rulesToDb(source.rules),
    })
    .select("id")
    .single();
  const limit = templateInsertError(inserted.error);
  if (limit) throw limit;
  const row = check(inserted) as { id: string } | null;
  if (!row) throw TEMPLATE_NOT_FOUND();
  return NextResponse.json(
    { template: await loadTemplate(supabase, studio.id, row.id) },
    { status: 201 },
  );
});
