import { ApiError, passwordUpdateInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody, requireUser } from "@/lib/api";
import { supabaseForSession } from "@/lib/supabase/server";

/** PUT /api/v1/auth/password — set a new password (after a reset link, or while signed in). */
export const PUT = handle(async (request: Request) => {
  const input = await parseBody(request, passwordUpdateInput);
  const { supabase } = await supabaseForSession();
  await requireUser(supabase);
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) {
    throw new ApiError(
      error.code === "same_password" || error.code === "weak_password"
        ? "invalid_input"
        : "internal",
      "Choose a different, stronger password.",
      { password: "validation.passwordWeak" },
    );
  }
  return new NextResponse(null, { status: 204 });
});
