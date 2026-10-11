import { isDataRegion, regionDatabase } from "@daybell/config";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/api";
import { REGION_COOKIE, REGION_COOKIE_OPTIONS } from "@/lib/region";
import { ensureStudio } from "@/lib/studio";
import { supabaseFor, supabaseForSession } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "recovery",
  "signup",
  "magiclink",
  "invite",
  "email_change",
]);

/**
 * Where email links land (sign-up, sign-in link, password reset). Our email templates send `token_hash`, which works in
 * any browser or device; `code` (same browser only) is still accepted. The link names its region, so it reaches the
 * right regional database even on a device that has never visited Daybell (D113).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const regionParam = url.searchParams.get("region");
  const fail = NextResponse.redirect(new URL("/sign-in?link=expired", url.origin));

  try {
    const region = isDataRegion(regionParam) && regionDatabase(regionParam) ? regionParam : null;
    const supabase = region ? await supabaseFor(region) : (await supabaseForSession()).supabase;
    const { data, error } =
      tokenHash && type && OTP_TYPES.has(type)
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        : code
          ? await supabase.auth.exchangeCodeForSession(code)
          : { data: { user: null }, error: new Error("missing link parameters") };
    if (error || !data.user) return fail;
    if (region) (await cookies()).set(REGION_COOKIE, region, REGION_COOKIE_OPTIONS);
    await ensureStudio(supabase, data.user);
    return NextResponse.redirect(new URL(next, url.origin));
  } catch {
    return fail;
  }
}
