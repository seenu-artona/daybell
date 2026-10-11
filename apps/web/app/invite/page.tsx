import type { Metadata } from "next";
import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Invite links look like /invite#<token>; the token never reaches a server log (ADR 0005). */
export default function InvitePage() {
  return <AcceptInvite />;
}
