import { markNotificationsReadInput, type UnreadCountResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { markRead, unreadCount } from "@/lib/notifications";
import { studioScope } from "@/lib/studio";

/**
 * POST /api/v1/notifications/read — marks 1 to 100 of the person's own notifications read (ADR 0021); others' ids match
 * nothing. Writes no event (Q3). Returns the unread count after.
 */
export const POST = handle(async (request: Request) => {
  const { supabase, studio, userId } = await studioScope();
  const { ids } = await parseBody(request, markNotificationsReadInput);
  const scope = { supabase, studioId: studio.id, userId };
  await markRead(scope, ids);
  const body: UnreadCountResponse = { unread: await unreadCount(scope) };
  return NextResponse.json(body);
});
