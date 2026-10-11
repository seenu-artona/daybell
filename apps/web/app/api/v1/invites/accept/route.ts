import { acceptInviteInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody, requireUser } from "@/lib/api";
import { me } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";

/** POST /api/v1/invites/accept — the invited person joins the studio. */
export const POST = handle(async (request: Request) => {
  const { token } = await parseBody(request, acceptInviteInput);
  const { region, supabase } = await supabaseForSession();
  const user = await requireUser(supabase);
  check(await supabase.rpc("accept_invite", { p_token: token }));
  return NextResponse.json(await me(supabase, user, region));
});
