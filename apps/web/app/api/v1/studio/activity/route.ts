import { ACTIVITY_TYPES, type ActivityItem, ApiError, type StudioRole } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, requireUser } from "@/lib/api";
import { currentStudio } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";

const KNOWN = new Set<string>(ACTIVITY_TYPES);

/**
 * GET /api/v1/studio/activity — the latest 50 things that happened in the studio (owners and admins, D96).
 * Names (people, jobs, organizations) are resolved when read, never stored in events.
 */
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
  // Events hold IDs only; job and organization names are looked up now, so they are always current.
  const subjectsOf = (prefix: string) => [
    ...new Set(
      rows.filter((e) => e.type.startsWith(prefix) && e.subject_id).map((e) => e.subject_id),
    ),
  ];
  const [jobIds, organizationIds] = [subjectsOf("job."), subjectsOf("organization.")];
  const [jobs, organizations] = await Promise.all([
    jobIds.length
      ? supabase.from("jobs").select("id, name").eq("studio_id", studio.id).in("id", jobIds)
      : null,
    organizationIds.length
      ? supabase
          .from("organizations")
          .select("id, name")
          .eq("studio_id", studio.id)
          .in("id", organizationIds)
      : null,
  ]);
  const names = new Map<string, string>(
    [
      ...(jobs ? (check(jobs) ?? []) : []),
      ...(organizations ? (check(organizations) ?? []) : []),
    ].map((r: { id: string; name: string }) => [r.id, r.name]),
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
        subjectName: e.subject_id ? (names.get(e.subject_id) ?? null) : null,
        occurredAt: e.occurred_at,
      };
    });
  return NextResponse.json({ activity });
});
