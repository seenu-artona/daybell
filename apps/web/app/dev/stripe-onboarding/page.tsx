import { notFound } from "next/navigation";
import { isFakeStripe } from "@/lib/stripe";
import { FakeStripe } from "./fake-stripe";

export const dynamic = "force-dynamic";

/**
 * The fake Stripe's "hosted onboarding" and "Express dashboard" (STRIPE_DRIVER=fake only: development, CI and
 * end-to-end tests; ADR 0020). With any other driver, and always on Vercel, this page doesn't exist.
 */
export default async function FakeStripePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.VERCEL || !isFakeStripe()) notFound();
  const { view } = await searchParams;
  return <FakeStripe view={view === "dashboard" ? "dashboard" : "onboarding"} />;
}
