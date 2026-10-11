import type { Metadata } from "next";
import { Gallery } from "./gallery";

// Review page for the design system (Phase 0, step 2). Hidden from search; admin-only once logins exist.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ComponentsPage() {
  return <Gallery />;
}
