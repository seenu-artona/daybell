import { ApiError, signInInput } from "@daybell/api";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { REGION_COOKIE, REGION_COOKIE_OPTIONS } from "@/lib/region";
import { ensureStudio, me } from "@/lib/studio";
import { supabaseFor } from "@/lib/supabase/server";

/** POST /api/v1/auth/sign-in */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, signInInput);
  const supabase = await supabaseFor(input.region);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error || !data.user) {
    if (error?.code === "email_not_confirmed") {
      throw new ApiError(
        "email_not_confirmed",
        "Please confirm your email first. Check your inbox.",
      );
    }
    if (error?.status === 429)
      throw new ApiError("rate_limited", "Too many attempts. Please wait a minute.");
    throw new ApiError("invalid_credentials", "That email and password don't match.");
  }
  (await cookies()).set(REGION_COOKIE, input.region, REGION_COOKIE_OPTIONS);
  await ensureStudio(supabase, data.user);
  return NextResponse.json(await me(supabase, data.user, input.region));
});
