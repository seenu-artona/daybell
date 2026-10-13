import { notFound } from "next/navigation";
import { isFakeStripe } from "@/lib/stripe";
import { fakeCheckoutSummary } from "@/lib/stripe/fake-driver";
import { FakeCheckout } from "./fake-checkout";

export const dynamic = "force-dynamic";

/**
 * The fake Stripe's hosted checkout (STRIPE_DRIVER=fake only: development, CI and end-to-end tests; ADR 0023): the
 * order as Daybell sent it, an email, a test card and, for home delivery, an address. With any other driver, always on
 * Vercel, and for a checkout the fake didn't make, this page doesn't exist.
 */
export default async function FakeCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  if (process.env.VERCEL || !isFakeStripe()) notFound();
  const { session } = await searchParams;
  const summary =
    session && /^cs_test_fake[A-Za-z0-9]{1,64}$/.test(session)
      ? fakeCheckoutSummary(session)
      : null;
  if (!session || !summary) notFound();
  return <FakeCheckout session={session} summary={summary} />;
}
