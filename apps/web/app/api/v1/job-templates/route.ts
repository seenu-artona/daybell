import { jobTemplateInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import {
  assertTemplateRoom,
  loadTemplate,
  loadTemplates,
  TEMPLATE_NOT_FOUND,
  templateInsertError,
} from "@/lib/job-templates";
import { rulesToDb } from "@/lib/jobs";
import { assertPriceListInStudio } from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

/**
 * GET /api/v1/job-templates — the studio's job templates (D154; ADR 0029), the default first, each with how many jobs
 * were made from it. Everyone on the team reads them (they choose one when making a job).
 */
export const GET = handle(async () => {
  const { supabase, studio } = await studioScope();
  return NextResponse.json({ templates: await loadTemplates(supabase, studio.id) });
});

/**
 * POST /api/v1/job-templates — owners and admins add a template: a name and any rules (the rest are today's
 * defaults). Its price list, when named, must be the studio's. At most 50 per studio. The database writes
 * job_template.created (its id only).
 */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, jobTemplateInput);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  await assertPriceListInStudio(supabase, studio.id, input.priceListId ?? undefined);
  await assertTemplateRoom(supabase, studio.id);
  const { name, priceListId, deliverToSchool, ...rules } = input;
  const inserted = await supabase
    .from("job_templates")
    .insert({
      studio_id: studio.id,
      name,
      price_list_id: priceListId,
      deliver_to_school: deliverToSchool,
      ...rulesToDb(rules),
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
