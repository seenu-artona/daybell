import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  return <AcceptInvite token={token} />;
}
