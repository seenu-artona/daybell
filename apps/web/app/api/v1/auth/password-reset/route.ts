import { passwordResetRequestInput } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { supabaseFor } from "@/lib/supabase/server";

/** POST /api/v1/auth/password-reset — always answers the same, so it can't reveal who has an account. */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, passwordResetRequestInput);
  const supabase = await supabaseFor(input.region);
  await supabase.auth.resetPasswordForEmail(input.email, {
    redirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent("/set-password?next=/app")}`,
  });
  return NextResponse.json({ status: "check_email" }, { status: 202 });
});
