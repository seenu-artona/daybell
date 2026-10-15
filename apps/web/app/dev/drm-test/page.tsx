import { ApiError } from "@daybell/api";
import { drmTestPageEnabled } from "@daybell/config/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentStudio } from "@/lib/studio";
import { supabaseForSession } from "@/lib/supabase/server";
import { DrmTest } from "./drm-test";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("drmTest");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/** The signed-in person's role in their studio; null when nobody is signed in here. */
async function callerRole(): Promise<string | null | undefined> {
  try {
    const { region, supabase } = await supabaseForSession();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    return (await currentStudio(supabase, data.user, region))?.role;
  } catch (err) {
    if (err instanceof ApiError && err.code === "region_unavailable") return null;
    throw err;
  }
}

/**
 * /dev/drm-test (spike; D158; ADR 0032): does hardware DRM make a photo black in screenshots on this device? Only
 * when DRM_TEST_PAGE_ENABLED is true (otherwise it doesn't exist), for a studio's owners and admins; anyone else signed
 * in gets not found, and someone signed out is asked to sign in first.
 */
export default async function DrmTestPage() {
  if (!drmTestPageEnabled()) notFound();
  const role = await callerRole();
  if (role === null) redirect("/sign-in?next=/dev/drm-test");
  if (role !== "owner" && role !== "admin") notFound();
  return <DrmTest />;
}
