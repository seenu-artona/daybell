import type { JobCategory } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { studioScope } from "@/lib/studio";

/** GET /api/v1/job-categories — the studio's job categories in display order. */
export const GET = handle(async () => {
  const { supabase, studio } = await studioScope();
  const rows = check(
    await supabase
      .from("job_categories")
      .select("id, name, position")
      .eq("studio_id", studio.id)
      .order("position")
      .order("name"),
  ) as JobCategory[] | null;
  return NextResponse.json({ categories: rows ?? [] });
});
