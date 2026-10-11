import { NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/api";
import { ensureStudio, me } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";

/** GET /api/v1/me — who is signed in and their studio. */
export const GET = handle(async () => {
  const { region, supabase } = await supabaseForSession();
  const user = await requireUser(supabase);
  await ensureStudio(supabase, user);
  return NextResponse.json(await me(supabase, user, region));
});
