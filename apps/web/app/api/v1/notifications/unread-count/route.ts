import type { UnreadCountResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { unreadCount } from "@/lib/notifications";
import { studioScope } from "@/lib/studio";

/** GET /api/v1/notifications/unread-count — the bell's badge (ADR 0021): a count of the person's own unread ones. */
export const GET = handle(async (_request: Request) => {
  const { supabase, studio, userId } = await studioScope();
  const body: UnreadCountResponse = {
    unread: await unreadCount({ supabase, studioId: studio.id, userId }),
  };
  return NextResponse.json(body);
});
