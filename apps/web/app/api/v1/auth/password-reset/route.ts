import { passwordResetRequestInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { supabaseFor } from "@/lib/supabase/server";

/** POST /api/v1/auth/password-reset — always answers the same, so it can't reveal who has an account. */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, passwordResetRequestInput);
  const supabase = await supabaseFor(input.region);
  const origin = new URL(request.url).origin;
  await supabase.auth.resetPasswordForEmail(input.email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });
  return NextResponse.json({ status: "check_email" }, { status: 202 });
});
