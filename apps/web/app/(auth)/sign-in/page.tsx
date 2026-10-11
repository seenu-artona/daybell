import { availableRegions } from "@daybell/config";
import { safeNextClient } from "@/lib/safe-next";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; link?: string }>;
}) {
  const { next, link } = await searchParams;
  return (
    <SignInForm
      regions={availableRegions().map((r) => r.region)}
      next={safeNextClient(next)}
      linkExpired={link === "expired"}
    />
  );
}
