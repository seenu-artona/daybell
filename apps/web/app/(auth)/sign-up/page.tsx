import { availableRegions } from "@daybell/config";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ join?: string }>;
}) {
  const { join } = await searchParams;
  return <SignUpForm regions={availableRegions().map((r) => r.region)} joining={join === "1"} />;
}
