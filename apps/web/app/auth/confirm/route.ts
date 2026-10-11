import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/api";
import { ensureStudio } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";

/**
 * Where email links land: sign-up confirmation and password reset. Accepts both link styles Supabase can send
 * (`code` for same-browser links, `token_hash` for links opened anywhere).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const fail = NextResponse.redirect(new URL("/sign-in?link=expired", url.origin));

  try {
    const { supabase } = await supabaseForSession();
    const { data, error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : tokenHash && type
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        : { data: { user: null }, error: new Error("missing link parameters") };
    if (error || !data.user) return fail;
    await ensureStudio(supabase, data.user);
    return NextResponse.redirect(new URL(next, url.origin));
  } catch {
    return fail;
  }
}
