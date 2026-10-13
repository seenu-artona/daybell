import { type ActivityItem, ApiError, activityQuery, type StudioRole } from "@daybell/api";
import { NextResponse } from "next/server";
import {
  activityType,
  JOB_ACTIVITY_TYPES,
  JOB_SUBJECT_PREFIXES,
  STORED_ACTIVITY_TYPES,
} from "@/lib/activity";
import { check, handle, parseQuery } from "@/lib/api";
import { assertCanManage, studioScope } from "@/lib/studio";

/**
 * GET /api/v1/studio/activity — the latest 50 things that happened in the studio (owners and admins, D96).
 * ?jobId= narrows it to one job of the caller's studio: its own changes, roster imports and QR card prints (D138;
 * ADR 0013, 0015).
 * Names (people, jobs, clients) are resolved when read, never stored in events.
 */
export const GET = handle(async (request: Request) => {
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const { jobId } = parseQuery(request, activityQuery);

  if (jobId) {
    // An explicit check on top of row-level security: another studio's job is simply not found.
    const job = check(
      await supabase
        .from("jobs")
        .select("id")
        .eq("studio_id", studio.id)
        .eq("id", jobId)
        .maybeSingle(),
    );
    if (!job) throw new ApiError("not_found", "Job not found.");
  }

  let eventsQuery = supabase
    .from("events")
    .select("id, type, actor_id, subject_id, data, occurred_at")
    .eq("studio_id", studio.id);
  // Hidden types are filtered here, before the limit, so a big import can't empty the log.
  eventsQuery = jobId
    ? eventsQuery.eq("subject_id", jobId).in("type", [...JOB_ACTIVITY_TYPES])
    : eventsQuery.in("type", [...STORED_ACTIVITY_TYPES]);
  const [events, team] = await Promise.all([
    eventsQuery.order("id", { ascending: false }).limit(50),
    supabase.rpc("studio_team", { p_studio_id: studio.id }),
  ]);
  const rows = check(events) ?? [];
  const emails = new Map(
    ((check(team) ?? []) as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email]),
  );
  // Events hold IDs only; job and client names are looked up now, so they are always current.
  // Events written before organizations became clients (ADR 0009) are shown as client events.
  const subjectsOf = (prefix: string) => [
    ...new Set(
      rows.filter((e) => e.type.startsWith(prefix) && e.subject_id).map((e) => e.subject_id),
    ),
  ];
  // Roster imports and QR card prints point at their job (counts only in the event, D96).
  const [jobIds, clientIds] = [
    [...new Set(JOB_SUBJECT_PREFIXES.flatMap((prefix) => subjectsOf(prefix)))],
    [...subjectsOf("client."), ...subjectsOf("organization.")],
  ];
  const [jobs, clients] = await Promise.all([
    jobIds.length
      ? supabase.from("jobs").select("id, name").eq("studio_id", studio.id).in("id", jobIds)
      : null,
    clientIds.length
      ? supabase.from("clients").select("id, name").eq("studio_id", studio.id).in("id", clientIds)
      : null,
  ]);
  const names = new Map<string, string>(
    [...(jobs ? (check(jobs) ?? []) : []), ...(clients ? (check(clients) ?? []) : [])].map(
      (r: { id: string; name: string }) => [r.id, r.name],
    ),
  );

  const activity: ActivityItem[] = rows
    .filter((e) => activityType(e.type) !== null)
    .map((e) => {
      const data = (e.data ?? {}) as { role?: StudioRole; to?: StudioRole };
      return {
        id: e.id,
        type: activityType(e.type) as ActivityItem["type"],
        actorEmail: e.actor_id ? (emails.get(e.actor_id) ?? null) : null,
        hasActor: e.actor_id !== null,
        subjectEmail:
          e.subject_id && e.type.startsWith("member.") ? (emails.get(e.subject_id) ?? null) : null,
        role: data.to ?? data.role ?? null,
        subjectName: e.subject_id ? (names.get(e.subject_id) ?? null) : null,
        occurredAt: e.occurred_at,
      };
    });
  return NextResponse.json({ activity });
});
