import type { NotificationsResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { latestNotifications, unreadCount } from "@/lib/notifications";
import { studioScope } from "@/lib/studio";

/**
 * GET /api/v1/notifications — the signed-in person's bell (D143: information only; ADR 0021): the 20 latest, with the
 * job's current name, and how many are unread. Their own only.
 */
export const GET = handle(async (_request: Request) => {
  const { supabase, studio, userId } = await studioScope();
  const scope = { supabase, studioId: studio.id, userId };
  const [notifications, unread] = await Promise.all([
    latestNotifications(scope),
    unreadCount(scope),
  ]);
  const body: NotificationsResponse = { notifications, unread };
  return NextResponse.json(body);
});
