import { safeNextClient } from "@/lib/safe-next";
import { SetPasswordForm } from "./set-password-form";

/** After confirming an email (sign-up or password reset), people choose their password here. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <SetPasswordForm next={safeNextClient(next)} />;
}
