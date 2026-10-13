import type { UnreadCountResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { markRead, unreadCount } from "@/lib/notifications";
import { studioScope } from "@/lib/studio";

/**
 * POST /api/v1/notifications/read-all — marks all the person's own notifications read (ADR 0021). Writes no event
 * (Q3). Returns the unread count after: 0, unless one arrived meanwhile.
 */
export const POST = handle(async (_request: Request) => {
  const { supabase, studio, userId } = await studioScope();
  const scope = { supabase, studioId: studio.id, userId };
  await markRead(scope, "all");
  const body: UnreadCountResponse = { unread: await unreadCount(scope) };
  return NextResponse.json(body);
});
