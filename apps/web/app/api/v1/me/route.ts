import { NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";
import { me } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";

/** GET /api/v1/me — who is signed in and their studio. (Studios are created at confirm and sign-in, not here.) */
export const GET = handle(async () => {
  const { region, supabase } = await supabaseForSession();
  const user = await requireUser(supabase);
  return NextResponse.json(await me(supabase, user, region));
});
