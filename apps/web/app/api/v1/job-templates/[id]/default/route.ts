import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { loadTemplate } from "@/lib/job-templates";
import { pathId } from "@/lib/roster";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/job-templates/:id/default — owners and admins make one of the studio's templates the default: new jobs
 * get it unless another is chosen; existing jobs keep theirs (D154). The studio's composite key keeps it inside the
 * studio; the database writes job_template.made_default.
 */
export const POST = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Template not found.");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  await loadTemplate(supabase, studio.id, id);
  check(await supabase.from("studios").update({ default_job_template_id: id }).eq("id", studio.id));
  return NextResponse.json({ template: await loadTemplate(supabase, studio.id, id) });
});
