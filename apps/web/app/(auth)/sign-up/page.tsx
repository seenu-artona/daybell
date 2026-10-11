import { availableRegions } from "@daybell/config";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const regions = availableRegions().map((r) => r.region);
  return (
    <SignUpForm
      regions={regions}
      inviteToken={invite && /^[0-9a-f]{64}$/.test(invite) ? invite : null}
    />
  );
}
