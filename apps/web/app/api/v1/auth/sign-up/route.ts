import { ApiError, joinSignUpInput, signUpInput } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import { REGION_COOKIE, REGION_COOKIE_OPTIONS } from "@/lib/region";
import { supabaseFor } from "@/lib/supabase/server";

/**
 * POST /api/v1/auth/sign-up
 * - New studio owner: { studioName, studioSlug, region, email, password }. The studio is created once the email is confirmed.
 * - Invited person: { inviteToken, region, email, password }. They join the studio after confirming.
 */
export const POST = handle(async (request: Request) => {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { inviteToken?: unknown } | null;
  const joining = body !== null && typeof body === "object" && "inviteToken" in body;
  const origin = new URL(request.url).origin;

  let region: DataRegion;
  let email: string;
  let password: string;
  let next: string;
  let data: Record<string, string> | undefined;

  if (joining) {
    const input = await parseBody(request, joinSignUpInput);
    ({ region, email, password } = input);
    next = `/invite/${input.inviteToken}`;
  } else {
    const input = await parseBody(request, signUpInput);
    ({ region, email, password } = input);
    next = "/app";
    data = { studio_name: input.studioName, studio_slug: input.studioSlug };
    const available = check(
      await (await supabaseFor(region)).rpc("slug_available", { p_slug: input.studioSlug }),
    );
    if (!available) {
      throw new ApiError("conflict", "That web address is taken.", {
        studioSlug: "validation.slugTaken",
      });
    }
  }

  const supabase = await supabaseFor(region);
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      ...(data ? { data } : {}),
    },
  });
  if (error) {
    if (error.status === 429)
      throw new ApiError("rate_limited", "Too many attempts. Please wait a minute.");
    if (error.code === "weak_password") {
      throw new ApiError("invalid_input", "Choose a stronger password.", {
        password: "validation.passwordWeak",
      });
    }
    // Same answer whether or not the email is already registered (no account discovery).
    if (error.code !== "user_already_exists")
      throw new ApiError("internal", "We couldn't create your account.");
  }

  (await cookies()).set(REGION_COOKIE, region, REGION_COOKIE_OPTIONS);
  return NextResponse.json({ status: "check_email" }, { status: 201 });
});
