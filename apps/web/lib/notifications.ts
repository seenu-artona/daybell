import "server-only";
import { type Notification, notificationData } from "@daybell/api";
import { NOTIFICATION_KINDS, NOTIFICATIONS_SHOWN, type NotificationKind } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";

/**
 * The bell (ADR 0021, call 4). Every read and write goes through the person's own session (row-level security: their
 * own rows in a studio they belong to) and is filtered by their studio and their user id as well, so the scope is plain
 * to read. Ids and counts only; nothing here is ever logged.
 */

/** The job is embedded through the composite studio FK, with its current name (names are never stored here). */
export const NOTIFICATION_COLUMNS = "id, kind, created_at, read_at, data, job:jobs (id, name)";

export interface NotificationRow {
  id: string;
  kind: string;
  created_at: string;
  read_at: string | null;
  data: unknown;
  job: { id: string; name: string } | null;
}

const KNOWN = new Set<string>(NOTIFICATION_KINDS);

/** A row as the API shows it; a kind this code doesn't know (a newer database) is left out. */
export function toNotification(row: NotificationRow): Notification | null {
  if (!KNOWN.has(row.kind)) return null;
  const data = notificationData.safeParse(row.data);
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    createdAt: row.created_at,
    readAt: row.read_at,
    job: row.job ? { id: row.job.id, name: row.job.name } : null,
    data: data.success ? data.data : {},
  };
}

type Scope = { supabase: SupabaseClient; studioId: string; userId: string };

/** The person's own notifications in their studio (a query to finish). */
function mine({ supabase, studioId, userId }: Scope, columns: string, head = false) {
  return supabase
    .from("notifications")
    .select(columns, head ? { count: "exact", head: true } : undefined)
    .eq("studio_id", studioId)
    .eq("user_id", userId);
}

export async function unreadCount(scope: Scope): Promise<number> {
  const result = await mine(scope, "id", true).is("read_at", null);
  check({ data: null, error: result.error });
  return result.count ?? 0;
}

export async function latestNotifications(scope: Scope): Promise<Notification[]> {
  const rows = (check(
    await mine(scope, NOTIFICATION_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(NOTIFICATIONS_SHOWN),
  ) ?? []) as unknown as NotificationRow[];
  return rows.map(toNotification).filter((n): n is Notification => n !== null);
}

/**
 * Marks the person's own unread notifications read: the ones named, or all. The database stamps its own time once (ADR
 * 0021); ids that aren't theirs match nothing.
 */
export async function markRead(scope: Scope, ids: readonly string[] | "all"): Promise<void> {
  let query = scope.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("studio_id", scope.studioId)
    .eq("user_id", scope.userId)
    .is("read_at", null);
  if (ids !== "all") query = query.in("id", [...ids]);
  check(await query);
}
