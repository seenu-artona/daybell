import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

// Review page for the design system (Phase 0, step 2). Preview links only: never served on the
// production deployment, and hidden from search. Becomes admin-only once logins exist.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ComponentsPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <Gallery />;
}
