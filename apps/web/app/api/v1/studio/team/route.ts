import { ApiError, type TeamMember } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, requireUser } from "@/lib/api";
import { currentStudio } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";

/** GET /api/v1/studio/team */
export const GET = handle(async () => {
  const { region, supabase } = await supabaseForSession();
  const user = await requireUser(supabase);
  const studio = await currentStudio(supabase, user, region);
  if (!studio) throw new ApiError("not_found", "You're not part of a studio yet.");
  const rows = check(await supabase.rpc("studio_team", { p_studio_id: studio.id })) as {
    user_id: string;
    email: string;
    role: TeamMember["role"];
  }[];
  const team: TeamMember[] = rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role }));
  return NextResponse.json({ team });
});
