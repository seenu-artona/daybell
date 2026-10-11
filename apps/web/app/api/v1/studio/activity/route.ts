import { ACTIVITY_TYPES, type ActivityItem, ApiError, type StudioRole } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, requireUser } from "@/lib/api";
import { currentStudio } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";

const KNOWN = new Set<string>(ACTIVITY_TYPES);

/** GET /api/v1/studio/activity — the latest 50 things that happened in the studio (owners and admins, D96). */
export const GET = handle(async () => {
  const { region, supabase } = await supabaseForSession();
  const user = await requireUser(supabase);
  const studio = await currentStudio(supabase, user, region);
  if (!studio) throw new ApiError("not_found", "You're not part of a studio yet.");
  if (studio.role !== "owner" && studio.role !== "admin")
    throw new ApiError("forbidden", "Owners and admins only.");

  const [events, team] = await Promise.all([
    supabase
      .from("events")
      .select("id, type, actor_id, subject_id, data, occurred_at")
      .eq("studio_id", studio.id)
      .order("id", { ascending: false })
      .limit(50),
    supabase.rpc("studio_team", { p_studio_id: studio.id }),
  ]);
  const rows = check(events) ?? [];
  const emails = new Map(
    ((check(team) ?? []) as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email]),
  );

  const activity: ActivityItem[] = rows
    .filter((e) => KNOWN.has(e.type))
    .map((e) => {
      const data = (e.data ?? {}) as { role?: StudioRole; to?: StudioRole };
      return {
        id: e.id,
        type: e.type as ActivityItem["type"],
        actorEmail: e.actor_id ? (emails.get(e.actor_id) ?? null) : null,
        subjectEmail:
          e.subject_id && e.type.startsWith("member.") ? (emails.get(e.subject_id) ?? null) : null,
        role: data.to ?? data.role ?? null,
        occurredAt: e.occurred_at,
      };
    });
  return NextResponse.json({ activity });
});
