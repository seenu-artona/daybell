import "server-only";
import { ApiError, type MeResponse, type StudioRole, type StudioSummary } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import {
  canEditRoster,
  canFulfil,
  canManagePayouts,
  canRefund,
  canSeeOrders,
  canSeePayouts,
} from "@daybell/core";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { check, requireUser } from "./api";
import { supabaseForSession } from "./supabase/server";

/**
 * After the email is confirmed, create the studio the person asked for at sign-up (saved on their account then).
 * Safe to call repeatedly: it does nothing once they belong to a studio.
 */
export async function ensureStudio(supabase: SupabaseClient, user: User): Promise<void> {
  const name = user.user_metadata?.studio_name;
  const slug = user.user_metadata?.studio_slug;
  if (typeof name !== "string" || typeof slug !== "string") return;
  const { data } = await supabase
    .from("studio_members")
    .select("studio_id")
    .eq("user_id", user.id)
    .limit(1);
  if (data && data.length > 0) return;
  // If someone took the web address between sign-up and confirmation, add a short suffix rather than leave the
  // person stuck; they can change it in settings.
  for (const candidate of [slug, `${slug.slice(0, 35)}-${randomSuffix()}`]) {
    const result = await supabase.rpc("create_studio", { p_name: name, p_slug: candidate });
    if (!result.error) return;
    if (result.error.code !== "23505") check(result);
  }
}

function randomSuffix(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function currentStudio(
  supabase: SupabaseClient,
  user: User,
  region: DataRegion,
): Promise<StudioSummary | null> {
  const rows = check(
    await supabase
      .from("studio_members")
      .select("role, studios (id, name, slug)")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(1),
  ) as unknown as {
    role: StudioRole;
    studios: { id: string; name: string; slug: string } | null;
  }[];
  const row = rows[0];
  if (!row?.studios) return null;
  return { ...row.studios, region, role: row.role };
}

export async function me(
  supabase: SupabaseClient,
  user: User,
  region: DataRegion,
): Promise<MeResponse> {
  return { email: user.email ?? "", studio: await currentStudio(supabase, user, region) };
}

/**
 * The signed-in person's studio and a client acting as them; every query is still filtered by RLS (D96). userId is
 * the verified person, for the server-only code writes that act for them (ADR 0011). No email here (security review
 * N2): the one route that needs it asks userEmail().
 */
export async function studioScope(): Promise<{
  supabase: SupabaseClient;
  studio: StudioSummary;
  userId: string;
}> {
  const { region, supabase } = await supabaseForSession();
  const user = await requireUser(supabase);
  const studio = await currentStudio(supabase, user, region);
  if (!studio) throw new ApiError("not_found", "You're not part of a studio yet.");
  return { supabase, studio, userId: user.id };
}

/**
 * The signed-in person's sign-in email from the verified auth user (getUser(), never the cookie, the request or
 * user_metadata), or null when the account has none. Personal data: never logged. Only the payouts onboarding link
 * calls it, after the owner check, to send Stripe its contact email (ADR 0020 section 16; security review N2).
 */
export async function userEmail(supabase: {
  auth: { getUser: () => Promise<{ data: { user: User | null } }> };
}): Promise<string | null> {
  const user = await requireUser(supabase);
  return user.email || null;
}

/** Owners and admins only. The database enforces this too; checking first gives a clear error instead of no change. */
export function assertCanManage(studio: StudioSummary): void {
  if (studio.role !== "owner" && studio.role !== "admin")
    throw new ApiError("forbidden", "Owners and admins only.");
}

/** Owners, admins and photographers edit the roster; staff only read (Seenu, Oct 11 2026). The database enforces it too. */
export function assertCanEditRoster(studio: StudioSummary): void {
  if (!canEditRoster(studio.role))
    throw new ApiError("forbidden", "Owners, admins and photographers only.");
}

/** Payouts (ADR 0020; Seenu, answer 1): owners and admins see them; photographers and staff don't. */
export function assertCanSeePayouts(studio: StudioSummary): void {
  if (!canSeePayouts(studio.role)) throw new ApiError("forbidden", "Owners and admins only.");
}

/**
 * Payout management (connecting, the schedule, Stripe links): only the owner today (Seenu, answer 1). Named for the
 * payouts rule, not for "owner", so other owner-only checks never borrow it by accident. The database checks it again.
 */
export function assertCanManagePayouts(studio: StudioSummary): void {
  if (!canManagePayouts(studio.role)) throw new ApiError("forbidden", "The studio owner only.");
}

/** Orders (ADR 0024; Q4): owners, admins and staff see and fulfil them; photographers don't. The database checks too. */
export function assertCanSeeOrders(studio: StudioSummary): void {
  if (!canSeeOrders(studio.role) || !canFulfil(studio.role))
    throw new ApiError("forbidden", "Owners, admins and staff only.");
}

/** Refunds and taking a step back (answer 3): owners and admins. The database checks too. */
export function assertCanRefund(studio: StudioSummary): void {
  if (!canRefund(studio.role)) throw new ApiError("forbidden", "Owners and admins only.");
}
