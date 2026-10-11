import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { check, handle, requireUser } from "@/lib/api";
import { supabaseForSession } from "@/lib/supabase/server";

/** DELETE /api/v1/studio/invites/:id — owner withdraws an open invite. */
export const DELETE = handle(
  async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "Invite not found.");
    const { supabase } = await supabaseForSession();
    await requireUser(supabase);
    check(await supabase.rpc("revoke_invite", { p_invite_id: id }));
    return new NextResponse(null, { status: 204 });
  },
);
