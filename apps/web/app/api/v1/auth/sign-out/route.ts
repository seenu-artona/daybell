import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { supabaseForSession } from "@/lib/supabase/server";

/** POST /api/v1/auth/sign-out */
export const POST = handle(async (_request: Request) => {
  const { supabase } = await supabaseForSession();
  await supabase.auth.signOut();
  return new NextResponse(null, { status: 204 });
});
