import { ApiError, joinSignUpInput, signUpInput } from "@daybell/api";
import { type DataRegion, siteUrl } from "@daybell/config";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import { REGION_COOKIE, REGION_COOKIE_OPTIONS } from "@/lib/region";
import { supabaseFor } from "@/lib/supabase/server";

/**
 * POST /api/v1/auth/sign-up — passwordless (ADR 0005). We email a link; after confirming, the person chooses a password.
 * - New studio owner: { studioName, studioSlug, region, email }. The studio is created once the email is confirmed.
 * - Invited person: { join: true, region, email }. They come back to the invite after confirming.
 * Always answers the same way, so it never reveals whether an email already has an account.
 */
export const POST = handle(async (request: Request) => {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { join?: unknown } | null;
  const joining = body?.join === true;

  let region: DataRegion;
  let email: string;
  let next: string;
  let data: Record<string, string> | undefined;

  if (joining) {
    ({ region, email } = await parseBody(request, joinSignUpInput));
    next = "/invite";
  } else {
    const input = await parseBody(request, signUpInput);
    ({ region, email } = input);
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
  const afterConfirm = `/set-password?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(afterConfirm)}`,
      ...(data ? { data } : {}),
    },
  });
  if (error?.status === 429)
    throw new ApiError("rate_limited", "Too many attempts. Please wait a minute.");
  if (error) throw new ApiError("internal", "We couldn't send the email. Please try again.");

  (await cookies()).set(REGION_COOKIE, region, REGION_COOKIE_OPTIONS);
  return NextResponse.json({ status: "check_email" }, { status: 201 });
});
