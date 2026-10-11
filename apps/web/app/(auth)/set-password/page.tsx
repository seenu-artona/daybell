import { redirect } from "next/navigation";
import { safeNextClient } from "@/lib/safe-next";
import { supabaseForSession } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

/** After confirming an email (sign-up or password reset), people choose their password here. Needs the link's session. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const signedIn = await supabaseForSession()
    .then(async ({ supabase }) => Boolean((await supabase.auth.getUser()).data.user))
    .catch(() => false);
  if (!signedIn) redirect("/sign-in?link=expired");
  return <SetPasswordForm next={safeNextClient(next)} />;
}
