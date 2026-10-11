import { ApiError, inviteInput, type PendingInvite } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import { NextResponse } from "next/server";
import { check, handle, parseBody, requireUser } from "@/lib/api";
import { currentStudio } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";

async function studioOrThrow() {
  const { region, supabase } = await supabaseForSession();
  const user = await requireUser(supabase);
  const studio = await currentStudio(supabase, user, region);
  if (!studio) throw new ApiError("not_found", "You're not part of a studio yet.");
  return { supabase, studio };
}

/** GET /api/v1/studio/invites — open invites (owners and admins). */
export const GET = handle(async () => {
  const { supabase, studio } = await studioOrThrow();
  const rows = check(
    await supabase
      .from("studio_invites")
      .select("id, email, role, expires_at")
      .eq("studio_id", studio.id)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  );
  const invites: PendingInvite[] = (rows ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role as PendingInvite["role"],
    expiresAt: r.expires_at,
  }));
  return NextResponse.json({ invites });
});

/**
 * POST /api/v1/studio/invites — owner invites someone. Returns the invite link once.
 * Until email sending arrives (Phase 0, step 7) the owner shares the link themselves.
 */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, inviteInput);
  const { supabase, studio } = await studioOrThrow();
  const token = check(
    await supabase.rpc("invite_member", {
      p_studio_id: studio.id,
      p_email: input.email,
      p_role: input.role,
    }),
  ) as string;
  // The token travels in the URL fragment (#), which browsers never send to servers, so it stays out of every log.
  const link = `${siteUrl()}/invite#${token}`;
  return NextResponse.json({ link }, { status: 201 });
});
